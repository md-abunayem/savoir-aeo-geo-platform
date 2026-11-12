import { test, expect } from "@playwright/test";

test("overview uses live metrics, filters, honest failure states and responsive navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  let failTrend = false;
  const metric = { value: .62, displayable: true, n: 100, confidenceLabel: "Adequate sample", label: "Observed" };
  await page.route("**/v1/**", async route => {
    const url = new URL(route.request().url());
    let data: unknown = [];
    if (url.pathname.endsWith("auth/me")) data = { user: { id: "u", name: "Alex Morgan", email: "test@example.com" } };
    else if (url.pathname.endsWith("/projects")) data = { projects: [{ id: "p", tenantId: "t", tenantName: "Northstar workspace", brandName: "Northstar", domain: "northstar.example", status: "active" }], nextCursor: null };
    else if (url.pathname.endsWith("/health")) data = { backlog: 0, credits_used: 20, success_rate_7d: 1, credits: { available: 980, reserved: 0, used: 20 } };
    else if (url.pathname.endsWith("/visibility")) data = { composite: { score: 69, grade: "C" }, metrics: { visibilityRate: metric, shareOfVoice: { ...metric, value: .31 }, citationRate: { ...metric, value: .38 } }, sampleSummary: { brandCitedRuns: 38, runsWithCitations: 100 }, competitors: [{ name: "Atlas" }], engines: [{ engine: "gemini", name: "Gemini", visibilityRate: .64, n: 100 }] };
    else if (url.pathname.endsWith("/trend")) {
      if (failTrend) { await route.fulfill({ status: 503, json: { detail: "Temporarily unavailable" } }); return; }
      data = { points: [62, 58, 69, 64, 60, 63, 62].map((value, i) => ({ date: `2026-11-0${i + 1}`, visibilityRate: value / 100, sampleSize: 100 })) };
    } else if (url.pathname.endsWith("/actions")) data = { items: [{ id: "a", title: "Fix the cited pricing URL", category: "technical", priorityScore: 86, effort: "S", evidence: [{ url: "https://example.com" }] }] };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto("/dashboard");
  await expect(page.getByText("62.0%", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your next best actions" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Daily brand visibility/ })).toBeVisible();
  await page.screenshot({ path: "test-results/overview-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Search workspace" }).click();
  const searchDialog = page.getByRole("dialog", { name: "Find your next view" });
  await expect(searchDialog).toBeVisible();
  await searchDialog.getByRole("searchbox").fill("citations");
  await expect(searchDialog.getByRole("link", { name: "Citation Intelligence" })).toHaveAttribute("href", "/citations?project=p");
  await searchDialog.getByRole("searchbox").fill("nothing-matches");
  await expect(searchDialog.getByText(/No matching sections/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Search workspace" })).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(searchDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass("dark");
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await expect(page.getByText("62.0%", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/navbar-dark-desktop.png", fullPage: true });
  const filtered = page.waitForRequest(r => r.url().includes("/visibility?") && r.url().includes("days=30"));
  await page.getByLabel("Period", { exact: true }).selectOption("30");
  await filtered;
  await expect(page.getByText("62.0%", { exact: true })).toBeVisible();
  failTrend = true;
  await page.getByLabel("Engine", { exact: true }).selectOption("gemini");
  await expect(page.locator("main").getByRole("alert")).toContainText("Visibility trend unavailable");
  await expect(page.getByText("62.0%", { exact: true })).toBeVisible();
  failTrend = false;
  await page.getByRole("button", { name: "Retry overview" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/overview-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Search workspace" }).click();
  await expect(searchDialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("link", { name: "Action Center", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

