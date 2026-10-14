import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;

// A test server of its own (`pnpm test-server`), with a new database each
// run: the tests never see what `pnpm dev`'s database holds. The last of the
// ports Dex lets test servers log in from.
const port = 8806;
const site = `${process.env.SKJERA_TEST_SERVER_URL || "http://localhost"}:${port}`;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  // In CI: annotations on the run, and a report to download when it fails.
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  // Full-stack tests: logins and syncs go through Dex, the server and Postgres.
  expect: { timeout: 10_000 },
  timeout: 60_000,
  use: {
    baseURL: site,
    trace: "retain-on-failure",
    // Times show in the viewer's locale and zone; these pin what they read.
    locale: "en-US",
    timezoneId: "Europe/Oslo",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Leaves the containers running, like `pnpm dev` would.
      command:
        "docker compose up --wait postgres dex rustfs mailpit && tail -f /dev/null",
      cwd: "../..",
      url: "http://localhost:5556/dex/.well-known/openid-configuration",
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // The production build: much faster page loads than the dev server,
      // and what users get.
      command: `PORT=${port} pnpm test-server`,
      cwd: "../..",
      url: `http://localhost:${port}/health/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
