import { createProjectService } from "./services/project.service.js";
import { ApprovalService } from "./services/publishing/approval.service.js";
import { PublicMediaService } from "./services/publishing/media.service.js";
import { QaService } from "./services/intelligence/qa.service.js";
import { QaClassifierService } from "./services/intelligence/qa-classifier.service.js";
import { SocialAnalyticsService } from "./services/publishing/social-analytics.service.js";
import { createProjectManagementService } from "./services/project-management.service.js";
import { createMonitoringService } from "./services/monitoring/monitoring.service.js";
import { createMonitoringEvidence } from "./services/monitoring/evidence.js";
import { createGeminiProvider } from "./services/monitoring/gemini.adapter.js";
import { createOpenRouterProvider } from "./services/monitoring/openrouter.adapter.js";
import { createOpenAIProvider } from "./services/monitoring/openai.adapter.js";
import { createSerpProvider } from "./services/monitoring/serp.adapter.js";
import { createMultiEngineProvider } from "./services/monitoring/multi-engine.provider.js";
import { createPasswordResetService } from "./services/password-reset.service.js";
import { createRegistrationService } from "./services/registration.service.js";
import { createPasswordSafetyCheck } from "./services/password-safety.service.js";
import { createAuthService } from "./services/auth.service.js";
import { createOAuthService } from "./services/oauth.service.js";
import { createOnboardingService } from "./services/onboarding.service.js";
import { createRateLimiter } from "./services/rate-limit.service.js";
import { AnswerService } from "./services/answer/answer.service.js";
import { VisibilityService } from "./services/analytics/visibility.service.js";
import { CitationService } from "./services/analytics/citation.service.js";
import { CompetitorService } from "./services/analytics/competitor.service.js";
import { GraderService } from "./services/grader/grader.service.js";
import { TechnicalAuditService } from "./services/technical/technical-audit.service.js";
import { AxoService } from "./services/axo/axo.service.js";
import { ContentService } from "./services/content/content.service.js";
import { ActionCenterService } from "./services/action-center/action-center.service.js";
import { IntegrationsService } from "./services/integrations/integrations.service.js";
import { ApiKeyService } from "./services/integrations/api-key.service.js";
import { GoogleSync } from "./services/integrations/google-sync.js";
import { createHash } from "node:crypto";
import { TrafficAnalyticsService } from "./services/integrations/traffic-analytics.service.js";
import { ExecutiveDashboardService } from "./services/reporting/executive-dashboard.service.js";
import { AlertEngineService } from "./services/reporting/alert-engine.service.js";
import { ReportGeneratorService } from "./services/reporting/report-generator.service.js";
import { StripeAdapter } from "./services/billing/stripe.adapter.js";
import { BillingService } from "./services/billing/billing.service.js";
import { CreditLedgerService } from "./services/billing/credit-ledger.service.js";
import { OperatorService } from "./services/admin/operator.service.js";
import "./config/load-env.js";
import { parseEnvironment } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createInfrastructure } from "./services/infrastructure.service.js";
import { createApp } from "./app.js";
import { registerShutdown } from "./utils/shutdown.js";
import { createTenantQueryPool } from "./db/tenant-query.js";
import { createMonitoringControlQueue } from "./jobs/monitoring-queue.js";

function startupErrorDetails(error: unknown) {
  if (!(error instanceof Error)) return { message: "Unknown startup error" };
  let message = error.message.replace(/([a-z][a-z\d+.-]*:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@");
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)/i.test(key) && value && value.length >= 4)
      message = message.replaceAll(value, "[REDACTED]");
  }
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { name: error.name, code, message };
}

