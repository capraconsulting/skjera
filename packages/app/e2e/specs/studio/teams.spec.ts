import type { Dialog } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { dexUsers } from "@skjera/test";
import { signedIn, uniqueTeamName } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { EventsColumn } from "../../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("a refused event deletion keeps the editor open and shows the failure (STU-19 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const team = await teams.create(uniqueTeamName("Refused deletion"));
  const events = new EventsColumn(alice);
  const id = await events.newEvent();
  const editor = new EventEditor(alice);
  await editor.title.type("Still here");
  await editor.expectSaved();

  const deletion = new RegExp(`/api/documents/${id}$`);
  await alice.route(deletion, (route) => route.fulfill({ status: 500 }));
  const refused = editor.clickDeleteAnswering("accept");
  await refused.question;
  await refused.done;
  await editor.expectAt(team, id);
  await editor.expectRefused("Deleting the event failed");
  await editor.title.expectText("Still here");

  await alice.unroute(deletion);
  await editor.delete(id);
  await teams.delete(team);
});

test("a failed cancellation answer shows no delete question and keeps the event (STU-01 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const team = await teams.create(uniqueTeamName("Failed cancellation answer"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.title.type("Still here");
  await editor.expectSaved();

  const answer = new RegExp(`/api/documents/${id}/cancellation-notice$`);
  await alice.route(answer, (route) => route.fulfill({ status: 500 }));
  let asked = false;
  const onDialog = async (dialog: Dialog) => {
    asked = true;
    await dialog.dismiss();
  };
  alice.on("dialog", onDialog);
  await alice
    .getByRole("button", { name: m.common_delete(), exact: true })
    .click();
  await editor.expectRefused("Deleting the event failed");
  expect(asked).toBe(false);
  alice.off("dialog", onDialog);
  await editor.expectAt(team, id);
  await editor.title.expectText("Still here");

  await alice.unroute(answer);
  await editor.delete(id);
  await teams.delete(team);
});

test("events are created in a team and a refused team deletion shows the server reason (STU-03 AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const bob = await signedIn(browser, dexUsers.bob);
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
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
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
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const takenName = uniqueTeamName("Taken");
  const taken = await teams.create(takenName);
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
  const alice = await signedIn(browser, dexUsers.alice);
  const bob = await signedIn(browser, dexUsers.bob);
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
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Watched"));
  const aliceSees = new EventsColumn(alice);
  await aliceSees.expectEmpty();

  // Bob adds and names an event in Alice's team, and she sees it.
  const bob = await signedIn(browser, dexUsers.bob);
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
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Launches"));
  const bob = await signedIn(browser, dexUsers.bob);
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
  const alice = await signedIn(browser, dexUsers.alice);
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

test("a team's events are searched by title and tags, and ordered (STU-26 AC-1, STU-26 AC-2, STU-26 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const redName = uniqueTeamName("Search");
  const red = await teams.create(redName);
  const word = red.slice(-8);
  const party = `Party ${word}`;
  const evening = `Evening ${word}`;
  const feast = `Feast ${word}`;

  // Made in turn. The party is tagged and never published; the evening is
  // the only one with a start.
  const partyId = await events.newEvent();
  await editor.title.type(party);
  await editor.tags.add("Sosialt");
  await editor.tags.close();
  const eveningId = await events.newEvent();
  await editor.title.type(evening);
  await editor.times.pick();
  const feastId = await events.newEvent();
  await editor.title.type(feast);
  await editor.expectSaved();
  // The party is edited last.
  await editor.goto(red, partyId);
  await editor.title.typeAt("end", "!");
  await editor.expectSaved();

  // «Sist endret» is the order to begin with.
  await events.expectOrder("updated");
  await events.expectTitles([`${party}!`, feast, evening]);
  await events.chooseOrder("created");
  await events.expectTitles([feast, evening, `${party}!`]);
  await events.chooseOrder("starts");
  await events.expectTitles([evening, `${party}!`, feast]);
  await events.chooseOrder("updated");

  // By title, whatever the case; by the draft's tag, never published.
  await events.search(`FEAST ${word}`);
  await events.expectTitles([feast]);
  await events.search("sosi");
  await events.expectTitles([`${party}!`]);
  // Nothing typed, or only spaces: the whole list.
  await events.search("   ");
  await events.expectTitles([`${party}!`, feast, evening]);
  await events.search(`nothing like this ${word}`);
  await events.expectNothingFound();

  // Opening an event keeps the search; another team starts without one.
  await events.search(`Evening ${word}`);
  await events.open(evening);
  await editor.expectAt(red, eveningId);
  await events.expectSearchText(`Evening ${word}`);
  await events.expectTitles([evening]);
  const blueName = uniqueTeamName("Other");
  const blue = await teams.create(blueName);
  await events.expectSearchText("");
  await teams.goto(red);
  await events.expectSearchText("");
  await events.expectTitles([`${party}!`, feast, evening]);

  for (const id of [partyId, eveningId, feastId]) {
    await editor.goto(red, id);
    await editor.delete(id);
  }
  await teams.delete(red);
  await teams.delete(blue);
});

