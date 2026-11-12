import "dotenv/config";
import { Pool } from "pg";
import { parseEnvironment } from "../config/env.js";

async function provision() {
  const env = parseEnvironment(process.env);
  if (!env.DATABASE_APP_URL)
    throw new Error("Set DATABASE_APP_URL with a separate runtime login first");
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL to a direct migration connection first");
  const migrationUrl = new URL(env.DATABASE_URL);
  const runtimeUrl = new URL(env.DATABASE_APP_URL);
  const name = decodeURIComponent(runtimeUrl.username);
  const password = decodeURIComponent(runtimeUrl.password);
  if (runtimeUrl.host !== migrationUrl.host || runtimeUrl.pathname !== migrationUrl.pathname) {
    throw new Error("Runtime and migration URLs must target the same database");
  }
  if (
    !/^[a-z][a-z0-9_]{2,62}$/.test(name) ||
    name === decodeURIComponent(migrationUrl.username) ||
    name === "savoir_runtime" ||
    password.length < 24
  ) {
    throw new Error("Use a distinct runtime login and a password of at least 24 characters");
  }
  const admin = new Pool({ connectionString: env.DATABASE_URL });
  const client = await admin.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL standard_conforming_strings = on");
    const privileges = await client.query(
      "SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user",
    );
    if (
      privileges.rowCount !== 1 ||
      (!privileges.rows[0].rolsuper && !privileges.rows[0].rolcreaterole)
    ) {
      throw new Error(
        "DATABASE_URL must use a PostgreSQL administrator or a role with CREATEROLE to provision DATABASE_APP_URL",
      );
    }
    const group = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = 'savoir_runtime' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolcreaterole AND NOT rolcreatedb",
    );
    if (group.rowCount !== 1) throw new Error("Apply the tenant-isolation migration first");
    const existing = await client.query(
      "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname = $1",
      [name],
    );
    const quotedPassword = "'" + password.replaceAll("'", "''") + "'";
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (row.rolsuper || row.rolbypassrls || row.rolcreaterole || row.rolcreatedb) {
        throw new Error(
          "Existing role has privileged attributes (superuser/bypassrls/createrole/createdb)",
        );
      }
      await client.query(
        'ALTER ROLE "' +
          name +
          '" WITH LOGIN PASSWORD ' +
          quotedPassword +
          " NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION",
      );
    } else {
      await client.query(
        'CREATE ROLE "' +
          name +
          '" LOGIN PASSWORD ' +
          quotedPassword +
          " NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION",
      );
    }
    await client.query('GRANT savoir_runtime TO "' + name + '"');
    await client.query("COMMIT");
    console.log("Restricted runtime login provisioned. No credentials were printed.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await admin.end();
  }
}
provision().catch((error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "EACCES") {
    console.error(
      "Runtime role provisioning failed: Cannot connect to PostgreSQL on localhost:5432. Ensure Docker and PostgreSQL are running.",
    );
  } else {
    console.error(
      "Runtime role provisioning failed:",
      error instanceof Error ? error.message : "Check prerequisites",
    );
  }
  process.exitCode = 1;
});
