import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60000);
const projectId = "11111111-1111-4111-8111-111111111111", secondId = "22222222-2222-4222-8222-222222222222";
const tenantId = "33333333-3333-4333-8333-333333333333";
const engines = ["gemini", "openai", "google_ai_overviews", "google_ai_mode", "openrouter"];
const rowId = (prefix: number, index: number) => `${prefix}4444444-4444-4444-8444-${String(index).padStart(12, "0")}`;

async function fixture(page: Page, options: { engine?: string; prompts?: number; schedules?: number; runs?: number; pausedFirstPage?: boolean; minimum?: number } = {}) {
  const state = {
    failHealth: false, loseSchedule: false,
    posts: [] as { kind: string; key: string; payload: Record<string, unknown> }[],
    receipts: new Map<string, unknown>(),
    prompts: Array.from({ length: options.prompts ?? 1 }, (_, index) => ({ id: rowId(4, index), body: `Question ${index + 1}`, active: !(options.pausedFirstPage && index < 100), persona: "", version: 1 })),
    schedules: Array.from({ length: options.schedules ?? 0 }, (_, index) => ({ id: rowId(5, index), status: "active", next_run_at: "2026-11-10T00:00:00Z", config: { engine: "gemini", cadence: "daily", samples: 1, promptIds: [rowId(4, 0)] } })),
    runs: Array.from({ length: options.runs ?? 0 }, (_, index) => ({ id: rowId(6, index), status: "queued", attempts: 0, error_code: null as string | null, created_at: "2026-11-09T00:00:00Z", request: { engine: "gemini", prompt: `Run question ${index + 1}`, geo: "US", language: "en" } })),
  };
  await page.route("**/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    let data: unknown = [];
    if (path === "/v1/auth/me") data = { user: { id: "owner", name: "Owner" } };
    else if (path === "/v1/auth/csrf") data = { csrfToken: "test-csrf" };
    else if (path === "/v1/projects") data = { projects: [projectId, secondId].map((id, index) => ({ id, tenantId, brandName: `Project ${index + 1}`, domain: "example.com", status: "active" })), nextCursor: null };
    else if (path.endsWith("/health")) {
      if (state.failHealth) { await route.fulfill({ status: 503, json: { detail: "Temporary health failure" } }); return; }
      data = { backlog: 0, credits_used: 0, success_rate_7d: null, credits: { available: 100, reserved: 0, used: 0, minimum_interval_minutes: options.minimum ?? 1440 } };
    }
    else if (path.endsWith("/engines")) data = engines.map((engine) => ({ engine, configured: engine === (options.engine ?? "gemini"), model: `${engine}-fixture` }));
    else if (path.endsWith("/runs/stop-quota-retries") && request.method() === "POST") {
      let stopped = 0;
      for (const run of state.runs) if (run.status === "queued" && run.error_code === "PROVIDER_RATE_LIMITED") {
        run.status = "failed"; run.error_code = "PROVIDER_QUOTA_REVIEW_REQUIRED"; stopped++;
      }
      data = { stopped };
    }
    else if (request.method() === "POST" && /\/(runs|schedules)$/.test(path)) {
      const kind = path.split("/").at(-1)!, key = request.headers()["idempotency-key"], payload = request.postDataJSON();
      state.posts.push({ kind, key, payload });
      if (kind === "schedules") {
        if (!state.receipts.has(key)) {
          const row = { id: rowId(7, state.schedules.length), status: "active", next_run_at: "2026-11-10T00:00:00Z", config: payload };
          state.schedules.unshift(row); state.receipts.set(key, row);
        }
        data = state.receipts.get(key);
        if (state.loseSchedule) { state.loseSchedule = false; await route.abort("failed"); return; }
      } else data = { runIds: [rowId(8, 1)] };
    }
    else if (/\/(prompts|schedules|runs)$/.test(path)) {
      const kind = path.split("/").at(-1)! as "prompts" | "schedules" | "runs";
      const rows = path.includes(secondId) ? (kind === "prompts" ? [{ ...state.prompts[0], body: "Second project prompt" }] : []) : state[kind];
      const cursor = url.searchParams.get("before"), start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0;
      data = rows.slice(start, start + Number(url.searchParams.get("limit")));
    }
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`/monitoring?project=${projectId}`);
  await expect(page.getByRole("heading", { name: "Plan your next collection" })).toBeVisible();
  return state;
}

test("schedule retries reuse their key after a lost response even without browser storage", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "sessionStorage", { get() { throw new Error("Unavailable"); } }); });
  const state = await fixture(page); state.loseSchedule = true;
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("result could not be confirmed");
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Schedule created");
  expect(state.posts).toHaveLength(2);
  expect(state.posts[0].key).toBe(state.posts[1].key);
  expect(state.posts[0].key).toBeTruthy();
  expect(state.schedules).toHaveLength(1);
});

test("unconfigured engines disable scheduling and manual runs with accurate instructions", async ({ page }) => {
  const state = await fixture(page, { engine: "none" });
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("button", { name: "Create schedule", exact: true })).toBeDisabled();
  await expect(page.getByText(/Configure this engine or choose an available engine/)).toBeVisible();
  await page.getByRole("button", { name: "Manual run", exact: true }).click();
  await expect(page.getByRole("button", { name: "Queue manual run", exact: true })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
});

