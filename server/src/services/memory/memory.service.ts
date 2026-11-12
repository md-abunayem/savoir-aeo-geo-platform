import { GoogleGenAI } from "@google/genai";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { z } from "zod";
import { brandMemory, productMemory, projects } from "../../db/schema.js";
import { withTenant, type TenantContext } from "../../db/tenant.js";
import { ApiError } from "../../utils/ApiError.js";

const approvalStatus = z.enum(["draft", "approved", "rejected"]).default("draft");
const strings = z.array(z.string().trim().min(1)).default([]);
const brandInput = z.object({
  brandVoice: z.string().trim().min(1),
  toneGuidelines: strings,
  audiencePersonas: strings,
  negativeKeywords: strings,
  negativeClaims: strings,
  approvalStatus,
});
const productInput = z
  .object({
    name: z.string().trim().min(1),
    features: strings,
    specs: z.record(z.string(), z.string()).default({}),
    pricing: z.string().trim().min(1),
    validFrom: z.date().nullable().default(null),
    validUntil: z.date().nullable().default(null),
    approvalStatus,
  })
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil > v.validFrom, {
    message: "validUntil must be after validFrom",
  });

export type BrandMemoryInput = z.input<typeof brandInput>;
export type ProductMemoryInput = z.input<typeof productInput>;
export interface MemoryFact {
  id: string;
  kind: "brand" | "product";
  facts: Record<string, unknown>;
}
export interface RelevantFact extends MemoryFact, Record<string, unknown> {
  similarity: number;
}

/** Bind to an authenticated tenant context; never accept that context from request bodies. */
export class MemoryService {
  private readonly ai: GoogleGenAI;

