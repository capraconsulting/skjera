import { expect, test } from "@playwright/test";
import {
  body,
  deletePost,
  newPost,
  signInAtDex,
  title,
  typeAt,
  visitor,
} from "./helpers.ts";

test("visitors can read the site but not the studio", async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Studio" })).toHaveCount(0);

  await page.goto("/studio/posts");
  await expect(page).toHaveURL(/localhost:5556\/dex/);
});

test("logging in from the site leads to the studio and back", async ({
  browser,
}) => {
  const page = await visitor(browser);
  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await signInAtDex(page, "alice@example.com");
  await expect(page).toHaveURL(/\/studio\/posts$/);
  await expect(page.getByTestId("me")).toHaveText("alice@example.com");

  await page.getByRole("link", { name: "View site" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Studio" })).toBeVisible();
  await expect(page.getByTestId("me")).toHaveText("alice@example.com");
});

test("the site shows what was published, and only that", async ({
  browser,
}) => {
  const alice = await visitor(browser);
  await alice.goto("/studio/posts");
  await signInAtDex(alice, "alice@example.com");
  const id = await newPost(alice);
  const headline = `Launch ${id.slice(-12)}`;

  // Not public before it is published.
  const reader = await visitor(browser);
  await reader.goto(`/posts/${id}`);
  await expect(reader.getByText("isn't published")).toBeVisible();

  await title(alice).pressSequentially(headline);
  await body(alice).pressSequentially("Line one");
  await body(alice).press("Enter");
  await body(alice).pressSequentially("Line two");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  await reader.goto("/");
  await reader.getByRole("link", { name: headline }).click();
  await expect(reader).toHaveURL(new RegExp(`/posts/${id}$`));
  await expect(reader.getByRole("heading", { name: headline })).toBeVisible();
  await expect(reader.getByTestId("post-body")).toHaveText(
    "Line one\nLine two",
  );

  // Edits stay private until they are republished.
  await typeAt(title(alice), "end", " (updated)");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await reader.reload();
  await expect(reader.getByRole("heading", { name: headline })).toBeVisible();

  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByRole("link", { name: "View on site" })).toBeVisible();
  await reader.reload();
  await expect(
    reader.getByRole("heading", { name: `${headline} (updated)` }),
  ).toBeVisible();

  // Deleting takes it off the site too.
  await deletePost(alice, id);
  await reader.goto("/");
  await expect(reader.getByRole("link", { name: headline })).toHaveCount(0);
});
