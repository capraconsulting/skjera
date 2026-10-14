import { test } from "@playwright/test";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("events are created in a team and listed under it", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");
  const redName = uniqueTeamName("Red");
  const blueName = uniqueTeamName("Blue");
  const red = await new TeamsColumn(alice).create(redName);
  const blue = await new TeamsColumn(bob).create(blueName);

  // Everyone sees every team.
  for (const page of [alice, bob]) {
    const teams = new TeamsColumn(page);
    await teams.goto();
    await teams.expectTeam(redName);
    await teams.expectTeam(blueName);
  }

  // Bob creates an event in Alice's team.
  const bobsTeams = new TeamsColumn(bob);
  const bobsEditor = new EventEditor(bob);
  await bobsTeams.goto(red);
  const event = await new EventsColumn(bob).newEvent();
  await bobsTeams.expectTeam(redName);
  await bobsEditor.title.type("Red news");
  // The events column follows the editor.
  await new EventsColumn(bob).expectEvent(/Red news/);
  // A link with the wrong team leads to the right one.
  await bobsEditor.goto(blue, event);
  await bobsEditor.expectAt(red, event);
  await bobsEditor.title.expectText("Red news");

  const teams = new TeamsColumn(alice);
  await teams.goto(red);
  await new EventsColumn(alice).expectEvent("Red news");
  // A team with events can't be deleted.
  await teams.openMenu(red);
  await teams.expectDeleteRefused();
  await teams.closeMenu();
  await teams.goto(blue);
  await new EventsColumn(alice).expectEmpty();

  await bobsEditor.goto(red, event);
  await bobsEditor.delete(event);
  await teams.delete(red);
  await teams.delete(blue);
});

test("the events column shows the team picked, switching without a reload", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const redName = uniqueTeamName("Red");
  const blueName = uniqueTeamName("Blue");
  const red = await teams.create(redName);
  const event = await events.newEvent();
  await editor.title.type("Red only");
  await editor.expectSaved();
  const blue = await teams.create(blueName);

  await teams.goto(red);
  await events.expectEvent(/Red only/);
  // From one team to the other in the team list, in the same page.
  await teams.clickTeam(blueName);
  await teams.expectAt(blue);
  await events.expectEmpty();
  await events.expectNoEvent(/Red only/);
  await teams.clickTeam(redName);
  await events.expectEvent(/Red only/);

  await editor.goto(red, event);
  await editor.delete(event);
  await teams.delete(red);
  await teams.delete(blue);
});

test("team names must be unique", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const name = uniqueTeamName("Unique");
  const team = await teams.create(name);

  await teams.goto();
  const dialog = await teams.openNewTeamDialog();
  await dialog.fillName(name.toUpperCase());
  await dialog.clickConfirm();
  // The dialog stays open with the error and the name, for fixing.
  await dialog.expectError("already a team");
  // The team shown while it was being created is gone again. (Link names
  // match regardless of case.)
  await teams.expectTeamCount(name, 1);
  await dialog.expectName(name.toUpperCase());
  await dialog.clickCancel();
  await dialog.expectClosed();

  await teams.delete(team);
});

test("teams can be renamed", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const taken = await teams.create(uniqueTeamName("Taken"));
  const takenName = await teams.teamName("Taken");
  const before = uniqueTeamName("Before");
  const team = await teams.create(before);
  const renamed = uniqueTeamName("After");

  const refused = await teams.openRenameDialog(team);
  await refused.fillName(takenName);
  await refused.clickConfirm();
  await refused.expectError("already a team");
  // Refused: the team keeps its name.
  await teams.expectTeam(before);
  await teams.expectTeamCount(takenName, 1);
  await refused.closeWithEscape();
  await refused.expectClosed();

  await teams.rename(team, renamed);
  await teams.expectSelected(renamed);

  await teams.delete(team);
  await teams.delete(taken);
});

test("the team list follows others' changes without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");
  const aliceSees = new TeamsColumn(alice);
  await aliceSees.expectShown();

  // Bob adds a team; it shows up for Alice on her open page.
  const name = uniqueTeamName("Polled");
  const team = await new TeamsColumn(bob).create(name);
  await aliceSees.expectTeam(name);

  // And disappears once Bob deletes it.
  await new TeamsColumn(bob).delete(team);
  await aliceSees.expectTeamCount(name, 0);
});

test("the events column follows others' changes without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Watched"));
  const aliceSees = new EventsColumn(alice);
  await aliceSees.expectEmpty();

  // Bob adds and names an event in Alice's team, and she sees it.
  const bob = await signedIn(browser, "bob@example.com");
  await new TeamsColumn(bob).goto(team);
  const event = await new EventsColumn(bob).newEvent();
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.title.type("Added by Bob");
  await aliceSees.expectEvent(/Added by Bob/);

  // And it's gone for her once he deletes it.
  await bobsEditor.delete(event);
  await aliceSees.expectEmpty();
  await new TeamsColumn(alice).delete(team);
});

test("publishing shows for others without reloading", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Launches"));
  const bob = await signedIn(browser, "bob@example.com");
  await new TeamsColumn(bob).goto(team);
  const event = await new EventsColumn(bob).newEvent();
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.title.type("Launch party");
  await bobsEditor.times.pick();
  await bobsEditor.writePlace();
  await bobsEditor.expectSaved();

  // Alice has it open, unpublished.
  const editor = new EventEditor(alice);
  const events = new EventsColumn(alice);
  await editor.goto(team, event);
  await events.expectEvent(/Launch party/, "Draft");
  await editor.expectStatus("Not published");

  // Bob publishes: her footer and the list follow.
  await bobsEditor.clickPublish();
  await bobsEditor.expectPublished();
  await editor.expectPublished();
  await events.expectEvent(/Launch party/, "Published");

  // Bob edits it again: the list says it has unpublished changes.
  await bobsEditor.title.typeAt("end", "!");
  await events.expectEvent(/Launch party!/, "Changed");

  await bobsEditor.delete(event);
  await new TeamsColumn(alice).delete(team);
});

test("a team's logos are chosen, replaced and removed in its logo dialog", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const team = await teams.create(uniqueTeamName("Logos"));
  const dialog = await teams.openLogoDialog(team);

  await dialog.expectNoLogo("light");
  await dialog.chooseFile("light");
  await dialog.expectLogo("light");
  await dialog.chooseFile("dark");
  await dialog.expectLogo("dark");

  // Replaced: another upload, with its own address.
  const first = await dialog.logoSrc("light");
  await dialog.clickReplace("light");
  await dialog.chooseFile("light");
  await dialog.expectLogoNot("light", first);
  const replaced = await dialog.logoSrc("light");

  await dialog.clickRemove("dark");
  await dialog.expectNoLogo("dark");
  await dialog.expectLogo("light", replaced);

  // After a reload the team has the replaced light logo and no dark one.
  await teams.goto(team);
  const again = await teams.openLogoDialog(team);
  await again.expectLogo("light", replaced);
  await again.expectNoLogo("dark");
  await again.closeWithEscape();

  await teams.delete(team);
});
