import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export async function createDatabaseFixture() {
  const connections = new Map<Pool, Set<PoolClient>>();
  function track(pool: Pool) {
    const clients = new Set<PoolClient>();
    connections.set(pool, clients);
    pool.on("connect", (client) => {
      clients.add(client);
      client.once("end", () => clients.delete(client));
    });
    return pool;
  }
  async function drain(pool: Pool) {
    // pg-pool.end() can resolve before client sockets finish shutting down.
    // Wait for those sockets before DROP DATABASE ... FORCE terminates them.
    const closed = [...(connections.get(pool) ?? [])].map(
      (client) => new Promise<void>((resolve) => client.once("end", resolve)),
    );
    await pool.end();
    await Promise.all(closed);
  }
  const databaseName = "savoir_test_" + randomUUID().replaceAll("-", "");
  const roleName = "savoir_test_" + randomUUID().replaceAll("-", "");
  const adminUrl = process.env.DATABASE_URL;
  if (
    !adminUrl ||
    !["localhost", "127.0.0.1", "[::1]", "postgres"].includes(new URL(adminUrl).hostname)
  )
    throw new Error("Integration tests require local or CI PostgreSQL");
  const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
  const url = new URL(adminUrl);
  url.pathname = "/" + databaseName;
  const database = track(new Pool({ connectionString: url.toString() }));
  let runtime: Pool | undefined;
  let created = false,
    roleCreated = false;
  async function close() {
    if (runtime) await drain(runtime);
    await drain(database);
    if (created) await admin.query('DROP DATABASE "' + databaseName + '" WITH (FORCE)');
    if (roleCreated) await admin.query('DROP ROLE "' + roleName + '"');
    await admin.end();
  }
  try {
    await admin.query('CREATE DATABASE "' + databaseName + '"');
    created = true;
    await migrate(drizzle(database), { migrationsFolder: "./drizzle" });
    const password = randomUUID();
    await admin.query(
      'CREATE ROLE "' +
        roleName +
        '" LOGIN PASSWORD ' +
        "'" +
        password +
        "'" +
        " NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE",
    );
    roleCreated = true;
    await admin.query('GRANT savoir_runtime TO "' + roleName + '"');
    url.username = roleName;
    url.password = password;
    runtime = track(new Pool({ connectionString: url.toString(), max: 5 }));
    return { database, runtime, close };
  } catch (error) {
    await close();
    throw error;
  }
}
