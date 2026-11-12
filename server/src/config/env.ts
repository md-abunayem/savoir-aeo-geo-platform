import { z } from "zod";

const httpUrl = z
  .url()
  .refine((value) => URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol));
const providerApiKey = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const key = value.trim();
  return !key || /^(?:your[_-]|placeholder|change[_-]?me|example)|^<.*>$/i.test(key)
    ? undefined
    : key;
}, z.string().min(1).optional());
const hasControlCharacter = (value: string) =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(8000),
    HOST: z.string().default("127.0.0.1"),
    AUTH_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EMAIL_VERIFICATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    MAIL_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    MONITORING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    GEMINI_API_KEY: providerApiKey.refine(
      (key) => !key?.startsWith("sk-or-"),
      "Use OPENROUTER_API_KEY for OpenRouter credentials",
    ),
    OPENROUTER_API_KEY: providerApiKey,
    OPENROUTER_MODEL: z
      .string()
      .trim()
      .min(1)
      .max(256)
      .refine(
        (model) => !/\s/u.test(model) && !hasControlCharacter(model),
        "Invalid model identifier",
      )
      .default("openai/gpt-6-luna"),
    OPENROUTER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4096).default(512),
    GEMINI_MODEL: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .default("gemini-3.8-flash"),
    MONITORING_DAILY_CALL_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
    MONITORING_CALL_SPACING_SECONDS: z.coerce.number().int().min(1).max(3600).default(10),
    GEMINI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(8192).default(2048),
    GEMINI_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().optional(),
    GEMINI_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().optional(),
    OPENAI_API_KEY: providerApiKey,
    OPENAI_MODEL: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,100}$/)
      .default("gpt-4o"),
    OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(16384).default(2048),
    OPENAI_INPUT_USD_PER_MILLION: z.coerce.number().nonnegative().optional(),
    OPENAI_OUTPUT_USD_PER_MILLION: z.coerce.number().nonnegative().optional(),
    SERP_PROVIDER_API_KEY: providerApiKey,
    SERP_PROVIDER_BASE_URL: httpUrl.optional(),
    SERP_COST_PER_CALL_USD: z.coerce.number().nonnegative().optional(),
    YOUTUBE_DATA_API_KEY: providerApiKey,
    REDDIT_CLIENT_ID: providerApiKey,
    REDDIT_CLIENT_SECRET: providerApiKey,
    REDDIT_USER_AGENT: z.string().trim().min(1).max(200).optional(),
    TIKTOK_RESEARCH_ACCESS_TOKEN: providerApiKey,
    BREVO_API_KEY: z.string().min(1).optional(),
    BREVO_SENDER_EMAIL: z.email().optional(),
    BREVO_SENDER_NAME: z.string().min(1).max(100).default("Savoir"),
    EMAIL_PAYLOAD_KEY: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    AUTH_JWT_SECRET: z.string().min(48).optional(),
    AUTH_CSRF_SECRET: z.string().min(48).optional(),
    GOOGLE_AUTH_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_REDIRECT_URI: httpUrl.optional(),
    FIRECRAWL_API_KEY: providerApiKey,
    FIRECRAWL_API_URL: httpUrl.optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    STRIPE_STARTER_PRICE_ID: z.string().optional(),
    STRIPE_GROWTH_PRICE_ID: z.string().optional(),
    STRIPE_ENTERPRISE_PRICE_ID: z.string().optional(),
    OPERATOR_SECRET_KEY: z.string().min(8).optional(),
    CORS_ORIGIN: z
      .string()
      .default("http://localhost:3000")
      .transform((value) => value.split(",").map((origin) => origin.trim()))
      .pipe(
        z
          .array(httpUrl.refine((value) => URL.canParse(value) && new URL(value).origin === value))
          .min(1),
      ),
    DATABASE_URL: z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) && ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      )
      .optional(),
    DATABASE_APP_URL: z
      .url()
      .refine(
        (value) =>
          URL.canParse(value) && ["postgres:", "postgresql:"].includes(new URL(value).protocol),
      )
      .optional(),
    REDIS_URL: z
      .url()
      .refine(
        (value) => URL.canParse(value) && ["redis:", "rediss:"].includes(new URL(value).protocol),
      ),
    S3_ENDPOINT: httpUrl,
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_REGION: z
      .string()
      .regex(/^[a-z]{2}-[a-z]+-\d$/)
      .default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    PUBLISHING_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    PUBLISHING_TOKEN_KEY: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    S3_PUBLIC_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .optional(),
    S3_PUBLIC_BASE_URL: z
      .url()
      .refine((v) => new URL(v).protocol === "https:")
      .optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  })
  .superRefine((value, context) => {
    if (value.S3_PUBLIC_BUCKET && value.S3_PUBLIC_BUCKET === value.S3_BUCKET)
      context.addIssue({
        code: "custom",
        path: ["S3_PUBLIC_BUCKET"],
        message: "Public media must use a separate bucket",
      });
    if (value.PUBLISHING_ENABLED && (!value.PUBLISHING_TOKEN_KEY || !value.DATABASE_APP_URL))
      context.addIssue({
        code: "custom",
        path: ["PUBLISHING_ENABLED"],
        message: "Publishing requires a token encryption key and restricted database URL",
      });
    if (!value.DATABASE_APP_URL && !value.DATABASE_URL)
      context.addIssue({
        code: "custom",
        path: ["DATABASE_APP_URL"],
        message: "A database connection is required",
      });
    if (value.MONITORING_ENABLED) {
      if (!value.DATABASE_APP_URL)
        context.addIssue({
          code: "custom",
          path: ["DATABASE_APP_URL"],
          message: "Required for monitoring",
        });
      if (
        !value.GEMINI_API_KEY &&
        !value.OPENAI_API_KEY &&
        !value.SERP_PROVIDER_API_KEY &&
        !value.OPENROUTER_API_KEY
      )
        context.addIssue({
          code: "custom",
          path: ["GEMINI_API_KEY"],
          message: "At least one provider API key required for monitoring",
        });
      if (!value.AUTH_ENABLED)
        context.addIssue({
          code: "custom",
          path: ["AUTH_ENABLED"],
          message: "Monitoring requires authentication",
        });
    }
    if (Boolean(value.REDDIT_CLIENT_ID) !== Boolean(value.REDDIT_CLIENT_SECRET))
      context.addIssue({
        code: "custom",
        path: ["REDDIT_CLIENT_SECRET"],
        message: "Reddit client ID and secret must be configured together",
      });
    if (
      Boolean(value.REDDIT_CLIENT_ID || value.REDDIT_CLIENT_SECRET) !==
      Boolean(value.REDDIT_USER_AGENT)
    )
      context.addIssue({
        code: "custom",
        path: ["REDDIT_USER_AGENT"],
        message: "A Reddit user agent is required when Reddit credentials are configured",
      });
    if (value.MAIL_ENABLED) {
      for (const field of [
        "DATABASE_APP_URL",
        "BREVO_API_KEY",
        "BREVO_SENDER_EMAIL",
        "EMAIL_PAYLOAD_KEY",
      ] as const) {
        if (!value[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Required for transactional email",
          });
      }
    }
    if (value.AUTH_ENABLED) {
      if (value.AUTH_JWT_SECRET && value.AUTH_JWT_SECRET === value.AUTH_CSRF_SECRET)
        context.addIssue({
          code: "custom",
          path: ["AUTH_CSRF_SECRET"],
          message: "Signing secrets must be independent",
        });
      for (const field of [
        "DATABASE_APP_URL",
        "AUTH_JWT_SECRET",
        "AUTH_CSRF_SECRET",
        "EMAIL_PAYLOAD_KEY",
      ] as const) {
        if (!value[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "Required for authentication",
          });
      }
    }
    if (value.NODE_ENV === "production" && !value.DATABASE_APP_URL) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_APP_URL"],
        message: "A restricted runtime database connection is required in production",
      });
    }
  });

export type Environment = z.infer<typeof schema>;

export function parseEnvironment(source: NodeJS.ProcessEnv): Environment {
  const clean = { ...source };
  for (const key of [
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "SERP_PROVIDER_API_KEY",
    "FIRECRAWL_API_KEY",
    "YOUTUBE_DATA_API_KEY",
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "TIKTOK_RESEARCH_ACCESS_TOKEN",
  ]) {
    if (clean[key]?.startsWith("your_")) delete clean[key];
  }
  const result = schema.safeParse(clean);
  if (!result.success) {
    // Never include input values: connection URLs and credentials are secrets.
    throw new Error(
      "Invalid environment fields: " +
        [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", "),
    );
  }
  return result.data;
}
