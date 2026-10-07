import { expect, test } from "@playwright/test";
import {
  body,
  deleteEvent,
  deleteTeam,
  newEvent,
  newTeam,
  pickTimes,
  publishedEvent,
  signedIn,
  signInAtDex,
  title,
  typeAt,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

test("visitors can read the site but not the studio", async ({ browser }) => {
  const page = await visitor(browser);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Upcoming events" }),
  ).toBeVisible();
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
  await expect(page.getByTestId("me")).toHaveAttribute(
    "title",
    "alice@example.com",
  );

  await page.getByRole("link", { name: "Skjera" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Studio" })).toBeVisible();
  await expect(page.getByTestId("me")).toHaveAttribute(
    "title",
    "alice@example.com",
  );
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
  await expect(root).toHaveCSS("background-color", "rgb(9, 9, 11)");
  await expect(root).not.toHaveAttribute("data-theme");

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveCSS("background-color", "rgb(255, 255, 255)");

  // The choice is remembered.
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(root).toHaveCSS("background-color", "rgb(9, 9, 11)");
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
  // Markdown-like typing, and the toolbar.
  await body(alice).pressSequentially("## Agenda");
  await body(alice).press("Enter");
  await body(alice).pressSequentially("Doors open at ");
  await alice.getByRole("button", { name: "Bold" }).click();
  await body(alice).pressSequentially("six");
  await alice.getByRole("button", { name: "Bold" }).click();
  await body(alice).pressSequentially(".");
  await body(alice).press("Enter");
  await body(alice).pressSequentially("- Bring snacks");
  await body(alice).press("Enter");
  await body(alice).pressSequentially("Bring friends");
  for (const _ of "friends") await body(alice).press("Shift+ArrowLeft");
  await alice.getByRole("button", { name: "Link", exact: true }).click();
  await alice
    .getByRole("textbox", { name: "Link address" })
    .fill("https://example.com/friends");
  await alice.getByRole("button", { name: "Add link" }).click();
  await expect(
    body(alice).getByRole("link", { name: "friends" }),
  ).toBeVisible();
  const date = await pickTimes(alice);
  await alice.getByRole("checkbox", { name: /Public event/ }).check();
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  await reader.goto("/");
  await reader.getByRole("link", { name: headline }).click();
  await expect(reader).toHaveURL(new RegExp(`/events/${id}$`));
  await expect(reader.getByRole("heading", { name: headline })).toBeVisible();
  // The day, then the hours, in the event's zone.
  const times = reader.getByRole("article").locator("time");
  await expect(times.nth(0)).toContainText(date);
  await expect(times.nth(1)).toHaveText(/^6:00\s*–\s*8:00\s*PM$/);
  const content = reader.getByTestId("event-body");
  await expect(
    content.getByRole("heading", { name: "Agenda", level: 2 }),
  ).toBeVisible();
  await expect(content.getByRole("paragraph").first()).toHaveText(
    "Doors open at six.",
  );
  await expect(content.locator("strong")).toHaveText("six");
  await expect(content.getByRole("listitem")).toHaveText([
    "Bring snacks",
    "Bring friends",
  ]);
  await expect(content.getByRole("link", { name: "friends" })).toHaveAttribute(
    "href",
    "https://example.com/friends",
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

test("the site follows publishing without reloading", async ({ browser }) => {
  const reader = await visitor(browser);
  await reader.goto("/");

  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Live site"));
  const event = await publishedEvent(alice, { public: true });
  const link = reader.getByRole("link", { name: event.title });
  await expect(link).toBeVisible();

  // Republished for members only: it leaves the visitor's page.
  await alice.getByRole("checkbox", { name: /Public event/ }).uncheck();
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await expect(link).toHaveCount(0);

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("sign-up closes at the deadline, in the event's time zone", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Deadline"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  const attendance = reader.getByRole("region", { name: "Attendance" });
  // Without a deadline, sign-up closes when the event starts.
  await expect(attendance).toContainText(/Sign-up closes .* at 6:00\s*PM\./);

  // Moved to New York, it starts at 18:00 there: shown as such, and named.
  await alice
    .getByRole("combobox", { name: "Time zone" })
    .selectOption("America/New_York");
  await expect(alice.getByLabel("Start time")).toHaveValue("18:00");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await reader.reload();
  await expect(reader.getByRole("article").locator("time").nth(1)).toHaveText(
    /^6:00\s*–\s*8:00\s*PM \(ET\)$/,
  );

  // A deadline that has passed closes it.
  await alice.getByRole("button", { name: "Deadline date" }).click();
  await alice
    .getByRole("button", { name: /1st, \d{4}/ })
    .first()
    .click();
  await alice.getByLabel("Deadline time").fill("00:00");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await reader.reload();
  await expect(attendance).toContainText("Sign-up has closed.");
  await expect(attendance.getByRole("button")).toHaveCount(0);

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("the account menu leads to settings, and logs out", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  // In the studio, its link says so; on the site, it doesn't.
  const studio = alice.getByRole("link", { name: "Studio" });
  await expect(studio).toHaveAttribute("aria-current", "page");

  // Who's signed in: their name from the login, and their email.
  await alice.getByRole("button", { name: "Account menu" }).click();
  const menu = alice.locator(":popover-open");
  await expect(menu).toContainText("alice");
  await expect(menu).toContainText("alice@example.com");
  await menu.getByRole("link", { name: "Account settings" }).click();
  await expect(alice).toHaveURL(/\/account$/);
  await expect(studio).not.toHaveAttribute("aria-current");

  const page = alice.getByRole("main");
  await expect(
    page.getByRole("heading", { name: "Account settings" }),
  ).toBeVisible();
  await expect(page).toContainText("alice@example.com");

  // The theme: picked, or the system's again.
  const root = alice.locator("html");
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "Same as the system" }).check();
  await expect(root).not.toHaveAttribute("data-theme");

  // The language: the page comes back in it.
  await page.getByRole("radio", { name: "Nynorsk" }).check();
  await expect(root).toHaveAttribute("lang", "nn");
  await expect(
    alice.getByRole("heading", { name: "Kontoinnstillingar" }),
  ).toBeVisible();
  await alice.getByRole("radio", { name: "English" }).check();
  await expect(root).toHaveAttribute("lang", "en");

  await alice.getByRole("button", { name: "Account menu" }).click();
  await alice.getByRole("button", { name: "Log out" }).click();
  await expect(alice.getByRole("link", { name: "Log in" })).toBeVisible();
});
