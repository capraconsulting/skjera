import { type Browser, expect, type Page, test } from "@playwright/test";

/** A browser of its own for a Dex test user, logged in. */
const signedIn = async (browser: Browser, email: string) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/posts");
  await page.locator("#login").fill(email);
  await page.locator("#password").fill("password");
  await page.locator("#submit-login").click();
  await expect(page.getByTestId("me")).toHaveText(email);
  return page;
};

const title = (page: Page) => page.getByRole("textbox", { name: "Title" });
const body = (page: Page) => page.getByRole("textbox", { name: "Body" });

test("two users edit a post live and publish it", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");

  await alice.getByRole("button", { name: "New post" }).click();
  await expect(alice).toHaveURL(/\/posts\/[0-9a-f-]+$/);
  await bob.goto(alice.url());

  await title(alice).pressSequentially("Hello from Alice");
  await expect(title(bob)).toHaveText("Hello from Alice");

  await body(bob).pressSequentially("Bob writes");
  await expect(body(alice)).toHaveText("Bob writes");

  // Both type into the body at the same time.
  await body(alice).press("End");
  await body(bob).press("Home");
  await Promise.all([
    body(alice).pressSequentially(" and Alice adds"),
    body(bob).pressSequentially("First, "),
  ]);
  await expect(body(alice)).toHaveText("First, Bob writes and Alice adds");
  await expect(body(bob)).toHaveText("First, Bob writes and Alice adds");

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  // The dev database keeps posts from earlier runs: find this one by link.
  const path = new URL(alice.url()).pathname;
  await bob.goto("/posts");
  const item = bob
    .getByRole("listitem")
    .filter({ has: bob.locator(`a[href="${path}"]`) });
  await expect(item).toContainText("Hello from Alice");
  await expect(item).toContainText("Published");
});

test("refuses to publish a post without a title", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  await alice.getByRole("button", { name: "New post" }).click();
  await body(alice).pressSequentially("No title here");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByRole("alert")).toHaveText(
    "The content isn't ready to publish",
  );
  await expect(alice.getByTestId("status")).toContainText("Not published");
});
