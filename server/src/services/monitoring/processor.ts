import { createHash } from "node:crypto";
import type { Pool } from "pg";
import {
  MonitoringProviderError,
  type ClaimedRun,
  type EvidenceStore,
  type MonitoringProvider,
  type MonitoringEngineType,
} from "./types.js";
import { processAnswerForRun } from "../answer/answer-pipeline.service.js";

export function monitoringRetryDelay(attempt: number, providerDelay: number, random = Math.random) {
  const base = Math.min(3600, 10 * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(base * 0.25 * Math.max(0, Math.min(1, random())));
  return Math.min(604800, Math.max(providerDelay, base + jitter));
}
// Baseline minimization, not a complete private-person PII classifier.
export function redactEvidence(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL REDACTED]");
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactEvidence(v)]));
  return value;
}
export function createMonitoringProcessor(
  pool: Pool,
  provider: MonitoringProvider,
  storage: EvidenceStore,
  config: {
    dailyLimit: number;
    spacingSeconds: number;
    onFailure?: (details: Record<string, unknown>) => void;
  },
) {
  const finish = async (
    run: ClaimedRun,
    status: string,
    result: unknown,
    code: string | null,
    delay: number,
  ) =>
    pool.query("SELECT savoir_monitoring_finish($1,$2,$3,$4,$5,$6)", [
      run.id,
      run.lease_id,
      status,
      result,
      code,
      delay,
    ]);
  async function processNext(target?: {
    runId: string;
    engine: MonitoringEngineType;
  }): Promise<boolean> {
    const result = target
      ? await pool.query<ClaimedRun>("SELECT * FROM savoir_monitoring_claim_run($1,$2,$3,$4)", [
          target.runId,
          target.engine,
          config.dailyLimit,
          config.spacingSeconds,
        ])
      : await pool.query<ClaimedRun>("SELECT * FROM savoir_monitoring_claim($1,$2)", [
          config.dailyLimit,
          config.spacingSeconds,
        ]);
    const run = result.rows[0];
    if (!run) return false;
    let answer;
    try {
      answer = await provider.execute(run.request);
    } catch (error) {
      const known = error instanceof MonitoringProviderError;
      const retry = known && error.retryable && run.attempts < 4;
      await finish(
        run,
        retry ? "queued" : known && error.uncertain ? "uncertain" : "failed",
        {
          failure: {
            provider: run.request.engine,
            model: run.request.model,
            category: known ? error.category : "PROVIDER_UNAVAILABLE",
            message: known ? error.message : "Unexpected provider execution failure.",
            httpStatus: known ? error.httpStatus : null,
            retryable: known && error.retryable,
            attempts: run.attempts,
            retryAttempts: Math.max(0, run.attempts - 1),
            retryBudgetExhausted: known && error.retryable && !retry,
            timestamp: new Date().toISOString(),
            status: retry ? "queued" : known && error.uncertain ? "uncertain" : "failed",
          },
        },
        known ? error.code : "PROVIDER_UNEXPECTED",
        retry ? monitoringRetryDelay(run.attempts, error.retryAfter) : 0,
      );
      config.onFailure?.({
        runId: run.id,
        provider: run.request.engine,
        model: run.request.model,
        code: known ? error.code : "PROVIDER_UNEXPECTED",
        category: known ? error.category : "PROVIDER_UNAVAILABLE",
        httpStatus: known ? error.httpStatus : null,
        attempts: run.attempts,
        retryScheduled: retry,
        uncertain: known && error.uncertain,
      });
      return true;
    }
    const evidenceKey = `monitoring/${run.tenant_id}/${run.project_id}/${run.id}/${run.lease_id}.json`;
    const evidence = JSON.stringify(
      redactEvidence({
        request: run.request,
        response: answer.raw,
        redactionVersion: "email-v1",
      }),
    );
    const evidenceHash = createHash("sha256").update(evidence).digest("hex");
    try {
      await storage.put(evidenceKey, evidence);
    } catch {
      await finish(run, "uncertain", null, "EVIDENCE_WRITE_UNCERTAIN", 0);
      return true;
    }
    const { raw: _raw, ...normalized } = answer;
    const engine = run.request.engine || "gemini";
    // A failed DB completion leaves an ambiguous lease; recovery refunds it without another API call.
    await finish(
      run,
      answer.status,
      redactEvidence({
        ...normalized,
        evidenceKey,
        evidenceHash,
        parserVersion: `${engine}-v1`,
        costBasis: engine.startsWith("google_ai_")
          ? "serp-call-fee"
          : "token-estimate-excludes-grounding",
        collectedAt: new Date().toISOString(),
      }),
      null,
      0,
    );
    // Fail visibly; the next tick retries extraction without repeating the paid call.
    await processAnswerForRun(pool, run.id);
    return true;
  }
  return {
    async tick() {
      await pool.query("SELECT savoir_monitoring_tick()");
      const pending = await pool.query<{ id: string }>("SELECT * FROM savoir_answer_pending()");
      for (const run of pending.rows) await processAnswerForRun(pool, run.id);
    },
    processNext: () => processNext(),
    processRun: (runId: string, engine: MonitoringEngineType) => processNext({ runId, engine }),
  };
}
