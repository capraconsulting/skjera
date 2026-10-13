import { expect, type Page, test } from "@playwright/test";
import {
  body,
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  openTeamMenu,
  pickTimes,
  publishedEvent,
  setTeamLogo,
  signedIn,
  signInAtDex,
  summary,
  title,
  typeAt,
  uniqueTeamName,
  visitor,
  writePlace,
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

test("a page waits for a server that is starting", async ({ browser }) => {
  const page = await signedIn(browser, "alice@example.com");
  // The proxy's answer while the server restarts, twice, then the server.
  let starting = 2;
  await page.route("/api/me", (route) =>
    starting-- > 0 ? route.fulfill({ status: 502 }) : route.continue(),
  );

  await page.goto("/studio/teams");
  await expect(page.getByTestId("me")).toHaveAttribute(
    "title",
    "alice@example.com",
  );
  expect(starting).toBeLessThan(0);
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

test("the site shows what was published, and only that (AC-1, AC-3)", async ({
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
  await writePlace(alice, "Kantina, 2. etasje");
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
  await expect(reader.getByRole("article")).toContainText("Kantina, 2. etasje");
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

test("an event's summary is written in the studio and shown on its page (AC-1, AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Summary"));
  const event = await publishedEvent(alice, { public: true });
  const text = `Coffee and a talk ${event.id.slice(-12)}.`;

  await summary(alice).pressSequentially(text);
  await expect(summary(alice)).toHaveText(text);
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  await expect(reader.getByRole("article")).toContainText(text);

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("the site follows publishing without reloading", async ({ browser }) => {
  const reader = await visitor(browser);
  await reader.goto("/");

  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Live site"));
  const event = await publishedEvent(alice, { public: true });
  const link = reader.getByRole("link", { name: event.title });
  // Visitors' pages pull every 5 seconds: a few pulls' time, when busy.
  const pulled = { timeout: 20_000 };
  await expect(link).toBeVisible(pulled);

  // Republished for members only: it leaves the visitor's page.
  await alice.getByRole("checkbox", { name: /Public event/ }).uncheck();
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await expect(link).toHaveCount(0, pulled);

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

test("the account menu subscribes to the coming events in Google Calendar (AC-6)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  await reader.goto("/");
  await expect(reader.getByRole("link", { name: "Subscribe" })).toHaveCount(0);

  const alice = await signedIn(browser, "alice@example.com");
  // Nothing leaves the machine: Google's address is answered here.
  await alice
    .context()
    .route("https://www.google.com/**", (route) => route.fulfill({ body: "" }));
  await alice.goto("/");
  await alice.getByRole("button", { name: "Account menu" }).click();
  const popup = alice.waitForEvent("popup");
  await alice
    .locator(":popover-open")
    .getByRole("link", { name: "Subscribe" })
    .click();
  await expect(await popup).toHaveURL(
    `https://www.google.com/calendar/render?cid=webcal://${new URL(alice.url()).host}/api/subscribe`,
  );
});

test("the site has its logo, its footer and a privacy page", async ({
  browser,
}) => {
  // As configured in mise.toml: SITE_LOGO, SITE_FOOTER, SITE_OPERATOR, …
  const page = await visitor(browser);
  await page.goto("/");
  const brand = page.getByRole("link", { name: "Skjera", exact: true });
  await expect(brand.locator('img[src="/site-assets/logo.svg"]')).toBeVisible();
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("Events, together");
  await expect(
    footer.getByRole("link", { name: "Example Ltd" }),
  ).toHaveAttribute("href", "https://example.com");

  // Dark: the logo's dark version.
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(
    brand.locator('img[src="/site-assets/logo-dark.svg"]'),
  ).toBeVisible();
  await expect(brand.locator('img[src="/site-assets/logo.svg"]')).toBeHidden();

  await footer.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  const policy = page.getByRole("article");
  await expect(policy.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(policy).toContainText("Skjera runs Skjera");
  await expect(
    policy.getByRole("link", { name: "privacy@skjera.localhost" }),
  ).toHaveAttribute("href", "mailto:privacy@skjera.localhost");
});

/** Publishes an event in the open team, a month ago. Returns its title. */
const publishedPastEvent = async (page: Page) => {
  const id = await newEvent(page);
  const past = `Was ${id.slice(-12)}`;
  await title(page).pressSequentially(past);
  await page.getByRole("button", { name: "Start date" }).click();
  await page.getByRole("button", { name: /previous month/i }).click();
  await page.getByRole("button", { name: /15th, \d{4}/ }).click();
  await page.getByRole("checkbox", { name: /Public event/ }).check();
  await expect(page.getByTestId("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("status")).toContainText("Published");
  return { id, title: past };
};

test("the site's list shows each event's team as its organizer (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const brandedName = uniqueTeamName("Branded");
  const branded = await newTeam(alice, brandedName);
  const logo = await setTeamLogo(alice, branded, "light");
  const coming = await publishedEvent(alice, { public: true });
  const was = await publishedPastEvent(alice);
  const plainName = uniqueTeamName("Plain");
  const plain = await newTeam(alice, plainName);
  const plainComing = await publishedEvent(alice, { public: true });

  const reader = await visitor(browser);
  await reader.goto("/");
  const upcoming = reader.getByRole("region", { name: "Upcoming events" });
  const past = reader.getByRole("region", { name: "Past events" });
  // The logo, named by the team, in place of the team's name.
  for (const link of [
    upcoming.getByRole("link", { name: coming.title }),
    past.getByRole("link", { name: was.title }),
  ]) {
    await expect(link.getByRole("img", { name: brandedName })).toHaveAttribute(
      "src",
      logo,
    );
  }
  const plainLink = upcoming.getByRole("link", { name: plainComing.title });
  await expect(plainLink.getByRole("img")).toHaveCount(0);
  await expect(plainLink).toContainText(plainName);

  await deleteEvent(alice, plainComing.id);
  await deleteTeam(alice, plain);
  await alice.goto(eventPath(branded, was.id));
  await deleteEvent(alice, was.id);
  await alice.goto(eventPath(branded, coming.id));
  await deleteEvent(alice, coming.id);
  await deleteTeam(alice, branded);
});

test("the event page shows the team as its organizer (AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const brandedName = uniqueTeamName("Branded");
  const branded = await newTeam(alice, brandedName);
  const logo = await setTeamLogo(alice, branded, "light");
  const withLogo = await publishedEvent(alice, { public: true });
  const plainName = uniqueTeamName("Plain");
  const plain = await newTeam(alice, plainName);
  const without = await publishedEvent(alice, { public: true });

  const reader = await visitor(browser);
  await reader.goto(`/events/${withLogo.id}`);
  const article = reader.getByRole("article");
  await expect(article.getByRole("img", { name: brandedName })).toHaveAttribute(
    "src",
    logo,
  );
  await reader.goto(`/events/${without.id}`);
  await expect(reader.getByRole("article")).toContainText(plainName);
  await expect(reader.getByRole("article").getByRole("img")).toHaveCount(0);

  await deleteEvent(alice, without.id);
  await deleteTeam(alice, plain);
  await alice.goto(eventPath(branded, withLogo.id));
  await deleteEvent(alice, withLogo.id);
  await deleteTeam(alice, branded);
});

test("the dark theme shows the team's dark logo, the light one the light logo (AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Themed"));
  const light = await setTeamLogo(alice, team, "light");
  const dark = await setTeamLogo(alice, team, "dark");
  const event = await publishedEvent(alice, { public: true });

  const reader = await (
    await browser.newContext({ colorScheme: "dark" })
  ).newPage();
  await reader.goto(`/events/${event.id}`);
  const article = reader.getByRole("article");
  await expect(article.locator(`img[src="${dark}"]`)).toBeVisible();
  await expect(article.locator(`img[src="${light}"]`)).toBeHidden();

  await reader.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(article.locator(`img[src="${light}"]`)).toBeVisible();
  await expect(article.locator(`img[src="${dark}"]`)).toBeHidden();

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("the open list follows a team's rename without reloading (AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const name = uniqueTeamName("Before");
  const team = await newTeam(alice, name);
  const event = await publishedEvent(alice, { public: true });
  const reader = await visitor(browser);
  await reader.goto("/");
  const link = reader.getByRole("link", { name: event.title });
  await expect(link).toContainText(name);

  const renamed = uniqueTeamName("After");
  await openTeamMenu(alice, team);
  await alice.getByRole("button", { name: "Rename team…" }).click();
  const dialog = alice.getByRole("dialog", { name: "Rename team" });
  await dialog.getByRole("textbox", { name: "Team name" }).fill(renamed);
  await dialog.getByRole("button", { name: "Rename team" }).click();
  await expect(dialog).toBeHidden();
  // Visitors' pages pull every 5 seconds.
  await expect(link).toContainText(renamed, { timeout: 20_000 });

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});
