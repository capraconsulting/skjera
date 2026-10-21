import { expect, type Page, test } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { Header } from "../pom/Header.ts";
import { LoginPage } from "../pom/LoginPage.ts";
import { AccountPage } from "../pom/site/AccountPage.ts";
import { Attendance } from "../pom/site/Attendance.ts";
import { CalendarFeed } from "../pom/site/CalendarFeed.ts";
import { EventPage } from "../pom/site/EventPage.ts";
import { Footer } from "../pom/site/Footer.ts";
import { HomePage } from "../pom/site/HomePage.ts";
import { HubSpot, hubSpotScript } from "../pom/site/HubSpot.ts";
import { PrivacyPage } from "../pom/site/PrivacyPage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("visitors can read the site but not the studio", async ({ browser }) => {
  const page = await visitor(browser);
  await new HomePage(page).goto();
  await new HomePage(page).expectUpcomingHeading();
  const header = new Header(page);
  await header.expectLogIn();
  await header.expectNoStudioLink();

  await new TeamsColumn(page).goto();
  await new LoginPage(page).expectShown();
});

test("logging in from the site leads to the studio and back", async ({
  browser,
}) => {
  const page = await visitor(browser);
  const header = new Header(page);
  await new HomePage(page).goto();
  await header.clickLogIn();
  await new LoginPage(page).signIn("alice@example.com");
  await new TeamsColumn(page).expectAt();
  await header.expectSignedInAs("alice@example.com");

  await header.clickBrand();
  await new HomePage(page).expectAt();
  await header.expectStudioLink();
  await header.expectSignedInAs("alice@example.com");
});

test("a page waits for a server that is starting", async ({ browser }) => {
  const page = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(page);
  const name = uniqueTeamName("Starting");
  const team = await teams.create(name);
  // The proxy's answer while the server restarts: twice for every API
  // request, the session and the synced tables alike, then the server.
  const tries = new Map<string, number>();
  await page.route("/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const tried = (tries.get(path) ?? 0) + 1;
    tries.set(path, tried);
    return tried <= 2 ? route.fulfill({ status: 502 }) : route.continue();
  });

  await teams.goto();
  await new Header(page).expectSignedInAs("alice@example.com");
  await teams.expectTeam(name);
  expect(tries.get("/api/me")).toBeGreaterThan(2);
  expect(
    [...tries].some(([path, n]) => path.startsWith("/api/sync/") && n > 2),
  ).toBe(true);

  await page.unrouteAll();
  await teams.delete(team);
});

test("the theme follows the system until the user picks one", async ({
  browser,
}) => {
  const page = await visitor(browser, { colorScheme: "dark" });
  const header = new Header(page);
  await new HomePage(page).goto();
  // Dark from the system, without an explicit choice.
  await header.expectBackground("rgb(9, 9, 11)");
  await header.expectTheme(null);

  await header.switchToLightMode();
  await header.expectTheme("light");
  await header.expectBackground("rgb(255, 255, 255)");

  // The choice is remembered.
  await new HomePage(page).reload();
  await header.expectTheme("light");
  await header.switchToDarkMode();
  await header.expectBackground("rgb(9, 9, 11)");
});

test("the site shows what was published, and only that", async ({
  browser,
}) => {
  const alice = await visitor(browser);
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  await teams.goto();
  await new LoginPage(alice).signIn("alice@example.com");
  const team = await teams.create(uniqueTeamName("Site"));
  await teams.goto(team);
  const id = await new EventsColumn(alice).newEvent();
  const headline = `Launch ${id.slice(-12)}`;

  // Not public before it is published.
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(id);
  await page.expectNotPublished();

  await editor.title.type(headline);
  // Markdown-like typing, and the toolbar.
  await editor.body.type("## Agenda");
  await editor.body.press("Enter");
  await editor.body.type("Doors open at ");
  await editor.toolbar.clickBold();
  await editor.body.type("six");
  await editor.toolbar.clickBold();
  await editor.body.type(".");
  await editor.body.press("Enter");
  await editor.body.type("- Bring snacks");
  await editor.body.press("Enter");
  await editor.body.type("Bring friends");
  for (const _ of "friends") await editor.body.press("Shift+ArrowLeft");
  await editor.toolbar.linkSelection("https://example.com/friends");
  await editor.body.expectLink("friends");
  const date = await editor.times.pick();
  await editor.writePlace("Kantina, 2. etasje");
  await editor.checkPublic();
  await editor.publish();

  const home = new HomePage(reader);
  await home.goto();
  await home.clickEvent(headline);
  await page.expectAt(id);
  await page.expectHeading(headline);
  // The day, then the hours, in the event's zone.
  await page.expectTimes(date, /^6:00\s*–\s*8:00\s*PM$/);
  await page.expectText("Kantina, 2. etasje");
  await page.expectBodyHeading("Agenda", 2);
  await page.expectFirstParagraph("Doors open at six.");
  await page.expectBold("six");
  await page.expectListItems(["Bring snacks", "Bring friends"]);
  await page.expectBodyLink("friends", "https://example.com/friends");

  // Edits stay private until they are republished.
  await editor.title.typeAt("end", " (updated)");
  await editor.expectSaved();
  await page.reload();
  await page.expectHeading(headline);

  await editor.clickPublish();
  await editor.expectViewOnSite();
  await page.reload();
  await page.expectHeading(`${headline} (updated)`);

  // Deleting takes it off the site too.
  await editor.delete(id);
  await home.goto();
  await home.expectNoEvent(headline);
  await teams.delete(team);
});

