import type { MemoryService } from "../memory/memory.service.js";

export interface StudioModelConfig {
  apiKey?: string;
  model: string;
}
export type StudioMemory = Pick<
  MemoryService,
  "searchRelevantFacts" | "getApprovedBrandRules" | "getApprovedProductFacts"
>;
export interface FlaggedClaim {
  path: string;
  claim: string;
  code:
    | "UNSUPPORTED_CLAIM"
    | "CONTRADICTED_CLAIM"
    | "BRAND_RULE"
    | "X_LENGTH"
    | "IG_SLIDE_COUNT"
    | "HOOK_LENGTH"
    | "VERIFICATION_UNAVAILABLE";
  reason: string;
  evidenceIds: string[];
}
export interface ValidationReport {
  passed: boolean;
  flaggedClaims: FlaggedClaim[];
  suggestions: string[];
}
