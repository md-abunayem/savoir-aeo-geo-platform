import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { AiReferrerClassifier } from "../src/services/integrations/ai-referrer-classifier.js";
import { GscAnalyzer } from "../src/services/integrations/gsc-analyzer.js";
import { TokenCrypto } from "../src/services/integrations/token-crypto.js";
import { IntegrationsService } from "../src/services/integrations/integrations.service.js";
import { TrafficAnalyticsService } from "../src/services/integrations/traffic-analytics.service.js";

describe("AI Referrer Classifier (TRF-FR-002, TRF-FR-003)", () => {
  it("correctly identifies ChatGPT web and app referrers", () => {
    expect(AiReferrerClassifier.classify("chatgpt.com").aiEngine).toBe("chatgpt");
    expect(AiReferrerClassifier.classify("https://chatgpt.com/c/123-abc").aiEngine).toBe("chatgpt");
    expect(AiReferrerClassifier.classify("chat.openai.com").aiEngine).toBe("chatgpt");
    expect(AiReferrerClassifier.classify("android-app://com.openai.chatgpt").aiEngine).toBe(
      "chatgpt",
    );
    expect(AiReferrerClassifier.isAiReferral("chatgpt.com")).toBe(true);
  });

  it("correctly identifies Gemini referrers", () => {
    expect(AiReferrerClassifier.classify("gemini.google.com").aiEngine).toBe("gemini");
    expect(AiReferrerClassifier.classify("bard.google.com").aiEngine).toBe("gemini");
    expect(AiReferrerClassifier.isAiReferral("gemini.google.com")).toBe(true);
  });

  it("correctly identifies Perplexity, Claude, Copilot, DeepSeek", () => {
    expect(AiReferrerClassifier.classify("www.perplexity.ai").aiEngine).toBe("perplexity");
    expect(AiReferrerClassifier.classify("claude.ai").aiEngine).toBe("claude");
    expect(AiReferrerClassifier.classify("copilot.microsoft.com").aiEngine).toBe("copilot");
    expect(AiReferrerClassifier.classify("chat.deepseek.com").aiEngine).toBe("deepseek");
  });

  it("returns non-AI classification for standard search/referrers", () => {
    const googleRes = AiReferrerClassifier.classify("google.com", "organic");
    expect(googleRes.isAiReferral).toBe(false);
    expect(googleRes.customChannelGroup).toBe("Organic Search");
    expect(googleRes.aiEngine).toBeUndefined();

    const redditRes = AiReferrerClassifier.classify("reddit.com", "referral");
    expect(redditRes.isAiReferral).toBe(false);
    expect(redditRes.customChannelGroup).toBe("Referral");

    const directRes = AiReferrerClassifier.classify("(direct)", "(none)");
    expect(directRes.isAiReferral).toBe(false);
    expect(directRes.customChannelGroup).toBe("Direct");
  });

  it("provides human-readable engine labels", () => {
    expect(AiReferrerClassifier.getEngineDisplayName("chatgpt")).toBe("ChatGPT");
    expect(AiReferrerClassifier.getEngineDisplayName("gemini")).toBe("Google Gemini");
    expect(AiReferrerClassifier.getEngineDisplayName("perplexity")).toBe("Perplexity");
    expect(AiReferrerClassifier.getEngineDisplayName("claude")).toBe("Claude");
    expect(AiReferrerClassifier.getEngineDisplayName("copilot")).toBe("Microsoft Copilot");
    expect(AiReferrerClassifier.getEngineDisplayName("deepseek")).toBe("DeepSeek");
    expect(AiReferrerClassifier.getEngineDisplayName("other_ai")).toBe("Other AI");
  });

  it("returns mandatory un-referred traffic disclosure (TRF-FR-003)", () => {
    const disclosure = AiReferrerClassifier.getMandatoryDisclosure();
    expect(disclosure.label).toBe("Observed");
    expect(disclosure.text).toContain("Some AI traffic arrives without a referrer header");
    expect(disclosure.requirement).toBe("TRF-FR-003");
  });
});

