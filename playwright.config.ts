import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://localhost:3000",
    ...devices["Desktop Chrome"],
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined),
    trace: "off",
    screenshot: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
