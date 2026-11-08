import type { BrowserContext } from "@playwright/test";
import { visitor } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";

// A browser left open keeps syncing with the server through every test
// after it, and on CI's one worker they add up until pages take seconds.
test.describe.configure({ mode: "serial" });

let opened: BrowserContext | undefined;

test("a test opens a browser of its own", async ({ browser }) => {
  opened = (await visitor(browser)).context();
});

test("the next test starts with that browser closed", async ({ browser }) => {
  expect(opened).toBeDefined();
  expect(browser.contexts()).not.toContain(opened);
});
