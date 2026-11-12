import type { Pool, PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "./schema.js";
import { ApiError } from "../utils/ApiError.js";

const contextSchema = z.object({ userId: z.uuid(), tenantId: z.uuid() });
export type TenantContext = z.infer<typeof contextSchema>;
type TenantDatabase = NodePgDatabase<typeof schema>;

/** Call only with a server-authenticated user ID. Tenant selection is checked against membership. */
export async function withTenant<T>(
  pool: Pool,
  context: TenantContext,
  operation: (database: TenantDatabase) => Promise<T>,
): Promise<T> {
  return withTenantClient(pool, context, (client) => operation(drizzle({ client, schema })));
}

export async function withTenantClient<T>(
  pool: Pool,
  context: TenantContext,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const { userId, tenantId } = contextSchema.parse(context);
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    if (!role.rows[0] || role.rows[0].rolsuper || role.rows[0].rolbypassrls) {
      throw new ApiError(503, "Restricted database connection required", "UNSAFE_DATABASE_ROLE");
    }
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)",
      [userId, tenantId],
    );
    const membership = await client.query(
      "SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2 AND role = 'owner'",
      [tenantId, userId],
    );
    if (membership.rowCount !== 1) throw new ApiError(404, "Resource not found", "NOT_FOUND");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