  constructor(
    private readonly pool: Pool,
    private readonly context: TenantContext,
    apiKey: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async embed(text: string, taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") {
    const result = await this.ai.models.embedContent({
      model: "text-embedding-004",
      contents: text,
      config: { taskType, outputDimensionality: 768, httpOptions: { timeout: 15000 } },
    });
    const values = result.embeddings?.[0]?.values;
    if (
      !values ||
      values.length !== 768 ||
      values.some((v) => !Number.isFinite(v)) ||
      !values.some((v) => v !== 0)
    ) {
      throw new ApiError(502, "Invalid memory embedding", "MEMORY_EMBEDDING_INVALID");
    }
    return values;
  }

  /** Full replacement on update: omitted optional fields return to their defaults. */
  async saveBrandMemory(projectId: string, input: BrandMemoryInput, id?: string) {
    const data = brandInput.parse(input);
    return this.save("brand", projectId, data, id);
  }

  async saveProductMemory(projectId: string, input: ProductMemoryInput, id?: string) {
    const data = productInput.parse(input);
    return this.save("product", projectId, data, id);
  }

  private async save(
    kind: "brand" | "product",
    projectId: string,
    data: z.output<typeof brandInput> | z.output<typeof productInput>,
    id?: string,
  ) {
    z.uuid().parse(projectId);
    if (id !== undefined) z.uuid().parse(id);
    // Authorize before sending private facts to the embedding provider.
    await this.requireProject(projectId);
    const embedding = await this.embed(JSON.stringify(data), "RETRIEVAL_DOCUMENT");
    return withTenant(this.pool, this.context, async (db) => {
      const scope = {
        projectId,
        tenantId: this.context.tenantId,
        embedding,
        updatedAt: new Date(),
      };
      const table = kind === "brand" ? brandMemory : productMemory;
      const where = and(
        eq(table.id, id ?? projectId),
        eq(table.projectId, projectId),
        eq(table.tenantId, this.context.tenantId),
      );
      // Branching keeps each table's insert/update shape checked by TypeScript.
      const rows =
        kind === "brand"
          ? id !== undefined
            ? await db
                .update(brandMemory)
                .set({ ...(data as z.output<typeof brandInput>), ...scope })
                .where(where)
                .returning({ id: brandMemory.id })
            : await db
                .insert(brandMemory)
                .values({ ...(data as z.output<typeof brandInput>), ...scope })
                .returning({ id: brandMemory.id })
          : id !== undefined
            ? await db
                .update(productMemory)
                .set({ ...(data as z.output<typeof productInput>), ...scope })
                .where(where)
                .returning({ id: productMemory.id })
            : await db
                .insert(productMemory)
                .values({ ...(data as z.output<typeof productInput>), ...scope })
                .returning({ id: productMemory.id });
      if (!rows[0]) throw new ApiError(404, "Memory not found", "NOT_FOUND");
      return rows[0];
    });
  }

  private async requireProject(projectId: string) {
    await withTenant(this.pool, this.context, async (db) => {
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, this.context.tenantId)));
      if (!project) throw new ApiError(404, "Project not found", "NOT_FOUND");
    });
  }

  /** Load all approved brand rules: mandatory exclusions must not depend on similarity. */
  async getApprovedBrandRules(projectId: string): Promise<MemoryFact[]> {
    z.uuid().parse(projectId);
    await this.requireProject(projectId);
    return withTenant(this.pool, this.context, async (db) => {
      const rows = await db
        .select({
          id: brandMemory.id,
          brandVoice: brandMemory.brandVoice,
          toneGuidelines: brandMemory.toneGuidelines,
          audiencePersonas: brandMemory.audiencePersonas,
          negativeKeywords: brandMemory.negativeKeywords,
          negativeClaims: brandMemory.negativeClaims,
        })
        .from(brandMemory)
        .where(
          and(
            eq(brandMemory.projectId, projectId),
            eq(brandMemory.tenantId, this.context.tenantId),
            eq(brandMemory.approvalStatus, "approved"),
          ),
        );
      return rows.map(({ id, ...facts }) => ({ id, kind: "brand" as const, facts }));
    });
  }

  /** Re-read current facts for independent review; expired or revoked records are excluded. */
  async getApprovedProductFacts(projectId: string): Promise<MemoryFact[]> {
    z.uuid().parse(projectId);
    await this.requireProject(projectId);
    return withTenant(this.pool, this.context, async (db) => {
      const rows = await db
        .select({
          id: productMemory.id,
          name: productMemory.name,
          features: productMemory.features,
          specs: productMemory.specs,
          pricing: productMemory.pricing,
          validFrom: productMemory.validFrom,
          validUntil: productMemory.validUntil,
        })
        .from(productMemory)
        .where(
          and(
            eq(productMemory.projectId, projectId),
            eq(productMemory.tenantId, this.context.tenantId),
            eq(productMemory.approvalStatus, "approved"),
            sql`(${productMemory.validFrom} IS NULL OR ${productMemory.validFrom} <= now())`,
            sql`(${productMemory.validUntil} IS NULL OR ${productMemory.validUntil} > now())`,
          ),
        );
      return rows.map(({ id, ...facts }) => ({ id, kind: "product" as const, facts }));
    });
  }

  /** threshold is minimum cosine similarity [-1, 1]; returns up to 20 approved facts. */
  async searchRelevantFacts(
    projectId: string,
    queryText: string,
    threshold = 0.7,
  ): Promise<RelevantFact[]> {
    z.uuid().parse(projectId);
    queryText = z.string().trim().min(1).parse(queryText);
    z.number().min(-1).max(1).parse(threshold);
    await this.requireProject(projectId);
    const embedding = JSON.stringify(await this.embed(queryText, "RETRIEVAL_QUERY"));
    return withTenant(this.pool, this.context, async (db) => {
      const result = await db.execute<RelevantFact>(sql`
        SELECT id, kind, facts, 1 - distance AS similarity FROM (
          SELECT id, 'brand' AS kind,
            jsonb_build_object('brandVoice', brand_voice, 'toneGuidelines', tone_guidelines,
              'audiencePersonas', audience_personas, 'negativeKeywords', negative_keywords,
              'negativeClaims', negative_claims) AS facts,
            embedding <=> ${embedding}::vector AS distance
          FROM brand_memory WHERE project_id = ${projectId}::uuid
            AND tenant_id = ${this.context.tenantId}::uuid AND approval_status = 'approved'
          UNION ALL
          SELECT id, 'product' AS kind,
            jsonb_build_object('name', name, 'features', features, 'specs', specs,
              'pricing', pricing, 'validFrom', valid_from, 'validUntil', valid_until) AS facts,
            embedding <=> ${embedding}::vector AS distance
          FROM product_memory WHERE project_id = ${projectId}::uuid
            AND tenant_id = ${this.context.tenantId}::uuid AND approval_status = 'approved'
            AND (valid_from IS NULL OR valid_from <= now())
            AND (valid_until IS NULL OR valid_until > now())
        ) memories WHERE distance <= ${1 - threshold}
        ORDER BY distance, kind, id LIMIT 20
      `);
      return result.rows;
    });
  }
}
