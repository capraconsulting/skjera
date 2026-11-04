import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * Playwright's `test`, with each test's own browsers closed when it ends.
 * The tests open them from the shared `browser` (`signedIn`, `visitor`), which
 * lives as long as the worker: left open, each keeps syncing with the server
 * through every test after it.
 */
export const test = base.extend<{ closesItsBrowsers: void }>({
  closesItsBrowsers: [
    async ({ browser }, use) => {
      const before = new Set(browser.contexts());
      await use();
      for (const context of browser.contexts())
        if (!before.has(context)) await context.close();
    },
    { auto: true },
  ],
});
