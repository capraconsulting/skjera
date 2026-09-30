import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Reuses Dex when it is already running, e.g. from `pnpm dev`.
      command: "docker compose up dex",
      cwd: "../..",
      url: "http://localhost:5556/dex/.well-known/openid-configuration",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      // Its own port and callback, so it can run next to the real server.
      env: {
        PORT: "3001",
        OAUTH_REDIRECT_URI: "http://localhost:3001/auth/callback",
      },
      url: "http://localhost:3001/health",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
