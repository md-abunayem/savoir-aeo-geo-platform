export interface User {
  id: string;
  name: string;
  email: string;
}
export interface Project {
  id: string;
  tenantId: string;
  tenantName: string;
  brandName: string;
  domain: string;
  status: string;
}
export interface Prompt {
  id: string;
  body: string;
  persona: string;
  tags?: string[];
  version: number;
  active: boolean;
  archived_at?: string | null;
  created_at?: string;
  updated_at?: string;
  visibility?: number | null;
  cited_count?: number;
  answer_count?: number;
  engines?: string[];
}
export interface Health {
  backlog: number;
  credits_used: number;
  last_successful_run: string | null;
  success_rate_7d: number | null;
  credits: {
    available: number;
    reserved: number;
    minimum_interval_minutes: number;
    used: number;
  } | null;
}
export interface Engine {
  engine: string;
  configured: boolean;
  model?: string;
  collectionMethod?: string;
  observationStatus?: "succeeded" | "failed" | "refused" | "uncertain" | null;
  observedStatus?: string | null;
  observedAt?: string | null;
  observedModel?: string | null;
  errorCode?: string | null;
}
export interface Run {
  id: string;
  status: string;
  error_code: string | null;
  created_at: string;
  available_at?: string;
  attempts?: number;
  answer_processed?: boolean;
  request: {
    prompt: string;
    engine: string;
    model?: string;
    geo: string;
    language: string;
  };
  result: {
    text?: string;
    modelVersion?: string;
    grounded?: boolean;
    citations?: { url: string; title?: string }[];
  } | null;
}
export interface Schedule {
  id: string;
  status: string;
  next_run_at: string;
  config: {
    engine?: string;
    cadence: string;
    promptIds: string[];
    pausedPromptIds?: string[];
    samples: number;
  };
}
export interface Snapshot {
  health: Health;
  engines: Engine[];
  runs: Run[];
  prompts: Prompt[];
  schedules: Schedule[];
}

export interface BrandProfile {
  brandName: string;
  aliases: string[];
  description: string;
  category: string;
  products: string[];
  primaryLanguage: string;
}

export interface CompetitorInput {
  name: string;
  domain: string;
  rationale?: string;
  aliases?: string[];
}

export interface MarketInput {
  country: string;
  language: string;
}

export interface PromptInput {
  text: string;
  intent: "informational" | "comparison" | "transactional" | "navigational";
  funnelStage: "awareness" | "consideration" | "decision";
  priority: number;
  tags: string[];
  persona?: string;
}

export interface CostEstimation {
  promptCount: number;
  engineCount: number;
  dailyRuns: number;
  monthlyCredits: number;
  planLimit: number;
  crawlPageBudget: number;
  withinBudget: boolean;
}

export interface OnboardingDraftData {
  domain?: string;
  brandProfile?: BrandProfile;
  competitors?: CompetitorInput[];
  markets?: MarketInput[];
  prompts?: PromptInput[];
  engines?: string[];
  fromGraderToken?: string;
  [key: string]: unknown;
}

export interface OnboardingDraft {
  step: number;
  data: OnboardingDraftData;
  updatedAt?: string;
}

export interface MentionItem {
  id: string;
  entityType: "brand" | "competitor";
  entityId?: string;
  entityName: string;
  matchedText: string;
  positionIndex: number;
  listRank?: number | null;
  sentiment: number;
  confidence: number;
  snippet?: string;
  reviewStatus?: "auto" | "verified" | "false_positive";
  label?: "Observed" | "Estimated";
}

export interface CitationItem {
  id?: string;
  url?: string;
  normalizedUrl?: string;
  domain: string;
  sourceType: string;
  anchorText?: string;
  orderIndex?: number;
}

export interface ClaimItem {
  id: string;
  entityName: string;
  claimText: string;
  theme: string;
  sentiment: number;
  confidence: number;
  label: string;
}

export interface AnswerFlagItem {
  id: string;
  reason: string;
  note?: string;
  tags?: string[];
  status: string;
  createdAt: string;
}

