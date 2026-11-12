import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createDatabaseFixture } from "./database-fixture.js";
import { AnswerService } from "../../src/services/answer/answer.service.js";
import { processAnswerForRun } from "../../src/services/answer/answer-pipeline.service.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let answerService: AnswerService;

const ownerId = randomUUID();
const tenantId = randomUUID();
const projectId = randomUUID();
const competitorId = randomUUID();
const promptId = randomUUID();
const context = { tenantId, userId: ownerId };

beforeAll(async () => {
  f = await createDatabaseFixture();

  // 1. Seed user, tenant, membership, project, competitor, and prompt
  await f.database.query(
    `INSERT INTO users (id, email, name, password_hash, email_verified_at)
     VALUES ($1, 'answer-tester@example.com', 'Answer Tester', 'hash', now())`,
    [ownerId],
  );

  await f.database.query(
    `INSERT INTO tenants (id, name, region) VALUES ($1, 'Answer Pipeline Tenant', 'us')`,
    [tenantId],
  );

  await f.database.query(
    `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [tenantId, ownerId],
  );

  await f.database.query(
    `INSERT INTO projects (id, tenant_id, brand_name, domain, aliases, status)
     VALUES ($1, $2, 'Savoir AI', 'https://savoir.io', '["Savoir", "savoir.io"]'::jsonb, 'active')`,
    [projectId, tenantId],
  );

  await f.database.query(
    `INSERT INTO competitors (id, tenant_id, project_id, name, domain, aliases)
     VALUES ($1, $2, $3, 'ApexScale', 'https://apexscale.com', '["Apex Scale"]'::jsonb)`,
    [competitorId, tenantId, projectId],
  );

  await f.database.query(
    `INSERT INTO monitoring_prompts (id, tenant_id, project_id, body, persona, version, active)
     VALUES ($1, $2, $3, 'Which AI engine optimization tool is best?', 'SEO Lead', 1, true)`,
    [promptId, tenantId, projectId],
  );

  await f.database.query(
    `INSERT INTO monitoring_credits (tenant_id, available, reserved, used)
     VALUES ($1, 1000, 0, 0)`,
    [tenantId],
  );

  answerService = new AnswerService(f.database);
});

afterAll(async () => {
  await f?.close();
});

describe("Answer Pipeline & Explorer Integration (ANS & M5)", () => {
  let runId1: string;
  let runId2: string;
  let answerId1: string;
  let answerId2: string;

  it("processes a completed monitoring run into answer, mentions, citations, and claims", async () => {
    runId1 = randomUUID();
    const batchKey = randomUUID();
    const itemKey = randomUUID();

    const rawAnswerText = `
Here is a comprehensive breakdown of top platforms:
1. Savoir AI is the best choice, highly recommended for real-time visibility and ease of use. Pricing starts at $49/mo.
2. ApexScale is a viable alternative but is known to be expensive and complex to configure.

For independent reviews, visit https://www.g2.com/products/savoir-ai/reviews?utm_source=newsletter and read the docs at https://savoir.io/docs.
    `;

    // Seed monitoring run as succeeded
    await f.database.query(
      `INSERT INTO monitoring_runs (
        id, tenant_id, project_id, batch_key, item_key, request, status, result, created_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, now(), now())`,
      [
        runId1,
        tenantId,
        projectId,
        batchKey,
        itemKey,
        JSON.stringify({
          engine: "openai",
          model: "gpt-4o",
          promptId,
          geo: "US",
          language: "en",
          collectionMethod: "official_api",
        }),
        JSON.stringify({
          text: rawAnswerText,
          evidenceKey: `monitoring/${tenantId}/${projectId}/${runId1}/lease.json`,
          evidenceHash: "a".repeat(64),
          parserVersion: "openai-v1.0.0",
          citations: [
            {
              url: "https://www.g2.com/products/savoir-ai/reviews?utm_source=newsletter",
              title: "G2 Review",
            },
          ],
          searchQueries: ["Which AI engine optimization tool is best?"],
          latencyMs: 320,
          usage: { totalTokens: 210 },
        }),
      ],
    );

    // Process answer
    const result = await processAnswerForRun(f.runtime, runId1);

    expect(result).not.toBeNull();
    answerId1 = result!.answerId;
    expect(result!.brandMentioned).toBe(true);
    expect(result!.mentions.length).toBeGreaterThanOrEqual(2);
    expect(result!.citations.length).toBeGreaterThanOrEqual(2);
    expect(result!.claims.length).toBeGreaterThanOrEqual(1);

    // Verify brand mention
    const brandMention = result!.mentions.find((m) => m.entityType === "brand");
    expect(brandMention).toBeDefined();
    expect(brandMention?.entityName).toBe("Savoir AI");
    expect(brandMention?.positionIndex).toBe(1);
    expect(brandMention?.listRank).toBe(1);
    expect(brandMention?.sentiment).toBe(1); // Positive ("best choice, highly recommended")
    expect(brandMention?.confidence).toBeGreaterThanOrEqual(0.6);

    // Verify competitor mention
    const compMention = result!.mentions.find((m) => m.entityType === "competitor");
    expect(compMention).toBeDefined();
    expect(compMention?.entityName).toBe("ApexScale");
    expect(compMention?.positionIndex).toBe(2);
    expect(compMention?.listRank).toBe(2);

    // Verify citations
    const g2Citation = result!.citations.find((c) => c.domain === "g2.com");
    expect(g2Citation).toBeDefined();
    expect(g2Citation?.normalizedUrl).toBe("https://g2.com/products/savoir-ai/reviews");
    expect(g2Citation?.sourceType).toBe("review_comparison");

    const brandCitation = result!.citations.find((c) => c.domain === "savoir.io");
    expect(brandCitation).toBeDefined();
    expect(brandCitation?.sourceType).toBe("brand");

    // Verify audit event emitted
    const eventRes = await f.database.query(
      `SELECT * FROM monitoring_events WHERE project_id = $1 AND kind = 'answer.parsed'`,
      [projectId],
    );
    expect(eventRes.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("processes a second run (refusal) and verifies refusal flags and source disclosure", async () => {
    runId2 = randomUUID();
    const batchKey = randomUUID();
    const itemKey = randomUUID();

    await f.database.query(
      `INSERT INTO monitoring_runs (
        id, tenant_id, project_id, batch_key, item_key, request, status, result, created_at, completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'refused', $7, now(), now())`,
      [
        runId2,
        tenantId,
        projectId,
        batchKey,
        itemKey,
        JSON.stringify({
          engine: "google_ai_overviews",
          model: "google-ai-overview-surface",
          promptId,
          geo: "US",
          language: "en",
          collectionMethod: "licensed_serp",
        }),
        JSON.stringify({
          text: "",
          evidenceKey: `monitoring/${tenantId}/${projectId}/${runId2}/lease.json`,
          evidenceHash: "b".repeat(64),
          parserVersion: "google_ai_overviews-v1.0.0",
          citations: [],
          latencyMs: 400,
        }),
      ],
    );

    const result = await processAnswerForRun(f.runtime, runId2);
    expect(result).not.toBeNull();
    answerId2 = result!.answerId;

    const answer = await answerService.getAnswerById(context, projectId, answerId2);
    expect(answer.refusalFlag).toBe(true);
    expect(answer.sourceType).toBe("licensed_serp");
    expect(answer.sourceDisclosure.disclosureNote).toContain("licensed SERP");
  });

  it("lists answers with dynamic filtering, full-text search, and pagination (ANS-FR-001, ANS-FR-006)", async () => {
    // 1. Filter by engine
    const openaiList = await answerService.listAnswers(context, projectId, {
      engine: "openai",
    });
    expect(openaiList.total).toBe(1);
    if ("answers" in openaiList && openaiList.answers) {
      expect(openaiList.answers[0].engine).toBe("openai");
    }

    // 2. Filter by brandMentioned = true
    const brandMentionedList = await answerService.listAnswers(context, projectId, {
      brandMentioned: "true",
    });
    expect(brandMentionedList.total).toBe(1);
    if ("answers" in brandMentionedList && brandMentionedList.answers) {
      expect(brandMentionedList.answers[0].brandMentioned).toBe(true);
    }

    // 3. Filter by sentiment = 1
    const positiveList = await answerService.listAnswers(context, projectId, {
      sentiment: "1",
    });
    expect(positiveList.total).toBe(1);

    // 4. Full-text search (ANS-FR-006)
    const searchList = await answerService.listAnswers(context, projectId, {
      search: "visibility ease",
    });
    expect(searchList.total).toBe(1);
    if ("answers" in searchList && searchList.answers) {
      expect(searchList.answers[0].id).toBe(answerId1);
    }

    // 5. CSV export (ANS-FR-009)
    const csvExport = await answerService.listAnswers(context, projectId, {
      format: "csv",
    });
    expect("csv" in csvExport).toBe(true);
    if ("csv" in csvExport) {
      expect(csvExport.csv).toContain("Engine,Model,Geo,Language");
      expect(csvExport.csv).toContain("Savoir AI");
    }
  });

  it("retrieves full answer detail view (ANS-FR-002, ANS-FR-003, ANS-FR-011)", async () => {
    const detail = await answerService.getAnswerById(context, projectId, answerId1);

    expect(detail.id).toBe(answerId1);
    expect(detail.promptText).toBe("Which AI engine optimization tool is best?");
    expect(detail.mentions.length).toBeGreaterThanOrEqual(2);
    expect(detail.citations.length).toBeGreaterThanOrEqual(2);
    expect(detail.claims.length).toBeGreaterThanOrEqual(1);
  });

  it("compares answers side-by-side: cross-engine and timeline diff (ANS-FR-004, ANS-FR-005)", async () => {
    // Cross-engine compare for prompt (ANS-FR-005)
    const crossEngine = await answerService.compareAnswers(context, projectId, {
      promptId,
    });
    expect(crossEngine.type).toBe("cross_engine_compare");
    if ("engines" in crossEngine && crossEngine.engines) {
      expect(crossEngine.engines.length).toBe(2);
    }

    // Timeline diff between two answers (ANS-FR-004)
    const timelineDiff = await answerService.compareAnswers(context, projectId, {
      answerId1,
      answerId2,
    });
    expect(timelineDiff.type).toBe("timeline_diff");
    if ("diff" in timelineDiff && timelineDiff.diff) {
      expect(timelineDiff.diff).toBeDefined();
      expect(timelineDiff.diff.brandMentionedBefore).toBe(true);
      expect(timelineDiff.diff.brandMentionedAfter).toBe(false);
    }
  });

  it("flags an answer as inaccurate/misleading and updates mention review status (ANS-FR-007, Feature ANS-F1)", async () => {
    // 1. Flag answer
    const flag = await answerService.flagAnswer(context, projectId, answerId1, {
      reason: "inaccurate",
      note: "Competitor pricing mentioned is outdated as of Q1 2026.",
      tags: ["pricing", "competitor"],
    });

    expect(flag.id).toBeDefined();
    expect(flag.status).toBe("open");

    // Verify flag is returned in answer detail
    const detailAfterFlag = await answerService.getAnswerById(context, projectId, answerId1);
    expect(detailAfterFlag.flags.length).toBe(1);
    expect(detailAfterFlag.flags[0].reason).toBe("inaccurate");

    // 2. Review mention
    const mentionId = detailAfterFlag.mentions[0].id;
    const reviewed = await answerService.reviewMention(
      context,
      projectId,
      answerId1,
      mentionId,
      "verified",
    );

    expect(reviewed.reviewStatus).toBe("verified");
  });
});
