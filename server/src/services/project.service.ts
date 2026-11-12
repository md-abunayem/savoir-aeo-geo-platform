import type { Pool } from "pg";
import { z } from "zod";
const input = z
  .object({
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export function createProjectService(pool: Pool) {
  return {
    async list(userId: string, query: unknown) {
      const { after, limit } = input.parse(query);
      const result = await pool.query<{
        id: string;
        tenant_id: string;
        tenant_name: string;
        brand_name: string;
        domain: string;
        status: string;
      }>("SELECT * FROM public.savoir_owned_projects($1,$2,$3)", [
        z.uuid().parse(userId),
        after ?? null,
        limit + 1,
      ]);
      const projects = result.rows.slice(0, limit).map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        brandName: row.brand_name,
        domain: row.domain,
        status: row.status,
      }));
      return { projects, nextCursor: result.rows.length > limit ? projects.at(-1)!.id : null };
    },
  };
}
export type ProjectService = ReturnType<typeof createProjectService>;