async function main() {
  const env = parseEnvironment(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const infrastructure = createInfrastructure(env, logger);
  const tenantQueries = createTenantQueryPool(infrastructure.pool);
  const monitoringQueue = env.MONITORING_ENABLED
    ? createMonitoringControlQueue(env.REDIS_URL)
    : undefined;
  monitoringQueue?.on("error", () =>
    logger.warn("monitoring queue connection error; database outbox retained"),
  );
  const close = async () => {
    await Promise.all([monitoringQueue?.close(), infrastructure.close()]);
  };
  let draining = false;
  try {
    await infrastructure.redis.connect();
    const oauth =
      env.AUTH_ENABLED &&
      env.GOOGLE_AUTH_ENABLED &&
      env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET
        ? createOAuthService(infrastructure.pool, infrastructure.redis, env.AUTH_JWT_SECRET ?? "", {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
          })
        : undefined;
    const auth = env.AUTH_ENABLED
      ? {
          service: await createAuthService(infrastructure.pool, env.AUTH_JWT_SECRET ?? ""),
          oauth,
          registration: await createRegistrationService(
            infrastructure.pool,
            env.EMAIL_PAYLOAD_KEY ?? "",
            createPasswordSafetyCheck(),
            { requireEmailVerification: env.EMAIL_VERIFICATION_ENABLED },
          ),
          passwordReset: await createPasswordResetService(
            infrastructure.pool,
            env.EMAIL_PAYLOAD_KEY ?? "",
            createPasswordSafetyCheck(),
          ),
          limiter: createRateLimiter(infrastructure.redis),
          csrfSecret: env.AUTH_CSRF_SECRET ?? "",
          secureCookies: env.NODE_ENV === "production",
          requireEmailVerification: env.EMAIL_VERIFICATION_ENABLED,
        }
      : undefined;
    const onboarding = auth
      ? createOnboardingService(infrastructure.pool, {
          firecrawlApiKey: env.FIRECRAWL_API_KEY,
          firecrawlApiUrl: env.FIRECRAWL_API_URL,
          geminiApiKey: env.GEMINI_API_KEY,
          monitoringEngines: [
            {
              engine: "openrouter",
              model: env.OPENROUTER_MODEL,
              enabled: env.MONITORING_ENABLED && Boolean(env.OPENROUTER_API_KEY),
            },
            {
              engine: "gemini",
              model: env.GEMINI_MODEL,
              enabled: env.MONITORING_ENABLED && Boolean(env.GEMINI_API_KEY),
            },
            {
              engine: "openai",
              model: env.OPENAI_MODEL,
              enabled: env.MONITORING_ENABLED && Boolean(env.OPENAI_API_KEY),
            },
            {
              engine: "google_ai_overviews",
              model: "google-ai-overview-surface",
              enabled: env.MONITORING_ENABLED && Boolean(env.SERP_PROVIDER_API_KEY),
            },
            {
              engine: "google_ai_mode",
              model: "google-ai-mode-surface",
              enabled: false,
            },
          ],
          allowLocalTest: env.NODE_ENV !== "production",
        })
      : undefined;
    const multiEngineProvider = createMultiEngineProvider({
      ...(env.OPENROUTER_API_KEY
        ? {
            openrouter: createOpenRouterProvider({
              apiKey: env.OPENROUTER_API_KEY,
              maxOutputTokens: env.OPENROUTER_MAX_OUTPUT_TOKENS,
            }),
          }
        : {}),
      ...(env.GEMINI_API_KEY
        ? {
            gemini: createGeminiProvider({
              apiKey: env.GEMINI_API_KEY,
              maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
              inputUsdPerMillion: env.GEMINI_INPUT_USD_PER_MILLION,
              outputUsdPerMillion: env.GEMINI_OUTPUT_USD_PER_MILLION,
            }),
          }
        : {}),
      ...(env.OPENAI_API_KEY
        ? {
            openai: createOpenAIProvider({
              apiKey: env.OPENAI_API_KEY,
              maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
              inputUsdPerMillion: env.OPENAI_INPUT_USD_PER_MILLION,
              outputUsdPerMillion: env.OPENAI_OUTPUT_USD_PER_MILLION,
            }),
          }
        : {}),
      ...(env.SERP_PROVIDER_API_KEY
        ? {
            google_ai_overviews: createSerpProvider({
              apiKey: env.SERP_PROVIDER_API_KEY,
              baseUrl: env.SERP_PROVIDER_BASE_URL,
              costPerCallUsd: env.SERP_COST_PER_CALL_USD,
            }),
          }
        : {}),
    });

    const stripeAdapter = new StripeAdapter({
      secretKey: env.STRIPE_SECRET_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      starterPriceId: env.STRIPE_STARTER_PRICE_ID,
      growthPriceId: env.STRIPE_GROWTH_PRICE_ID,
      enterprisePriceId: env.STRIPE_ENTERPRISE_PRICE_ID,
    });
    const creditLedgerService = new CreditLedgerService(infrastructure.pool);
    const billingService = new BillingService(infrastructure.pool, stripeAdapter);
    const operatorService = new OperatorService(infrastructure.pool);
    const technical = new TechnicalAuditService(infrastructure.pool, {
      firecrawlApiKey: env.FIRECRAWL_API_KEY,
      firecrawlApiUrl: env.FIRECRAWL_API_URL,
      allowLocalTest: env.NODE_ENV !== "production",
      requestTimeoutMs: 30000,
    });

    const app = createApp({
      studio: auth
        ? new ApprovalService(
            infrastructure.pool,
            {
              enabled: env.PUBLISHING_ENABLED,
              tokenKey: env.PUBLISHING_TOKEN_KEY,
              apiKey: env.GEMINI_API_KEY,
              model: env.GEMINI_MODEL,
            },
            new PublicMediaService(infrastructure.publicStorage, {
              bucket: env.S3_PUBLIC_BUCKET,
              privateBucket: env.S3_BUCKET,
              publicBaseUrl: env.S3_PUBLIC_BASE_URL,
            }),
          )
        : undefined,
      qa: auth
        ? new QaService(
            infrastructure.pool,
            new QaClassifierService({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
          )
        : undefined,
      socialAnalytics: auth
        ? new SocialAnalyticsService(
            infrastructure.pool,
            createHash("sha256")
              .update("savoir-publishing:" + (env.AUTH_JWT_SECRET ?? ""))
              .digest(),
          )
        : undefined,
      monitoringQueue,
      auth,
      projects: auth ? createProjectService(infrastructure.pool) : undefined,
      projectManagement: auth
        ? createProjectManagementService(infrastructure.pool, technical, {
            firecrawlConfigured: Boolean(env.FIRECRAWL_API_KEY),
            dailyCallLimit: env.MONITORING_DAILY_CALL_LIMIT,
            allowLocalTest: env.NODE_ENV === "test",
            engines: [
              {
                engine: "openrouter",
                name: "OpenRouter / GPT-6 Luna",
                model: env.OPENROUTER_MODEL,
                configured: Boolean(env.OPENROUTER_API_KEY && env.MONITORING_ENABLED),
                requiresGrounding: true,
              },
              {
                engine: "gemini",
                name: "Gemini",
                model: env.GEMINI_MODEL,
                configured: Boolean(env.GEMINI_API_KEY && env.MONITORING_ENABLED),
                requiresGrounding: true,
              },
              {
                engine: "openai",
                name: "ChatGPT",
                model: env.OPENAI_MODEL,
                configured: Boolean(env.OPENAI_API_KEY && env.MONITORING_ENABLED),
                requiresGrounding: true,
              },
              {
                engine: "google_ai_overviews",
                name: "Google AI Overviews",
                model: "google-ai-overview-surface",
                configured: Boolean(env.SERP_PROVIDER_API_KEY && env.MONITORING_ENABLED),
                requiresGrounding: false,
              },
              {
                engine: "google_ai_mode",
                name: "Google AI Mode",
                model: "google-ai-mode-surface",
                configured: false,
                requiresGrounding: false,
              },
            ],
          })
        : undefined,
      onboarding,
      answers: auth ? new AnswerService(tenantQueries) : undefined,
      visibility: auth ? new VisibilityService(tenantQueries) : undefined,
      citations: auth ? new CitationService(tenantQueries) : undefined,
      competitors: auth ? new CompetitorService(tenantQueries) : undefined,
      technical: auth
        ? new TechnicalAuditService(infrastructure.pool, {
            firecrawlApiKey: env.FIRECRAWL_API_KEY,
            firecrawlApiUrl: env.FIRECRAWL_API_URL,
            allowLocalTest: env.NODE_ENV !== "production",
          })
        : undefined,
      axo: auth
        ? new AxoService(tenantQueries, {
            allowLocalTest: env.NODE_ENV !== "production",
          })
        : undefined,
      content: auth ? new ContentService(tenantQueries) : undefined,
      actions: auth ? new ActionCenterService(tenantQueries) : undefined,
      apiKeys: auth ? new ApiKeyService(infrastructure.pool, auth.limiter) : undefined,
      integrations: auth
        ? new IntegrationsService(
            tenantQueries,
            false,
            new GoogleSync(
              infrastructure.pool,
              createHash("sha256")
                .update("savoir-integrations:" + env.AUTH_JWT_SECRET!)
                .digest(),
              { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
            ),
            createHash("sha256")
              .update("savoir-integrations:" + env.AUTH_JWT_SECRET!)
              .digest(),
          )
        : undefined,
      traffic: auth ? new TrafficAnalyticsService(tenantQueries) : undefined,
      dashboard: auth ? new ExecutiveDashboardService(tenantQueries) : undefined,
      alerts: auth
        ? new AlertEngineService(
            tenantQueries,
            undefined,
            env.EMAIL_PAYLOAD_KEY ??
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          )
        : undefined,
      reports: auth
        ? new ReportGeneratorService(
            tenantQueries,
            env.EMAIL_PAYLOAD_KEY ??
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          )
        : undefined,
      billing: billingService,
      ledger: creditLedgerService,
      operator: operatorService,
      operatorSecretKey: env.OPERATOR_SECRET_KEY,
      grader: new GraderService(infrastructure.pool, multiEngineProvider, {
        geminiModel: env.GEMINI_MODEL,
        openaiModel: env.OPENAI_MODEL,
      }),
      monitoring: auth
        ? createMonitoringService(
            infrastructure.pool,
            createMonitoringEvidence(infrastructure.storage, env.S3_BUCKET),
            {
              model: env.GEMINI_MODEL,
              enabled: env.MONITORING_ENABLED,
              wakeQueue: monitoringQueue
                ? async () => {
                    await monitoringQueue.add(
                      "monitoring-tick",
                      {},
                      { jobId: "monitoring-wake", removeOnFail: true },
                    );
                  }
                : undefined,
              openrouter: {
                enabled: Boolean(env.OPENROUTER_API_KEY && env.MONITORING_ENABLED),
                model: env.OPENROUTER_MODEL,
              },
              gemini: {
                enabled: Boolean(env.GEMINI_API_KEY && env.MONITORING_ENABLED),
                model: env.GEMINI_MODEL,
              },
              openai: {
                enabled: Boolean(env.OPENAI_API_KEY && env.MONITORING_ENABLED),
                model: env.OPENAI_MODEL,
              },
              serp: {
                enabled: Boolean(env.SERP_PROVIDER_API_KEY && env.MONITORING_ENABLED),
                model: "google-ai-overview-surface",
                baseUrl: env.SERP_PROVIDER_BASE_URL,
              },
            },
            multiEngineProvider,
          )
        : undefined,
      origins: env.CORS_ORIGIN,
      logger,
      readiness: infrastructure.readiness,
      draining: () => draining,
    });
    const server = app.listen(env.PORT, env.HOST);
    server.once("listening", () => {
      const address = server.address();
      logger.info(
        { port: typeof address === "object" && address ? address.port : env.PORT, host: env.HOST },
        "API started",
      );
    });
    server.once("error", () => {
      logger.error("HTTP server failed to start");
      void close().finally(() => {
        process.exitCode = 1;
      });
    });
    registerShutdown(server, close, logger, env.SHUTDOWN_TIMEOUT_MS, () => {
      draining = true;
    });
  } catch (error) {
    logger.error({ error: startupErrorDetails(error) }, "API startup failed");
    await close();
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  // Validation errors contain field names only; do not print SDK errors or credentials.
  console.error(
    error instanceof Error && error.message.startsWith("Invalid environment fields:")
      ? error.message
      : "Backend startup failed",
  );
  process.exitCode = 1;
});
