import { signupRetentionDays } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import { Header } from "../../pom/Header.ts";
import { LoginPage } from "../../pom/LoginPage.ts";
import { Attendance, CancelByEmail } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { Footer } from "../../pom/site/Footer.ts";
import { HomePage } from "../../pom/site/HomePage.ts";
import { PrivacyPage } from "../../pom/site/PrivacyPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { EventsColumn } from "../../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

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

test("logging in from the site's header comes back to the page, filter and all (ACC-01 AC-1, ACC-01 AC-2)", async ({
  browser,
}) => {
  const page = await visitor(browser);
  const header = new Header(page);
  const home = new HomePage(page);
  await home.goto();
  await home.clickGuestFilter("open");
  await home.expectQuery("yes", null);
  await header.clickLogIn();
  await new LoginPage(page).signIn(dexUsers.alice);
  await home.expectUrl(/\/\?guests=yes$/);
  await header.expectSignedInAs(dexUsers.alice);
  await header.expectStudioLink();
});

test("a page waits for a server that is starting and keeps the configured site (OPS-07 AC-1)", async ({
  browser,
}) => {
  const page = await signedIn(browser, dexUsers.alice);
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
  await new Header(page).expectSignedInAs(dexUsers.alice);
  await teams.expectTeam(name);
  await expect(page).toHaveTitle("Skjera");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(tries.get("/api/me")).toBeGreaterThan(2);
  expect(tries.get("/api/site")).toBeGreaterThan(2);
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

  await header.pickTheme("Light");
  await header.expectTheme("light");
  await header.expectBackground("rgb(255, 255, 255)");

  // The choice is remembered.
  await new HomePage(page).reload();
  await header.expectTheme("light");
  await header.pickTheme("Dark");
  await header.expectBackground("rgb(9, 9, 11)");

  // Back to the system's: no choice kept, and still dark from the system.
  await header.pickTheme("Same as the system");
  await header.expectTheme(null);
  await header.expectThemePicked("Same as the system");
  await new HomePage(page).reload();
  await header.expectTheme(null);
  await header.expectBackground("rgb(9, 9, 11)");
});

test("the site shows what was published, and only that", async ({
  browser,
}) => {
  const alice = await visitor(browser);
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  await teams.goto();
  await new LoginPage(alice).signIn(dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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

  const alice = await signedIn(browser, dexUsers.alice);
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

test("sign-up closes at the deadline or event start, in its time zone (SIGN-05 AC-1, SIGN-05 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Deadline"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    maxAttendees: 2,
  });
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  const attendance = new Attendance(reader);
  await page.goto(event.id);
  // Without a deadline, sign-up closes when the event starts.
  await attendance.expectText(/Sign-up closes .* at 6:00\s*PM\./);
  await page.expectInfoItem("2 places left");

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
  // The places left go with the deadline, once the page has loaded.
  await page.expectNowhere(/places? left/);
  await attendance.expectNoButtons();
  await new CancelByEmail(reader).expectAbsent();

  const started = await editor.createPublished({
    public: true,
    guests: true,
    maxAttendees: 2,
  });
  await editor.times.pickPastStart();
  await editor.publish();
  await page.goto(started.id);
  await attendance.expectText("Sign-up has closed.");
  await page.expectNowhere(/places? left/);

  await cleanUp(alice, team, event.id, started.id);
});

test("the site has its logo, its footer and a privacy page (SITE-01 AC-2, SITE-01 AC-3)", async ({
  browser,
}) => {
  // Capra's and Liflig's logo; as configured in mise.toml: SITE_FOOTER, …
  // The animated logo, which the other tests turn off.
  const page = await visitor(browser, { reducedMotion: "no-preference" });
  const header = new Header(page);
  const footer = new Footer(page);
  await new HomePage(page).goto();
  // The logo for a light background is the dark one.
  await header.expectBrandLogo("logo-dark", true);
  // The tab: the site and its companies, as in Skjer.
  await new HomePage(page).expectTabTitle("Skjer | Capra Liflig");

  // Dark: the logo for a dark background.
  await header.pickTheme("Dark");
  await header.expectBrandLogo("logo-light", true);
  await header.expectBrandLogo("logo-dark", false);

  await footer.clickPrivacy();
  const privacy = new PrivacyPage(page);
  await privacy.expectAt();
  await privacy.expectTitle();
  await privacy.expectTabTitle("Privacy policy | Skjera");
  await privacy.expectOperatorDetails();
});

