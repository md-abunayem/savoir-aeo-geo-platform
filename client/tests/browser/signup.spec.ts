import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/v1/auth/csrf", route => route.fulfill({
    json: { success: true, data: { csrfToken: "test-csrf" } },
  }));
});
test("signup, resend, verification and return to sign-in", async ({ page }) => {
  const calls: { path: string; body: unknown }[] = [];
  await page.route(/\/v1\/auth\/(register|verify-email|resend-verification)$/, async route => {
    expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
    calls.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    await route.fulfill({ status: route.request().url().endsWith("verify-email") ? 200 : 202, json: { success: true, data: null } });
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "Create an account" }).click();
  await page.getByLabel("Full name").fill("Test Person");
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("a-safe-test-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("region", { name: "Your Savoir account" }).getByRole("alert")).toHaveText("Passwords do not match.");
  expect(calls).toHaveLength(0);
  await page.getByLabel("Confirm password").fill("a-safe-test-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Verify your email." })).toBeVisible();
  await expect(page.getByLabel("Registration password")).toHaveValue("");
  await page.getByRole("button", { name: "Resend verification code" }).click();
  await expect(page.getByRole("status")).toContainText("new code");
  await page.getByLabel("Verification code", { exact: true }).fill("a".repeat(64));
  await page.getByLabel("Registration password").fill("a-safe-test-password");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("email is verified");
  expect(calls).toEqual([
    { path: "/v1/auth/register", body: { name: "Test Person", email: "test@example.com", password: "a-safe-test-password" } },
    { path: "/v1/auth/resend-verification", body: { email: "test@example.com" } },
    { path: "/v1/auth/verify-email", body: { token: "a".repeat(64), password: "a-safe-test-password" } },
  ]);
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/login$/);
});
test("verification errors allow retry and mobile layout fits", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/v1/auth/verify-email", route => route.fulfill({
    status: 400, json: { code: "INVALID_VERIFICATION", detail: "Verification code or password is invalid or expired" },
  }));
  await page.goto("/verify-email");
  await page.getByLabel("Verification code", { exact: true }).fill("a".repeat(64));
  await page.getByLabel("Registration password").fill("wrong-password");
  await page.getByRole("button", { name: "Verify email", exact: true }).click();
  await expect(page.getByRole("region", { name: "Your Savoir account" }).getByRole("alert")).toContainText("invalid or expired");
  await expect(page.getByRole("button", { name: "Verify email", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("registration errors retain inputs for retry", async ({ page }) => {
  await page.route("**/v1/auth/register", route => route.fulfill({
    status: 503, json: { code: "PASSWORD_CHECK_UNAVAILABLE", detail: "Password safety check temporarily unavailable" },
  }));
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test Person");
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("a-safe-test-password");
  await page.getByLabel("Confirm password").fill("a-safe-test-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("region", { name: "Your Savoir account" }).getByRole("alert")).toContainText("temporarily unavailable");
  await expect(page.getByLabel("Email address")).toHaveValue("test@example.com");
  await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
});