export interface AnswerItem {
  id: string;
  tenantId: string;
  projectId: string;
  runId: string;
  promptId?: string;
  promptText?: string;
  engine: string;
  engineModel?: string;
  geo: string;
  language: string;
  text: string;
  parserVersion: string;
  hasCitations: boolean;
  groundingStatus?: "grounded" | "no_sources" | "ungrounded_mode" | "unknown";
  providerCitations?: { url: string; title?: string }[];
  answerTextUrls?: { url: string; title?: string }[];
  refusalFlag: boolean;
  sourceType: string;
  latencyMs?: number;
  tokensUsed?: number;
  createdAt: string;
  brandMentioned: boolean;
  brandSentiment?: number | null;
  brandPosition?: number | null;
  brandListRank?: number | null;
  citationsCount: number;
  citationDomains: string[];
  flagsCount: number;
  mentions?: MentionItem[];
  citations?: CitationItem[];
  claims?: ClaimItem[];
  flags?: AnswerFlagItem[];
  rawResponse?: unknown;
  sourceDisclosure?: {
    sourceType: string;
    disclosureNote: string;
  };
}

// AI Visibility Analytics Models (VIS & M3)
export type GradeBand = "A" | "B" | "C" | "D" | "F";
export type ConfidenceTier = "adequate" | "low_confidence" | "insufficient";

export interface MetricValueItem {
  value: number;
  label: "Observed" | "Modeled" | "Estimated";
  n: number;
  ciLow?: number;
  ciHigh?: number;
  confidenceTier: ConfidenceTier;
  confidenceLabel: string;
  displayable: boolean;
  delta?: number;
  deltaPercent?: number;
}

export interface EngineBreakdownItem {
  engine: string;
  name: string;
  visibilityRate: number;
  n: number;
  positionScore: number;
  sentimentScore: number;
  citationRate: number;
  compositeScore: number;
  grade: GradeBand;
}

export interface CompetitorVisibilityItem {
  id: string;
  name: string;
  domain?: string | null;
  visibilityRate: number;
  shareOfVoice: number;
  mentionCount: number;
}

export interface PromptBreakdownItem {
  promptId: string;
  text: string;
  priority: number;
  totalRuns: number;
  mentionedRuns: number;
  visibilityRate: number;
  averageRank: number | null;
}

export interface VisibilityOverviewResponse {
  project: {
    id: string;
    brandName: string;
    domain: string;
    description?: string | null;
  };
  timeWindow: {
    current: { from: string; to: string; days: number };
    previous: { from: string; to: string; days: number };
  };
  composite: {
    score: number;
    grade: GradeBand;
    label: "Modeled";
    delta?: number;
    deltaPercent?: number;
    fairShare: number;
    sovRatio: number;
  };
  metrics: {
    visibilityRate: MetricValueItem;
    shareOfVoice: MetricValueItem;
    positionScore: MetricValueItem;
    sentimentScore: MetricValueItem;
    citationRate: MetricValueItem;
    recommendedRate: MetricValueItem;
    netSentiment: { value: number; label: "Estimated" };
  };
  sampleSummary: {
    totalValidRuns: number;
    brandMentionedRuns: number;
    runsWithCitations: number;
    brandCitedRuns: number;
    failureRate: number;
    totalRunsAttempted: number;
  };
  competitors: CompetitorVisibilityItem[];
  engines: EngineBreakdownItem[];
  prompts: PromptBreakdownItem[];
}

export interface TrendPointItem {
  date: string;
  value: number;
  visibilityRate: number;
  sampleSize: number;
  shareOfVoice: number;
  citationRate: number;
  compositeScore: number;
  grade: GradeBand;
  rollingAvg?: number;
}

export interface TrendEventItem {
  date: string;
  title: string;
  description: string;
  type: "engine_update" | "prompt_change" | "milestone";
}

export interface AnomalyItem {
  id: string;
  metric: string;
  entityName: string;
  engine: string;
  currentValue: number;
  previousValue: number;
  currentN: number;
  previousN: number;
  delta: number;
  pValue: number;
  qValue?: number;
  significant: boolean;
}

export interface MetricGoalItem {
  id: string;
  tenant_id: string;
  project_id: string;
  metric_name: string;
  target_value: number;
  deadline?: string | null;
  status: string;
  created_at: string;
}

export interface SavedViewItem {
  id: string;
  tenant_id: string;
  project_id: string;
  name: string;
  filters: Record<string, unknown>;
  created_at: string;
}

