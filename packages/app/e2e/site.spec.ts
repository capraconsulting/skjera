import { expect, test } from "@playwright/test";
import {
  body,
  deleteEvent,
  deleteTeam,
  newEvent,
  newTeam,
  pickDate,
  signInAtDex,
  title,
  typeAt,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

test("visitors can read the site but not the studio", async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Studio" })).toHaveCount(0);

  await page.goto("/studio/teams");
  await expect(page).toHaveURL(/localhost:5556\/dex/);
});

test("logging in from the site leads to the studio and back", async ({
  browser,
}) => {
  const page = await visitor(browser);
  await page.goto("/");
  await page.getByRole("link", { name: "Log in" }).click();
  await signInAtDex(page, "alice@example.com");
  await expect(page).toHaveURL(/\/studio\/teams$/);
  await expect(page.getByTestId("me")).toHaveText("alice@example.com");

  await page.getByRole("link", { name: "Skjera" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Studio" })).toBeVisible();
  await expect(page.getByTestId("me")).toHaveText("alice@example.com");
});

test("the theme follows the system until the user picks one", async ({
  browser,
}) => {
  const page = await (
    await browser.newContext({ colorScheme: "dark" })
  ).newPage();
  await page.goto("/");
  const root = page.locator("html");
  // Dark from the system, without an explicit choice.
  await expect(root).toHaveCSS("background-color", "rgb(17, 20, 24)");
  await expect(root).not.toHaveAttribute("data-theme");

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveCSS("background-color", "rgb(246, 247, 249)");

  // The choice is remembered.
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(root).toHaveCSS("background-color", "rgb(17, 20, 24)");
});

test("the site shows what was published, and only that", async ({
  browser,
}) => {
  const alice = await visitor(browser);
  await alice.goto("/studio/teams");
  await signInAtDex(alice, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Site"));
  await alice.goto(`/studio/teams/${team}`);
  const id = await newEvent(alice);
  const headline = `Launch ${id.slice(-12)}`;

  // Not public before it is published.
  const reader = await visitor(browser);
  await reader.goto(`/events/${id}`);
  await expect(reader.getByText("isn't published")).toBeVisible();

  await title(alice).pressSequentially(headline);
  await body(alice).pressSequentially("Line one");
  await body(alice).press("Enter");
  await body(alice).pressSequentially("Line two");
  const date = await pickDate(alice);
  await alice.getByRole("checkbox", { name: /Public event/ }).check();
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  await reader.goto("/");
  await reader.getByRole("link", { name: headline }).click();
  await expect(reader).toHaveURL(new RegExp(`/events/${id}$`));
  await expect(reader.getByRole("heading", { name: headline })).toBeVisible();
  await expect(reader.getByText(date)).toBeVisible();
  await expect(reader.getByTestId("event-body")).toHaveText(
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
  await deleteEvent(alice, id);
  await reader.goto("/");
  await expect(reader.getByRole("link", { name: headline })).toHaveCount(0);
  await deleteTeam(alice, team);
});
