"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Clock3, Play, Pause, Trash2, Plus, LoaderCircle } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { monitoringEngines, pendingRunKey, runSelection, type MonitoringEngine } from "../lib/monitoring-input";
import type { Project, Snapshot, Schedule } from "../lib/types";
export function MonitoringControls({
  project,
  data,
  onChanged,
  pagination,
}: {
  project: Project;
  data: Snapshot;
  onChanged: () => void;
  pagination?: { prompts: boolean; schedules: boolean; loading: boolean; more: (kind: "prompts" | "schedules") => void };
}) {
  const [mode, setMode] = useState<"schedule" | "manual">("schedule"),
    [selection, setSelection] = useState<string[]>([]),
    [samples, setSamples] = useState(1);
  const [cadence, setCadence] = useState("daily"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<string | null>(null);
  const [countries, setCountries] = useState("US"),
    [languages, setLanguages] = useState("en");
  const inFlight = useRef(false);
  const fallbackKeys = useRef(new Map<string, string>());
  const [engineChoice, setEngineChoice] = useState("");
  useEffect(() => {
    if (window.location.hash === "#schedules") {
      document.getElementById("schedules")?.scrollIntoView({ block: "start" });
    }
  }, []);
  const names: Record<string, string> = { openrouter: "OpenRouter / GPT-6 Luna", gemini: "Gemini", openai: "ChatGPT", google_ai_overviews: "Google AI Overviews", google_ai_mode: "Google AI Mode (unsupported by Serper)" };
  const base = `/v1/tenants/${project.tenantId}/projects/${project.id}/monitoring`;
  const available = data.prompts.filter((p) => p.active);
  const selected = selection.filter((id) => available.some((p) => p.id === id));
  const engines = data.engines.filter((e) => monitoringEngines.includes(e.engine as MonitoringEngine));
  const engine = engines.find((e) => e.engine === engineChoice) ?? engines.find((e) => e.configured) ?? engines[0];
  const enabled = Boolean(engine?.configured);
  const engineName = names[engine?.engine ?? "gemini"];
  const minimum = data.health.credits?.minimum_interval_minutes ?? 1440;
  const effectiveCadence = (cadence === "daily" && minimum > 1440) || (cadence === "weekly" && minimum > 10080)
    ? minimum <= 10080 ? "weekly" : "custom" : cadence;
  let estimatedRuns: number | null = null;
  try {
    const estimate = runSelection(selected, countries, languages, samples, engine?.engine);
    estimatedRuns =
      estimate.promptIds.length *
      estimate.geos.length *
      estimate.languages.length *
      estimate.samples;
  } catch {
    /* The form reports incomplete selections on submission. */
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      const input = runSelection(
        selected,
        String(form.get("countries")),
        String(form.get("languages")),
        samples,
        engine?.engine,
      );
      if (!enabled)
        throw new Error(
          engine?.engine === "google_ai_mode"
            ? "Google AI Mode is not supported by the configured Serper provider. Choose another available engine."
            : `${engineName} is not configured. Configure this engine or choose an available engine before collecting or scheduling.`,
        );
      const operation = mode === "manual" ? "run" : "schedule";
      const storageKey = `savoir.pending-${operation}.` + project.id;
      const storage = {
        getItem: (key: string) => {
          try { return fallbackKeys.current.get(key) ?? window.sessionStorage.getItem(key); }
          catch { return fallbackKeys.current.get(key) ?? null; }
        },
        setItem: (key: string, value: string) => {
          fallbackKeys.current.set(key, value);
          try { window.sessionStorage.setItem(key, value); } catch { /* Memory retains the retry key. */ }
        },
        removeItem: (key: string) => {
          fallbackKeys.current.delete(key);
          try { window.sessionStorage.removeItem(key); } catch { fallbackKeys.current.set(key, "null"); }
        },
      };
      if (mode === "manual") {
        const key = pendingRunKey(project.id, input, storage);
        const result = await api.request<{ runIds: string[] }>(base + "/runs", {
          method: "POST",
          body: input,
          headers: { "Idempotency-Key": key },
        });
        storage.removeItem(storageKey);
        setNotice(
          `${result.runIds.length} runs queued. Credits are reserved until each run completes.`,
        );
      } else {
        const interval = Number(form.get("interval"));
        if (
          effectiveCadence === "custom" &&
          (!Number.isInteger(interval) ||
            interval < minimum ||
            interval > 43200)
        )
          throw new Error(
            `Custom intervals must be between ${minimum} and 43200 minutes.`,
          );
        const payload = { ...input, cadence: effectiveCadence, ...(effectiveCadence === "custom" ? { intervalMinutes: interval } : {}) };
        const key = pendingRunKey(project.id, payload, storage, "schedule");
        await api.request(base + "/schedules", {
          method: "POST",
          body: payload,
          headers: { "Idempotency-Key": key },
        });
        storage.removeItem(storageKey);
        setSelection([]);
        setNotice(
          "Schedule created. Its first cycle is due immediately.",
        );
      }
      onChanged();
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 0 || (e.status >= 500 && e.code !== "ENGINE_NOT_CONFIGURED" && e.code !== "MONITORING_DISABLED"))
          ? "The result could not be confirmed. Retry with the same choices to reuse the request and prevent duplicate charges."
          : e instanceof Error
            ? e.message
            : "The request failed.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function status(
    schedule: Schedule | null,
    status: "active" | "paused" | "deleted",
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.request(
        schedule
          ? base + "/schedules/" + schedule.id
          : base + "/schedules/status",
        {
          method: schedule
            ? status === "deleted"
              ? "DELETE"
              : "PATCH"
            : "POST",
          ...(status === "deleted" && schedule ? {} : { body: { status } }),
        },
      );
      setConfirm(null);
      setNotice(
        status === "deleted"
          ? "Schedule deleted. Already reserved runs and history are preserved."
          : status === "active"
            ? "Schedule resumed. The next cycle is due immediately; quota checks still apply."
            : "Future scheduling paused. Already reserved runs continue.",
      );
      onChanged();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The schedule could not be changed.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel monitoring-create">
        <header className="panel-head">
          <div>
            <h2>Plan your next collection</h2>
            <p>{engineName} · {engine?.model ?? "Provider setup required"}</p>
            {engine?.engine === "openrouter" && <p>Live web search enabled · input/output token prices capped at $0.10/$0.50 per million · search fees may apply separately.</p>}
          </div>
        </header>
        <div className="mode-tabs" role="group" aria-label="Collection type">
          <button
            type="button"
            aria-pressed={mode === "schedule"}
            onClick={() => {
              setMode("schedule");
              setSamples(1);
              setError("");
            }}
            disabled={busy}
          >
            <Clock3 size={15} />
            Recurring schedule
          </button>
          <button
            type="button"
            aria-pressed={mode === "manual"}
            onClick={() => {
              setMode("manual");
              setSamples(3);
              setError("");
            }}
            disabled={busy}
          >
            <Play size={15} />
            Manual run
          </button>
        </div>
        {error && (
          <p className="error control-notice" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice control-notice" role="status">
            {notice}
          </p>
        )}
        {pagination?.prompts && <button type="button" className="button" disabled={busy || pagination.loading} onClick={() => pagination.more("prompts")}>Load more prompts</button>}
        {!available.length ? (
          <p className="table-empty">
            Add or resume a prompt to start.{" "}
            <Link className="text-link" href={`/prompts?project=${encodeURIComponent(project.id)}`}>
              Manage prompts
            </Link>
          </p>
        ) : (
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <legend>
                Choose active prompts{" "}
                <small>({selected.length} selected · {data.prompts.length} loaded)</small>
              </legend>
              <div className="prompt-checks">
                {available.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={(e) =>
                        setSelection((ids) =>
                          e.target.checked
                            ? [...ids, p.id]
                            : ids.filter((id) => id !== p.id),
                        )
                      }
                    />
                    <span>{p.body}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="collection-fields">
              <label>
                AI engine
                <select value={engine?.engine ?? ""} onChange={(e) => setEngineChoice(e.target.value)} disabled={busy}>
                  {!engines.length && <option value="">No engines available</option>}
                  {engines.map((item) => <option key={item.engine} value={item.engine}>{names[item.engine]}{item.configured || item.engine === "google_ai_mode" ? "" : " (not configured)"}</option>)}
                </select>
                {engine?.engine === "google_ai_mode" && (
                  <small>Serper supports Google AI Overviews through Search, but does not provide AI Mode results.</small>
                )}
              </label>
              <label>
                Countries
                <input
                  name="countries"
                  value={countries}
                  onChange={(event) => setCountries(event.target.value)}
                  placeholder="US, GB"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Languages
                <input
                  name="languages"
                  value={languages}
                  onChange={(event) => setLanguages(event.target.value)}
                  placeholder="en, fr"
                  required
                  disabled={busy}
                />
              </label>
              <label>
                Samples
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={samples}
                  onChange={(e) => setSamples(Number(e.target.value))}
                  required
                  disabled={busy}
                />
              </label>
              {mode === "schedule" && (
                <label>
                  Frequency
                  <select
                    value={effectiveCadence}
                    onChange={(e) => setCadence(e.target.value)}
                    disabled={busy}
                  >
                    <option value="daily" disabled={minimum > 1440}>
                      Daily
                    </option>
                    <option value="weekly" disabled={minimum > 10080}>
                      Weekly
                    </option>
                    <option value="custom">Custom interval</option>
                  </select>
                </label>
              )}
              {mode === "schedule" && effectiveCadence === "custom" && (
                <label>
                  Interval in minutes
                  <input
                    name="interval"
                    type="number"
                    min={minimum}
                    max={43200}
                    defaultValue={minimum}
                    required
                    disabled={busy}
                  />
                </label>
              )}
            </div>
            <p className="form-explanation" aria-live="polite">
              {estimatedRuns !== null && (
                <strong>
                  {estimatedRuns} runs · {estimatedRuns} credits{" "}
                  {mode === "schedule" ? "per cycle" : "reserved on submission"}
                  .{" "}
                </strong>
              )}
              One credit per prompt × country × language × sample. Manual runs
              reserve credits immediately; schedules reserve credits when each
              cycle starts. Times use fixed UTC intervals.
            </p>
            {!enabled && (
              <p className="execution-notice">
                {engineName} is not configured. Configure this engine or choose an available engine before collecting or scheduling.
              </p>
            )}
            {project.status !== "active" && (
              <p className="execution-notice">
                Activate this project before configuring collection.
              </p>
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                !selected.length ||
                project.status !== "active" ||
                !enabled
              }
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : mode === "schedule" ? (
                <Plus size={15} />
              ) : (
                <Play size={15} />
              )}{" "}
              {mode === "schedule" ? "Create schedule" : "Queue manual run"}
            </button>
          </form>
        )}
      </section>
      <section className="panel schedules-panel" id="schedules">
        <header className="panel-head">
          <div>
            <h2>Monitoring schedules</h2>
            <p>{data.schedules.length} schedules loaded · displayed in your local time zone</p>
          </div>
          {data.schedules.length > 0 && (
            <div className="actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => status(null, "paused")}
              >
                Pause all
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => status(null, "active")}
              >
                Resume all
              </button>
            </div>
          )}
        </header>
        {data.schedules.length ? (
          <div className="schedule-cards">
            {data.schedules.map((s) => (
              <article key={s.id} aria-label={"Schedule " + s.id}>
                <div className="schedule-summary">
                  <Clock3 size={18} />
                  <div>
                    <h3>
                      {names[s.config.engine ?? "gemini"] ?? s.config.engine} · {s.config.cadence} · {s.config.promptIds.length} prompts
                    </h3>
                    <p>
                      Next due: {new Date(s.next_run_at).toLocaleString()} ·{" "}
                      {s.config.samples} samples
                    </p>
                    {Boolean(s.config.pausedPromptIds?.length) && (
                      <small>
                        {s.config.pausedPromptIds!.length} prompts paused within
                        this schedule
                      </small>
                    )}
                  </div>
                  <span className={"pill status-" + s.status}>
                    {s.status.replaceAll("_", " ")}
                  </span>
                </div>
                <div className="schedule-actions">
                  {confirm === s.id ? (
                    <>
                      <span>
                        Delete future scheduling? Queued runs will remain.
                      </span>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => status(s, "deleted")}
                      >
                        Confirm deletion
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setConfirm(null)}
                        disabled={busy}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          status(s, s.status === "active" ? "paused" : "active")
                        }
                      >
                        {s.status === "active" ? (
                          <Pause size={13} />
                        ) : (
                          <Play size={13} />
                        )}{" "}
                        {s.status === "active"
                          ? "Pause schedule"
                          : "Resume schedule"}
                      </button>
                      <button
                        className="text-button danger"
                        disabled={busy}
                        onClick={() => setConfirm(s.id)}
                      >
                        <Trash2 size={13} />
                        Delete schedule
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="table-empty">
            No schedules yet. Choose prompts and a frequency above to create
            one.
          </p>
        )}
        {pagination?.schedules && <button type="button" className="button" disabled={busy || pagination.loading} onClick={() => pagination.more("schedules")}>Load more schedules</button>}
      </section>
    </>
  );
}