export type SourceType =
  | "news_media"
  | "review_comparison"
  | "forum_ugc"
  | "marketplace"
  | "encyclopedia"
  | "academic"
  | "social"
  | "brand"
  | "other";

export interface DomainCitationItem {
  domain: string;
  sourceType: SourceType;
  citationCount: number;
  citationShare: number;
  ciLow: number;
  ciHigh: number;
  distinctPagesCount: number;
  engines: string[];
  trendStatus: "new" | "lost" | "retained";
  delta: number;
  isAllowed: boolean;
  isDenied: boolean;
  citesBrand: boolean;
  citesCompetitors: string[];
}

export interface PageCitationItem {
  url: string;
  normalizedUrl: string;
  domain: string;
  sourceType: SourceType;
  citationCount: number;
  engines: string[];
  promptsCount: number;
  isBrandPage: boolean;
  competitorsCited: string[];
}

export interface CitationGapItem {
  id: string;
  targetDomain: string;
  targetUrl: string;
  sourceType: SourceType;
  competitorsCited: string[];
  engines: string[];
  frequency: number;
  avgPriority: number;
  opportunityScore: number;
  recommendedAction: string;
  status: "open" | "in_progress" | "resolved" | "dismissed";
}

export interface BrokenCitationItem {
  id: string;
  url: string;
  domain: string;
  issueType: "http_4xx" | "http_5xx" | "redirect_chain" | "connection_error";
  httpStatus?: number | null;
  redirectUrl?: string | null;
  citationCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "active" | "in_review" | "resolved" | "dismissed";
  resolutionNotes?: string | null;
}