test("the footer is Capra's, as in Skjer (SITE-01 AC-3, SITE-01 AC-4, SITE-01 AC-9)", async ({
  browser,
}) => {
  const page = await visitor(browser);
  const footer = new Footer(page);
  await new HomePage(page).goto();
  // In English: heading, certifications that are not links, company logos
  // that are, and the line with the year.
  await footer.expectText("We are part of the Capra Group");
  await footer.expectText("Certifications");
  await footer.expectUnlinkedLogo("Eco-Lighthouse certification");
  await footer.expectUnlinkedLogo("DNV certification");
  await footer.expectLink("Capra logo", "https://www.capraconsulting.no/");
  await footer.expectLink("Liflig logo", "https://www.liflig.no/");
  await footer.expectText(
    `${new Date().getFullYear()} © Capra | Torggata 2-4, 0180 Oslo |`,
  );
  await footer.expectLink(
    "post@capraconsulting.no",
    "mailto:post@capraconsulting.no",
  );
  await footer.expectLogosLoaded();
  await footer.expectLogoFile(
    "Capra logo",
    "/footer/capra-black-vertical.webp",
  );
  // SITE_ASSETS_DIR's files are still served, though the footer no longer
  // uses them.
  const asset = await page.request.get("/site-assets/logo.svg");
  expect(asset.status()).toBe(200);

  await new Header(page).pickTheme("Dark");
  await footer.expectLogoFile(
    "Capra logo",
    "/footer/capra-white-vertical.webp",
  );
});

test("the privacy page has the sections of Skjer's policy (SITE-10 AC-1)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const privacy = new PrivacyPage(reader);
  await privacy.goto();
  await privacy.expectSections();
});

test("the privacy page names the operator the site gives (SITE-10 AC-4)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const privacy = new PrivacyPage(reader);
  await privacy.withOperator("Example Ltd");
  await privacy.goto();
  await privacy.expectInPart("controller", "Example Ltd");
});

test("without the operator's details, the privacy page leaves out their lines (SITE-10 AC-3)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const privacy = new PrivacyPage(reader);
  await privacy.withOnlyOperator();
  await privacy.goto();
  await privacy.expectNoOperatorDetails();
});

test("asking for less motion, the visitor sees the still logo", async ({
  browser,
}) => {
  const page = await visitor(browser, { reducedMotion: "reduce" });
  const header = new Header(page);
  await new HomePage(page).goto();
  await header.expectBrandLogo("logo-reduced-motion", true);
  await header.expectBrandLogo("logo-dark", false);
  await header.pickTheme("Dark");
  await header.expectBrandLogo("logo-reduced-motion", true);
  await header.expectBrandLogo("logo-light", false);
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

test("a link to a public event shows its title, summary and cover; others the site's name (SITE-11 AC-3, SITE-11 AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
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

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(shown.id);
  await page.expectTabTitle(shown.title);
  await page.expectSharingTag("og:title", shown.title);
  await page.expectSharingTag("og:description", summary);
  await page.expectSharingTag("og:image", new RegExp(`${cover}$`));
  await page.expectSharingTag("og:image:alt", "A full room");
  await page.expectSharingTag("twitter:card", "summary_large_image");
  await page.expectCanonical(new RegExp(`/events/${shown.id}$`));

  // The front page has the site's description.
  await new HomePage(reader).goto();
  await new HomePage(reader).expectDescription("Skjer | Capra Liflig");

  // No such event: the site's name only.
  await page.goto(crypto.randomUUID());
  await page.expectSharingTag("og:title", "Skjera");
  await page.expectNoSharingTag("og:description");
  await page.expectNoSharingTag("og:image");

  await cleanUp(alice, team, shown.id);
});

test("the privacy page says the configured retention in each language (SIGN-13 AC-2, SIGN-13 AC-4, SIGN-13 AC-1)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const header = new Header(reader);
  await new PrivacyPage(reader).goto();
  await new PrivacyPage(reader).expectTitle();
  await new PrivacyPage(reader).expectText(
    m.privacy_keep({ days: signupRetentionDays }, { locale: "en" }),
  );
  await header.selectLanguage("Bokmål");
  await new PrivacyPage(reader, "nb").expectTitle();
  await new PrivacyPage(reader, "nb").expectText(
    m.privacy_keep({ days: signupRetentionDays }, { locale: "nb" }),
  );
  await header.selectLanguage("Nynorsk", "Språk");
  await new PrivacyPage(reader, "nn").expectTitle();
  await new PrivacyPage(reader, "nn").expectText(
    m.privacy_keep({ days: signupRetentionDays }, { locale: "nn" }),
  );
});

test("the event page leads back to the front page with All events (SITE-05 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("All events"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.clickAllEvents();
  const home = new HomePage(reader);
  await home.expectAt();
  await home.expectUpcomingHeading();

  await cleanUp(alice, team, event.id);
});

test("a deleted event leaves open front pages, and its open page says it does not exist (SITE-09 AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Deleted"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  // Both pages stay open from here, and are never reloaded.
  const onFrontPage = await visitor(browser);
  const home = new HomePage(onFrontPage);
  await home.goto();
  await home.expectEvent(event.title);
  const onEventPage = await visitor(browser);
  const page = new EventPage(onEventPage);
  await page.goto(event.id);
  await page.expectHeading(event.title);

  await editor.delete(event.id);

  await home.expectNoEvent(event.title);
  await page.expectNotPublished();

  await new TeamsColumn(alice).delete(team);
});
