import type { Pool } from "pg";
import { ApiError } from "../../utils/ApiError.js";
import { validateDomainSecurity } from "../domain-security.service.js";
import { LlmsValidator, type LlmsValidationResult } from "./llms-validator.js";
import {
  RobotsPolicyBuilder,
  type PolicyPreset,
  type RobotsComparisonResult,
} from "./robots-policy-builder.js";
import {
  DraftGenerator,
  type BrandProfileInput,
  type CrawledPageSummary,
  type GeneratedSchemas,
} from "./draft-generator.js";

export interface AgentPolicyRecord {
  id: string;
  tenantId: string;
  projectId: string;
  policyPreset: PolicyPreset;
  robotsTxtContent: string;
  botRules: Record<string, boolean>;
  trainingBotsDisallowed: boolean;
  searchBotsAllowed: boolean;
  customDirectives: string | null;
  llmsTxtDraft: string | null;
  llmsFullTxtDraft: string | null;
  llmsValidation: LlmsValidationResult | Record<string, unknown>;
  schemaTemplates: GeneratedSchemas | Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SavePolicyInput {
  policyPreset?: PolicyPreset;
  robotsTxtContent: string;
  botRules?: Record<string, boolean>;
  trainingBotsDisallowed?: boolean;
  searchBotsAllowed?: boolean;
  customDirectives?: string | null;
  llmsTxtDraft?: string | null;
  llmsFullTxtDraft?: string | null;
  llmsValidation?: Record<string, unknown>;
  schemaTemplates?: Record<string, unknown>;
}

export interface AxoServiceConfig {
  allowLocalTest?: boolean;
  fetchTimeoutMs?: number;
}

export class AxoService {
  private llmsValidator: LlmsValidator;
  private robotsPolicyBuilder: RobotsPolicyBuilder;
  private draftGenerator: DraftGenerator;
  private fetchTimeoutMs: number;

  constructor(
    private pool: Pool,
    private config: AxoServiceConfig = {},
  ) {
    this.llmsValidator = new LlmsValidator();
    this.robotsPolicyBuilder = new RobotsPolicyBuilder();
    this.draftGenerator = new DraftGenerator();
    this.fetchTimeoutMs = config.fetchTimeoutMs || 8000;
  }

