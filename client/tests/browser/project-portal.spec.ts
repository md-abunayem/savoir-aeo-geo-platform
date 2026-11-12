import { test, expect as baseExpect, type Page } from "@playwright/test";
test.use({ actionTimeout: 60000 });
test.setTimeout(300000);
const expect = baseExpect.configure({ timeout: 60000 });
const id = "11111111-1111-4111-8111-111111111111",
  tenant = "22222222-2222-4222-8222-222222222222";
async function fixture(page: Page) {
  const state = {
    secondProject: false,
    failCanaryOnce: false,
    canaryKeys: [] as string[],
    created: false,
    launches: 0,
    launchBodies: [] as Record<string, unknown>[],
    firecrawlConfigured: true,
    canaries: 0,
    engineReads: 0,
    createKeys: [] as string[],
    failCreateOnce: false,
    draft: null as unknown,
    project: {
      id,
      tenantId: tenant,
      brandName: "Example Brand",
      domain: "example.com",
      status: "active",
      description: "",
      aliases: [],
      markets: [{ country: "US", language: "en" }],
    },
    prompts: [] as { id: string; body: string; active: boolean }[],
  };
  const detail = () => ({
    project: state.project,
    prompts: state.prompts,
    competitors: [],
    schedules: [],
    runs: [],
    counts: { pending: 0, succeeded: 0, failed: 0 },
    answers: 0,
    audit: null,
    credits: { available: 2000, reserved: 0, used: 0 },
    launch: null,
  });
  await page.route("**/v1/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname,
      method = req.method();
    let data: unknown = null;
    const body = method === "GET" ? {} : (req.postDataJSON() ?? {});
    if (path === "/v1/auth/me")
      data = {
        user: {
          id: "33333333-3333-4333-8333-333333333333",
          email: "preview@test.invalid",
          name: "Preview",
        },
      };
    else if (path === "/v1/auth/csrf") data = { csrfToken: "test-csrf" };
    else if (path === "/v1/projects")
      data = {
        projects: state.created ? [state.project, ...(state.secondProject ? [{ ...state.project, id: "44444444-4444-4444-8444-444444444444", brandName: "Second Brand" }] : [])] : [],
        nextCursor: null,
      };
    else if (path === "/v1/project-management/summaries") data = {};
    else if (path === "/v1/project-management/connections")
      data = {
        engines: [
          {
            engine: "gemini",
            name: "Gemini",
            model: "configured-model",
            configured: true,
            requiresGrounding: true,
          },
          {
            engine: "openai",
            name: "ChatGPT",
            model: "unavailable-model",
            configured: false,
            requiresGrounding: true,
          },
        ],
        firecrawl: { configured: state.firecrawlConfigured },
        dailyCallLimit: 20,
        note: "Configured does not mean quota has been verified.",
      };
    else if (
      path.startsWith(`/v1/tenants/${tenant}/projects/`) && path.endsWith("/monitoring/engines")
    ) {
      state.engineReads++;
      data = [
        {
          engine: "gemini",
          configured: true,
          model: "configured-model",
          observationStatus: null,
          observedAt: null,
        },
        {
          engine: "openai",
          configured: false,
          model: "unavailable-model",
          observationStatus: null,
          observedAt: null,
        },
      ];
    } else if (
      path === `/v1/tenants/${tenant}/projects/${id}/monitoring/canary` &&
      method === "POST"
    ) {
      state.canaries++;
      state.canaryKeys.push(req.headers()["idempotency-key"]);
      if (state.failCanaryOnce) {
        state.failCanaryOnce = false;
        await route.abort("failed");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      data = {
        status: "succeeded",
        generationStatus: "succeeded",
        engine: body.engine,
        model: "configured-model",
        modelVersion: "fixture-model-v1",
        latencyMs: 120,
        groundingObserved: true,
        citationsCount: 2,
        testedAt: new Date().toISOString(),
        platformCreditsApplied: false,
      };
    }
    else if (path === "/v1/onboarding/draft") {
      if (method === "PUT") state.draft = body;
      if (method === "DELETE") state.draft = null;
      data = state.draft;
    } else if (path === "/v1/project-management" && method === "POST") {
      state.createKeys.push(req.headers()["idempotency-key"]);
      state.created = true;
      state.project = { ...state.project, ...body };
      state.prompts = body.prompts.map((p: { text: string }, i: number) => ({
        id: `prompt-${i}`,
        body: p.text,
        active: true,
      }));
      if (state.failCreateOnce) {
        state.failCreateOnce = false;
        await route.abort("failed");
        return;
      }
      data = { projectId: id, tenantId: tenant };
    } else if (path === `/v1/project-management/${id}/launch`) {
      state.launches++;
      state.launchBodies.push(body);
      data = { runIds: ["run-1"], scheduleIds: [] };
    } else if (path === `/v1/project-management/${id}/status`) {
      state.project.status = body.status;
      data = { status: body.status };
    } else if (path === `/v1/project-management/${id}`) {
      if (method === "PATCH") {
        state.project = { ...state.project, ...body };
        state.prompts = body.prompts;
      }
      data = detail();
    } else {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          code: "NOT_FOUND",
          detail: `Unmocked endpoint ${path}`,
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data }),
    });
  });
  return state;
}
test("six-step setup saves without calls, survives a lost response, and opens project settings", async ({
  page,
}) => {
  const state = await fixture(page);
  state.failCreateOnce = true;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/projects");
  await page.getByRole("link", { name: "Add your first project" }).click();
  await page.getByLabel("Website", { exact: true }).fill("example.com");
  await page.getByLabel("Brand name", { exact: true }).fill("Example Brand");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Add market", exact: true }).click();
  await page.getByLabel("Country code", { exact: true }).nth(1).fill("GB");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Add three suggested prompts" })
    .click();
  await page
    .getByRole("textbox", { name: "Prompt 1", exact: true })
    .fill("What are the best tools for this business?");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const chatgpt = page.getByRole("checkbox", { name: /ChatGPT/ });
  await expect(chatgpt).toBeEnabled();
  await chatgpt.check();
  await expect(chatgpt).toBeChecked();
  await chatgpt.uncheck();
  await expect(chatgpt).not.toBeChecked();
  await page.getByRole("checkbox", { name: /Gemini/ }).check();
  await page
    .getByRole("combobox", { name: "Frequency", exact: true })
    .selectOption("weekly");
  await page.screenshot({
    path: "test-results/project-wizard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByText("US / en, GB / en", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: /Save without running/ }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "could not reach",
  );
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/settings$`));
  expect(state.createKeys).toHaveLength(2);
  expect(state.createKeys[0]).toBe(state.createKeys[1]);
  expect(state.launches).toBe(0);
  await page.getByLabel("Brand name", { exact: true }).fill("Updated Brand");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Settings saved");
  await page
    .getByRole("button", { name: "Archive project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm archive", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("archived");
  expect(state.project.status).toBe("archived");
  expect(errors).toEqual([]);
});

test("unconfigured engine selections restore and cannot launch monitoring", async ({ page }) => {
  const state = await fixture(page);
  state.draft = {
    step: 4,
    data: {
      selfService: true,
      domain: "example.com",
      brandName: "Draft Brand",
      prompts: [{ body: "Which tools should I use?", active: true }],
    },
  };
  await page.goto("/projects/new");
  const chatgpt = page.getByRole("checkbox", { name: /ChatGPT/ });
  await chatgpt.check();
  await page.getByRole("combobox", { name: "Frequency", exact: true }).selectOption("weekly");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(chatgpt).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Frequency", exact: true })).toHaveValue("weekly");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("radio", { name: /Schedule monitoring/ }).check();
  await page.getByRole("button", { name: "Save and launch", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Selected engines are not configured");
  expect(state.created).toBe(false);
  expect(state.launches).toBe(0);
});

test("invalid websites stay on the first step and drafts restore", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/projects/new");
  await page.getByLabel("Website", { exact: true }).fill("not a domain");
  await page.getByLabel("Brand name", { exact: true }).fill("Draft Brand");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "valid website",
  );
  expect(state.draft).toBeNull();
  await page.getByLabel("Website", { exact: true }).fill("example.com");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "saved draft has been restored",
  );
  await expect(
    page.getByRole("button", { name: "Add market", exact: true }),
  ).toBeVisible();
  expect(state.created).toBe(false);
  expect(state.launches).toBe(0);
});
test("configured Firecrawl supports audit selection and a crawl-only retry", async ({ page }) => {
  const state = await fixture(page);
  state.created = true;
  await page.goto(`/projects/${id}/progress`);
  const audit = page.getByRole("checkbox", { name: /Run a website audit with Firecrawl/ });
  await expect(audit).toBeEnabled();
  await audit.check();
  await expect(audit).toBeChecked();
  await page.getByRole("combobox", { name: "Crawl scope", exact: true }).selectOption("5");
  await audit.uncheck();
  await expect(page.getByRole("combobox", { name: "Crawl scope", exact: true })).toHaveCount(0);
  await audit.check();
  await page.getByRole("button", { name: "Start new collection", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Launch accepted");
  expect(state.launches).toBe(1);
  expect(state.launchBodies[0]).toMatchObject({ mode: "once", crawl: true, engines: [], pagesLimit: 5 });
});

test("unconfigured Firecrawl keeps the audit checkbox disabled", async ({ page }) => {
  const state = await fixture(page);
  state.created = true;
  state.firecrawlConfigured = false;
  await page.goto(`/projects/${id}/progress`);
  const audit = page.getByRole("checkbox", { name: /Run a website audit with Firecrawl/ });
  await expect(audit).toBeDisabled();
  await expect(audit).not.toBeChecked();
  await expect(page.getByText("Run a website audit with Firecrawl (not configured)", { exact: true })).toBeVisible();
  expect(state.launches).toBe(0);
});

test("project progress and connections render on mobile without horizontal overflow", async ({
  page,
}) => {
  const state = await fixture(page);
  state.created = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${id}/progress`);
  await expect(
    page.getByRole("heading", { name: "Example Brand progress" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No AI runs yet. Saving a project does not make provider calls.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/project-progress-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Connection status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connection status", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Configured, not tested").first(),
  ).toBeVisible();
});

test("connection tests are explicit, project-scoped, and ignore duplicate clicks", async ({
  page,
}) => {
  const state = await fixture(page);
  state.created = true;
  state.secondProject = true;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/connections");
  await expect(
    page.getByRole("heading", { name: "Connection status", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Configured, not tested").first()).toBeVisible();
  expect(state.canaries).toBe(0);
  expect(state.engineReads).toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/connections-desktop.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Test connection" }).first().click();
  const dialog = page.getByRole("dialog", {
    name: "Test provider connection?",
  });
  await expect(dialog).toContainText("Engine: Gemini");
  await expect(dialog).toContainText("Search grounding: requested");
  await expect(dialog).toContainText("may consume provider quota");
  const confirm = dialog.getByRole("button", { name: "Confirm test" });
  await confirm.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(page.getByRole("heading", { name: "Connection test result" })).toBeVisible();
  expect(state.canaries).toBe(1);
  expect(state.canaryKeys[0]).toMatch(/^[a-f0-9-]{36}$/);
  await expect(page.getByText("Generation succeeded.")).toBeVisible();
  await expect(page.getByText(/found \(2 provider sources\)/)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/connections-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Current project").selectOption("44444444-4444-4444-8444-444444444444");
  await expect(page.getByRole("heading", { name: "Connection test result" })).toHaveCount(0);
});

test("a lost connection test response reuses the original request key", async ({ page }) => {
  const state = await fixture(page);
  state.created = true;
  state.failCanaryOnce = true;
  await page.goto("/connections");
  await page.getByRole("button", { name: "Test connection" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirm test" }).click();
  await expect(dialog.getByRole("alert")).toContainText("outcome could not be confirmed");
  await dialog.getByRole("button", { name: "Confirm test" }).click();
  await expect(page.getByText("Generation succeeded.")).toBeVisible();
  expect(state.canaryKeys).toHaveLength(2);
  expect(state.canaryKeys[1]).toBe(state.canaryKeys[0]);
});
