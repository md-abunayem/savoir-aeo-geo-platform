import "dotenv/config";
import { Pool } from "pg";
import { parseEnvironment } from "../config/env.js";

const env = parseEnvironment(process.env);
const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  console.log(
    JSON.stringify({
      monitoring: env.MONITORING_ENABLED,
      model: env.GEMINI_MODEL,
      providers: {
        gemini: Boolean(env.GEMINI_API_KEY),
        openai: Boolean(env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith("your_")),
        serp: Boolean(env.SERP_PROVIDER_API_KEY),
      },
    }),
  );
  for (const [name, query] of Object.entries({
    projects: "SELECT id, tenant_id, brand_name, domain, status FROM projects",
    schedules:
      "SELECT id, project_id, status, config FROM monitoring_schedules WHERE status <> 'deleted'",
    runs: "SELECT status, count(*)::int FROM monitoring_runs GROUP BY status",
    answers: "SELECT count(*)::int FROM answers",
    credits: "SELECT tenant_id, available, reserved, used FROM monitoring_credits",
  }))
    console.log(name, JSON.stringify((await pool.query(query)).rows));
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    {
      headers: { "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      signal: AbortSignal.timeout(15000),
    },
  );
  const body = (await response.json()) as {
    models?: { name: string }[];
    error?: { status: string };
  };
  console.log(
    JSON.stringify({
      modelListStatus: response.status,
      error: body.error?.status,
      configuredModelAvailable: body.models?.some((m) => m.name === `models/${env.GEMINI_MODEL}`),
      flashModels: body.models?.filter((m) => m.name.includes("flash")).map((m) => m.name),
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.name : "Status check failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
