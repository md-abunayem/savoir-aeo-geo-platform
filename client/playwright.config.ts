import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    actionTimeout: 15000,
    browserName: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
});

