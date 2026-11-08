import type { Page } from "@playwright/test";
import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { Header } from "../../pom/Header.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { HomePage } from "../../pom/site/HomePage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

/** Publishes an event in the open team, a month ago. Returns its title. */
const publishedPastEvent = async (page: Page) => {
  const editor = new EventEditor(page);
  return editor.createPublished({ public: true, past: true });
};

test("the site's list shows each event's team as its organizer", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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
  await new Header(reader).pickTheme("Light");
  await page.expectLogo(light, true);
  await page.expectLogo(dark, false);

  await cleanUp(alice, team, event.id);
  await cleanUp(alice, lightOnlyTeam, lightOnlyEvent.id);
});

test("the open list follows a team's rename without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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