  /**
   * 1. Get current project agent policy (or return default recommended configuration)
   */
  async getPolicy(tenantId: string, projectId: string): Promise<AgentPolicyRecord> {
    const project = await this.getProject(tenantId, projectId);

    const query = `
      SELECT 
        id,
        tenant_id as "tenantId",
        project_id as "projectId",
        policy_preset as "policyPreset",
        robots_txt_content as "robotsTxtContent",
        bot_rules as "botRules",
        training_bots_disallowed as "trainingBotsDisallowed",
        search_bots_allowed as "searchBotsAllowed",
        custom_directives as "customDirectives",
        llms_txt_draft as "llmsTxtDraft",
        llms_full_txt_draft as "llmsFullTxtDraft",
        llms_validation as "llmsValidation",
        schema_templates as "schemaTemplates",
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM public.agent_policies
      WHERE project_id = $1 AND tenant_id = $2
      LIMIT 1
    `;

    const res = await this.pool.query(query, [projectId, tenantId]);

    if (res.rows.length > 0) {
      return res.rows[0];
    }

    // Default synthesis if no saved policy exists yet
    const defaultRobots = this.robotsPolicyBuilder.generateRobotsTxt({
      preset: "search_only",
      domain: project.domain,
    });

    const defaultDrafts = await this.generateDrafts(tenantId, projectId);

    return {
      id: "draft",
      tenantId,
      projectId,
      policyPreset: "search_only",
      robotsTxtContent: defaultRobots,
      botRules: {},
      trainingBotsDisallowed: true,
      searchBotsAllowed: true,
      customDirectives: null,
      llmsTxtDraft: defaultDrafts.llmsTxt,
      llmsFullTxtDraft: defaultDrafts.llmsFullTxt,
      llmsValidation: {},
      schemaTemplates: defaultDrafts.schemas,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 2. Save or update project agent policy
   */
  async savePolicy(
    tenantId: string,
    projectId: string,
    payload: SavePolicyInput,
  ): Promise<AgentPolicyRecord> {
    await this.getProject(tenantId, projectId);

    const policyPreset = payload.policyPreset || "search_only";
    const robotsTxtContent = payload.robotsTxtContent || "";
    const botRules = JSON.stringify(payload.botRules || {});
    const trainingBotsDisallowed = payload.trainingBotsDisallowed ?? true;
    const searchBotsAllowed = payload.searchBotsAllowed ?? true;
    const customDirectives = payload.customDirectives || null;
    const llmsTxtDraft = payload.llmsTxtDraft || null;
    const llmsFullTxtDraft = payload.llmsFullTxtDraft || null;
    const llmsValidation = JSON.stringify(payload.llmsValidation || {});
    const schemaTemplates = JSON.stringify(payload.schemaTemplates || {});

    // Check if existing record exists
    const checkRes = await this.pool.query(
      `SELECT id FROM public.agent_policies WHERE project_id = $1 AND tenant_id = $2 LIMIT 1`,
      [projectId, tenantId],
    );

    let res;
    if (checkRes.rows.length > 0) {
      const updateQuery = `
        UPDATE public.agent_policies
        SET
          policy_preset = $1,
          robots_txt_content = $2,
          bot_rules = $3,
          training_bots_disallowed = $4,
          search_bots_allowed = $5,
          custom_directives = $6,
          llms_txt_draft = $7,
          llms_full_txt_draft = $8,
          llms_validation = $9,
          schema_templates = $10,
          updated_at = NOW()
        WHERE project_id = $11 AND tenant_id = $12
        RETURNING
          id,
          tenant_id as "tenantId",
          project_id as "projectId",
          policy_preset as "policyPreset",
          robots_txt_content as "robotsTxtContent",
          bot_rules as "botRules",
          training_bots_disallowed as "trainingBotsDisallowed",
          search_bots_allowed as "searchBotsAllowed",
          custom_directives as "customDirectives",
          llms_txt_draft as "llmsTxtDraft",
          llms_full_txt_draft as "llmsFullTxtDraft",
          llms_validation as "llmsValidation",
          schema_templates as "schemaTemplates",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `;
      res = await this.pool.query(updateQuery, [
        policyPreset,
        robotsTxtContent,
        botRules,
        trainingBotsDisallowed,
        searchBotsAllowed,
        customDirectives,
        llmsTxtDraft,
        llmsFullTxtDraft,
        llmsValidation,
        schemaTemplates,
        projectId,
        tenantId,
      ]);
    } else {
      const insertQuery = `
        INSERT INTO public.agent_policies (
          tenant_id,
          project_id,
          policy_preset,
          robots_txt_content,
          bot_rules,
          training_bots_disallowed,
          search_bots_allowed,
          custom_directives,
          llms_txt_draft,
          llms_full_txt_draft,
          llms_validation,
          schema_templates,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        RETURNING
          id,
          tenant_id as "tenantId",
          project_id as "projectId",
          policy_preset as "policyPreset",
          robots_txt_content as "robotsTxtContent",
          bot_rules as "botRules",
          training_bots_disallowed as "trainingBotsDisallowed",
          search_bots_allowed as "searchBotsAllowed",
          custom_directives as "customDirectives",
          llms_txt_draft as "llmsTxtDraft",
          llms_full_txt_draft as "llmsFullTxtDraft",
          llms_validation as "llmsValidation",
          schema_templates as "schemaTemplates",
          created_at as "createdAt",
          updated_at as "updatedAt"
      `;
      res = await this.pool.query(insertQuery, [
        tenantId,
        projectId,
        policyPreset,
        robotsTxtContent,
        botRules,
        trainingBotsDisallowed,
        searchBotsAllowed,
        customDirectives,
        llmsTxtDraft,
        llmsFullTxtDraft,
        llmsValidation,
        schemaTemplates,
      ]);
    }

    return res.rows[0];
  }

  /**
   * 3. Validate Live /llms.txt and /llms-full.txt from domain (AXO-FR-001, AXO-FR-002)
   */
  async validateLiveLlms(
    tenantId: string,
    projectId: string,
    customUrl?: string,
  ): Promise<{
    url: string;
    statusCode: number;
    rawContent: string;
    validation: LlmsValidationResult;
    fullTxtAvailable: boolean;
    fullTxtUrl: string | null;
  }> {
    const project = await this.getProject(tenantId, projectId);
    const domain = project.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

    const targetUrl = customUrl?.trim() || `https://${domain}/llms.txt`;

    let urlObj: URL;
    try {
      urlObj = new URL(targetUrl);
    } catch {
      throw new ApiError(400, "Invalid target URL", "INVALID_URL");
    }

    // SSRF validation
    try {
      await validateDomainSecurity(urlObj.hostname);
    } catch (err: unknown) {
      if (!this.config.allowLocalTest) {
        throw err instanceof ApiError
          ? err
          : new ApiError(400, "SSRF validation failed", "SSRF_REJECTED");
      }
    }

    let rawContent = "";
    let statusCode = 0;

    try {
      const response = await fetch(targetUrl, {
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
        headers: {
          "User-Agent": "AEO-GEO-AgentExperienceOptimizer/1.0",
          Accept: "text/plain, text/markdown, text/*",
        },
      });

      statusCode = response.status;
      if (response.ok) {
        rawContent = await response.text();
      }
    } catch {
      // Unreachable or connection error
    }

    const validation = this.llmsValidator.validate(rawContent, domain);

    // Check if /llms-full.txt also exists
    let fullTxtAvailable = false;
    let fullTxtUrl: string | null = null;
    const fullUrlCandidate = `https://${domain}/llms-full.txt`;

    try {
      const fullRes = await fetch(fullUrlCandidate, {
        method: "HEAD",
        signal: AbortSignal.timeout(Math.min(this.fetchTimeoutMs, 3000)),
        headers: { "User-Agent": "AEO-GEO-AgentExperienceOptimizer/1.0" },
      });
      if (fullRes.ok) {
        fullTxtAvailable = true;
        fullTxtUrl = fullUrlCandidate;
      }
    } catch {
      fullTxtAvailable = false;
    }

    return {
      url: targetUrl,
      statusCode,
      rawContent,
      validation,
      fullTxtAvailable,
      fullTxtUrl,
    };
  }

  /**
   * 4. Generate Robots.txt and compute diff against live robots.txt (AXO-FR-003, AXO-FR-004, AXO-FR-005)
   */
  async generateRobotsPolicy(
    tenantId: string,
    projectId: string,
    options: {
      preset?: PolicyPreset;
      customBotRules?: Record<string, boolean>;
      customDirectives?: string;
    } = {},
  ): Promise<{
    preset: PolicyPreset;
    generatedContent: string;
    existingContent: string;
    comparison: RobotsComparisonResult;
  }> {
    const project = await this.getProject(tenantId, projectId);
    const domain = project.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const preset = options.preset || "search_only";

    const generatedContent = this.robotsPolicyBuilder.generateRobotsTxt({
      preset,
      customBotRules: options.customBotRules,
      customDirectives: options.customDirectives,
      domain,
    });

    // Try fetching existing live robots.txt from target domain
    let existingContent = "";
    try {
      const liveRes = await fetch(`https://${domain}/robots.txt`, {
        signal: AbortSignal.timeout(this.fetchTimeoutMs),
        headers: { "User-Agent": "AEO-GEO-AgentExperienceOptimizer/1.0" },
      });
      if (liveRes.ok) {
        existingContent = await liveRes.text();
      }
    } catch {
      existingContent = "";
    }

    const comparison = this.robotsPolicyBuilder.compareRobotsTxt(existingContent, generatedContent);

    return {
      preset,
      generatedContent,
      existingContent,
      comparison,
    };
  }

  /**
   * 5. Synthesize draft /llms.txt, /llms-full.txt, and Schema.org JSON-LD (AXO-FR-006, AXO-FR-007, AXO-FR-008)
   */
  async generateDrafts(
    tenantId: string,
    projectId: string,
  ): Promise<{
    llmsTxt: string;
    llmsFullTxt: string;
    schemas: GeneratedSchemas;
  }> {
    const project = await this.getProject(tenantId, projectId);

    // Fetch high-scoring crawled pages from technical audit if available
    const pagesRes = await this.pool.query(
      `SELECT url, path, page_score as "pageScore", word_count as "wordCount"
       FROM public.technical_audit_pages
       WHERE project_id = $1 AND tenant_id = $2 AND is_indexable = true
       ORDER BY page_score DESC, word_count DESC
       LIMIT 25`,
      [projectId, tenantId],
    );

    const crawledPages: CrawledPageSummary[] = pagesRes.rows.map((r) => ({
      url: r.url,
      path: r.path,
      pageScore: r.pageScore,
      wordCount: r.wordCount,
    }));

    // Fetch seed prompts to construct rich FAQ schemas
    const promptsRes = await this.pool.query(
      `SELECT body as text FROM public.monitoring_prompts
       WHERE project_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 10`,
      [projectId, tenantId],
    );
    const seedPrompts = promptsRes.rows.map((p) => p.text as string);

    const brandProfile: BrandProfileInput = {
      brandName: project.brandName,
      domain: project.domain,
      description: project.description,
      aliases: project.aliases,
    };

    const llmsTxt = this.draftGenerator.generateLlmsTxt(brandProfile, crawledPages);
    const llmsFullTxt = this.draftGenerator.generateLlmsFullTxt(brandProfile, crawledPages);
    const schemas = this.draftGenerator.generateJsonLdSchemas(
      brandProfile,
      crawledPages,
      seedPrompts,
    );

    return {
      llmsTxt,
      llmsFullTxt,
      schemas,
    };
  }

  private async getProject(
    tenantId: string,
    projectId: string,
  ): Promise<{
    id: string;
    brandName: string;
    domain: string;
    description: string | null;
    aliases: string[];
  }> {
    const res = await this.pool.query(
      `SELECT id, brand_name as "brandName", domain, description, aliases
       FROM public.projects
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [projectId, tenantId],
    );

    if (res.rows.length === 0) {
      throw new ApiError(404, "Project not found", "PROJECT_NOT_FOUND");
    }

    return res.rows[0];
  }
}
