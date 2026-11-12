import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/auth/csrf", (route) =>
    route.fulfill({
      json: { success: true, data: { csrfToken: "test-csrf" } },
    }),
  );
});

test("requests a recovery code with a generic success message", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/csrf")) {
      await route.fulfill({
        json: { success: true, data: { csrfToken: "test-csrf" } },
      });
      return;
    }
    expect(path).toBe("/v1/auth/forgot-password");
    expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { success: true, data: null } });
  });

  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/forgot-password$/);
  await page.getByLabel("Email address").fill("person@example.com");
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(page.getByRole("status")).toContainText(
    "If the account is eligible",
  );
  expect(requests).toEqual([{ email: "person@example.com" }]);
  await page.getByRole("link", { name: "I have a reset code" }).click();
  await expect(page).toHaveURL(/reset-password$/);
});

test("validates and submits a reset, then directs the user to sign in", async ({
  page,
}) => {
  const requests: unknown[] = [];
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/csrf")) {
      await route.fulfill({
        json: { success: true, data: { csrfToken: "test-csrf" } },
      });
      return;
    }
    expect(path).toBe("/v1/auth/reset-password");
    expect(route.request().headers()["x-csrf-token"]).toBe("test-csrf");
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: { success: true, data: null } });
  });

  await page.goto("/reset-password");
  await page.getByLabel("Password reset code").fill("A".repeat(64));
  await page
    .getByLabel("New password", { exact: true })
    .fill("long-enough-password-123");
  await page.getByLabel("Confirm new password").fill("a-different-password");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  expect(requests).toHaveLength(0);

  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("long-enough-password-123");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated." }),
  ).toBeVisible();
  expect(requests).toEqual([
    {
      token: "a".repeat(64),
      password: "long-enough-password-123",
    },
  ]);
  await page.getByRole("link", { name: "Continue to sign in" }).click();
  await expect(page).toHaveURL(/login$/);
});
