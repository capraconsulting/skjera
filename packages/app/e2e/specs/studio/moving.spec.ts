import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { PreviewPage } from "../../pom/site/PreviewPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { EventsColumn } from "../../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("an event that was never published can be moved to another team, which then has it in its list and in its preview (STU-27 AC-1, STU-27 AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const fromName = uniqueTeamName("Moved from");
  const toName = uniqueTeamName("Moved to");
  const from = await teams.create(fromName);
  const to = await teams.create(toName);

  await teams.goto(from);
  const event = await events.newEvent();
  await editor.title.type("Moving house");
  await editor.times.pick();
  await editor.writePlace();
  await editor.expectSaved();
  await editor.expectOrganizer(from);
  await editor.expectOrganizerChoices([fromName, toName]);

  await editor.chooseOrganizer(toName);
  await editor.expectAt(to, event);
  await editor.expectOrganizer(to);
  await editor.title.expectText("Moving house");

  await teams.goto(to);
  await events.expectEvent(/Moving house/);
  await teams.goto(from);
  await events.expectNoEvent(/Moving house/);

  await editor.goto(to, event);
  const preview = new PreviewPage(await editor.openPreview());
  await preview.expectOrganizer(toName);

  await cleanUp(alice, to, event);
  await teams.delete(from);
});

test("the organizer of a published event can't be changed, also after it is unpublished (STU-27 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Locked organizer"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  await editor.expectOrganizer(team);
  await editor.expectOrganizerLocked();

  await editor.clickUnpublishAnswering("accept").done;
  await editor.expectStatus("Not published");
  await editor.expectOrganizerLocked();
  await editor.reload();
  await editor.expectOrganizerLocked();

  await cleanUp(alice, team, event.id);
});

test("the old address of a moved event opens it in its new team, also after the old team is deleted (STU-27 AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const toName = uniqueTeamName("Moved to");
  const from = await teams.create(uniqueTeamName("Wrong team"));
  const to = await teams.create(toName);

  await teams.goto(from);
  const event = await new EventsColumn(alice).newEvent();
  await editor.chooseOrganizer(toName);
  await editor.expectAt(to, event);
  // Nothing left in the wrong team, so it can go.
  await teams.delete(from);

  await editor.goto(from, event);
  await editor.expectAt(to, event);

  await cleanUp(alice, to, event);
});

test("others who have the event open follow it to the new team, without reloading (STU-27 AC-7)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const bob = await signedIn(browser, dexUsers.bob);
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const bobsEditor = new EventEditor(bob);
  const toName = uniqueTeamName("Followed to");
  const from = await teams.create(uniqueTeamName("Followed from"));
  const to = await teams.create(toName);

  await teams.goto(from);
  const event = await new EventsColumn(alice).newEvent();
  await bobsEditor.goto(from, event);
  await bobsEditor.expectOrganizer(from);

  await editor.chooseOrganizer(toName);

  await editor.expectAt(to, event);
  await bobsEditor.expectAt(to, event);
  await bobsEditor.expectOrganizer(to);

  await cleanUp(alice, to, event);
  await teams.delete(from);
});
