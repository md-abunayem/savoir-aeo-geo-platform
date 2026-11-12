import { providerFailure } from "./provider-errors.js";

export type MonitoringEngineType =
  "gemini" | "openai" | "google_ai_overviews" | "google_ai_mode" | "openrouter";

export interface MonitoringRequest {
  engine: MonitoringEngineType;
  model: string;
  promptId: string;
  promptVersion: number;
  prompt: string;
  maxOutputTokens?: number;
  persona: string;
  geo: string;
  language: string;
  sample: number;
  simulationMethod: "prompt_context";
  collectionMethod: "official_api" | "licensed_serp" | "aggregator_api";
  policyVersion: string;
}
export interface ProviderResult {
  status: "succeeded" | "refused";
  text: string;
  modelVersion: string;
  latencyMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  citations: { url: string; title: string }[];
  searchQueries: string[];
  searchEntryPoint: unknown;
  grounded: boolean;
  raw: unknown;
  estimatedCostUsd: number | null;
  refusalReason: string | null;
}
export interface MonitoringProvider {
  execute(request: MonitoringRequest): Promise<ProviderResult>;
}
export class MonitoringProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfter = 0,
    readonly uncertain = false,
    readonly httpStatus: number | null = null,
  ) {
    super(providerFailure(code).message);
  }
  get category() {
    return providerFailure(this.code).category;
  }
}
export interface EvidenceStore {
  put(key: string, value: string): Promise<void>;
  get(key: string): Promise<string>;
}
export interface ClaimedRun {
  id: string;
  tenant_id: string;
  project_id: string;
  request: MonitoringRequest;
  attempts: number;
  lease_id: string;
}