test("an event's summary is written in the studio and shown on its page", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Summary"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  const text = `Coffee and a talk ${event.id.slice(-12)}.`;

  await editor.summary.type(text);
  await editor.summary.expectText(text);
  await editor.publish();

  const reader = await visitor(browser);
  await new EventPage(reader).goto(event.id);
  await new EventPage(reader).expectText(text);

  await cleanUp(alice, team, event.id);
});

test("the site follows publishing without reloading", async ({ browser }) => {
  const reader = await visitor(browser);
  const home = new HomePage(reader);
  await home.goto();

  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Live site"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  // Visitors' pages pull every 5 seconds.
  await home.expectEvent(event.title);

  // Republished for members only: it leaves the visitor's page.
  await editor.uncheckPublic();
  await editor.publish();
  await home.expectNoEvent(event.title);

  await cleanUp(alice, team, event.id);
});

test("sign-up closes at the deadline, in the event's time zone", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Deadline"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  const attendance = new Attendance(reader);
  await page.goto(event.id);
  // Without a deadline, sign-up closes when the event starts.
  await attendance.expectText(/Sign-up closes .* at 6:00\s*PM\./);

  // Moved to New York, it starts at 18:00 there: shown as such, and named.
  await editor.times.selectTimeZone("America/New_York");
  await editor.times.expectStartTime("18:00");
  await editor.publish();
  await page.reload();
  await page.expectHours(/^6:00\s*–\s*8:00\s*PM \(ET\)$/);

  // A deadline that has passed closes it.
  await editor.times.setPassedDeadline();
  await editor.publish();
  await page.reload();
  await attendance.expectText("Sign-up has closed.");
  await attendance.expectNoButtons();

  await cleanUp(alice, team, event.id);
});

test("the account menu leads to settings, and logs out", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const header = new Header(alice);
  // In the studio, its link says so; on the site, it doesn't.
  await header.expectStudioCurrent(true);

  // Who's signed in: their name from the login, and their email.
  await header.openAccountMenu();
  await header.expectAccountMenuShows("alice");
  await header.expectAccountMenuShows("alice@example.com");
  await header.clickAccountSettings();
  const account = new AccountPage(alice);
  await account.expectAt();
  await header.expectStudioCurrent(false);
  await account.expectHeading("Account settings");
  await account.expectText("alice@example.com");

  // The theme: picked, or the system's again.
  await account.pickTheme("Dark");
  await header.expectTheme("dark");
  await account.pickTheme("Same as the system");
  await header.expectTheme(null);

  // The language: the page comes back in it.
  await account.pickLanguage("Nynorsk");
  await header.expectPageLanguage("nn");
  await account.expectHeading("Kontoinnstillingar");
  await account.pickLanguage("English");
  await header.expectPageLanguage("en");

  await header.logOut();
  await header.expectLogIn();
});

test("the header subscribes to the coming events in Google Calendar, beside the account menu", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  await new HomePage(reader).goto();
  await new Header(reader).expectNoSubscribe();

  const alice = await signedIn(browser, "alice@example.com");
  const header = new Header(alice);
  // Nothing leaves the machine: Google's address is answered here.
  await alice
    .context()
    .route("https://www.google.com/**", (route) => route.fulfill({ body: "" }));
  for (const path of ["/", "/studio/teams"]) {
    await alice.goto(path);
    await header.expectSubscribe();

    // Beside the account menu, not in it.
    await header.openAccountMenu();
    await header.expectAccountMenuWithoutSubscribe();
    await header.closeMenu();
  }

  await new HomePage(alice).goto();
  await header.clickSubscribeOpening(
    `https://www.google.com/calendar/render?cid=webcal://${new URL(alice.url()).host}/api/subscribe`,
  );
});

