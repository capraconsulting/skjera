import { m } from "@skjera/i18n/messages";
import { dexUsers } from "@skjera/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { expect, test } from "../fixtures/test.ts";
import { Header } from "../pom/Header.ts";
import { AccountPage } from "../pom/site/AccountPage.ts";
import { HomePage } from "../pom/site/HomePage.ts";
import { HubSpot, hubSpotScript } from "../pom/site/HubSpot.ts";
import { PreviewPage } from "../pom/site/PreviewPage.ts";
import { PrivacyPage } from "../pom/site/PrivacyPage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("every page of the site loads HubSpot's script, once", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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

test("the preview never runs HubSpot's script, however it is entered", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview HubSpot"),
  );
  const event = await new EventEditor(alice).createPublished({ public: true });
  const hubSpot = new HubSpot(alice);
  const asked = await hubSpot.install();
  const preview = new PreviewPage(alice);

  // Entered directly.
  await preview.goto(event.id);
  await preview.expectHeading(event.title);
  expect(asked).toEqual([]);
  await hubSpot.expectRunsNow(0);
  await hubSpot.expectLoaders(0);

  // After a site page that has run it.
  await alice.goto(`/events/${event.id}`);
  await hubSpot.expectRuns(1);
  await preview.goto(event.id);
  await preview.expectHeading(event.title);
  await hubSpot.expectRuns(0);
  await hubSpot.expectLoaders(0);

  await cleanUp(alice, team, event.id);
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
  expect(asked).toEqual([]);
});

test("the privacy page names HubSpot, and opens its cookie settings (EXT-06 AC-5)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const hubSpot = new HubSpot(reader);
  await hubSpot.install();
  const privacy = new PrivacyPage(reader);
  await privacy.goto();
  await privacy.expectInPart("sharing", m.privacy_shared_hubspot());

  await privacy.clickCookieSettings();
  await hubSpot.expectBannerAsked();
});

test("the privacy page names HubSpot in Norwegian too (EXT-06 AC-5)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  await new HubSpot(reader).install();
  const header = new Header(reader);
  await new PrivacyPage(reader).goto();
  await header.selectLanguage("Bokmål");
  await new PrivacyPage(reader, "nb").expectInPart(
    "sharing",
    m.privacy_shared_hubspot({}, { locale: "nb" }),
  );
  await header.selectLanguage("Nynorsk", "Språk");
  await new PrivacyPage(reader, "nn").expectInPart(
    "sharing",
    m.privacy_shared_hubspot({}, { locale: "nn" }),
  );
});

test("without a HubSpot account id, the privacy page says nothing tracks you (EXT-06 AC-5)", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const privacy = new PrivacyPage(reader);
  await privacy.goto();
  await privacy.expectCookiesText(m.privacy_cookies_untracked());
  await privacy.expectNoText("HubSpot");
  await privacy.expectNoCookieSettings();
});
