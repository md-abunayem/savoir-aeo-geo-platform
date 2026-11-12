import "dotenv/config";
import { parseArgs } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";
async function main() {
  const args = parseArgs({
    options: {
      email: { type: "string" },
      domain: { type: "string" },
      credits: { type: "string" },
      "request-id": { type: "string" },
      "minimum-interval": { type: "string" },
    },
    strict: true,
  }).values;
  const input = z
    .object({
      email: z.email().transform((v) => v.toLowerCase()),
      domain: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      credits: z.coerce.number().int().min(1).max(100000),
      "request-id": z.uuid(),
      "minimum-interval": z.coerce.number().int().min(60).max(43200).default(1440),
    })
    .parse(args);
  const url = process.env.DATABASE_URL;
  if (
    process.env.NODE_ENV === "production" ||
    !url ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
  )
    throw new Error("Local development only");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7))", [
      input["request-id"],
    ]);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = await client.query(
      "SELECT details FROM monitoring_events WHERE kind='credits.development_grant' AND details->>'requestId'=$1",
      [input["request-id"]],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].details.fingerprint !== fingerprint)
        throw new Error("Request id conflict");
      await client.query("COMMIT");
      console.log(JSON.stringify(existing.rows[0].details));
      return;
    }
    const user = await client.query(
      "SELECT id FROM users WHERE lower(email)=$1 AND email_verified_at IS NOT NULL AND disabled_at IS NULL",
      [input.email],
    );
    if (user.rowCount !== 1) throw new Error("One existing verified account is required");
    const tenantId = randomUUID(),
      projectId = randomUUID();
    await client.query("INSERT INTO tenants(id,name,region) VALUES($1,$2,'us')", [
      tenantId,
      "Monitoring development workspace",
    ]);
    await client.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [
      tenantId,
      user.rows[0].id,
    ]);
    await client.query(
      "INSERT INTO projects(id,tenant_id,brand_name,domain,status) VALUES($1,$2,$3,$4,'active')",
      [projectId, tenantId, input.domain, input.domain],
    );
    await client.query(
      "INSERT INTO monitoring_credits(tenant_id,available,minimum_interval_minutes) VALUES($1,$2,$3)",
      [tenantId, input.credits, input["minimum-interval"]],
    );
    const details = {
      tenantId,
      projectId,
      credits: input.credits,
      requestId: input["request-id"],
      fingerprint,
      testOnly: true,
    };
    await client.query(
      "INSERT INTO monitoring_events(tenant_id,project_id,kind,details) VALUES($1,$2,'credits.development_grant',$3)",
      [tenantId, projectId, details],
    );
    await client.query("COMMIT");
    console.log(JSON.stringify(details));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "Monitoring development setup failed. Check arguments, local database and verified account; no credentials are printed.",
  );
  process.exitCode = 1;
});