test("the calendar to subscribe to holds the coming events, members-only too, to anyone", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Feed"));
  const editor = new EventEditor(alice);
  const open = await editor.createPublished({ public: true });
  const membersOnly = await editor.createPublished({ public: false });
  const deleted = await editor.createPublished({ public: true });
  await editor.delete(deleted.id);

  // Fetched without a session, as Google Calendar does.
  const calendar = await new CalendarFeed(await visitor(browser)).fetch();
  calendar.expectEvent(open.title);
  calendar.expectEvent(membersOnly.title);
  calendar.expectNoEvent(deleted.title);

  await cleanUp(alice, team, open.id, membersOnly.id);
});

test("the header keeps «Abonner» and the account menu in a phone's window", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  await alice.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/", "/studio/teams"]) {
    await alice.goto(path);
    await new Header(alice).expectSubscribeAndAccountMenuFit();
  }
});

test("the site has its logo, its footer and a privacy page", async ({
  browser,
}) => {
  // As configured in mise.toml: SITE_LOGO, SITE_FOOTER, SITE_OPERATOR, …
  const page = await visitor(browser);
  const header = new Header(page);
  const footer = new Footer(page);
  await new HomePage(page).goto();
  await header.expectBrandLogo("/site-assets/logo.svg", true);
  await footer.expectText("Events, together");
  await footer.expectLink("Example Ltd", "https://example.com");

  // Dark: the logo's dark version.
  await header.switchToDarkMode();
  await header.expectBrandLogo("/site-assets/logo-dark.svg", true);
  await header.expectBrandLogo("/site-assets/logo.svg", false);

  await footer.clickPrivacy();
  const privacy = new PrivacyPage(page);
  await privacy.expectAt();
  await privacy.expectTitle();
  await privacy.expectText("Skjera runs Skjera");
  await privacy.expectContactEmail("privacy@skjera.localhost");
});

test("with a policy kept elsewhere, /privacy sends the visitor there", async ({
  browser,
}) => {
  const policy = "https://privacy.example/policy";
  const page = await visitor(browser);
  const privacy = new PrivacyPage(page);
  await privacy.keptElsewhere(policy);
  const home = new HomePage(page);
  await home.goto();

  await privacy.goto();
  await privacy.expectSentTo(policy);
  // Back leaves it: /privacy is not in the history to send on again.
  await page.goBack();
  await home.expectAt();
});

/** Publishes an event in the open team, a month ago. Returns its title. */
const publishedPastEvent = async (page: Page) => {
  const editor = new EventEditor(page);
  const id = await new EventsColumn(page).newEvent();
  const past = `Was ${id.slice(-12)}`;
  await editor.title.type(past);
  await editor.times.pickPastStart();
  await editor.writePlace();
  await editor.checkPublic();
  await editor.publish();
  return { id, title: past };
};

test("the site's list shows each event's team as its organizer", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const brandedName = uniqueTeamName("Branded");
  const branded = await teams.create(brandedName);
  const logo = await teams.setLogo(branded, "light");
  const coming = await editor.createPublished({ public: true });
  const was = await publishedPastEvent(alice);
  const plainName = uniqueTeamName("Plain");
  const plain = await teams.create(plainName);
  const plainComing = await editor.createPublished({ public: true });

  const reader = await visitor(browser);
  const home = new HomePage(reader);
  await home.goto();
  // The logo, named by the team, in place of the team's name.
  await home.expectOrganizerLogo(coming.title, "upcoming", brandedName, logo);
  await home.expectOrganizerLogo(was.title, "past", brandedName, logo);
  await home.expectNoOrganizerLogo(plainComing.title, "upcoming");
  await home.expectEventSays(plainComing.title, plainName);

  await editor.delete(plainComing.id);
  await teams.delete(plain);
  await cleanUp(alice, branded, was.id, coming.id);
});

