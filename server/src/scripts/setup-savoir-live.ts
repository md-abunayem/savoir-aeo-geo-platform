import "dotenv/config";
import { Pool } from "pg";
import { parseEnvironment } from "../config/env.js";

// Local administrator setup, explicitly requested for this workspace.
const env = parseEnvironment(process.env);
if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL to a direct migration connection first");
if (
  env.NODE_ENV === "production" ||
  !["localhost", "127.0.0.1"].includes(new URL(env.DATABASE_URL).hostname)
)
  throw new Error("Local setup only");
const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const users = await client.query(
    "SELECT id, email_verified_at FROM users WHERE lower(email)=$1 AND disabled_at IS NULL",
    ["md.abunayem.cs@gmail.com"],
  );
  if (users.rowCount !== 1) throw new Error("OWNER_ACCOUNT_MISSING");
  if (!users.rows[0].email_verified_at) throw new Error("OWNER_ACCOUNT_UNVERIFIED");
  const userId = users.rows[0].id;
  let tenantId = (
    await client.query(
      "SELECT tenant_id FROM memberships WHERE user_id=$1 AND role='owner' LIMIT 1",
      [userId],
    )
  ).rows[0]?.tenant_id;
  if (!tenantId) {
    tenantId = (
      await client.query(
        "INSERT INTO tenants(name,region) VALUES('Savoir Workspace','us') RETURNING id",
      )
    ).rows[0].id;
    await client.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
      tenantId,
      userId,
    ]);
  }
  let projectId = (
    await client.query("SELECT id FROM projects WHERE tenant_id=$1 AND domain='savoir.luxury'", [
      tenantId,
    ])
  ).rows[0]?.id;
  if (!projectId)
    projectId = (
      await client.query(
        "INSERT INTO projects(tenant_id,brand_name,domain,status,default_markets) VALUES($1,'Savoir','savoir.luxury','active','[{\"country\":\"US\",\"language\":\"en\"}]') RETURNING id",
        [tenantId],
      )
    ).rows[0].id;
  await client.query(
    "INSERT INTO monitoring_credits(tenant_id,available,reserved,used,minimum_interval_minutes) VALUES($1,2000,0,0,1440) ON CONFLICT DO NOTHING",
    [tenantId],
  );
  const prompts = [
    "What products or services does Savoir at savoir.luxury offer? Cite current sources and distinguish it from similarly named brands.",
    "What can a customer learn about Savoir from savoir.luxury and independent sources? Cite sources and clearly state what cannot be verified.",
    "Which alternatives offer products or services comparable to Savoir at savoir.luxury? First verify what Savoir offers, then cite sources for the comparison.",
  ];
  const ids: string[] = [];
  for (const body of prompts) {
    let id = (
      await client.query("SELECT id FROM monitoring_prompts WHERE project_id=$1 AND body=$2", [
        projectId,
        body,
      ])
    ).rows[0]?.id;
    if (!id)
      id = (
        await client.query(
          "INSERT INTO monitoring_prompts(tenant_id,project_id,body,persona,version,active) VALUES($1,$2,$3,'Potential customer',1,true) RETURNING id",
          [tenantId, projectId, body],
        )
      ).rows[0].id;
    ids.push(id);
  }
  if (
    !(
      await client.query(
        "SELECT id FROM monitoring_schedules WHERE project_id=$1 AND status<>'deleted'",
        [projectId],
      )
    ).rowCount
  ) {
    await client.query(
      "INSERT INTO monitoring_schedules(tenant_id,project_id,config,status) VALUES($1,$2,$3,'paused')",
      [
        tenantId,
        projectId,
        JSON.stringify({
          engine: "gemini",
          model: env.GEMINI_MODEL,
          cadence: "daily",
          intervalMinutes: 1440,
          samples: 1,
          promptIds: ids,
          pausedPromptIds: [],
          geos: ["US"],
          languages: ["en"],
        }),
      ],
    );
  }
  await client.query(
    "UPDATE monitoring_schedules SET config=jsonb_set(config,'{model}',to_jsonb($2::text)) WHERE project_id=$1 AND status='paused' AND config->>'engine'='gemini'",
    [projectId, env.GEMINI_MODEL],
  );
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      projectId,
      tenantId,
      prompts: ids.length,
      schedule: "paused pending provider verification",
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  const message = error instanceof Error ? error.message : "SETUP_FAILED";
  console.error(
    ["OWNER_ACCOUNT_MISSING", "OWNER_ACCOUNT_UNVERIFIED"].includes(message)
      ? message
      : "SETUP_FAILED",
  );
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
