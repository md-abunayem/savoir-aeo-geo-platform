import type { Pool } from "pg";
import type { Queue } from "bullmq";
import { ApiError } from "../utils/ApiError.js";
import { validateDomainSecurity } from "./domain-security.service.js";
import {
  analyzeDomainSchema,
  generateSeedsSchema,
  estimateCostsSchema,
  saveDraftSchema,
  activateProjectSchema,
  type BrandProfile,
  type CompetitorInput,
  type PromptInput,
} from "../validations/onboarding.validation.js";

export interface OnboardingConfig {
  firecrawlApiKey?: string;
  firecrawlApiUrl?: string;
  geminiApiKey?: string;
  allowLocalTest?: boolean;
  monitoringEngines?: Array<{ engine: string; model: string; enabled: boolean }>;
}

export interface OnboardingService {
  getDraft(
    userId: string,
  ): Promise<{ step: number; data: Record<string, unknown>; updatedAt: Date } | null>;
  saveDraft(userId: string, input: unknown): Promise<void>;
  deleteDraft(userId: string): Promise<void>;
  analyzeDomain(
    userId: string,
    input: unknown,
  ): Promise<{
    domain: string;
    brandProfile: BrandProfile;
    isEstimated: boolean;
    source: "firecrawl" | "direct_scrape" | "heuristic";
  }>;
  generateSeeds(input: unknown): Promise<{
    competitors: CompetitorInput[];
    markets: Array<{ country: string; language: string }>;
    prompts: PromptInput[];
  }>;
  estimateCosts(input: unknown): {
    promptCount: number;
    engineCount: number;
    dailyRuns: number;
    monthlyCredits: number;
    planLimit: number;
    crawlPageBudget: number;
    withinBudget: boolean;
  };
  activate(
    userId: string,
    input: unknown,
    monitoringQueue?: Queue,
  ): Promise<{
    projectId: string;
    tenantId: string;
    status: string;
    firstRunScheduledAt: string;
  }>;
}