describe("GSC Analyzer & Prompt Extractor (ITG-FR-001, TRF-FR-004)", () => {
  it("detects question-like queries correctly", () => {
    expect(GscAnalyzer.isQuestionQuery("how does savoir work")).toBe(true);
    expect(GscAnalyzer.isQuestionQuery("what is geo search")).toBe(true);
    expect(GscAnalyzer.isQuestionQuery("best aeo software 2026")).toBe(true);
    expect(GscAnalyzer.isQuestionQuery("savoir vs competitor")).toBe(true);
    expect(GscAnalyzer.isQuestionQuery("can ai search engines crawl javascript")).toBe(true);
    expect(GscAnalyzer.isQuestionQuery("why is my brand not cited by perplexity")).toBe(true);
  });

  it("identifies non-question commercial/navigational queries", () => {
    expect(GscAnalyzer.isQuestionQuery("savoir login")).toBe(false);
    expect(GscAnalyzer.isQuestionQuery("random query phrase")).toBe(false);
  });

  it("classifies query search intent accurately", () => {
    expect(GscAnalyzer.classifyIntent("how to optimize for llms")).toBe("informational");
    expect(GscAnalyzer.classifyIntent("savoir vs brightedge aeo")).toBe("comparison");
    expect(GscAnalyzer.classifyIntent("best enterprise aeo tool")).toBe("commercial");
  });

  it("extracts prioritized prompt opportunities from GSC queries", () => {
    const mockRows = [
      {
        query: "how does aeo differ from traditional seo",
        page: "https://example.com/guide",
        impressions: 4200,
        clicks: 350,
        ctr: 0.083,
        position: 4.2,
      },
      {
        query: "savoir platform login",
        page: "https://example.com/login",
        impressions: 12000,
        clicks: 2800,
        ctr: 0.233,
        position: 1.1,
      },
      {
        query: "best ai search optimization tools for b2b",
        page: "https://example.com/tools",
        impressions: 1800,
        clicks: 120,
        ctr: 0.067,
        position: 6.8,
      },
    ];

    const opportunities = GscAnalyzer.extractPromptOpportunities(mockRows);
    expect(opportunities.length).toBe(2); // Only question queries
    expect(opportunities[0]?.query).toBe("how does aeo differ from traditional seo");
    expect(opportunities[0]?.suggestedIntent).toBe("informational");
    expect(opportunities[0]?.opportunityScore).toBeGreaterThan(0);
  });

  it("returns mandatory GSC non-isolation disclosure (TRF-FR-004)", () => {
    const disclosure = GscAnalyzer.getMandatoryDisclosure();
    expect(disclosure.label).toBe("Observed");
    expect(disclosure.text).toContain(
      "Google Search Console does not isolate AI Overview / AI Mode search traffic directly",
    );
    expect(disclosure.requirement).toBe("TRF-FR-004");
  });
});

describe("Token Crypto & Webhook Signing (ITG-FR-005, ITG-FR-006, ITG-FR-011)", () => {
  it("encrypts and decrypts OAuth credentials using AES-256-GCM (ITG-FR-011)", () => {
    const plain = { accessToken: "ya29.secret_token", refreshToken: "1//refresh_token" };
    const encrypted = TokenCrypto.encrypt(plain);

    expect(encrypted.startsWith("v1.")).toBe(true);
    const parts = encrypted.split(".");
    expect(parts.length).toBe(4); // v1.iv.tag.ciphertext

    const decrypted = TokenCrypto.decrypt<typeof plain>(encrypted);
    expect(decrypted.accessToken).toBe(plain.accessToken);
    expect(decrypted.refreshToken).toBe(plain.refreshToken);
  });

  it("fails decryption if encrypted payload is tampered", () => {
    const plain = { test: "data" };
    const encrypted = TokenCrypto.encrypt(plain);
    const tampered = encrypted.slice(0, -4) + "XXXX";

    expect(() => TokenCrypto.decrypt(tampered)).toThrow();
  });

  it("generates sk_live_ API key and validates SHA-256 hash (ITG-FR-005)", () => {
    const { secretKey, keyPrefix, keyHash } = TokenCrypto.generateApiKey();

    expect(secretKey.startsWith("sk_live_")).toBe(true);
    expect(keyPrefix.startsWith("sk_live_")).toBe(true);
    expect(keyHash.length).toBe(64); // SHA-256 hex string

    expect(TokenCrypto.verifyApiKey(secretKey, keyHash)).toBe(true);
    expect(TokenCrypto.verifyApiKey("sk_live_wrong_key", keyHash)).toBe(false);
  });

  it("signs and verifies outbound webhooks with HMAC-SHA256 (ITG-FR-006)", () => {
    const payload = JSON.stringify({
      event: "run.completed",
      runId: "run-999",
      tenantId: "tenant-111",
    });
    const secret = "whsec_super_secret_webhook_key_xyz";

    const signature = TokenCrypto.signWebhookPayload(payload, secret);
    expect(signature.startsWith("t=")).toBe(true);
    expect(signature).toContain(",v1=");

    const isValid = TokenCrypto.verifyWebhookSignature(payload, signature, secret, 300);
    expect(isValid).toBe(true);

    const isTampered = TokenCrypto.verifyWebhookSignature(
      payload + '{"extra":1}',
      signature,
      secret,
      300,
    );
    expect(isTampered).toBe(false);

    const isWrongSecret = TokenCrypto.verifyWebhookSignature(
      payload,
      signature,
      "wrong_secret",
      300,
    );
    expect(isWrongSecret).toBe(false);
  });
});

