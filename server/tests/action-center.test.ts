import { describe, it, expect, vi } from "vitest";
import { FixGenerator } from "../src/services/action-center/fix-generator.js";
import { ActionHarvester } from "../src/services/action-center/action-harvester.js";
import { ActionVerifier } from "../src/services/action-center/action-verifier.js";
import { ActionCenterService } from "../src/services/action-center/action-center.service.js";

describe("Action Center - Fix Generator (ACT-FR-005)", () => {
  it("generates copy-ready robots.txt directive with mandatory Estimated disclaimer", () => {
    const fix = FixGenerator.generateRobotsFix(["OAI-SearchBot", "ClaudeBot"]);
    expect(fix.type).toBe("robots");
    expect(fix.code).toContain("User-agent: OAI-SearchBot\nAllow: /");
    expect(fix.code).toContain("User-agent: ClaudeBot\nAllow: /");
    expect(fix.label).toBe("Estimated");
    expect(fix.disclaimer).toContain(
      "Savoir does not auto-publish or write to your site (ACT-FR-005)",
    );
  });

  it("generates JSON-LD FAQ structured data snippet", () => {
    const fix = FixGenerator.generateFaqJsonLd([
      {
        question: "What is Savoir?",
        answer: "Savoir is an enterprise AEO/GEO analytics platform.",
      },
    ]);
    expect(fix.type).toBe("jsonld");
    expect(fix.code).toContain('<script type="application/ld+json">');
    expect(fix.code).toContain('"@type": "FAQPage"');
    expect(fix.code).toContain("What is Savoir?");
    expect(fix.label).toBe("Estimated");
  });

  it("generates /llms.txt starter draft", () => {
    const fix = FixGenerator.generateLlmsTxtFix("example.com", "Acme Inc");
    expect(fix.type).toBe("llms");
    expect(fix.code).toContain("# Acme Inc");
    expect(fix.code).toContain("https://example.com/features");
    expect(fix.label).toBe("Estimated");
  });

  it("generates canonical meta tag snippet", () => {
    const fix = FixGenerator.generateCanonicalFix("https://example.com/guides/aeo");
    expect(fix.type).toBe("meta");
    expect(fix.code).toBe('<link rel="canonical" href="https://example.com/guides/aeo" />');
  });

  it("generates step-by-step remediation guide", () => {
    const fix = FixGenerator.generateStepByStepGuide("Resolve 404 on Cited URL", [
      "Locate the deleted page.",
      "Add a 301 redirect.",
    ]);
    expect(fix.type).toBe("guide");
    expect(fix.code).toContain("1. Locate the deleted page.");
    expect(fix.code).toContain("2. Add a 301 redirect.");
  });
});

describe("Action Center - Priority Calculation (ACT-FR-003)", () => {
  it("calculates modeled priority score based on Impact, Confidence, and Effort weight", () => {
    // S effort (weight 1.0)
    // 10 * 1.0 / 1.0 * 10 = 100
    const p1 = ActionHarvester.calculatePriorityScore(10, 1.0, "S");
    expect(p1).toBe(100);

    // M effort (weight 1.8)
    // 9 * 0.9 / 1.8 * 10 = 45
    const p2 = ActionHarvester.calculatePriorityScore(9, 0.9, "M");
    expect(p2).toBe(45);

    // L effort (weight 3.0)
    // 6 * 0.8 / 3.0 * 10 = 16
    const p3 = ActionHarvester.calculatePriorityScore(6, 0.8, "L");
    expect(p3).toBe(16);

    // Score is clamped between 0 and 100
    const pClamped = ActionHarvester.calculatePriorityScore(10, 1.5, "S");
    expect(pClamped).toBe(100);
  });
});

describe("Action Center - Closed-Loop Verification (ACT-FR-008)", () => {
  it("verifies live robots.txt directive", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "User-agent: OAI-SearchBot\nAllow: /\nUser-agent: ClaudeBot\nAllow: /",
    } as unknown as Response);

    const result = await ActionVerifier.verifyAction(
      {
        category: "technical",
        sourceModule: "M8",
        title: "Allow OAI-SearchBot in robots.txt",
      },
      "example.com",
      mockFetch,
    );

    expect(result.status).toBe("verified");
    expect(result.notes).toContain("Found updated AI crawler directives");
  });

  it("flags not_verified when robots.txt does not contain required directives", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "User-agent: BadBot\nDisallow: /",
    } as unknown as Response);

    const result = await ActionVerifier.verifyAction(
      {
        category: "technical",
        sourceModule: "M8",
        title: "Allow OAI-SearchBot in robots.txt",
      },
      "example.com",
      mockFetch,
    );

    expect(result.status).toBe("not_verified");
    expect(result.notes).toContain(
      "Probed https://example.com/robots.txt but target AI bot allow directives were not detected",
    );
  });

  it("verifies /llms.txt publication", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "# Acme Corp\n> The leading platform for intelligent answer engineering.",
    } as unknown as Response);

    const result = await ActionVerifier.verifyAction(
      {
        category: "agent_readiness",
        sourceModule: "M16",
        title: "Publish /llms.txt markdown index",
      },
      "example.com",
      mockFetch,
    );

    expect(result.status).toBe("verified");
    expect(result.notes).toContain("Successfully probed https://example.com/llms.txt");
  });

  it("returns inconclusive for long-cycle content and competitor actions awaiting monitoring runs", async () => {
    const result = await ActionVerifier.verifyAction(
      {
        category: "content",
        sourceModule: "M9",
        title: "Publish guide answering target prompt",
      },
      "example.com",
    );

    expect(result.status).toBe("inconclusive");
    expect(result.notes).toContain("scheduled search monitoring run");
  });
});

