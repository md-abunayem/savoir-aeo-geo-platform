import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60000);
const projectId = "11111111-1111-4111-8111-111111111111";
const secondId = "33333333-3333-4333-8333-333333333333";
const tenantId = "22222222-2222-4222-8222-222222222222";

async function fixture(page: Page, count = 1) {
  const state = {
    failCreate: false, loseResponse: false, failPause: false,
    failAuxiliary: false,
    auxiliaryRequests: 0,
    keys: [] as string[],
    importKeys: [] as string[],
    runRequests: [] as Record<string, unknown>[],
    runKeys: [] as string[],
    receipts: new Map<string, unknown>(),
    prompts: Array.from({ length: count }, (_, index) => ({
      id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
      body: `Question ${index + 1}`, persona: "Buyer", tags: index === 0 ? ["Comparison"] : [], version: 1, active: true,
      archived_at: null as string | null, archived_active: null as boolean | null, created_at: new Date(index).toISOString(),
      updated_at: new Date(index).toISOString(), visibility: 42.5, cited_count: 2,
      answer_count: 4, engines: ["gemini"],
    })),
  };
  await page.route("**/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let data: unknown = [];
    if (path === "/v1/auth/me") data = { user: { id: "owner", name: "Owner" } };
    else if (path === "/v1/auth/csrf") data = { csrfToken: "test-csrf" };
    else if (state.failAuxiliary && (path.endsWith("/runs") || path.endsWith("/schedules")) && request.method() === "GET") {
      state.auxiliaryRequests += 1;
      await route.fulfill({ status: 503, json: { detail: "Monitoring data unavailable" } }); return;
    }
    else if (path.endsWith("/engines")) data = [{ engine: "openai", configured: true }];
    else if (path === "/v1/projects") data = {
      projects: [projectId, secondId].map((id, index) => ({ id, tenantId, brandName: `Project ${index + 1}`, domain: "example.com", status: "active" })), nextCursor: null,
    };
    else if (path.endsWith("/health")) data = { credits: { available: 100, reserved: 0, used: 0 } };
    else if (path.endsWith("/prompts/summary")) data = {
      total: state.prompts.filter((prompt) => !prompt.archived_at).length,
      active: state.prompts.filter((prompt) => prompt.active && !prompt.archived_at).length,
      paused: state.prompts.filter((prompt) => !prompt.active && !prompt.archived_at).length,
      archived: state.prompts.filter((prompt) => Boolean(prompt.archived_at)).length,
      answers_30d: 0,
      avg_visibility: 42.5,
    };
    else if (path.endsWith("/prompts/suggestions")) data = {
      source: "local", billable: false,
      suggestions: [{ body: "Which providers are best for example.com?", persona: "", tags: ["Suggested"] }],
    };
    else if (path.endsWith("/prompts/import") && request.method() === "POST") {
      state.importKeys.push(request.headers()["idempotency-key"]);
      const { prompts } = request.postDataJSON();
      let created = 0, skipped = 0;
      for (const prompt of prompts) {
        if (state.prompts.some((item) => item.body.toLowerCase() === prompt.body.toLowerCase() && !item.archived_at)) {
          skipped++;
        } else {
          state.prompts.unshift({
            ...prompt, id: crypto.randomUUID(), version: 1, active: true,
            archived_at: null, archived_active: null, created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          created++;
        }
      }
      data = { created, skipped, prompts: [] };
    }
    else if (path.endsWith("/prompts/bulk") && request.method() === "POST") {
      const { promptIds, action, tag } = request.postDataJSON();
      for (const prompt of state.prompts.filter((item) => promptIds.includes(item.id))) {
        if (action === "pause") prompt.active = false;
        if (action === "resume") prompt.active = true;
        if (action === "archive") {
          if (!prompt.archived_at) prompt.archived_active = prompt.active;
          prompt.archived_at = new Date().toISOString();
          prompt.active = false;
        }
        if (action === "restore" && prompt.archived_at) {
          prompt.active = prompt.archived_active ?? false;
          prompt.archived_active = null;
          prompt.archived_at = null;
        }
        if (action === "add-tag" && !prompt.tags.includes(tag)) prompt.tags.push(tag);
      }
      data = { updated: [] };
    }
    else if (path.endsWith("/runs") && request.method() === "POST") {
      state.runRequests.push(request.postDataJSON());
      state.runKeys.push(request.headers()["idempotency-key"]);
      data = { runIds: ["66666666-6666-4666-8666-666666666666"] };
    }
    else if (path.endsWith("/prompts") && request.method() === "POST") {
      const key = request.headers()["idempotency-key"];
      state.keys.push(key);
      if (state.failCreate) {
        state.failCreate = false;
        await route.fulfill({ status: 503, json: { detail: "Temporary failure" } }); return;
      }
      if (!state.receipts.has(key)) {
        const prompt = { ...request.postDataJSON(), id: "55555555-5555-4555-8555-555555555555", version: 1, active: true };
        state.prompts.unshift(prompt);
        state.receipts.set(key, prompt);
      }
      data = state.receipts.get(key);
      if (state.loseResponse) { state.loseResponse = false; await route.abort("failed"); return; }
    }
    else if (path.includes("/prompts/") && request.method() === "PATCH") {
      if (state.failPause) {
        state.failPause = false;
        await route.fulfill({ status: 503, json: { detail: "Pause failed" } }); return;
      }
      const prompt = state.prompts.find((p) => path.endsWith(p.id))!;
      prompt.active = request.postDataJSON().active;
      data = prompt;
    }
    else if (path.endsWith("/prompts")) {
      if (path.includes(secondId)) data = [{ ...state.prompts[0], body: "Second project question" }];
      else {
        const cursor = url.searchParams.get("before");
          const prompts = url.searchParams.get("includeArchived") === "true"
            ? state.prompts
            : state.prompts.filter((prompt) => !prompt.archived_at);
          const offset = cursor ? prompts.findIndex((p) => p.id === cursor) + 1 : 0;
          data = prompts.slice(offset, offset + 100);
        }
    }
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`/prompts?project=${projectId}`);
  await expect(page.getByRole("heading", { name: "Your prompts", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select prompt Question 1", exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Prompt details" })).toBeVisible();
  return state;
}

async function openForm(page: Page) {
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Which tool should I choose?");
  await page.getByRole("textbox", { name: /Persona or context/ }).fill("Research buyer");
}

test("sidebar stays consistent and prompts render when auxiliary monitoring requests fail", async ({ page }) => {
  const state = await fixture(page);
  state.failAuxiliary = true;
  await page.getByRole("button", { name: "Refresh prompt data" }).click();
  await expect(page.getByRole("heading", { name: "Your prompts", exact: true })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveClass(/workspace-shell/);
  expect(state.auxiliaryRequests).toBe(0);
});

test("a failed save preserves the form, input, and prompt table for retry", async ({ page }) => {
  const state = await fixture(page);
  state.failCreate = true;
  await openForm(page);
  const submit = page.locator("#prompt-create").getByRole("button", { name: "Add prompt", exact: true });
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("save could not be confirmed");
  await expect(page.getByRole("textbox", { name: "Question", exact: true })).toHaveValue("Which tool should I choose?");
  await expect(page.getByRole("textbox", { name: /Persona or context/ })).toHaveValue("Research buyer");
  await expect(page.getByRole("heading", { name: "Your prompts", exact: true })).toBeVisible();
  await submit.click();
  await expect(page.getByRole("status")).toContainText("Prompt added");
  expect(state.keys[0]).toBe(state.keys[1]);
});

test("a failed pause keeps the table available and can be retried", async ({ page }) => {
  const state = await fixture(page);
  state.failPause = true;
  await page.getByRole("table").getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Pause failed");
  await page.getByRole("table").getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("table").getByRole("button", { name: "Resume", exact: true })).toBeVisible();
});

test("loads more than 100 prompts and retains the loaded pages after refresh", async ({ page }) => {
  await fixture(page, 105);
  await expect(page.locator("tbody tr")).toHaveCount(100);
  await page.getByRole("button", { name: "Load more prompts", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(105);
  await expect(page.getByRole("button", { name: "Load more prompts", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh monitoring data", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(105);
  await page.getByRole("textbox", { name: "Search loaded prompts" }).fill("Question 105");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("a lost response retries with the same key and creates only one prompt", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Storage unavailable"); } });
  });
  const state = await fixture(page);
  state.loseResponse = true;
  await openForm(page);
  const submit = page.locator("#prompt-create").getByRole("button", { name: "Add prompt", exact: true });
  await submit.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("save could not be confirmed");
  await submit.click();
  await expect(page.getByRole("status")).toContainText("Prompt added");
  expect(state.keys).toHaveLength(2);
  expect(state.keys[0]).toBe(state.keys[1]);
  expect(state.prompts.filter((p) => p.body === "Which tool should I choose?")).toHaveLength(1);
});

test("duplicate submit events send only one creation request", async ({ page }) => {
  const state = await fixture(page);
  await openForm(page);
  await page.locator("#prompt-create form").evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByRole("status")).toContainText("Prompt added");
  expect(state.keys).toHaveLength(1);
});

test("schedule navigation and pagination remain scoped to the selected project", async ({ page }) => {
  await fixture(page, 105);
  await page.getByRole("button", { name: "Load more prompts", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(105);
  await page.getByRole("combobox", { name: "Select project", exact: true }).selectOption(secondId);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page).toHaveURL(new RegExp(`/prompts\\?project=${secondId}`));
  await expect(page.getByRole("link", { name: "Manage schedules" })).toHaveAttribute("href", `/monitoring?project=${secondId}#schedules`);
  await page.getByRole("link", { name: "Manage schedules" }).click();
  await expect(page).toHaveURL(new RegExp(`/monitoring\\?project=${secondId}#schedules$`));
  await expect(page.locator("#schedules")).toBeInViewport();
  await expect(page.getByRole("combobox", { name: "Select project", exact: true })).toHaveValue(secondId);
});

test("local suggestions can be added without an AI generation request", async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole("button", { name: "Suggest prompts" }).click();
  await expect(page.getByText("No AI request or usage charge.")).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Suggested prompt added");
  expect(state.prompts.some((prompt) => prompt.body === "Which providers are best for example.com?")).toBe(true);
});

test("shows collected visibility and filters prompts by tag and engine", async ({ page }) => {
  await fixture(page);
  await expect(page.getByText("42.5%", { exact: true }).first()).toBeVisible();
  await expect(page.locator("tbody tr").getByText("Gemini", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Comparison", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter prompts by engine").selectOption("gemini");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("runs a prompt with the configured project engine", async ({ page }) => {
  const state = await fixture(page);
  const runButton = page.getByRole("table").getByRole("button", { name: "Run now", exact: true });
  await runButton.click();
  await expect(page.getByRole("status")).toContainText("A run was queued");
  expect(state.runRequests[0]).toMatchObject({ engine: "openai", promptIds: [state.prompts[0]!.id] });
  await runButton.click();
  await expect(page.getByRole("status")).toContainText("A run was queued");
  expect(state.runRequests).toHaveLength(2);
  expect(state.runKeys[0]).not.toBe(state.runKeys[1]);
});

test("CSV import creates prompts and skips duplicates", async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel("Import prompts from CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('question,persona,tags\n"Which tea brands are best?","First-time buyer","comparison;shopping"'),
  });
  await expect(page.getByRole("status")).toContainText("1 prompts imported; 0 duplicates skipped.");
  expect(state.prompts[0]).toMatchObject({
    body: "Which tea brands are best?",
    persona: "First-time buyer",
    tags: ["comparison", "shopping"],
  });
  await page.getByLabel("Import prompts from CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('question,persona,tags\n"Which tea brands are best?","First-time buyer","comparison;shopping"'),
  });
  await expect(page.getByRole("status")).toContainText("0 prompts imported; 1 duplicates skipped.");
  expect(state.importKeys[0]).not.toBe(state.importKeys[1]);
});

test("bulk archive is recoverable from the archived prompt filter", async ({ page }) => {
  await fixture(page);
  await page.getByRole("checkbox", { name: "Select prompt Question 1" }).check();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("row", { name: /Question 1/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Include archived" }).check();
  await expect(page.getByRole("checkbox", { name: "Select prompt Question 1", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select prompt Question 1" }).check();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByRole("row", { name: /Question 1/ })).toContainText("Active");
});
