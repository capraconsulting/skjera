import { defineConfig, devices } from "@playwright/test";
import {
  composeServices,
  dexDiscoveryUrl,
  testServerOrigin,
} from "@skjera/test";
import { reservePort } from "./e2e/port.ts";

const ci = !!process.env.CI;

// A test server of its own (`pnpm test-server`), with a new database each
// run: the tests never see what `pnpm dev`'s database holds. Its port is the
// run's own (e2e/port.ts), so runs in several worktrees can go at once. The
// config is read again in every worker: the port is chosen once, in the main
// process, and the workers get it through the environment.
process.env.SKJERA_E2E_PORT ??= String(await reservePort());
const port = Number(process.env.SKJERA_E2E_PORT);
const site = testServerOrigin(process.env, port);

export default defineConfig({
  testDir: "e2e/specs",
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
    // The still logo: the animated one keeps the browser busy on every page,
    // which slows the whole run on CI's small machines.
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Leaves the containers running, like `pnpm dev` would.
      command: `docker compose up --wait ${[...composeServices.server, "dex", "mailpit"].join(" ")} && tail -f /dev/null`,
      cwd: "../..",
      url: dexDiscoveryUrl(),
      reuseExistingServer: true,
      timeout: 180_000,
    },
    {
      // The production build: much faster page loads than the dev server,
      // and what users get. The tests sign up far more often than the limits
      // on signing up allow, so those are off.
      command: `SIGNUP_LIMITS=off PORT=${port} pnpm test-server`,
      cwd: "../..",
      url: `http://localhost:${port}/health/ready`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
