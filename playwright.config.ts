import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, E2E_URL, serverEnv } from "./tests/e2e/env";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: E2E_URL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `pnpm exec next start -p ${E2E_PORT}`,
    url: `${E2E_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...serverEnv, NODE_ENV: "production" } as Record<string, string>,
  },
});