export function createOnboardingService(pool: Pool, config?: OnboardingConfig): OnboardingService {
  const allowLocalTest = Boolean(config?.allowLocalTest);

  return {
    async getDraft(userId: string) {
      const result = await pool.query<{
        step: number;
        data: Record<string, unknown>;
        updated_at: Date;
      }>("SELECT * FROM public.savoir_get_onboarding_draft($1)", [userId]);

      const row = result.rows[0];
      if (!row) return null;
      return {
        step: row.step,
        data: row.data || {},
        updatedAt: row.updated_at,
      };
    },

    async saveDraft(userId: string, input: unknown) {
      const validated = saveDraftSchema.parse(input);
      await pool.query("SELECT public.savoir_save_onboarding_draft($1, $2, $3)", [
        userId,
        validated.step,
        JSON.stringify(validated.data),
      ]);
    },

    async deleteDraft(userId: string) {
      await pool.query("SELECT public.savoir_delete_onboarding_draft($1)", [userId]);
    },

    async analyzeDomain(userId: string, input: unknown) {
      const { domain: rawDomain, brandName: brandNameHint } = analyzeDomainSchema.parse(input);

      // 1. SSRF & DNS validation
      const { normalizedDomain } = await validateDomainSecurity(rawDomain, {
        allowLocalTest,
      });

      // 2. Check if domain already registered and active in any project
      const existing = await pool.query<{ id: string }>(
        "SELECT id FROM public.projects WHERE domain = $1 AND status = 'active' LIMIT 1",
        [normalizedDomain],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new ApiError(
          409,
          `Domain "${normalizedDomain}" is already registered by another organization`,
          "DOMAIN_ALREADY_VERIFIED",
        );
      }

      // 3. Crawl domain content: Firecrawl or polite direct fetch
      let rawTitle = "";
      let rawDescription = "";
      let rawHeadings: string[] = [];
      let source: "firecrawl" | "direct_scrape" | "heuristic" = "heuristic";

      if (config?.firecrawlApiKey) {
        try {
          const firecrawlUrl =
            (config.firecrawlApiUrl || "https://api.firecrawl.dev") + "/v1/scrape";
          const res = await fetch(firecrawlUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.firecrawlApiKey}`,
            },
            body: JSON.stringify({ url: `https://${normalizedDomain}` }),
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              data?: { metadata?: { title?: string; description?: string }; markdown?: string };
            };
            if (json.data?.metadata?.title) rawTitle = json.data.metadata.title;
            if (json.data?.metadata?.description) rawDescription = json.data.metadata.description;
            source = "firecrawl";
          }
        } catch {
          // Fall back gracefully
        }
      }

      // Fallback: polite direct scrape if Firecrawl was unavailable or not configured
      if (!rawTitle && !allowLocalTest) {
        try {
          const res = await fetch(`https://${normalizedDomain}`, {
            headers: {
              "User-Agent": "SavoirBot/1.0 (+https://savoir.io/bot)",
              Accept: "text/html",
            },
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const html = await res.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch?.[1]) rawTitle = titleMatch[1].trim();

            const descMatch = html.match(
              /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i,
            );
            if (descMatch?.[1]) rawDescription = descMatch[1].trim();

            const h1Match = [...html.matchAll(/<h1[^>]*>([^<]+)<\/h1>/gi)].map(
              (m) => m[1]?.trim() || "",
            );
            rawHeadings = h1Match.filter(Boolean).slice(0, 5);
            source = "direct_scrape";
          }
        } catch {
          // Graceful fallback to heuristic
        }
      }

      // 4. Derive Brand Profile
      const domainNamePart = normalizedDomain.split(".")[0] || "brand";
      const fallbackBrandName =
        brandNameHint ||
        (rawTitle ? rawTitle.split(/[-|–:]/)[0]?.trim() : "") ||
        domainNamePart.charAt(0).toUpperCase() + domainNamePart.slice(1);

      const aliases = [fallbackBrandName, fallbackBrandName.toLowerCase(), normalizedDomain].filter(
        (v, i, a) => a.indexOf(v) === i,
      );

      const description =
        rawDescription ||
        (rawHeadings.length > 0
          ? rawHeadings.join(". ")
          : `Platform and solutions for ${fallbackBrandName}.`);

      // Determine Category heuristically or from title
      let category = "Software & Technology";
      const lowerAll = (rawTitle + " " + rawDescription + " " + normalizedDomain).toLowerCase();
      if (
        lowerAll.includes("shop") ||
        lowerAll.includes("store") ||
        lowerAll.includes("ecommerce")
      ) {
        category = "E-Commerce & Retail";
      } else if (
        lowerAll.includes("finance") ||
        lowerAll.includes("bank") ||
        lowerAll.includes("pay")
      ) {
        category = "Financial Services";
      } else if (
        lowerAll.includes("health") ||
        lowerAll.includes("medical") ||
        lowerAll.includes("care")
      ) {
        category = "Healthcare & Wellness";
      } else if (
        lowerAll.includes("travel") ||
        lowerAll.includes("hotel") ||
        lowerAll.includes("flight")
      ) {
        category = "Travel & Hospitality";
      }

      const products = [
        `${fallbackBrandName} Platform`,
        `${category.split("&")[0]?.trim() || category} Service`,
      ];

      const brandProfile: BrandProfile = {
        brandName: fallbackBrandName,
        aliases,
        description,
        category,
        products,
        primaryLanguage: "en",
      };

      return {
        domain: normalizedDomain,
        brandProfile,
        isEstimated: true,
        source,
      };
    },

    async generateSeeds(input: unknown) {
      const { domain: _domain, brandProfile, market } = generateSeedsSchema.parse(input);
      const brand = brandProfile.brandName;
      const category = brandProfile.category;
      const product = brandProfile.products[0] || `${brand} Core`;

      // 1. Propose 5–10 competitors with rationale (ONB-FR-005)
      const competitorCatalog: Record<
        string,
        Array<{ name: string; domain: string; rationale: string }>
      > = {
        "Software & Technology": [
          {
            name: "HubSpot",
            domain: "hubspot.com",
            rationale: "Leading inbound CRM and marketing suite",
          },
          {
            name: "Salesforce",
            domain: "salesforce.com",
            rationale: "Dominant enterprise CRM and cloud solutions",
          },
          {
            name: "Zoho",
            domain: "zoho.com",
            rationale: "Comprehensive business applications and productivity tools",
          },
          {
            name: "Zendesk",
            domain: "zendesk.com",
            rationale: "Top customer service and support platform",
          },
          {
            name: "ActiveCampaign",
            domain: "activecampaign.com",
            rationale: "Specialized customer experience automation",
          },
          {
            name: "Notion",
            domain: "notion.so",
            rationale: "Collaborative knowledge workspace and productivity",
          },
        ],
        "E-Commerce & Retail": [
          {
            name: "Shopify",
            domain: "shopify.com",
            rationale: "Primary global ecommerce platform leader",
          },
          {
            name: "BigCommerce",
            domain: "bigcommerce.com",
            rationale: "Enterprise headless and omnichannel commerce",
          },
          {
            name: "WooCommerce",
            domain: "woocommerce.com",
            rationale: "Widely used open-source WordPress commerce",
          },
          {
            name: "Magento",
            domain: "adobe.com",
            rationale: "Adobe Commerce enterprise architecture",
          },
          {
            name: "Amazon",
            domain: "amazon.com",
            rationale: "Global retail and marketplace benchmark",
          },
        ],
      };

      const rawCompetitors = competitorCatalog[category] || [
        {
          name: "MarketLeader",
          domain: "marketleader.com",
          rationale: "Key industry benchmark in " + category,
        },
        {
          name: "GlobalTech",
          domain: "globaltech.com",
          rationale: "Direct category competitor with strong AI citation",
        },
        {
          name: "AlphaSolutions",
          domain: "alphasolutions.com",
          rationale: "Prominent alternative solution provider",
        },
        {
          name: "NextGenCo",
          domain: "nextgenco.com",
          rationale: "Rapidly growing entrant in " + category,
        },
        {
          name: "EnterpriseOne",
          domain: "enterpriseone.com",
          rationale: "Established legacy incumbent",
        },
      ];

      const competitors: CompetitorInput[] = rawCompetitors.map((c) => ({
        name: c.name,
        domain: c.domain,
        rationale: c.rationale,
        aliases: [],
      }));

      const markets = [
        {
          country: market?.country || "US",
          language: market?.language || "en",
        },
      ];

      // 2. Generate 25 seed prompts across intents (ONB-FR-007)
      const comp1 = competitors[0]?.name || "Competitor A";
      const comp2 = competitors[1]?.name || "Competitor B";

      const prompts: PromptInput[] = [
        // Informational (8 prompts)
        {
          text: `What is ${brand} and how does it work?`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 1,
          tags: ["brand", "overview"],
          persona: "",
        },
        {
          text: `What are the key benefits of using ${product}?`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 2,
          tags: ["benefits", "product"],
          persona: "",
        },
        {
          text: `How to choose the best ${category} solution in 2026?`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 2,
          tags: ["category", "guide"],
          persona: "",
        },
        {
          text: `What problems does ${brand} solve for modern businesses?`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 2,
          tags: ["problem-solution"],
          persona: "",
        },
        {
          text: `Beginner guide to getting started with ${category}`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 3,
          tags: ["education"],
          persona: "",
        },
        {
          text: `Why is ${category} important for enterprise scaling?`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 3,
          tags: ["industry"],
          persona: "",
        },
        {
          text: `Key features to look for in a modern ${category} tool`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 2,
          tags: ["features"],
          persona: "",
        },
        {
          text: `How does ${brand} ensure security and reliability?`,
          intent: "informational",
          funnelStage: "awareness",
          priority: 3,
          tags: ["security"],
          persona: "",
        },

        // Comparison (7 prompts)
        {
          text: `Is ${brand} better than ${comp1}?`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 1,
          tags: ["comparison", "head-to-head"],
          persona: "",
        },
        {
          text: `${brand} vs ${comp1}: feature and price comparison`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 1,
          tags: ["comparison"],
          persona: "",
        },
        {
          text: `Top alternatives to ${comp1} in 2026`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 1,
          tags: ["alternatives"],
          persona: "",
        },
        {
          text: `Differences between ${brand} and ${comp2}`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 2,
          tags: ["comparison"],
          persona: "",
        },
        {
          text: `Which is best for small teams: ${brand} or ${comp1}?`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 2,
          tags: ["comparison", "smb"],
          persona: "",
        },
        {
          text: `Top rated ${category} platforms compared side by side`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 1,
          tags: ["leaderboard"],
          persona: "",
        },
        {
          text: `Why do companies switch from ${comp1} to ${brand}?`,
          intent: "comparison",
          funnelStage: "consideration",
          priority: 2,
          tags: ["migration"],
          persona: "",
        },

        // Transactional (6 prompts)
        {
          text: `How much does ${brand} cost and what plans are available?`,
          intent: "transactional",
          funnelStage: "decision",
          priority: 1,
          tags: ["pricing"],
          persona: "",
        },
        {
          text: `Where to sign up for a ${brand} free trial?`,
          intent: "transactional",
          funnelStage: "decision",
          priority: 1,
          tags: ["trial"],
          persona: "",
        },
        {
          text: `${brand} customer reviews, ratings and user feedback`,
          intent: "transactional",
          funnelStage: "decision",
          priority: 2,
          tags: ["reviews"],
          persona: "",
        },
        {
          text: `Is ${brand} worth the price for growing companies?`,
          intent: "transactional",
          funnelStage: "decision",
          priority: 2,
          tags: ["roi"],
          persona: "",
        },
        {
          text: `Best enterprise ${category} software pricing and licensing`,
          intent: "transactional",
          funnelStage: "decision",
          priority: 2,
          tags: ["enterprise"],
          persona: "",
        },
        {
          text: `How to request a demo of ${brand}?`,
          intent: "transactional",
          funnelStage: "decision",
          priority: 2,
          tags: ["demo"],
          persona: "",
        },

        // Navigational (4 prompts)
        {
          text: `${brand} official website and account login`,
          intent: "navigational",
          funnelStage: "decision",
          priority: 3,
          tags: ["navigational", "login"],
          persona: "",
        },
        {
          text: `${brand} customer support and contact options`,
          intent: "navigational",
          funnelStage: "decision",
          priority: 3,
          tags: ["support"],
          persona: "",
        },
        {
          text: `${brand} developer API documentation and webhooks`,
          intent: "navigational",
          funnelStage: "decision",
          priority: 3,
          tags: ["api"],
          persona: "",
        },
        {
          text: `${brand} terms of service and status page`,
          intent: "navigational",
          funnelStage: "decision",
          priority: 4,
          tags: ["legal"],
          persona: "",
        },
      ];

      return {
        competitors,
        markets,
        prompts,
      };
    },

    estimateCosts(input: unknown) {
      const { promptCount, engines } = estimateCostsSchema.parse(input);
      const dailyRuns = promptCount * engines.length;
      const monthlyCredits = dailyRuns * 30;
      const planLimit = 2000; // Starter plan default limit
      const crawlPageBudget = 500; // Starter crawl budget

      return {
        promptCount,
        engineCount: engines.length,
        dailyRuns,
        monthlyCredits,
        planLimit,
        crawlPageBudget,
        withinBudget: monthlyCredits <= planLimit,
      };
    },

    async activate(userId: string, input: unknown, monitoringQueue?: Queue) {
      const validated = activateProjectSchema.parse(input);

      // Validate domain security & SSRF
      const { normalizedDomain } = await validateDomainSecurity(validated.domain, {
        allowLocalTest,
      });

      // Execute atomic activation
      const result = await pool.query<{ project_id: string; tenant_id: string }>(
        "SELECT out_project_id AS project_id, out_tenant_id AS tenant_id FROM public.savoir_activate_onboarding($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [
          userId,
          validated.brandName,
          normalizedDomain,
          validated.description || "",
          JSON.stringify(validated.aliases || []),
          JSON.stringify(validated.markets),
          validated.region,
          JSON.stringify(validated.competitors),
          JSON.stringify(validated.prompts),
          JSON.stringify(
            (
              config?.monitoringEngines ?? [
                { engine: "gemini", model: "gemini-2.5-flash", enabled: false },
                { engine: "openai", model: "gpt-4o", enabled: false },
              ]
            ).filter((e) =>
              validated.engines.map((v) => (v === "chatgpt" ? "openai" : v)).includes(e.engine),
            ),
          ),
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new ApiError(500, "Project activation failed", "ACTIVATION_FAILED");
      }

      // Schedule first monitoring run within 5 minutes (ONB-FR-012)
      const scheduledTime = new Date(Date.now() + 60 * 1000); // 1 minute from now
      if (monitoringQueue) {
        try {
          await monitoringQueue.add(
            "monitoring-tick",
            {
              tenantId: row.tenant_id,
              projectId: row.project_id,
              trigger: "onboarding-activation",
            },
            {
              jobId: `init-${row.project_id}`,
              delay: 30000, // 30 seconds delay
              removeOnComplete: true,
            },
          );
        } catch {
          // Queue error does not abort database activation
        }
      }

      return {
        projectId: row.project_id,
        tenantId: row.tenant_id,
        status: "active",
        firstRunScheduledAt: scheduledTime.toISOString(),
      };
    },
  };
}