export interface SourceDomainItem {
  id: string;
  domain: string;
  sourceType: SourceType;
  isAllowed: boolean;
  isDenied: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CitationOverviewResponse {
  project: {
    id: string;
    brandName: string;
    domain: string;
  };
  dateWindow: {
    from: string;
    to: string;
    days: number;
  };
  kpis: {
    totalCitations: number;
    brandCitations: number;
    brandCitationRate: {
      value: number;
      ciLow: number;
      ciHigh: number;
      confidenceBadge:
        | "Low confidence (n < 5)"
        | "High confidence"
        | "Insufficient data (n < 3)";
      isReliable: boolean;
    };
    distinctDomains: number;
    distinctPages: number;
    citationGapsCount: number;
    brokenBrandCitationsCount: number;
  };
  sourceTypeDistribution: Record<SourceType, number>;
  topDomains: DomainCitationItem[];
  topBrandPages: PageCitationItem[];
  topGaps: CitationGapItem[];
  activeBrokenCitations: BrokenCitationItem[];
  metricLabels: {
    citationCounts: "Observed";
    brandCitationRate: "Observed";
    opportunityScore: "Modeled";
    sourceType: "Estimated";
  };
}

export type CompetitorType = "direct" | "indirect" | "aspirational";
export type CandidateEntityType =
  "competitor" | "marketplace" | "publisher" | "tool" | "other";
export type CandidateStatus = "suggested" | "accepted" | "rejected" | "snoozed";
export type HeadToHeadOutcome = "win" | "loss" | "tie";

export interface CompetitorItem {
  id: string;
  name: string;
  domain: string;
  aliases: string[];
  competitorType: CompetitorType;
  rationale?: string | null;
  discoveredVia: string;
  createdAt: string;
  updatedAt: string;
  metrics: {
    visibilityRate: number;
    shareOfVoice: number;
    avgPosition: number;
    sentimentScore: number;
    citationsCount: number;
    headToHead: {
      wins: number;
      losses: number;
      ties: number;
      winRate: number;
    };
  };
}

export interface LeaderboardItem {
  rank: number;
  rankDelta: number;
  entityId: string;
  name: string;
  domain: string;
  isBrand: boolean;
  competitorType?: CompetitorType | null;
  visibilityRate: number;
  ciLow: number;
  ciHigh: number;
  shareOfVoice: number;
  fairShare: number;
  positionScore: number;
  avgPosition: number;
  sentimentScore: number;
  citationShare: number;
  headToHeadWinRate: number;
}

export interface HeadToHeadPromptItem {
  promptId: string;
  promptText: string;
  priority: number;
  brandRank: number | null;
  competitorRank: number | null;
  brandVis: number;
  competitorVis: number;
  outcome: HeadToHeadOutcome;
  engines: string[];
}

export interface HeadToHeadResponse {
  competitor: {
    id: string;
    name: string;
    domain: string;
    competitorType: CompetitorType;
  };
  summary: {
    wins: number;
    losses: number;
    ties: number;
    totalPrompts: number;
    winRate: number;
    brandVisibilityRate: number;
    competitorVisibilityRate: number;
  };
  prompts: HeadToHeadPromptItem[];
}

export interface CompetitiveGapItem {
  promptId: string;
  promptText: string;
  priority: number;
  competitorId: string;
  competitorName: string;
  competitorVis: number;
  brandVis: number;
  gapScore: number;
  promptWeight: number;
  demandIndex: number;
  reasons: string[];
  engines: string[];
}

export interface CompetitorCandidateItem {
  id: string;
  name: string;
  domain: string | null;
  mentionCount: number;
  mentionFrequency: number;
  coOccurrenceCount: number;
  engines: string[];
  sampleAnswerIds: string[];
  entityType: CandidateEntityType;
  status: CandidateStatus;
  rejectedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GradeLetter = "A" | "B" | "C" | "D" | "F";

export interface GraderMetrics {
  visibilityRate: number;
  shareOfVoice: number;
  fairShare: number;
  positionScore: number;
  avgPosition: number;
  sentimentScore: number;
  citationScore: number;
  engineScores: Record<string, number>;
  formula: string;
}

export interface GraderPromptResult {
  id: string;
  text: string;
  intent:
    | "category_discovery"
    | "best_of"
    | "comparison"
    | "problem_solution"
    | "brand_specific";
  priority: number;
  brandMentioned: boolean;
  brandRank: number | null;
  competitorsMentioned: string[];
  sampleAnswers: Array<{
    engine: string;
    textSnippet: string;
    brandRank: number | null;
    sentiment: number;
    citations: string[];
  }>;
}

export interface BrandPerceptionSummary {
  descriptors: string[];
  positioning: string;
  strengths: string[];
  weaknesses: string[];
  inaccuracies: Array<{
    claim: string;
    explanation: string;
    evidenceSnippet: string;
  }>;
}

export interface TechnicalAuditSummary {
  statusCode: number;
  homepageRenderable: boolean;
  llmsTxt: boolean;
  schemaOrg: boolean;
  robotsTxt: {
    accessible: boolean;
    bots: {
      GPTBot: "allowed" | "disallowed";
      "ChatGPT-User": "allowed" | "disallowed";
      "Google-Extended": "allowed" | "disallowed";
      ClaudeBot: "allowed" | "disallowed";
      PerplexityBot: "allowed" | "disallowed";
    };
  };
  notes: string[];
}

export interface GraderRecommendation {
  id: string;
  title: string;
  category: "crawlers" | "citations" | "content" | "positioning" | "schema";
  impact: "High" | "Medium" | "Critical";
  effort: "Low" | "Medium" | "High";
  description: string;
  actionableStep: string;
}

export interface GraderReportData {
  id: string;
  shareToken: string;
  brandName: string;
  domain: string;
  normalizedDomain: string;
  category: string;
  country: string;
  language: string;
  competitors: Array<{ name: string; domain: string }>;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  currentStage: string;
  score: number;
  grade: GradeLetter;
  metrics: GraderMetrics;
  prompts: GraderPromptResult[];
  brandPerception: BrandPerceptionSummary;
  technicalAudit: TechnicalAuditSummary;
  recommendations: GraderRecommendation[];
  costUsd: number;
  isCached?: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubmitGraderPayload {
  brandName: string;
  domain: string;
  category?: string;
  country?: string;
  competitors?: Array<{ name: string; domain: string }>;
  turnstileToken?: string;
  deviceFingerprint?: string;
  forceRefresh?: boolean;
}

export interface SubmitGraderResponse {
  reportId: string;
  shareToken: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  currentStage: string;
  isCached?: boolean;
  report?: GraderReportData;
}

export type TechnicalGrade = "A" | "B" | "C" | "D" | "F";

export interface TechnicalCategoryScores {
  botAccess: number | null;
  indexability: number | null;
  schema: number | null;
  answerStructure: number | null;
  performanceTrust: number | null;
  agentReadability: number | null;
}

export interface BotEvaluation {
  bot: string;
  name: string;
  status:
    | "declared_allowed"
    | "declared_partial"
    | "declared_disallowed"
    | "unknown"
    | "allowed"
    | "partial"
    | "disallowed";
  score: number | null;
  ruleSource: string;
  impact: string;
  fixSnippet?: string;
}

export interface TechnicalAuditRecord {
  id: string;
  tenantId: string;
  projectId: string;
  status:
    "pending" | "running" | "completed" | "partial" | "failed" | "cancelled";
  crawlType: string;
  targetDomain: string;
  attemptedUrls: number | null;
  fetchedPages: number | null;
  failedRequests: number | null;
  httpErrorPages: number | null;
  excludedPages: number | null;
  pagesScored: number | null;
  queuedUrlsRemaining: number | null;
  pagesCrawled: number;
  pagesLimit: number;
  scoringVersion: number;
  completionReason: string | null;
  siteWideChecks: Record<string, unknown>;
  overallScore: number;
  grade: TechnicalGrade;
  categoryScores: TechnicalCategoryScores;
  botMatrix: {
    bots: Record<string, BotEvaluation>;
    score: number | null;
    declaredAllowedCount?: number;
    declaredPartialCount?: number;
    declaredDisallowedCount?: number;
    allowedCount?: number;
    partialCount?: number;
    disallowedCount?: number;
  };
  issuesSummary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  durationMs: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TechnicalAuditSchedule {
  id: string;
  tenantId: string;
  projectId: string;
  frequency: "daily" | "weekly" | "monthly";
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface TechnicalAuditPageItem {
  crawlSource?: string | null;
  fallbackReason?: string | null;
  duplicateOf?: string | null;
  id: string;
  url: string;
  finalUrl: string | null;
  path: string;
  statusCode: number;
  crawlStatus: "fetched" | "http_error" | "failed" | "legacy";
  fetchError: string | null;
  excluded: boolean;
  exclusionReason: string | null;
  isIndexable: boolean;
  canonicalUrl: string | null;
  canonicalStatus: string;
  pageScore: number | null;
  wordCount: number;
  headingCounts: Record<string, number>;
  answerFirstDetected: boolean;
  faqBlocksDetected: boolean;
  schemasDetected: Array<{
    type: string;
    status: "valid" | "warning" | "error";
    missingRequired: string[];
    missingRecommended: string[];
  }>;
  hasJsDomDiff: boolean;
  loadTimeMs: number;
  issuesCount: number;
  createdAt: string;
}

export interface TechnicalAuditIssueItem {
  id: string;
  pageId: string | null;
  category: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  findingType: "problem" | "suggestion" | "information";
  code: string;
  title: string;
  description: string;
  recommendation: string;
  fixSnippet: string | null;
  affectedUrl: string | null;
  status: "open" | "fixed" | "dismissed";
  createdAt: string;
}

// Agent Experience Optimization (M16 / AXO)
export type PolicyPreset =
  "search_only" | "maximum_visibility" | "strict_copyright" | "custom";

export interface BotDiffItem {
  bot: string;
  name: string;
  category: "search" | "training";
  existingStatus: "allowed" | "disallowed" | "unspecified";
  proposedStatus: "allowed" | "disallowed";
  hasChanged: boolean;
  impact: string;
}

export interface RobotsComparisonResult {
  searchBotsAllowed: number;
  searchBotsBlocked: number;
  trainingBotsAllowed: number;
  trainingBotsBlocked: number;
  diffs: BotDiffItem[];
  netImpact: string;
}

export interface LlmsLinkItem {
  title: string;
  url: string;
  description?: string;
  isInternal: boolean;
  statusCode?: number;
  error?: string;
}

export interface LlmsSectionItem {
  title: string;
  linkCount: number;
  links: LlmsLinkItem[];
}

export interface LlmsValidationIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  code: string;
  message: string;
  line?: number;
}

export interface LlmsValidationResult {
  score: number;
  status: "valid" | "warning" | "error" | "missing";
  title: string | null;
  summary: string | null;
  sections: LlmsSectionItem[];
  totalLinks: number;
  internalLinksCount: number;
  externalLinksCount: number;
  brokenLinksCount: number;
  byteLength: number;
  lineCount: number;
  issues: LlmsValidationIssue[];
}

export interface AgentPolicyRecord {
  id: string;
  tenantId: string;
  projectId: string;
  policyPreset: PolicyPreset;
  robotsTxtContent: string;
  botRules: Record<string, boolean>;
  trainingBotsDisallowed: boolean;
  searchBotsAllowed: boolean;
  customDirectives: string | null;
  llmsTxtDraft: string | null;
  llmsFullTxtDraft: string | null;
  llmsValidation: LlmsValidationResult | Record<string, unknown>;
  schemaTemplates: {
    organization?: Record<string, unknown>;
    product?: Record<string, unknown>;
    faqPage?: Record<string, unknown>;
    article?: Record<string, unknown>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AxoDraftsResult {
  llmsTxt: string;
  llmsFullTxt: string;
  schemas: {
    organization: Record<string, unknown>;
    product: Record<string, unknown>;
    faqPage: Record<string, unknown>;
    article: Record<string, unknown>;
  };
}

// Content Intelligence (M9 / CNT-FR-001 to CNT-FR-009)
export interface ContentItemRecord {
  id: string;
  tenantId: string;
  projectId: string;
  url: string;
  path: string;
  title: string | null;
  metaDescription: string | null;
  wordCount: number;
  contentScore: number;
  answerFirstScore: number;
  entityClarityScore: number;
  schemaScore: number;
  structureScore: number;
  credibilityScore: number;
  mappedPromptIds: string[];
  promptClusters: string[];
  lastModified: string | null;
  isStale: boolean;
  cannibalizedPromptIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentGapRecord {
  id: string;
  tenantId: string;
  projectId: string;
  promptId: string;
  promptText: string;
  clusterName: string;
  brandVisScore: number;
  demandIndex: number;
  priorityScore: number;
  closestOwnedPageUrl: string | null;
  similarityScore: number;
  topCitedCompetitorDomains: string[];
  suggestedAction: string;
  status: "open" | "in_brief" | "resolved" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface ContentBriefRecord {
  id: string;
  tenantId: string;
  projectId: string;
  gapId: string | null;
  title: string;
  targetPrompts: string[];
  primaryIntent:
    "informational" | "commercial" | "comparison" | "troubleshooting";
  questionsToAnswer: string[];
  suggestedOutline: Array<{ heading: string; level: number; guidance: string }>;
  targetEntities: string[];
  factsAndStatistics: string[];
  recommendedSchemas: string[];
  internalLinkingSuggestions: Array<{ anchor: string; url: string }>;
  sourcesToCite: string[];
  markdownContent: string;
  status: "draft" | "in_review" | "ready" | "exported";
  label: "Estimated";
  createdAt: string;
  updatedAt: string;
}

export interface CompetitorPageComparison {
  ownedUrl: string;
  competitorUrl: string;
  ownedScore: number;
  competitorScore: number;
  wordCountDelta: number;
  missingEntities: string[];
  missingQuestions: string[];
  schemaGaps: string[];
  structuralDifferences: string[];
  actionableSummary: string;
}

export interface CannibalizationIssue {
  promptId: string;
  promptText: string;
  competingPages: Array<{ url: string; title: string; similarity: number }>;
  recommendation: string;
}

// Action Center (M10 / ACT-FR-001 to ACT-FR-008)
export type ActionCategory =
  | "technical"
  | "content"
  | "citation"
  | "agent_readiness"
  | "accuracy"
  | "competitor";

export type ActionSourceModule =
  "M5" | "M6" | "M7" | "M8" | "M9" | "M16" | "manual";
export type ActionStatus =
  "backlog" | "todo" | "in_progress" | "done" | "dismissed";
export type ActionEffort = "S" | "M" | "L";
export type ActionVerificationStatus =
  "pending" | "verified" | "not_verified" | "inconclusive";

export interface ActionFixGuidance {
  type: "jsonld" | "robots" | "llms" | "faq" | "meta" | "guide";
  title: string;
  code?: string;
  instructions: string;
  label: "Estimated";
  disclaimer: string;
}

export interface ActionItemRecord {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  category: ActionCategory;
  sourceModule: ActionSourceModule;
  sourceId?: string | null;
  dedupKey: string;
  status: ActionStatus;
  dismissReason?: string | null;
  priorityScore: number;
  impact: number;
  confidence: number;
  effort: ActionEffort;
  owner?: string | null;
  dueDate?: string | null;
  evidence: Array<{
    url?: string;
    promptId?: string;
    quote?: string;
    source?: string;
    date?: string;
    findingType?: string;
  }>;
  fixGuidance?: ActionFixGuidance | null;
  verificationStatus: ActionVerificationStatus;
  verificationNotes?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionCommentRecord {
  id: string;
  actionId: string;
  tenantId: string;
  userId?: string | null;
  userName: string;
  body: string;
  createdAt: string;
}

export interface ActionStats {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  dismissed: number;
  backlog: number;
  avgPriority: number;
  byCategory: Record<string, number>;
}

// ==========================================
// Integrations (M14) & AI Traffic Analytics (M11)
// ==========================================

export type IntegrationProvider =
  "google_search_console" | "google_analytics_4" | "slack" | "hubspot";

export type IntegrationStatus =
  "connected" | "paused" | "error" | "disconnected";

export interface IntegrationConnection {
  id: string;
  tenantId: string;
  projectId: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountEmail?: string | null;
  propertyId?: string | null;
  propertyName?: string | null;
  scopesGranted: string[];
  lastSyncAt?: string | null;
  lastSyncStatus: "pending" | "success" | "failed";
  lastSyncError?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TenantApiKey {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  secretKey?: string; // only present upon creation
  scopes: string[];
  rateLimitRpm: number;
  rateLimitBurst: number;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  projectId: string;
  url: string;
  description?: string | null;
  events: string[];
  isActive: boolean;
  failureCount: number;
  lastDispatchedAt?: string | null;
  lastResponseCode?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface EngineTrafficBreakdown {
  engine: string;
  name: string;
  sessions: number;
  engagedSessions: number;
  conversions: number;
  revenue: number;
  shareOfAiTraffic: number;
  conversionRate: number;
}

export interface LandingPageTraffic {
  url: string;
  sessions: number;
  engagedSessions: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
  topEngine: string;
}

export interface DailyTrafficTrend {
  date: string;
  totalSessions: number;
  aiSessions: number;
  conversions: number;
}

export interface CrawlToCitationCorrelation {
  pageUrl: string;
  botCrawlsCount: number;
  citationCount: number;
  aiReferralSessions: number;
  correlationLabel: "High Alignment" | "Moderate Alignment" | "Emerging";
}

export interface AiTrafficOverview {
  dateWindowDays: number;
  kpis: {
    totalSessions: number;
    aiSessions: number;
    aiTrafficShare: number;
    aiEngagedSessions: number;
    aiEngagementRate: number;
    aiConversions: number;
    aiConversionRate: number;
    nonAiConversionRate: number;
    conversionMultiplier: number;
    aiRevenue: number;
  };
  engines: EngineTrafficBreakdown[];
  topLandingPages: LandingPageTraffic[];
  dailyTrends: DailyTrafficTrend[];
  crawlCorrelation: CrawlToCitationCorrelation[];
  metricLabels: {
    sessions: "Observed";
    conversions: "Observed";
    correlation: "Modeled";
  };
  disclaimer: string;
}

export interface GscPerformanceFact {
  id: string;
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  isQuestionQuery: boolean;
  searchIntent?: string | null;
  date: string;
}

export interface GscPromptOpportunity {
  query: string;
  page: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  opportunityScore: number;
  suggestedIntent: "informational" | "comparison" | "commercial";
}

export interface GscDataResponse {
  facts: GscPerformanceFact[];
  promptOpportunities: GscPromptOpportunity[];
  disclaimer: string;
  metricLabel: "Observed";
}

// ---------------------------------------------------------------------------
// Step 5.1: M13 Reporting & Alerts (RPT) Types
// ---------------------------------------------------------------------------

export type AlertRuleType =
  | "visibility_drop"
  | "competitor_overtake"
  | "lost_citation"
  | "crawl_blockage";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type AlertIncidentStatus =
  "active" | "acknowledged" | "resolved" | "dismissed";

export type ReportCadence = "weekly" | "monthly";

export type ReportFormat = "pdf" | "html" | "json";

export interface PillarBreakdownItem {
  id: string;
  title: string;
  weightPercent: number;
  score: number;
  status: "healthy" | "warning" | "critical";
  detail: string;
}

export interface ExecutiveKpiSummary {
  aeoReadinessIndex: number;
  readinessClassification: "Leading" | "Competitive" | "Moderate" | "At Risk";
  visibilityShare: number;
  citationShare: number;
  technicalAeoScore: number;
  contentCoverage: number;
  aiTrafficShare: number;
  actionVelocity: number;
  totalPromptsMonitored: number;
  activeIncidentsCount: number;
  criticalIncidentsCount: number;
}

export interface ExecutiveDashboardData {
  periodDays: number;
  summary: ExecutiveKpiSummary;
  keyWins: string[];
  criticalRisks: string[];
  pillarBreakdown: PillarBreakdownItem[];
  metricLabels: {
    observedMetrics: string[];
    modeledMetrics: string[];
    disclosure: string;
  };
}

export interface AlertRule {
  id: string;
  projectId: string;
  tenantId: string;
  name: string;
  ruleType: AlertRuleType;
  threshold: Record<string, unknown>;
  severity: AlertSeverity;
  channels: string[];
  cooldownHours: number;
  isActive: boolean;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertIncident {
  id: string;
  projectId: string;
  tenantId: string;
  ruleId?: string | null;
  ruleType: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  message: string;
  details: Record<string, unknown>;
  status: AlertIncidentStatus;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  resolvedAt?: string | null;
  resolvedNotes?: string | null;
  notifiedChannels: string[];
  createdAt: string;
}

export interface ReportSchedule {
  id: string;
  projectId: string;
  tenantId: string;
  title: string;
  cadence: ReportCadence;
  format: ReportFormat;
  recipients: string[];
  isActive: boolean;
  nextRunAt: string;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedReport {
  id: string;
  projectId: string;
  tenantId: string;
  scheduleId?: string | null;
  title: string;
  dateWindowDays: number;
  format: ReportFormat;
  status: "generating" | "completed" | "failed";
  summaryKpis: Record<string, unknown>;
  contentPayload: Record<string, unknown>;
  downloadUrl?: string | null;
  deliveredEmails: string[];
  dispatchedAt?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Step 5.2: M15 Platform Administration & Stripe Billing (ADM) Types
// ---------------------------------------------------------------------------

export type PlanTier = "starter" | "growth" | "enterprise";

export interface PlanConfig {
  id: PlanTier;
  name: string;
  priceUsdMonthly: number;
  monthlyCredits: number;
  monthlyCrawlCredits: number;
  maxPrompts: number;
}

export interface TenantSubscription {
  id: string;
  tenantId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  planTier: PlanTier;
  status: "active" | "past_due" | "canceled" | "trialing" | "incomplete";
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  monthlyCredits: number;
  monthlyCrawlCredits: number;
  createdAt: string;
  updatedAt: string;
}

export type CreditCategory = "monitoring" | "crawl";

export interface CreditLedgerEntry {
  id: string;
  tenantId: string;
  entryType:
    | "plan_allocation"
    | "credit_topup"
    | "monitoring_run"
    | "crawl_page"
    | "operator_adjustment"
    | "refund";
  category: CreditCategory;
  amount: number;
  balanceAfter: number;
  referenceId?: string | null;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BillingOverview {
  subscription: TenantSubscription;
  balances: {
    monitoring: {
      available: number;
      reserved: number;
      used: number;
    };
    crawl: {
      available: number;
      used: number;
    };
  };
  plans: Record<PlanTier, PlanConfig>;
  recentLedger: CreditLedgerEntry[];
}

export interface OperatorTenantSummary {
  id: string;
  name: string;
  region: string;
  status: "active" | "paused" | "archived";
  createdAt: string;
  planTier: string;
  subscriptionStatus: string;
  availableCredits: number;
  availableCrawlCredits: number;
  projectCount: number;
  memberCount: number;
  primaryDomain?: string | null;
}

export interface QueueHealthStats {
  queueName: string;
  waiting: number;
  active: number;
  failed: number;
  completedToday: number;
  status: "healthy" | "congested" | "degraded";
}

export interface OperatorAuditLog {
  id: string;
  operatorId: string;
  action: string;
  targetTenantId?: string | null;
  targetTenantName?: string | null;
  details: Record<string, unknown>;
  ipAddress?: string | null;
  createdAt: string;
}
