import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Queue } from "bullmq";
import { createDatabaseFixture } from "./database-fixture.js";
import { createOnboardingService } from "../../src/services/onboarding.service.js";
import { createProjectService } from "../../src/services/project.service.js";

let f: Awaited<ReturnType<typeof createDatabaseFixture>>;
let onboardingService: ReturnType<typeof createOnboardingService>;
let projectService: ReturnType<typeof createProjectService>;

const testUser = randomUUID();
const otherUser = randomUUID();

beforeAll(async () => {
  f = await createDatabaseFixture();
  onboardingService = createOnboardingService(f.runtime, {
    allowLocalTest: true,
    monitoringEngines: [
      { engine: "gemini", model: "configured-gemini-model", enabled: true },
      { engine: "openai", model: "configured-openai-model", enabled: false },
    ],
  });
  projectService = createProjectService(f.runtime);

  // Insert verified test users
  await f.database.query(
    "INSERT INTO users(id, name, email, email_verified_at) VALUES($1, 'Onboarding User', 'onboarding-user@test.invalid', now()), ($2, 'Other User', 'other-user@test.invalid', now())",
    [testUser, otherUser],
  );
}, 60000);

afterAll(async () => {
  await f?.close();
});

it("saves, retrieves and removes onboarding drafts", async () => {
  const draftData = {
    step: 2,
    data: {
      domain: "brand-test.test",
      brandProfile: {
        brandName: "BrandTest",
        category: "Software & Technology",
      },
    },
  };

  await onboardingService.saveDraft(testUser, draftData);

  const retrieved = await onboardingService.getDraft(testUser);
  expect(retrieved).not.toBeNull();
  expect(retrieved?.step).toBe(2);
  expect((retrieved?.data as Record<string, unknown>).domain).toBe("brand-test.test");

  // Other user shouldn't see testUser's draft
  const otherDraft = await onboardingService.getDraft(otherUser);
  expect(otherDraft).toBeNull();

  await onboardingService.deleteDraft(testUser);
  expect(await onboardingService.getDraft(testUser)).toBeNull();
});

it("atomically activates a project, provisions workspace, competitors, prompts, credits and schedule", async () => {
  const mockQueue = {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
  } as unknown as Queue;

  const activationInput = {
    domain: "https://www.innovate-tech.test/",
    brandName: "InnovateTech",
    description: "Cutting-edge AI automation",
    aliases: ["Innovate", "innovate-tech.test"],
    category: "Software & Technology",
    region: "us" as const,
    competitors: [
      { name: "CompA", domain: "compa.test", rationale: "Main rival", aliases: [] },
      { name: "CompB", domain: "compb.test", rationale: "Secondary competitor", aliases: [] },
    ],
    markets: [{ country: "US", language: "en" }],
    prompts: [
      {
        text: "What is InnovateTech?",
        intent: "informational" as const,
        funnelStage: "awareness" as const,
        priority: 1,
        tags: ["brand"],
        persona: "",
      },
      {
        text: "InnovateTech vs CompA",
        intent: "comparison" as const,
        funnelStage: "consideration" as const,
        priority: 1,
        tags: ["comparison"],
        persona: "",
      },
      {
        text: "InnovateTech pricing",
        intent: "transactional" as const,
        funnelStage: "decision" as const,
        priority: 2,
        tags: ["pricing"],
        persona: "",
      },
    ],
    engines: ["chatgpt", "gemini"],
  };

  const activation = await onboardingService.activate(testUser, activationInput, mockQueue);

  expect(activation.projectId).toBeDefined();
  expect(activation.tenantId).toBeDefined();
  expect(activation.status).toBe("active");
  expect(mockQueue.add).toHaveBeenCalledTimes(1);

  // Verify project appears in project discovery for testUser
  const userProjects = await projectService.list(testUser, {});
  expect(userProjects.projects).toHaveLength(1);
  expect(userProjects.projects[0]?.id).toBe(activation.projectId);
  expect(userProjects.projects[0]?.brandName).toBe("InnovateTech");
  expect(userProjects.projects[0]?.domain).toBe("innovate-tech.test");

  // Verify other user cannot see the project
  const otherProjects = await projectService.list(otherUser, {});
  expect(otherProjects.projects).toHaveLength(0);

  // Check database state directly
  const promptsCheck = await f.database.query(
    "SELECT body, active FROM monitoring_prompts WHERE project_id = $1",
    [activation.projectId],
  );
  expect(promptsCheck.rows).toHaveLength(3);
  expect(promptsCheck.rows.every((p) => p.active)).toBe(true);

  const schedCheck = await f.database.query(
    "SELECT config, status FROM monitoring_schedules WHERE project_id = $1",
    [activation.projectId],
  );
  expect(schedCheck.rows).toHaveLength(2);
  const gemini = schedCheck.rows.find((s) => s.config.engine === "gemini");
  expect(gemini.status).toBe("active");
  expect(gemini.config.model).toBe("configured-gemini-model");
  expect(gemini.config.geos).toEqual(["US"]);
  expect(gemini.config.languages).toEqual(["en"]);
  expect(schedCheck.rows.find((s) => s.config.engine === "openai").status).toBe("paused");
  await f.runtime.query("SELECT savoir_monitoring_tick()");
  const runs = await f.database.query("SELECT request FROM monitoring_runs WHERE project_id=$1", [
    activation.projectId,
  ]);
  expect(runs.rows).toHaveLength(3);
  expect(runs.rows.every((r) => r.request.model === "configured-gemini-model")).toBe(true);

  const creditsCheck = await f.database.query(
    "SELECT available, reserved FROM monitoring_credits WHERE tenant_id = $1",
    [activation.tenantId],
  );
  expect(creditsCheck.rows[0]?.available).toBe(1997);
  expect(creditsCheck.rows[0]?.reserved).toBe(3);

  const compCheck = await f.database.query(
    "SELECT name, domain FROM competitors WHERE project_id = $1",
    [activation.projectId],
  );
  expect(compCheck.rows).toHaveLength(2);
});

it("supports Google OAuth identity linking and session creation", async () => {
  const googleUid = "google-uid-" + randomUUID();
  const email = "google-linked@test.invalid";

  // 1. First login with Google creates user
  const linkResult = await f.database.query<{ user_id: string; is_new: boolean }>(
    "SELECT * FROM public.savoir_oauth_login_or_link('google', $1, $2, 'OAuth User')",
    [googleUid, email],
  );
  expect(linkResult.rows[0]?.is_new).toBe(true);
  const newUserId = linkResult.rows[0]?.user_id;

  // 2. Can create session for OAuth user without a password
  const tokenHash = "a".repeat(64);
  const session = await f.database.query<{ session_id: string }>(
    "SELECT * FROM public.savoir_oauth_create_session($1, $2, $3)",
    [newUserId, tokenHash, randomUUID()],
  );
  expect(session.rows[0]?.session_id).toBeDefined();

  // 3. Subsequent OAuth login with same provider returns same user with is_new = false
  const repeatLogin = await f.database.query<{ user_id: string; is_new: boolean }>(
    "SELECT * FROM public.savoir_oauth_login_or_link('google', $1, $2, 'OAuth User')",
    [googleUid, email],
  );
  expect(repeatLogin.rows[0]?.user_id).toBe(newUserId);
  expect(repeatLogin.rows[0]?.is_new).toBe(false);
});