test("a storage write failure cannot replace the retry key with stale persisted metadata", async ({ page }) => {
  await page.addInitScript((id) => {
    window.sessionStorage.setItem(`savoir.pending-schedule.${id}`, JSON.stringify({ fingerprint: "stale", key: "stale-key" }));
    Storage.prototype.setItem = () => { throw new Error("Quota exceeded"); };
  }, projectId);
  const state = await fixture(page); state.loseSchedule = true;
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("result could not be confirmed");
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Schedule created");
  expect(state.posts[0].key).toBe(state.posts[1].key);
  expect(state.posts[0].key).not.toBe("stale-key");
  expect(state.schedules).toHaveLength(1);
});

for (const engine of engines) {
  test(`collects and schedules using the configured ${engine} engine`, async ({ page }) => {
    const state = await fixture(page, { engine });
    await expect(page.getByRole("combobox", { name: "AI engine", exact: true })).toHaveValue(engine);
    if (engine === "openrouter") await expect(page.getByText("Live web search enabled · input/output token prices capped at $0.10/$0.50 per million · search fees may apply separately.", { exact: true })).toBeVisible();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Manual run", exact: true }).click();
    await page.getByRole("button", { name: "Queue manual run", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("runs queued");
    await page.getByRole("button", { name: "Recurring schedule", exact: true }).click();
    await page.getByRole("button", { name: "Create schedule", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Schedule created");
    expect(state.posts.map((post) => post.payload.engine)).toEqual([engine, engine]);
    expect(state.posts[0].key).not.toBe(state.posts[1].key);
  });
}

test("a refresh failure preserves engine, selections, and collection fields", async ({ page }) => {
  const state = await fixture(page, { engine: "openai" });
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Manual run", exact: true }).click();
  await page.getByRole("textbox", { name: "Countries", exact: true }).fill("GB");
  state.failHealth = true;
  await page.getByRole("button", { name: "Refresh monitoring data" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Temporary health failure");
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await expect(page.getByRole("textbox", { name: "Countries", exact: true })).toHaveValue("GB");
  await expect(page.getByRole("combobox", { name: "AI engine", exact: true })).toHaveValue("openai");
  await expect(page.getByRole("button", { name: "Queue manual run", exact: true })).toBeVisible();
  state.failHealth = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("checkbox").first()).toBeChecked();
});

test("paginates prompts, schedules, and runs and retains pages after refresh", async ({ page }) => {
  await fixture(page, { prompts: 105, schedules: 101, runs: 26, pausedFirstPage: true });
  await page.getByRole("button", { name: "Load more prompts", exact: true }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(5);
  await page.getByRole("button", { name: "Load more schedules", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(101);
  await page.getByRole("button", { name: "Load more runs", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(26);
  await page.getByRole("button", { name: "Refresh monitoring data" }).click();
  await expect(page.getByRole("article")).toHaveCount(101);
  await expect(page.locator("tbody tr")).toHaveCount(26);
  await page.getByRole("combobox", { name: "Select project", exact: true }).selectOption(secondId);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(0);
});

test("empty-state prompt links retain the selected project", async ({ page }) => {
  await fixture(page, { prompts: 0 });
  for (const name of ["Manage prompts", "Start with a prompt"]) {
    await expect(page.getByRole("link", { name })).toHaveAttribute("href", `/prompts?project=${projectId}`);
  }
});

test("chooses an interval that meets the tenant minimum", async ({ page }) => {
  const state = await fixture(page, { minimum: 20000 });
  await page.getByRole("checkbox").first().check();
  await expect(page.getByRole("combobox", { name: "Frequency", exact: true })).toHaveValue("custom");
  await expect(page.getByRole("spinbutton", { name: "Interval in minutes", exact: true })).toHaveValue("20000");
  await page.getByRole("button", { name: "Create schedule", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Schedule created");
  expect(state.posts[0].payload).toMatchObject({ cadence: "custom", intervalMinutes: 20000 });
});

test("quota errors stay compact and legacy retries can be stopped without submitting a collection", async ({ page }) => {
  const state = await fixture(page, { runs: 1 });
  state.runs[0].error_code = "PROVIDER_RATE_LIMITED";
  state.runs[0].attempts = 1;
  await page.getByRole("button", { name: "Refresh monitoring data" }).click();
  await expect(page.getByRole("button", { name: "Stop quota retries", exact: true })).toBeVisible();
  const details = page.locator("tbody .provider-error details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(page.locator("tbody").getByText(/The provider rejected the request for a quota/)).toBeHidden();
  await page.locator("tbody").getByText("Error details", { exact: true }).click();
  await expect(page.locator("tbody").getByText(/The provider rejected the request for a quota/)).toBeVisible();
  await page.getByRole("button", { name: "Stop quota retries", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 quota retries stopped");
  await expect(page.locator("tbody").getByText("Stopped · quota review", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop quota retries", exact: true })).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});
