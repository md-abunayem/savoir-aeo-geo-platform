import { test, expect, type Page } from "@playwright/test";
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("frontend-test@test.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Savoir-local-test-2026!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/dashboard$/, { timeout: 30000 });
  await expect(
    page.getByText("Integration test workspace", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your brand, in the answer." })).toBeVisible();
}
test("sign-in, real project data, answer detail, prompt create/pause, refresh and logout", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await expect(page.getByLabel("Select project")).toHaveValue(/.+/);
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "View", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "This is a synthetic answer",
  );
  await page.getByRole("button", { name: "Close answer" }).click();
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your prompts" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  const question = "Browser verification prompt " + Date.now();
  await page.getByLabel("Question", { exact: true }).fill(question);
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: question });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Monitoring", exact: true }).click();
  await expect(
    page.getByText("Monitoring schedules", { exact: true }),
  ).toBeVisible();
  await page.getByRole("checkbox").first().check();
  await page
    .getByRole("combobox", { name: "Frequency", exact: true })
    .selectOption("weekly");
  await page
    .getByRole("button", { name: "Create schedule", exact: true })
    .click();
  const weekly = page.getByRole("article").filter({ hasText: "weekly" });
  await expect(weekly).toBeVisible();
  await weekly
    .getByRole("button", { name: "Pause schedule", exact: true })
    .click();
  await expect(weekly.getByText("paused", { exact: true })).toBeVisible();
  await weekly
    .getByRole("button", { name: "Resume schedule", exact: true })
    .click();
  await expect(weekly.getByText("active", { exact: true })).toBeVisible();
  await weekly
    .getByRole("button", { name: "Delete schedule", exact: true })
    .click();
  await weekly
    .getByRole("button", { name: "Confirm deletion", exact: true })
    .click();
  await expect(weekly).toHaveCount(0);
  await page.getByRole("button", { name: "Manual run", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  const balance = page
    .locator(".metric")
    .filter({ hasText: "Available credits" })
    .locator("strong");
  const beforeCredits = Number(await balance.innerText());
  await page.screenshot({
    path: "test-results/monitoring-desktop.png",
    fullPage: true,
  });
  const keys: string[] = [];
  await page.route("**/monitoring/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    if (keys.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "Queue manual run", exact: true })
    .click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Retry with the same choices",
  );
  await page
    .getByRole("button", { name: "Queue manual run", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("3 runs queued");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.unroute("**/monitoring/runs");
  await expect(balance).toHaveText(String(beforeCredits - 3));
  await context.clearCookies({ name: "savoir_access" });
  const refreshed = page.waitForResponse(
    (r) => r.url().endsWith("/v1/auth/refresh") && r.status() === 200,
  );
  await page.getByRole("button", { name: "Refresh monitoring data" }).click();
  await refreshed;
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/login$/);
  expect(errors).toEqual([]);
});
test("mobile navigation fits the viewport and reaches prompts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Prompts", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Track the questions that matter." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add prompt", exact: true }).click();
  await page
    .getByLabel("Question", { exact: true })
    .fill("Mobile test question");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Monitoring", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Plan your next collection" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/monitoring-mobile.png",
    fullPage: true,
  });
});
test("shows honest empty and unavailable states", async ({ page }) => {
  await signIn(page);
  await page.route("**/v1/projects?limit=100", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { projects: [], nextCursor: null },
      }),
    }),
  );
  await page.goto("/dashboard");
  await expect(
    page.getByText("Your next chapter starts with a project."),
  ).toBeVisible();
  await page.unroute("**/v1/projects?limit=100");
  await page.route("**/monitoring/health", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/problem+json",
      body: JSON.stringify({
        code: "UNAVAILABLE",
        detail: "Monitoring temporarily unavailable",
      }),
    }),
  );
  await page.goto("/dashboard");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Monitoring temporarily unavailable",
  );
  await expect(page.getByText("100.0%", { exact: true })).toHaveCount(0);
});

test("disabled provider prevents manual calls and schedule creation", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/monitoring/engines", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: [{ engine: "gemini", configured: false }],
      }),
    }),
  );
  await page.getByRole("link", { name: "Monitoring", exact: true }).click();
  await expect(page.getByText("Not configured", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manual run", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await expect(
    page.getByRole("button", { name: "Queue manual run", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Recurring schedule", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create schedule", exact: true }),
  ).toBeDisabled();
});
