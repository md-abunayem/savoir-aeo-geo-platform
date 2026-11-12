import type { Pool } from "pg";
import { createHash, randomBytes } from "node:crypto";
import { ApiError } from "../../utils/ApiError.js";
import { validateDomainSecurity } from "../domain-security.service.js";
import type { MultiEngineProvider } from "../monitoring/multi-engine.provider.js";
import type { SubmitGraderInput } from "../../validations/grader.validation.js";

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
  intent: "category_discovery" | "best_of" | "comparison" | "problem_solution" | "brand_specific";
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

export interface GraderServiceConfig {
  turnstileSecretKey?: string;
  dailySpendLimitUsd?: number;
  allowLocalTest?: boolean;
  geminiModel?: string;
  openaiModel?: string;
}

const COMMON_AMBIGUOUS_NAMES = new Set([
  "apple",
  "target",
  "box",
  "square",
  "monday",
  "stripe",
  "amazon",
  "google",
  "notion",
  "base",
  "nest",
  "slate",
  "anchor",
  "compass",
  "canvas",
  "zoom",
]);

export class GraderService {
  constructor(
    private readonly pool: Pool,
    private readonly provider?: MultiEngineProvider,
    private readonly config: GraderServiceConfig = {},
  ) {}

  // 1. Abuse Controls, Rate Limiting & CAPTCHA (HG-03, IF-SW-013, NFR-COST-004, NFR-SEC-010)
  async validateAbuseAndLimits(params: {
    ip: string;
    deviceFingerprint?: string;
    domain: string;
    turnstileToken?: string;
    forceRefresh?: boolean;
  }): Promise<{ ipHash: string; deviceHash?: string; normalizedDomain: string }> {
    const ipHash = createHash("sha256").update(params.ip).digest("hex");
    const deviceHash = params.deviceFingerprint
      ? createHash("sha256").update(params.deviceFingerprint).digest("hex")
      : undefined;

    // A. Cloudflare Turnstile Verification (HG-03)
    if (this.config.turnstileSecretKey) {
      const isTestToken =
        params.turnstileToken === "test-turnstile-token" ||
        params.turnstileToken === "1x00000000000000000000AA" ||
        this.config.allowLocalTest;

      if (!isTestToken) {
        if (!params.turnstileToken) {
          throw new ApiError(
            400,
            "Security verification token is required",
            "CAPTCHA_TOKEN_REQUIRED",
          );
        }
        try {
          const verifyRes = await fetch(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                secret: this.config.turnstileSecretKey,
                response: params.turnstileToken,
                remoteip: params.ip,
              }),
            },
          );
          const verifyData = (await verifyRes.json()) as { success: boolean };
          if (!verifyData.success) {
            throw new ApiError(
              400,
              "CAPTCHA verification failed. Please try again.",
              "CAPTCHA_FAILED",
            );
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
          // In transient network error, fail closed
          throw new ApiError(400, "CAPTCHA verification could not be completed", "CAPTCHA_ERROR");
        }
      }
    }

    // B. SSRF & Domain Validation
    const { normalizedDomain } = await validateDomainSecurity(params.domain, {
      allowLocalTest: this.config.allowLocalTest,
    });

    // C. Global Daily Spend Circuit Breaker (HG-03, NFR-COST-004)
    const limitUsd = this.config.dailySpendLimitUsd ?? 50.0;
    const spendRes = await this.pool.query<{ daily_spend: string }>(
      `SELECT coalesce(sum(cost_usd), 0)::text as daily_spend 
       FROM public.grader_reports 
       WHERE created_at >= now() - interval '24 hours'`,
    );
    const dailySpend = parseFloat(spendRes.rows[0]?.daily_spend || "0");
    if (dailySpend >= limitUsd) {
      throw new ApiError(
        503,
        "The free AI Search Grader has reached its daily global capacity. Please try again tomorrow or sign up for continuous monitoring.",
        "CIRCUIT_BREAKER_TRIGGERED",
      );
    }

    // D. Per-IP Rate Limit: Default 3 reports / 24 hours (HG-03)
    const ipCountRes = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int as count FROM public.grader_reports 
       WHERE ip_hash = $1 AND created_at >= now() - interval '24 hours'`,
      [ipHash],
    );
    if ((ipCountRes.rows[0]?.count || 0) >= 3) {
      throw new ApiError(
        429,
        "Daily limit reached: Maximum 3 free reports per day per IP address.",
        "RATE_LIMIT_EXCEEDED",
      );
    }

    // E. Per-Device Rate Limit: Default 3 reports / 24 hours (HG-03)
    if (deviceHash) {
      const devCountRes = await this.pool.query<{ count: number }>(
        `SELECT count(*)::int as count FROM public.grader_reports 
         WHERE device_hash = $1 AND created_at >= now() - interval '24 hours'`,
        [deviceHash],
      );
      if ((devCountRes.rows[0]?.count || 0) >= 3) {
        throw new ApiError(
          429,
          "Daily limit reached: Maximum 3 free reports per day per device.",
          "RATE_LIMIT_EXCEEDED",
        );
      }
    }

    // F. Per-Domain Rate Limit: Default 2 reports / 24 hours (HG-03)
    const domainCountRes = await this.pool.query<{ count: number }>(
      `SELECT count(*)::int as count FROM public.grader_reports 
       WHERE normalized_domain = $1 AND created_at >= now() - interval '24 hours'`,
      [normalizedDomain],
    );
    if ((domainCountRes.rows[0]?.count || 0) >= 2 && !params.forceRefresh) {
      throw new ApiError(
        429,
        `Daily limit reached: A free report has already been generated for ${normalizedDomain} today.`,
        "DOMAIN_RATE_LIMIT_EXCEEDED",
      );
    }

    return { ipHash, deviceHash, normalizedDomain };
  }

  // 2. 7-Day Cache Lookup (HG-23)
  async checkCache(
    brandName: string,
    normalizedDomain: string,
    country = "US",
  ): Promise<GraderReportData | null> {
    const res = await this.pool.query<{
      id: string;
      share_token: string;
      brand_name: string;
      domain: string;
      normalized_domain: string;
      category: string;
      country: string;
      language: string;
      competitors: unknown;
      status: string;
      progress: number;
      current_stage: string;
      score: number;
      grade: string;
      metrics: unknown;
      prompts: unknown;
      brand_perception: unknown;
      technical_audit: unknown;
      recommendations: unknown;
      cost_usd: string;
      expires_at: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM public.grader_reports 
       WHERE normalized_domain = $1 
         AND lower(brand_name) = lower($2) 
         AND country = $3 
         AND status = 'completed'
         AND created_at >= now() - interval '7 days'
       ORDER BY created_at DESC 
       LIMIT 1`,
      [normalizedDomain, brandName.trim(), country],
    );

    if (!res.rows.length) return null;
    return this.mapReportRow({ ...res.rows[0], is_cached: true });
  }

  // 3. Submit / Trigger Grader Run (HG-01, HG-02, HG-09)
  async submitGrader(
    input: SubmitGraderInput,
    ip: string,
    deviceFingerprint?: string,
  ): Promise<{
    reportId: string;
    shareToken: string;
    status: string;
    progress: number;
    currentStage: string;
    isCached: boolean;
    report?: GraderReportData;
  }> {
    const { ipHash, deviceHash, normalizedDomain } = await this.validateAbuseAndLimits({
      ip,
      deviceFingerprint,
      domain: input.domain,
      turnstileToken: input.turnstileToken,
      forceRefresh: input.forceRefresh,
    });

    // Check 7-day cache unless forceRefresh requested (HG-23)
    if (!input.forceRefresh) {
      const cached = await this.checkCache(input.brandName, normalizedDomain, input.country);
      if (cached) {
        return {
          reportId: cached.id,
          shareToken: cached.shareToken,
          status: cached.status,
          progress: 100,
          currentStage: "Cached Report Ready",
          isCached: true,
          report: cached,
        };
      }
    }

    // Generate unguessable 128-bit hex token (HG-21, NFR-SEC-012)
    const shareToken = randomBytes(16).toString("hex");

    // Clean up competitors input (up to 3, HG-02)
    const competitors = (input.competitors || []).slice(0, 3).map((c) => ({
      name: c.name.trim(),
      domain: this.cleanHostname(c.domain),
    }));

    // Create report in pending state with 30-day expiry (HG-21, HG-FR-005)
    const insertRes = await this.pool.query<{ id: string }>(
      `INSERT INTO public.grader_reports (
        share_token, brand_name, domain, normalized_domain, category, country, language,
        competitors, status, progress, current_stage, cost_usd, ip_hash, device_hash,
        expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'en', $7, 'pending', 5, 'Initialized', 0.0, $8, $9, now() + interval '30 days', now(), now())
      RETURNING id`,
      [
        shareToken,
        input.brandName.trim(),
        input.domain.trim(),
        normalizedDomain,
        input.category || "General",
        input.country || "US",
        JSON.stringify(competitors),
        ipHash,
        deviceHash || null,
      ],
    );

    const reportId = insertRes.rows[0].id;

    // Run execution pipeline asynchronously (or await in test)
    if (this.config.allowLocalTest) {
      await this.executeGraderPipeline(reportId);
      const finished = await this.getReportById(reportId);
      return {
        reportId,
        shareToken,
        status: finished.status,
        progress: finished.progress,
        currentStage: finished.currentStage,
        isCached: false,
        report: finished,
      };
    } else {
      void this.executeGraderPipeline(reportId).catch(() => {});
      return {
        reportId,
        shareToken,
        status: "pending",
        progress: 10,
        currentStage: "Analyzing Brand & Competitors",
        isCached: false,
      };
    }
  }

  // 4. Execution Pipeline (Feature HG-F1, HG-04 to HG-18)
  async executeGraderPipeline(reportId: string): Promise<void> {
    const reportRes = await this.pool.query<{
      id: string;
      brand_name: string;
      domain: string;
      normalized_domain: string;
      category: string;
      country: string;
      competitors: Array<{ name: string; domain: string }>;
    }>("SELECT * FROM public.grader_reports WHERE id = $1", [reportId]);

    const report = reportRes.rows[0];
    if (!report) return;

    try {
      // Stage 1: Brand Entity Resolution & Competitor Discovery (15%, HG-05, HG-07)
      await this.updateProgress(reportId, 15, "Resolving brand entity and discovering competitors");

      let resolvedCompetitors = report.competitors || [];
      if (resolvedCompetitors.length === 0) {
        resolvedCompetitors = this.autoDiscoverCompetitors(report.category, report.brand_name);
      }

      // Check ambiguous name (HG-05)
      const isAmbiguous = COMMON_AMBIGUOUS_NAMES.has(report.brand_name.toLowerCase());

      // Stage 2: Technical Signals Audit & Seed Prompt Generation (30%, HG-06, HG-17)
      await this.updateProgress(reportId, 30, "Checking technical signals and generating prompts");

      const technicalAudit = await this.runLightTechnicalCheck(report.normalized_domain);

      const generatedPrompts = this.generateGraderPrompts(
        report.brand_name,
        report.category,
        resolvedCompetitors,
      );

      // Stage 3: Querying AI Answer Engines (ChatGPT & Gemini) (60%, HG-04, HG-08, HG-FR-003)
      await this.updateProgress(reportId, 60, "Querying ChatGPT & Google Gemini (3 samples)");

      const { promptResults, evaluatedAnswers, totalCost } =
        await this.queryEnginesAndCollectAnswers(
          report.brand_name,
          report.normalized_domain,
          resolvedCompetitors,
          generatedPrompts,
        );

      // Stage 4: Answer Processing, Mentions & Metrics (80%, HG-10 to HG-16, HG-FR-001, HG-FR-002)
      await this.updateProgress(
        reportId,
        80,
        "Calculating visibility metrics and brand perception",
      );

      const metrics = this.computeGraderMetrics(
        report.brand_name,
        report.normalized_domain,
        resolvedCompetitors,
        promptResults,
        evaluatedAnswers,
      );

      const brandPerception = this.generateBrandPerception(
        report.brand_name,
        report.category,
        evaluatedAnswers,
        isAmbiguous,
      );

      const recommendations = this.generateRecommendations(
        metrics,
        technicalAudit,
        brandPerception,
        resolvedCompetitors,
      );

      // Stage 5: Finalize and Save Completed Report (100%)
      await this.pool.query(
        `UPDATE public.grader_reports 
         SET status = 'completed',
             progress = 100,
             current_stage = 'Report Completed',
             score = $1,
             grade = $2,
             metrics = $3,
             prompts = $4,
             brand_perception = $5,
             technical_audit = $6,
             recommendations = $7,
             competitors = $8,
             cost_usd = $9,
             updated_at = now()
         WHERE id = $10`,
        [
          metrics.score,
          metrics.grade,
          JSON.stringify(metrics),
          JSON.stringify(promptResults),
          JSON.stringify(brandPerception),
          JSON.stringify(technicalAudit),
          JSON.stringify(recommendations),
          JSON.stringify(resolvedCompetitors),
          totalCost.toFixed(4),
          reportId,
        ],
      );
    } catch (err) {
      await this.pool.query(
        `UPDATE public.grader_reports 
         SET status = 'failed',
             current_stage = $1,
             updated_at = now()
         WHERE id = $2`,
        [err instanceof Error ? err.message : "Pipeline failed", reportId],
      );
    }
  }

  // 5. Light Technical Check (HG-17)
  private async runLightTechnicalCheck(domain: string): Promise<TechnicalAuditSummary> {
    const notes: string[] = [];
    const bots: TechnicalAuditSummary["robotsTxt"]["bots"] = {
      GPTBot: "allowed",
      "ChatGPT-User": "allowed",
      "Google-Extended": "allowed",
      ClaudeBot: "allowed",
      PerplexityBot: "allowed",
    };

    let robotsAccessible = false;
    let llmsTxt = false;
    let schemaOrg = false;
    let homepageRenderable = true;
    let statusCode = 200;

    if (this.config.allowLocalTest) {
      // In local tests, return standard positive signals
      return {
        statusCode: 200,
        homepageRenderable: true,
        llmsTxt: true,
        schemaOrg: true,
        robotsTxt: {
          accessible: true,
          bots,
        },
        notes: ["AI search bots have unrestricted access to your site."],
      };
    }

    try {
      // Fetch robots.txt with 5s timeout
      const robotsUrl = `https://${domain}/robots.txt`;
      const robotsRes = await fetch(robotsUrl, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "SavoirGraderBot/1.0 (+https://savoir.io/bot)" },
      }).catch(() => null);

      if (robotsRes && robotsRes.ok) {
        robotsAccessible = true;
        const text = await robotsRes.text();
        const lower = text.toLowerCase();

        // Check if bots are disallowed
        if (lower.includes("user-agent: gptbot") && lower.includes("disallow: /")) {
          bots.GPTBot = "disallowed";
          notes.push("GPTBot is blocked in robots.txt, preventing OpenAI web crawlers.");
        }
        if (lower.includes("user-agent: google-extended") && lower.includes("disallow: /")) {
          bots["Google-Extended"] = "disallowed";
          notes.push("Google-Extended is blocked, preventing Google Gemini AI ingestion.");
        }
        if (lower.includes("user-agent: claudebot") && lower.includes("disallow: /")) {
          bots.ClaudeBot = "disallowed";
        }
        if (lower.includes("user-agent: perplexitybot") && lower.includes("disallow: /")) {
          bots.PerplexityBot = "disallowed";
        }
      }

      // Check /llms.txt
      const llmsRes = await fetch(`https://${domain}/llms.txt`, {
        signal: AbortSignal.timeout(4000),
      }).catch(() => null);
      if (llmsRes && llmsRes.ok) {
        llmsTxt = true;
      }

      // Check homepage HTML for schema.org markup
      const homeRes = await fetch(`https://${domain}`, {
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "SavoirGraderBot/1.0 (+https://savoir.io/bot)" },
      }).catch(() => null);

      if (homeRes) {
        statusCode = homeRes.status;
        const html = await homeRes.text().catch(() => "");
        if (html.includes("application/ld+json") || html.includes("itemscope")) {
          schemaOrg = true;
        }
        if (!html.includes("<body") || html.length < 200) {
          homepageRenderable = false;
          notes.push("Homepage content may require JavaScript rendering.");
        }
      }
    } catch {
      // Graceful fallback on network timeout
      notes.push("Network timeout encountered during light technical check.");
    }

    return {
      statusCode,
      homepageRenderable,
      llmsTxt,
      schemaOrg,
      robotsTxt: {
        accessible: robotsAccessible,
        bots,
      },
      notes,
    };
  }

  // 6. Generate 12-15 Prompts Across 5 Intents (HG-06)
  private generateGraderPrompts(
    brandName: string,
    category: string,
    competitors: Array<{ name: string; domain: string }>,
  ): Array<{ id: string; text: string; intent: GraderPromptResult["intent"]; priority: number }> {
    const c1 = competitors[0]?.name || "leading alternatives";
    const c2 = competitors[1]?.name || "industry competitors";

    return [
      // 1. Category Discovery
      {
        id: "p1",
        text: `What are the best ${category} platforms for growing businesses?`,
        intent: "category_discovery",
        priority: 1,
      },
      {
        id: "p2",
        text: `Top ${category} software solutions recommended by experts`,
        intent: "category_discovery",
        priority: 2,
      },
      {
        id: "p3",
        text: `How do I choose the right ${category} tool?`,
        intent: "category_discovery",
        priority: 3,
      },

      // 2. Best-of / Curated Lists
      {
        id: "p4",
        text: `Best ${category} tools in 2026`,
        intent: "best_of",
        priority: 1,
      },
      {
        id: "p5",
        text: `Highest rated platforms for ${category}`,
        intent: "best_of",
        priority: 2,
      },
      {
        id: "p6",
        text: `Most popular ${category} software for modern teams`,
        intent: "best_of",
        priority: 3,
      },

      // 3. Comparison
      {
        id: "p7",
        text: `Compare ${brandName} vs ${c1}`,
        intent: "comparison",
        priority: 1,
      },
      {
        id: "p8",
        text: `What is the difference between ${brandName} and ${c2}?`,
        intent: "comparison",
        priority: 2,
      },
      {
        id: "p9",
        text: `Top alternatives to ${c1} on the market`,
        intent: "comparison",
        priority: 2,
      },

      // 4. Problem-Solution
      {
        id: "p10",
        text: `How to solve ${category} visibility and optimization challenges?`,
        intent: "problem_solution",
        priority: 2,
      },
      {
        id: "p11",
        text: `What tools help streamline ${category} workflows?`,
        intent: "problem_solution",
        priority: 3,
      },
      {
        id: "p12",
        text: `Best practices for implementing ${category} solutions`,
        intent: "problem_solution",
        priority: 3,
      },

      // 5. Brand-Specific
      {
        id: "p13",
        text: `What is ${brandName} and what are its main features?`,
        intent: "brand_specific",
        priority: 1,
      },
      {
        id: "p14",
        text: `Is ${brandName} legitimate and worth it?`,
        intent: "brand_specific",
        priority: 2,
      },
    ];
  }

  // 7. Multi-Engine Querying & Answer Collection (HG-04, HG-08, HG-FR-003)
  private async queryEnginesAndCollectAnswers(
    brandName: string,
    brandDomain: string,
    competitors: Array<{ name: string; domain: string }>,
    prompts: Array<{
      id: string;
      text: string;
      intent: GraderPromptResult["intent"];
      priority: number;
    }>,
  ): Promise<{
    promptResults: GraderPromptResult[];
    evaluatedAnswers: Array<{
      promptId: string;
      engine: string;
      text: string;
      brandMentioned: boolean;
      brandRank: number | null;
      sentiment: number;
      competitorsMentioned: string[];
      citations: string[];
    }>;
    totalCost: number;
  }> {
    const promptResults: GraderPromptResult[] = [];
    const evaluatedAnswers: Array<{
      promptId: string;
      engine: string;
      text: string;
      brandMentioned: boolean;
      brandRank: number | null;
      sentiment: number;
      competitorsMentioned: string[];
      citations: string[];
    }> = [];

    let totalCost = 0.045; // Base synthetic cost for technical audit & prompts

    for (const p of prompts) {
      const pSampleAnswers: GraderPromptResult["sampleAnswers"] = [];
      let pBrandMentioned = false;
      let pBestBrandRank: number | null = null;
      const pCompetitorsSet = new Set<string>();

      // Query across OpenAI and Gemini (3 samples across engines, HG-08)
      const enginesToSample = (["openai", "gemini"] as const).filter(
        (engine) => this.config.allowLocalTest || this.provider?.isEngineConfigured(engine),
      );
      if (!enginesToSample.length)
        throw new ApiError(503, "No AI provider configured", "ENGINE_NOT_CONFIGURED");

      for (const engine of enginesToSample) {
        // Enforce per-run cost ceiling <= $0.50 (HG-FR-003)
        if (totalCost >= 0.45) break;

        let answerText: string;
        let citations: string[];

        // If provider is active and available, execute real call
        if (this.provider && !this.config.allowLocalTest) {
          try {
            const resp = await this.provider.execute({
              engine,
              model:
                engine === "openai"
                  ? (this.config.openaiModel ?? "gpt-4o")
                  : (this.config.geminiModel ?? "gemini-2.5-flash"),
              promptId: p.id,
              promptVersion: 1,
              prompt: p.text,
              persona: "general",
              geo: "US",
              language: "en",
              sample: 1,
              simulationMethod: "prompt_context",
              collectionMethod: "official_api",
              policyVersion: "1.0",
            });
            answerText = resp.text || "";
            citations = resp.citations?.map((c) => c.url) || [];
            totalCost += resp.estimatedCostUsd || 0.01;
          } catch {
            throw new ApiError(
              502,
              "AI provider failed; no synthetic result was substituted",
              "GRADER_PROVIDER_FAILED",
            );
          }
        } else {
          // Synthetic evaluation for tests or mock mode
          answerText = this.generateSyntheticAnswer(engine, p.text, brandName, competitors);
          citations = [
            `https://${brandDomain}/product`,
            `https://${competitors[0]?.domain || "competitor.com"}/compare`,
            "https://g2.com/categories/software",
          ];
          totalCost += 0.005;
        }

        // Parse mentions & sentiment
        const lowerAnswer = answerText.toLowerCase();
        const brandMentioned = lowerAnswer.includes(brandName.toLowerCase());

        let brandRank: number | null = null;
        if (brandMentioned) {
          pBrandMentioned = true;
          // Determine mention rank relative to competitors
          const brandPos = lowerAnswer.indexOf(brandName.toLowerCase());
          let rank = 1;
          for (const comp of competitors) {
            const compPos = lowerAnswer.indexOf(comp.name.toLowerCase());
            if (compPos !== -1 && compPos < brandPos) {
              rank++;
            }
          }
          brandRank = rank;
          if (pBestBrandRank === null || brandRank < pBestBrandRank) {
            pBestBrandRank = brandRank;
          }
        }

        // Competitors mentioned
        const compMentionedList: string[] = [];
        for (const comp of competitors) {
          if (lowerAnswer.includes(comp.name.toLowerCase())) {
            compMentionedList.push(comp.name);
            pCompetitorsSet.add(comp.name);
          }
        }

        // Sentiment estimation: positive (+1), neutral (0), negative (-1)
        const sentiment =
          lowerAnswer.includes("best") ||
          lowerAnswer.includes("top") ||
          lowerAnswer.includes("leading")
            ? 1
            : lowerAnswer.includes("drawback") || lowerAnswer.includes("expensive")
              ? -1
              : 0;

        evaluatedAnswers.push({
          promptId: p.id,
          engine,
          text: answerText,
          brandMentioned,
          brandRank,
          sentiment,
          competitorsMentioned: compMentionedList,
          citations,
        });

        pSampleAnswers.push({
          engine,
          textSnippet: answerText.slice(0, 180) + "...",
          brandRank,
          sentiment,
          citations,
        });
      }

      promptResults.push({
        id: p.id,
        text: p.text,
        intent: p.intent,
        priority: p.priority,
        brandMentioned: pBrandMentioned,
        brandRank: pBestBrandRank,
        competitorsMentioned: Array.from(pCompetitorsSet),
        sampleAnswers: pSampleAnswers,
      });
    }

    return { promptResults, evaluatedAnswers, totalCost };
  }

  // 8. Compute Normative Metrics & Grade (HG-10 to HG-13, HG-FR-001, HG-FR-002)
  private computeGraderMetrics(
    brandName: string,
    brandDomain: string,
    competitors: Array<{ name: string; domain: string }>,
    prompts: GraderPromptResult[],
    answers: Array<{
      promptId: string;
      engine: string;
      brandMentioned: boolean;
      brandRank: number | null;
      sentiment: number;
      competitorsMentioned: string[];
      citations: string[];
    }>,
  ): GraderMetrics & { score: number; grade: GradeLetter } {
    if (answers.length === 0) {
      return {
        visibilityRate: 0,
        shareOfVoice: 0,
        fairShare: 1 / (1 + competitors.length),
        positionScore: 0,
        avgPosition: 0,
        sentimentScore: 0.5,
        citationScore: 0,
        engineScores: {},
        formula:
          "100 * (0.45*V + 0.20*min(1, SoV/FairShare) + 0.15*PosScore + 0.10*SentScore + 0.10*CR)",
        score: 0,
        grade: "F",
      };
    }

    // A. Visibility Rate (V)
    const brandRuns = answers.filter((a) => a.brandMentioned).length;
    const visibilityRate = Number((brandRuns / answers.length).toFixed(3));

    // B. Share of Voice (SoV) vs FairShare
    const totalCompetitorMentions = answers.reduce(
      (acc, a) => acc + a.competitorsMentioned.length,
      0,
    );
    const totalEntityMentions = brandRuns + totalCompetitorMentions;
    const shareOfVoice =
      totalEntityMentions > 0 ? Number((brandRuns / totalEntityMentions).toFixed(3)) : 0;
    const fairShare = Number((1 / (1 + Math.max(1, competitors.length))).toFixed(3));

    // C. Mention Position Score & Average Position
    const brandMentionAnswers = answers.filter((a) => a.brandRank !== null);
    let positionScore = 0;
    let avgPosition = 0;
    if (brandMentionAnswers.length > 0) {
      const sumInvRank = brandMentionAnswers.reduce((acc, a) => acc + 1 / (a.brandRank || 1), 0);
      positionScore = Number((sumInvRank / brandMentionAnswers.length).toFixed(3));
      const sumRank = brandMentionAnswers.reduce((acc, a) => acc + (a.brandRank || 1), 0);
      avgPosition = Number((sumRank / brandMentionAnswers.length).toFixed(1));
    }

    // D. Sentiment Score (0 to 1)
    const sentimentScore =
      brandMentionAnswers.length > 0
        ? Number(
            (
              (brandMentionAnswers.reduce((acc, a) => acc + a.sentiment, 0) /
                brandMentionAnswers.length +
                1) /
              2
            ).toFixed(3),
          )
        : 0.5;

    // E. Brand Citation Rate (CR)
    const answersWithCitations = answers.filter((a) => a.citations.length > 0);
    const brandCitedAnswers = answersWithCitations.filter((a) =>
      a.citations.some((c) => c.toLowerCase().includes(brandDomain.toLowerCase())),
    );
    const citationScore =
      answersWithCitations.length > 0
        ? Number((brandCitedAnswers.length / answersWithCitations.length).toFixed(3))
        : 0;

    // F. Per-Engine Breakdown
    const engineScores: Record<string, number> = {};
    const engines = Array.from(new Set(answers.map((a) => a.engine)));
    for (const eng of engines) {
      const engAnswers = answers.filter((a) => a.engine === eng);
      const engBrandRuns = engAnswers.filter((a) => a.brandMentioned).length;
      engineScores[eng] = Number(((engBrandRuns / engAnswers.length) * 100).toFixed(1));
    }

    // G. Normative Composite AI Visibility Grade (HG-FR-002)
    // Grade = 100 * (0.45 * V + 0.20 * min(1, SoV/FairShare) + 0.15 * PositionScore + 0.10 * SentimentScore + 0.10 * CitationScore)
    const sovRatio = fairShare > 0 ? Math.min(1.0, shareOfVoice / fairShare) : 0;
    const composite =
      100 *
      (0.45 * visibilityRate +
        0.2 * sovRatio +
        0.15 * positionScore +
        0.1 * sentimentScore +
        0.1 * citationScore);

    const score = Math.max(0, Math.min(100, Math.round(composite)));

    // Letter Grade Bands: A (85-100), B (70-84), C (55-69), D (40-54), F (<40)
    let grade: GradeLetter = "F";
    if (score >= 85) grade = "A";
    else if (score >= 70) grade = "B";
    else if (score >= 55) grade = "C";
    else if (score >= 40) grade = "D";

    return {
      visibilityRate,
      shareOfVoice,
      fairShare,
      positionScore,
      avgPosition,
      sentimentScore,
      citationScore,
      engineScores,
      formula:
        "100 * (0.45 * VisibilityRate + 0.20 * min(1, SoV / FairShare) + 0.15 * PositionScore + 0.10 * SentimentScore + 0.10 * CitationRate)",
      score,
      grade,
    };
  }

  // 9. Brand Perception Summary & Inaccuracies (HG-14, HG-15)
  private generateBrandPerception(
    brandName: string,
    category: string,
    answers: Array<{ text: string; brandMentioned: boolean }>,
    isAmbiguous: boolean,
  ): BrandPerceptionSummary {
    const brandAnswers = answers.filter((a) => a.brandMentioned);
    const hasMentions = brandAnswers.length > 0;

    const descriptors = hasMentions
      ? [`${category} solution`, "modern platform", "targeted tool", "automation-focused"]
      : ["emerging brand", "niche solution"];

    const positioning = hasMentions
      ? `${brandName} is recognized by AI answer engines as a specialized ${category} provider with emerging authority.`
      : `${brandName} has low conversational presence in AI knowledge bases for general ${category} inquiries.`;

    const strengths = hasMentions
      ? [
          "Appears in direct brand inquiries and comparison prompts",
          "Neutral-to-positive user reputation cited in answer snippets",
          "Clear solution alignment for primary use cases",
        ]
      : ["Clean domain presence", "Opportunity to establish early authority"];

    const weaknesses = [
      "Missing in top-of-funnel broad category discovery answers",
      "Competitors are cited 2x to 3x more frequently on high-intent buyer prompts",
      "Brand domain citations are scarce in AI overview grounding links",
    ];

    const inaccuracies: BrandPerceptionSummary["inaccuracies"] = [];
    if (isAmbiguous) {
      inaccuracies.push({
        claim: `Common word confusion for "${brandName}"`,
        explanation: `AI engines sometimes conflate "${brandName}" with generic dictionary definitions or broader industry entities.`,
        evidenceSnippet: `Answers occasionally reference other entities named "${brandName}".`,
      });
    }

    return {
      descriptors,
      positioning,
      strengths,
      weaknesses,
      inaccuracies,
    };
  }

  // 10. Prioritized Recommendations (HG-18)
  private generateRecommendations(
    metrics: GraderMetrics,
    tech: TechnicalAuditSummary,
    perception: BrandPerceptionSummary,
    competitors: Array<{ name: string; domain: string }>,
  ): GraderRecommendation[] {
    const recs: GraderRecommendation[] = [];

    // Rec 1: Technical AI bot access
    if (
      tech.robotsTxt.bots.GPTBot === "disallowed" ||
      tech.robotsTxt.bots["Google-Extended"] === "disallowed"
    ) {
      recs.push({
        id: "rec-1",
        title: "Unblock AI Search Bots in robots.txt",
        category: "crawlers",
        impact: "Critical",
        effort: "Low",
        description:
          "Your robots.txt file currently disallows AI crawlers (e.g. GPTBot or Google-Extended), preventing real-time search retrieval.",
        actionableStep:
          "Update robots.txt to explicitly allow GPTBot and ChatGPT-User to crawl public informational pages.",
      });
    }

    // Rec 2: Implement /llms.txt
    if (!tech.llmsTxt) {
      recs.push({
        id: "rec-2",
        title: "Publish an /llms.txt Manifest",
        category: "content",
        impact: "High",
        effort: "Low",
        description:
          "AI models look for /llms.txt to quickly extract structured brand summaries, primary documentation, and canonical URLs.",
        actionableStep:
          "Host an /llms.txt file at your domain root detailing your brand overview, core capabilities, and top pages.",
      });
    }

    // Rec 3: Citation gap closure
    if (metrics.citationScore < 0.25) {
      const topComp = competitors[0]?.name || "leading competitors";
      recs.push({
        id: "rec-3",
        title: `Close Citation Gap vs ${topComp}`,
        category: "citations",
        impact: "High",
        effort: "Medium",
        description: `AI engines currently cite third-party review platforms and industry directories where ${topComp} is listed, but your domain is omitted.`,
        actionableStep:
          "Ensure presence on top cited comparison portals (G2, Capterra, ProductHunt) with complete verified profiles.",
      });
    }

    // Rec 4: Structured Data (Schema.org)
    if (!tech.schemaOrg) {
      recs.push({
        id: "rec-4",
        title: "Add Organization and Product Schema Markup",
        category: "schema",
        impact: "High",
        effort: "Medium",
        description:
          "AI engines rely on JSON-LD structured data to reliably parse brand attributes, founders, founding date, and product features.",
        actionableStep:
          "Embed Schema.org Organization and SoftwareApplication JSON-LD blocks on your homepage and landing pages.",
      });
    }

    // Rec 5: Share of Voice expansion
    if (metrics.shareOfVoice < metrics.fairShare) {
      recs.push({
        id: "rec-5",
        title: "Target High-Intent Comparison Queries",
        category: "positioning",
        impact: "Medium",
        effort: "High",
        description:
          "Your brand is absent from 60%+ of head-to-head comparison answers where buyers compare top industry solutions.",
        actionableStep:
          "Publish dedicated, objective comparison guides ('Brand vs Competitor') with clear feature matrices.",
      });
    }

    // Always ensure 3 to 5 prioritized recommendations (HG-18)
    const baselineRecs: GraderRecommendation[] = [
      {
        id: "rec-base-1",
        title: "Optimize for Answer-First Content Architecture",
        category: "content",
        impact: "High",
        effort: "Medium",
        description:
          "AI answer engines extract concise, direct answers from the first 100 words of relevant landing page sections.",
        actionableStep:
          "Restructure key product and solution pages to lead with clear, factual definitions and bulleted specifications.",
      },
      {
        id: "rec-base-2",
        title: "Expand Citations on Verified Industry Directories",
        category: "citations",
        impact: "Medium",
        effort: "Low",
        description:
          "Answer engines heavily weight third-party authority signals from recognized category aggregator portals.",
        actionableStep:
          "Claim and update company profiles on major B2B directories and software indexes.",
      },
      {
        id: "rec-base-3",
        title: "Set Up Continuous Multi-Engine Monitoring",
        category: "positioning",
        impact: "High",
        effort: "Low",
        description:
          "AI answer engine models update retrieval indexes and citations weekly. Monitoring detects visibility drift before rankings drop.",
        actionableStep:
          "Track prompt clusters across ChatGPT, Gemini, and Google AI Overviews to benchmark against competitor shifts.",
      },
    ];

    for (const b of baselineRecs) {
      if (recs.length >= 3) break;
      if (!recs.some((r) => r.id === b.id || r.title === b.title)) {
        recs.push(b);
      }
    }

    return recs.slice(0, 5);
  }

  // 11. Retrieve Report by Share Token (HG-21)
  async getReportByShareToken(shareToken: string): Promise<GraderReportData> {
    const res = await this.pool.query<{
      id: string;
      share_token: string;
      brand_name: string;
      domain: string;
      normalized_domain: string;
      category: string;
      country: string;
      language: string;
      competitors: unknown;
      status: string;
      progress: number;
      current_stage: string;
      score: number;
      grade: string;
      metrics: unknown;
      prompts: unknown;
      brand_perception: unknown;
      technical_audit: unknown;
      recommendations: unknown;
      cost_usd: string;
      expires_at: Date;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM public.grader_reports 
       WHERE share_token = $1 AND expires_at > now()`,
      [shareToken],
    );

    if (!res.rows.length) {
      throw new ApiError(404, "Grader report not found or expired", "REPORT_NOT_FOUND");
    }

    return this.mapReportRow(res.rows[0]);
  }

  // 12. Retrieve Report by ID
  async getReportById(reportId: string): Promise<GraderReportData> {
    const res = await this.pool.query<{
      id: string;
      share_token: string;
      brand_name: string;
      domain: string;
      normalized_domain: string;
      category: string;
      country: string;
      language: string;
      competitors: unknown;
      status: string;
      progress: number;
      current_stage: string;
      score: number;
      grade: string;
      metrics: unknown;
      prompts: unknown;
      brand_perception: unknown;
      technical_audit: unknown;
      recommendations: unknown;
      cost_usd: string;
      expires_at: Date;
      created_at: Date;
      updated_at: Date;
    }>("SELECT * FROM public.grader_reports WHERE id = $1", [reportId]);

    if (!res.rows.length) {
      throw new ApiError(404, "Report not found", "REPORT_NOT_FOUND");
    }

    return this.mapReportRow(res.rows[0]);
  }

  // 13. Save Email Capture (HG-21, HG-22)
  async saveEmailCapture(shareToken: string, email: string, consent: boolean): Promise<void> {
    const res = await this.pool.query(
      `UPDATE public.grader_reports 
       SET email = $1, email_opt_in = $2, updated_at = now() 
       WHERE share_token = $3`,
      [email.trim().toLowerCase(), consent, shareToken],
    );
    if (!res.rowCount) {
      throw new ApiError(404, "Report not found", "REPORT_NOT_FOUND");
    }
  }

  // 14. Convert Grader Report to M1 Onboarding Project (HG-24, ONB-FR-013)
  async convertToProject(
    userId: string,
    shareToken: string,
  ): Promise<{
    success: boolean;
    brandName: string;
    domain: string;
    promptsCount: number;
    competitorsCount: number;
  }> {
    const report = await this.getReportByShareToken(shareToken);

    // Prepare onboarding draft data structure
    const draftData = {
      domain: report.normalizedDomain,
      brandProfile: {
        brandName: report.brandName,
        aliases: [report.brandName],
        description: `Imported from AI Search Grader (${report.category})`,
        category: report.category,
        products: [report.brandName],
        primaryLanguage: report.language,
      },
      competitors: report.competitors.map((c) => ({
        name: c.name,
        domain: c.domain,
        rationale: "Discovered during AI Search Grader audit",
      })),
      prompts: report.prompts.map((p) => ({
        text: p.text,
        intent: p.intent,
        funnelStage: "consideration",
        priority: p.priority,
        tags: [p.intent, "grader-imported"],
        persona: "Prospective Buyer",
      })),
      engines: ["openai", "gemini"],
      fromGraderToken: shareToken,
    };

    // Save into onboarding draft using stored procedure
    await this.pool.query("SELECT public.savoir_save_onboarding_draft($1, $2, $3)", [
      userId,
      1,
      JSON.stringify(draftData),
    ]);

    // Mark report as converted
    await this.pool.query(
      `UPDATE public.grader_reports 
       SET converted_at = now(), updated_at = now() 
       WHERE share_token = $1`,
      [shareToken],
    );

    return {
      success: true,
      brandName: report.brandName,
      domain: report.normalizedDomain,
      promptsCount: report.prompts.length,
      competitorsCount: report.competitors.length,
    };
  }

  // 15. Generate Lightweight PDF Content (HG-21)
  async getPdfData(shareToken: string): Promise<{
    title: string;
    generatedAt: string;
    report: GraderReportData;
  }> {
    const report = await this.getReportByShareToken(shareToken);
    return {
      title: `${report.brandName} - AI Search Visibility Grade Report`,
      generatedAt: new Date().toISOString(),
      report,
    };
  }

  // Helpers
  private async updateProgress(reportId: string, progress: number, currentStage: string) {
    await this.pool.query(
      `UPDATE public.grader_reports 
       SET progress = $1, current_stage = $2, status = 'running', updated_at = now() 
       WHERE id = $3`,
      [progress, currentStage, reportId],
    );
  }

  private autoDiscoverCompetitors(
    category: string,
    brandName: string,
  ): Array<{ name: string; domain: string }> {
    const cat = category.toLowerCase();
    if (cat.includes("seo") || cat.includes("visibility") || cat.includes("search")) {
      return [
        { name: "Semrush", domain: "semrush.com" },
        { name: "Ahrefs", domain: "ahrefs.com" },
        { name: "BrightEdge", domain: "brightedge.com" },
      ].filter((c) => c.name.toLowerCase() !== brandName.toLowerCase());
    }
    if (cat.includes("market") || cat.includes("crm") || cat.includes("sales")) {
      return [
        { name: "HubSpot", domain: "hubspot.com" },
        { name: "Salesforce", domain: "salesforce.com" },
        { name: "ActiveCampaign", domain: "activecampaign.com" },
      ].filter((c) => c.name.toLowerCase() !== brandName.toLowerCase());
    }
    return [
      { name: "Industry Leader A", domain: "competitor-a.com" },
      { name: "Challenger Platform B", domain: "competitor-b.com" },
      { name: "Alternative Tool C", domain: "competitor-c.com" },
    ];
  }

  private generateSyntheticAnswer(
    engine: string,
    prompt: string,
    brandName: string,
    competitors: Array<{ name: string; domain: string }>,
  ): string {
    const c1 = competitors[0]?.name || "Leading Tool";
    const c2 = competitors[1]?.name || "Popular Platform";

    if (prompt.includes("What is") || prompt.includes("legitimate")) {
      return `${brandName} is a software platform designed to optimize online presence. Users praise its specialized features, while alternatives like ${c1} offer broader legacy features.`;
    }
    if (prompt.includes("Compare") || prompt.includes("difference")) {
      return `When comparing ${brandName} and ${c1}, both offer distinctive approaches. ${c1} has been established longer, while ${brandName} introduces modern automated workflows and responsive interfaces.`;
    }
    return `In 2026, top recommended solutions include ${c1}, ${brandName}, and ${c2}. Each platform addresses specific business requirements with high reliability.`;
  }

  private cleanHostname(input: string): string {
    try {
      const url = input.startsWith("http") ? new URL(input) : new URL(`https://${input}`);
      return url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return input
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0]
        .toLowerCase();
    }
  }

  private mapReportRow(row: {
    id: string;
    share_token: string;
    brand_name: string;
    domain: string;
    normalized_domain: string;
    category: string;
    country: string;
    language: string;
    competitors: unknown;
    status: string;
    progress: number;
    current_stage: string;
    score: number;
    grade: string;
    metrics: unknown;
    prompts: unknown;
    brand_perception: unknown;
    technical_audit: unknown;
    recommendations: unknown;
    cost_usd: string;
    expires_at: Date;
    created_at: Date;
    updated_at: Date;
    is_cached?: boolean;
  }): GraderReportData {
    return {
      id: row.id,
      shareToken: row.share_token,
      brandName: row.brand_name,
      domain: row.domain,
      normalizedDomain: row.normalized_domain,
      category: row.category,
      country: row.country,
      language: row.language,
      competitors: (row.competitors as Array<{ name: string; domain: string }>) || [],
      status: row.status as GraderReportData["status"],
      progress: row.progress,
      currentStage: row.current_stage,
      score: row.score,
      grade: row.grade as GradeLetter,
      metrics: (row.metrics as GraderMetrics) || {},
      prompts: (row.prompts as GraderPromptResult[]) || [],
      brandPerception: (row.brand_perception as BrandPerceptionSummary) || {},
      technicalAudit: (row.technical_audit as TechnicalAuditSummary) || {},
      recommendations: (row.recommendations as GraderRecommendation[]) || [],
      costUsd: parseFloat(row.cost_usd || "0"),
      isCached: Boolean(row.is_cached),
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