describe("Action Center Service (M10)", () => {
  it("manages action creation, listing, comments, and RFC 4180 CSV export with formula escaping", async () => {
    const mockItems: Record<string, unknown>[] = [];
    const mockComments: Record<string, unknown>[] = [];

    const mockPool = {
      query: vi.fn().mockImplementation((queryText: string, params: unknown[]) => {
        if (queryText.includes("SELECT domain, name FROM projects")) {
          return { rows: [{ domain: "example.com", name: "Example Brand" }] };
        }

        if (queryText.includes("INSERT INTO action_items")) {
          const item = {
            id: "act-1234",
            tenant_id: params[1],
            project_id: params[0],
            title: params[2],
            description: params[3],
            category: params[4],
            source_module: "manual",
            source_id: null,
            dedup_key: params[5],
            status: "todo",
            dismiss_reason: null,
            priority_score: params[6],
            impact: params[7],
            confidence: params[8],
            effort: params[9],
            owner: params[10] || null,
            due_date: null,
            evidence: [],
            fix_guidance: null,
            verification_status: "pending",
            verification_notes: null,
            verified_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          };
          mockItems.push(item);
          return { rows: [item] };
        }

        if (queryText.includes("FROM action_items WHERE id = $1")) {
          const it = mockItems.find((i) => i.id === params[0]) || {
            id: params[0],
            tenant_id: params[2],
            project_id: params[1],
            title: "=CMD() Exploit Title",
            description: "High impact task",
            category: "technical",
            source_module: "M8",
            dedup_key: "M8:test",
            status: "todo",
            priority_score: 80,
            impact: 8,
            confidence: 0.9,
            effort: "S",
            evidence: [],
            verification_status: "pending",
            created_at: new Date(),
            updated_at: new Date(),
          };
          return { rows: [it] };
        }

        if (queryText.includes("SELECT COUNT(*)::int as total FROM action_items")) {
          return { rows: [{ total: 1 }] };
        }

        if (queryText.includes("GROUP BY category")) {
          return {
            rows: [
              {
                total: 1,
                todo_count: 1,
                in_progress_count: 0,
                done_count: 0,
                dismissed_count: 0,
                backlog_count: 0,
                avg_priority: 80,
                category: "technical",
                cat_count: 1,
              },
            ],
          };
        }

        if (queryText.includes("SELECT id, tenant_id, project_id, title, description, category")) {
          return {
            rows: [
              {
                id: "act-1234",
                tenant_id: params[1],
                project_id: params[0],
                title: "=CMD() Exploit Title",
                description: "Test description",
                category: "technical",
                source_module: "M8",
                dedup_key: "M8:test",
                status: "todo",
                priority_score: 80,
                impact: 8,
                confidence: 0.9,
                effort: "S",
                evidence: [],
                verification_status: "pending",
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }

        if (queryText.includes("INSERT INTO action_comments")) {
          const cmt = {
            id: "cmt-123",
            action_id: params[0],
            tenant_id: params[1],
            user_id: params[2],
            user_name: params[3],
            body: params[4],
            created_at: new Date(),
          };
          mockComments.push(cmt);
          return { rows: [cmt] };
        }

        if (queryText.includes("FROM action_comments")) {
          return { rows: mockComments };
        }

        return { rows: [] };
      }),
    };

    const service = new ActionCenterService(mockPool as unknown as import("pg").Pool);

    // 1. Create action
    const action = await service.createAction("proj-1", "tenant-1", {
      title: "Add Schema Markup",
      description: "Embed Organization JSON-LD snippet",
      category: "technical",
      impact: 8,
      confidence: 0.9,
      effort: "S",
    });
    expect(action.title).toBe("Add Schema Markup");
    expect(action.priorityScore).toBe(72); // 8 * 0.9 / 1.0 * 10 = 72

    // 2. List actions with stats
    const list = await service.listActions("proj-1", "tenant-1");
    expect(list.total).toBe(1);
    expect(list.stats.avgPriority).toBe(80);
    expect(list.stats.byCategory["technical"]).toBe(1);

    // 3. Comments
    const comment = await service.addComment(
      action.id,
      "proj-1",
      "tenant-1",
      "user-1",
      "Alice",
      "Assigned to frontend sprint.",
    );
    expect(comment.userName).toBe("Alice");
    expect(comment.body).toBe("Assigned to frontend sprint.");

    // 4. Export CSV with formula escaping
    const csv = await service.exportCsv("proj-1", "tenant-1");
    expect(csv).toContain("ID,Title,Category");
    // Ensure '=CMD() Exploit Title' was safely escaped with leading apostrophe
    expect(csv).toContain('"\'=CMD() Exploit Title"');
  });
});
