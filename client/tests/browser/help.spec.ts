import { test, expect } from "@playwright/test";

test("public API guide explains supported scopes and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/help/api");
  await expect(page.getByRole("heading", { name: "Connect your reporting tools." })).toBeVisible();
  await expect(page.getByText("GET /v1/public/projects/PROJECT_ID/traffic", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("help is readable on mobile and Tailwind utilities are compiled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "From your first question to a clearer next step." })).toBeVisible();
  await page.getByText("Why is my dashboard empty?", { exact: true }).click();
  await expect(page.getByText("Analytics need completed monitoring answers.", { exact: false })).toBeVisible();
  expect(await page.locator("main").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("24px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("help-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: test.info().outputPath("help-desktop.png"), fullPage: true });
});