test("events are found across teams in the order chosen, which is kept (STU-26 AC-3, STU-26 AC-4, STU-26 AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const redName = uniqueTeamName("Red");
  const blueName = uniqueTeamName("Blue");
  const red = await teams.create(redName);
  const word = red.slice(-8);
  const first = `First ${word}`;
  const second = `Second ${word}`;
  const firstId = await events.newEvent();
  await editor.title.type(first);
  await editor.expectSaved();
  const blue = await teams.create(blueName);
  const secondId = await events.newEvent();
  await editor.title.type(second);
  await editor.expectSaved();
  // The first made is edited last: «Sist endret» and «Opprettet» differ.
  await editor.goto(red, firstId);
  await editor.title.typeAt("end", "!");
  await editor.expectSaved();

  await events.chooseOrder("created");
  await teams.searchAll(word);
  await teams.expectResult(second, blueName);
  await teams.expectResult(first, redName);
  await teams.expectResultsInOrder([second, first]);
  // The results are in place of the teams.
  await teams.expectTeamCount(blueName, 1);
  await teams.searchAll(`nothing like this ${word}`);
  await teams.expectNothingFound();

  // A result opens in its own team.
  await teams.searchAll(word);
  await teams.openResult(second);
  await editor.expectAt(blue, secondId);
  await teams.expectSelected(blueName);
  await events.expectTitles([second]);
  // With the field emptied, the teams are listed again.
  await teams.searchAll("");
  await teams.expectTeam(redName);
  await teams.expectTeam(blueName);

  // The order is kept: in another team, in an open event, after a reload.
  await events.expectOrder("created");
  await teams.goto(red);
  await events.expectOrder("created");
  await editor.goto(red, firstId);
  await events.expectOrder("created");
  await editor.reload();
  await events.expectOrder("created");
  await events.expectTitles([`${first}!`]);

  await editor.delete(firstId);
  await editor.goto(blue, secondId);
  await editor.delete(secondId);
  await teams.delete(red);
  await teams.delete(blue);
});

test("a search and an order keep following others' edits without reloading (STU-26 AC-7)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const redName = uniqueTeamName("Followed");
  const red = await teams.create(redName);
  const word = red.slice(-8);
  const early = `Early ${word}`;
  const earlyId = await events.newEvent();
  await editor.title.type(early);
  await editor.expectSaved();
  await events.chooseOrder("created");
  await events.search(word);
  await teams.searchAll(word);
  await events.expectTitles([early]);

  // Bob makes an event that matches, and it is first for her in both lists.
  const bob = await signedIn(browser, dexUsers.bob);
  await new TeamsColumn(bob).goto(red);
  const added = `Added by Bob ${word}`;
  const addedId = await new EventsColumn(bob).newEvent();
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.title.type(added);
  await events.expectTitles([added, early]);
  await teams.expectResultsInOrder([added, early]);

  await bobsEditor.delete(addedId);
  await editor.goto(red, earlyId);
  await editor.delete(earlyId);
  await teams.delete(red);
});

test("an event without a title or a start shows Untitled and No date in the list (STU-03 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const team = await teams.create(uniqueTeamName("Blank"));
  const event = await events.newEvent();
  const path = `/studio/teams/${team}/events/${event}`;

  await events.expectRow(path, "Untitled");
  await events.expectRow(path, "No date");

  // A start replaces «No date» with the day.
  await editor.times.pick();
  await events.expectRow(path, /[A-Z][a-z]{2} 15, \d{4}/);
  await events.expectRowWithout(path, "No date");
  await events.expectRow(path, "Untitled");

  await editor.delete(event);
  await teams.delete(team);
});

test("a team that no longer exists says so when its address is opened (STU-03 AC-7)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const team = await teams.create(uniqueTeamName("Gone"));

  await teams.delete(team);
  await teams.goto(team);
  await teams.expectTeamGone();
});
