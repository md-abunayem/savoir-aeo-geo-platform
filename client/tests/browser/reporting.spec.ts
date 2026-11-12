import { expect, test } from "@playwright/test";

test("reporting uses backend routes and renders its response without changing the layout", async ({ page }) => {
  const project = { id: "11111111-1111-4111-8111-111111111111", tenantId: "22222222-2222-4222-8222-222222222222", brandName: "Example", domain: "example.com", status: "active" };
  const unexpected: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    let data: unknown;
    if (path === "/v1/auth/me") data = { user: { id: "owner", name: "Owner" } };
    else if (path === "/v1/projects") data = { projects: [project], nextCursor: null };
    else if (path.endsWith("/monitoring/health")) data = { credits: { available: 100, reserved: 0, used: 0 } };
    else if (path.includes("/monitoring/")) data = [];
    else if (path.endsWith("/reporting/dashboard")) data = {
      dateWindowDays: Number(url.searchParams.get("days")),
      kpis: { readinessIndex: 72, readinessRating: "Competitive", visibilityScore: 65, totalBrandCitations: 5, technicalAeoScore: 82, contentCoveragePercent: 70, conversionMultiplier: 1.5, verifiedFixesRate: 60 },
      keyWins: [], criticalRisks: [], disclosures: { modeledFormulas: "Modeled scores combine observed project evidence." },
    };
    else if (["/reporting/alerts/rules", "/reporting/alerts/incidents", "/reporting/reports"].some((suffix) => path.endsWith(suffix))) data = [];
    else if (path.endsWith("/reporting/schedules")) data = [{ id: "schedule", name: "Weekly brief", frequency: "weekly", format: "html", recipients: ["owner@example.com"], isActive: true, nextRunAt: "2026-11-16T00:00:00Z" }];
    else { unexpected.push(path); await route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }); return; }
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto("/reporting");
  await expect(page.getByText("Standing: Competitive")).toBeVisible();
  await expect(page.getByText("Modeled scores combine observed project evidence.")).toBeVisible();
  await page.getByRole("button", { name: "Scheduled Reports & PDF Exports" }).click();
  await expect(page.getByText("Weekly brief")).toBeVisible();
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
