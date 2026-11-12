import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 5000,
  });
  const db = drizzle({ client: pool, schema });
  return { pool, db };
}