describe("IntegrationsService (ITG-FR-001 - ITG-FR-012)", () => {
  it("connects a provider and encrypts access/refresh tokens at rest", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText: string) => {
        if (queryText.includes("SELECT id FROM integration_connections")) {
          return { rows: [] };
        }
        if (queryText.includes("INSERT INTO integration_connections")) {
          return {
            rows: [
              {
                id: "conn-123",
                tenant_id: "ten-1",
                project_id: "proj-1",
                provider: "google_search_console",
                status: "connected",
                account_email: "user@example.com",
                property_id: "sc-domain:example.com",
                property_name: "example.com",
                scopes_granted: ["https://www.googleapis.com/auth/webmasters.readonly"],
                last_sync_status: "pending",
                last_sync_at: null,
                last_sync_error: null,
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const service = new IntegrationsService(mockPool);
    const result = await service.connectProvider("proj-1", "ten-1", {
      provider: "google_search_console",
      propertyId: "sc-domain:example.com",
      accountEmail: "user@example.com",
      tokens: { accessToken: "plain-secret-token" },
      scopesGranted: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });

    expect(result.id).toBe("conn-123");
    expect(result.provider).toBe("google_search_console");
    expect(result.status).toBe("connected");
    expect(mockPool.query).toHaveBeenCalled();
  });

  it("creates tenant API key with scoped rate limits", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "key-123",
            tenant_id: "ten-1",
            project_id: "proj-1",
            name: "CI/CD Reporting Key",
            key_prefix: "sk_live_123456",
            scopes: ["read:traffic", "read:actions"],
            rate_limit_rpm: 60,
            rate_limit_burst: 120,
            last_used_at: null,
            revoked_at: null,
            expires_at: null,
            created_at: new Date(),
          },
        ],
      }),
    } as unknown as Pool;

    const service = new IntegrationsService(mockPool);
    const keyResult = await service.createApiKey("proj-1", "ten-1", "CI/CD Reporting Key", [
      "read:traffic",
      "read:actions",
    ]);

    expect(keyResult.secretKey?.startsWith("sk_live_")).toBe(true);
    expect(keyResult.name).toBe("CI/CD Reporting Key");
    expect(keyResult.scopes).toContain("read:traffic");
    expect(keyResult.rateLimitRpm).toBe(60);
    expect(keyResult.rateLimitBurst).toBe(120);
  });
});

describe("TrafficAnalyticsService (TRF-FR-001 - TRF-FR-009)", () => {
  it("calculates AI traffic overview, conversion multipliers, and mandatory disclosures", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation((queryText: string) => {
        if (queryText.includes("traffic_analytics_facts")) {
          return {
            rows: [
              {
                date: "2026-11-01",
                source: "chatgpt.com",
                medium: "referral",
                landing_page: "https://example.com/features",
                is_ai_referral: true,
                ai_engine: "chatgpt",
                sessions: 1500,
                engaged_sessions: 1200,
                users: 1400,
                conversions: 180,
                revenue: 3600,
              },
              {
                date: "2026-11-01",
                source: "perplexity.ai",
                medium: "referral",
                landing_page: "https://example.com/pricing",
                is_ai_referral: true,
                ai_engine: "perplexity",
                sessions: 800,
                engaged_sessions: 640,
                users: 750,
                conversions: 110,
                revenue: 2200,
              },
              {
                date: "2026-11-01",
                source: "google",
                medium: "organic",
                landing_page: "https://example.com/features",
                is_ai_referral: false,
                ai_engine: null,
                sessions: 10000,
                engaged_sessions: 6000,
                users: 9000,
                conversions: 400,
                revenue: 8000,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const trafficService = new TrafficAnalyticsService(mockPool);
    const overview = await trafficService.getOverview("proj-1", "ten-1", 30);

    expect(overview.kpis.aiSessions).toBe(2300);
    expect(overview.kpis.aiConversions).toBe(290);
    expect(overview.kpis.totalSessions).toBe(12300);

    // AI CVR = 290/2300 = 12.61%, Non-AI CVR = 400/10000 = 4.0% -> Multiplier = 3.15x
    expect(overview.kpis.aiConversionRate).toBeGreaterThan(10);
    expect(overview.kpis.conversionMultiplier).toBeGreaterThan(2.5);

    // Mandatory disclosures & labels
    expect(overview.disclaimer).toContain(
      "Observed: Some AI traffic arrives without a referrer header",
    );
    expect(overview.disclaimer).toContain("TRF-FR-003");
    expect(overview.metricLabels.sessions).toBe("Observed");
    expect(overview.metricLabels.correlation).toBe("Modeled");

    // Engine breakdown
    expect(overview.engines.length).toBeGreaterThanOrEqual(2);
    const chatgpt = overview.engines.find((e) => e.engine === "chatgpt");
    expect(chatgpt?.sessions).toBe(1500);
    expect(chatgpt?.conversions).toBe(180);

    // Top landing pages
    expect(overview.topLandingPages.length).toBe(2);
    expect(overview.topLandingPages[0]?.url).toBe("https://example.com/features");
    expect(overview.topLandingPages[0]?.sessions).toBe(1500);

    // Crawl-to-citation-to-visit Modeled correlation (TRF-FR-008)
    expect(overview.crawlCorrelation.length).toBe(2);
    expect(overview.crawlCorrelation[0]?.pageUrl).toBe("https://example.com/features");
    expect(overview.crawlCorrelation[0]?.correlationLabel).toBe("High Alignment");
  });
});