test("the event page shows the team as its organizer", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const brandedName = uniqueTeamName("Branded");
  const branded = await teams.create(brandedName);
  const logo = await teams.setLogo(branded, "light");
  const withLogo = await editor.createPublished({ public: true });
  const plainName = uniqueTeamName("Plain");
  const plain = await teams.create(plainName);
  const without = await editor.createPublished({ public: true });

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(withLogo.id);
  await page.expectOrganizerLogo(brandedName, logo);
  await page.goto(without.id);
  await page.expectText(plainName);
  await page.expectNoOrganizerLogo();

  await editor.delete(without.id);
  await teams.delete(plain);
  await cleanUp(alice, branded, withLogo.id);
});

test("the dark theme shows the team's dark logo, or its light one when it has none", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const team = await teams.create(uniqueTeamName("Themed"));
  const light = await teams.setLogo(team, "light");
  const dark = await teams.setLogo(team, "dark");
  const event = await new EventEditor(alice).createPublished({ public: true });
  // A team with no dark logo keeps its light one in the dark theme.
  const lightOnlyTeam = await teams.create(uniqueTeamName("Light only"));
  const lightOnly = await teams.setLogo(lightOnlyTeam, "light");
  const lightOnlyEvent = await new EventEditor(alice).createPublished({
    public: true,
  });

  const reader = await visitor(browser, { colorScheme: "dark" });
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectLogo(dark, true);
  await page.expectLogo(light, false);
  await page.goto(lightOnlyEvent.id);
  await page.expectLogo(lightOnly, true);

  await page.goto(event.id);
  await new Header(reader).switchToLightMode();
  await page.expectLogo(light, true);
  await page.expectLogo(dark, false);

  await cleanUp(alice, team, event.id);
  await cleanUp(alice, lightOnlyTeam, lightOnlyEvent.id);
});

test("the open list follows a team's rename without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const name = uniqueTeamName("Before");
  const team = await teams.create(name);
  const event = await new EventEditor(alice).createPublished({ public: true });
  const reader = await visitor(browser);
  const home = new HomePage(reader);
  await home.goto();
  await home.expectEventSays(event.title, name);

  const renamed = uniqueTeamName("After");
  await teams.rename(team, renamed);
  // Visitors' pages pull every 5 seconds.
  await home.expectEventSays(event.title, renamed);

  await cleanUp(alice, team, event.id);
});

test("a team's new logo shows on the open list without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const name = uniqueTeamName("Relogo");
  const team = await teams.create(name);
  const event = await new EventEditor(alice).createPublished({ public: true });
  const reader = await visitor(browser);
  const home = new HomePage(reader);
  await home.goto();
  await home.expectNoOrganizerLogo(event.title, "upcoming");
  await home.expectEventSays(event.title, name);

  const logo = await teams.setLogo(team, "light");
  // Visitors' pages pull every 5 seconds.
  await home.expectOrganizerLogo(event.title, "upcoming", name, logo);

  await cleanUp(alice, team, event.id);
});

test("a link to a public event shows its title, summary and cover; others the site's name", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Shared"));
  const editor = new EventEditor(alice);
  const shown = await editor.createPublished({ public: true });
  const summary = `Coffee and a talk ${shown.id.slice(-6)}`;
  await editor.summary.type(summary);
  await editor.cover.chooseFile();
  await editor.cover.expect(/^\/api\/images\//);
  const cover = await editor.cover.src();
  await editor.cover.description.type("A full room");
  await editor.publish();
  const membersOnly = await editor.createPublished({ public: false });

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(shown.id);
  await page.expectSharingTag("og:title", shown.title);
  await page.expectSharingTag("og:description", summary);
  await page.expectSharingTag("og:image", new RegExp(`${cover}$`));
  await page.expectSharingTag("og:image:alt", "A full room");
  await page.expectSharingTag("twitter:card", "summary_large_image");

  // Members only, or no such event: the site's name only.
  for (const id of [membersOnly.id, crypto.randomUUID()]) {
    await page.goto(id);
    await page.expectSharingTag("og:title", "Skjera");
    await page.expectNoSharingTag("og:description");
    await page.expectNoSharingTag("og:image");
  }

  await cleanUp(alice, team, shown.id, membersOnly.id);
});

test("the privacy page says in each language that signups are deleted 30 days after", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const header = new Header(reader);
  await new PrivacyPage(reader).goto();
  await new PrivacyPage(reader).expectText(
    m.privacy_keep({}, { locale: "en" }),
  );
  await header.selectLanguage("Bokmål");
  await new PrivacyPage(reader, "nb").expectText(
    m.privacy_keep({}, { locale: "nb" }),
  );
  await header.selectLanguage("Nynorsk", "Språk");
  await new PrivacyPage(reader, "nn").expectText(
    m.privacy_keep({}, { locale: "nn" }),
  );
});

test("every page of the site loads HubSpot's script, once", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("HubSpot"));
  const event = await new EventEditor(alice).createPublished({ public: true });

  const reader = await visitor(browser);
  const hubSpot = new HubSpot(reader);
  const asked = await hubSpot.install();
  for (const [n, path] of [`/events/${event.id}`, "/privacy", "/"].entries()) {
    await reader.goto(path);
    await hubSpot.expectRuns(1);
    expect(asked).toHaveLength(n + 1);
  }
  expect(asked).toEqual(Array(3).fill(hubSpotScript));

  // The site's name, on the front page, loads it again: its loader runs
  // again, and the script is not added again.
  await new Header(reader).clickBrandReloadingSession();
  await new HomePage(reader).expectUpcomingHeading();
  await hubSpot.expectLoaders(1);
  await hubSpot.expectRunsNow(1);
  expect(asked).toHaveLength(3);

  const member = await new HubSpot(alice).install();
  await new AccountPage(alice).goto();
  await new HubSpot(alice).expectRuns(1);
  expect(member).toEqual([hubSpotScript]);

  await cleanUp(alice, team, event.id);
});

test("the way from the studio to the site loads HubSpot's script", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const hubSpot = new HubSpot(alice);
  await hubSpot.install();
  const teams = new TeamsColumn(alice);
  await teams.goto();
  await teams.expectShown();

  await new Header(alice).clickBrand();
  await new HomePage(alice).expectUpcomingHeading();
  await hubSpot.expectRuns(1);
});

test("the studio never runs HubSpot's script, however it is entered", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const hubSpot = new HubSpot(alice);
  const asked = await hubSpot.install();
  const header = new Header(alice);
  const teams = new TeamsColumn(alice);

  // Entered directly.
  await teams.goto();
  await teams.expectShown();
  expect(asked).toEqual([]);
  await hubSpot.expectRunsNow(0);
  await hubSpot.expectLoaders(0);

  // From a site page that has run it, by Back.
  await header.clickBrand();
  await hubSpot.expectRuns(1);
  await alice.goBack();
  // Only the studio shows its teams: the page that ran HubSpot never does.
  await teams.expectShown();
  await hubSpot.expectRuns(0);
  await hubSpot.expectLoaders(0);

  // From a site page that has run it, by the "Studio" link.
  await header.clickBrand();
  await hubSpot.expectRuns(1);
  await header.clickStudio();
  await teams.expectShown();
  await hubSpot.expectRuns(0);
  await hubSpot.expectLoaders(0);
});

test("without a HubSpot account id, nothing goes to HubSpot", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const hubSpot = new HubSpot(reader);
  const asked = hubSpot.recordRequests();
  await new HomePage(reader).goto();
  await new HomePage(reader).expectUpcomingHeading();
  const privacy = new PrivacyPage(reader);
  await privacy.goto();
  await privacy.expectTitle();
  await hubSpot.waitForIdle();
  expect(asked).toEqual([]);
});

test("the privacy page names HubSpot, and opens its cookie settings", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const hubSpot = new HubSpot(reader);
  await hubSpot.install();
  const privacy = new PrivacyPage(reader);
  await privacy.goto();
  await privacy.expectCookiesText(m.privacy_cookies_hubspot());
  await privacy.expectCookiesWithout(m.privacy_cookies_untracked());

  await privacy.clickCookieSettings();
  await hubSpot.expectBannerAsked();
});

test("the privacy page names HubSpot in Norwegian too", async ({ browser }) => {
  const reader = await visitor(browser);
  await new HubSpot(reader).install();
  const header = new Header(reader);
  await new PrivacyPage(reader).goto();
  await header.selectLanguage("Bokmål");
  await new PrivacyPage(reader, "nb").expectCookiesText(
    m.privacy_cookies_hubspot({}, { locale: "nb" }),
  );
  await header.selectLanguage("Nynorsk", "Språk");
  await new PrivacyPage(reader, "nn").expectCookiesText(
    m.privacy_cookies_hubspot({}, { locale: "nn" }),
  );
});

test("without a HubSpot account id, the privacy page says nothing tracks you", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const privacy = new PrivacyPage(reader);
  await privacy.goto();
  await privacy.expectCookiesText(
    `${m.privacy_cookies()} ${m.privacy_cookies_untracked()}`,
  );
  await privacy.expectCookiesWithout(m.privacy_cookies_hubspot());
  await privacy.expectNoCookieSettings();
});
