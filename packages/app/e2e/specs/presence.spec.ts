import { dexUsers } from "@skjera/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { test } from "../fixtures/test.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("an event shows who else has it open, with their cursors", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const teamName = uniqueTeamName("Presence");
  const team = await new TeamsColumn(alice).create(teamName);
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.title.type("Hello there");

  const bob = await signedIn(browser, dexUsers.bob);
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.goto(team, id);
  await bobsEditor.title.expectText("Hello there");

  // Alice sees Bob in the event, and Bob sees Alice.
  await editor.presence.expectOthersHere("bob");
  await bobsEditor.presence.expectOthersHere("alice");

  // Hovering an avatar shows the name.
  await editor.presence.hoverAvatarShowing("bob");

  // Bob's caret shows up in Alice's title, with his name.
  await bobsEditor.title.typeAt("end", "!");
  await editor.title.expectText(/Hello there!/);
  await editor.title.expectCaretOf("bob", true);

  // It stays while Bob is in another window. The following document change
  // reaches Alice after any presence change caused by the blur.
  await bobsEditor.title.leaveWindow();
  await bobsEditor.checkPublic();
  await editor.expectPublic(true);
  await editor.title.expectCaretOf("bob", true);

  // ...and goes when he focuses something else on the page.
  await bobsEditor.title.returnToWindow();
  await bobsEditor.title.typeAt("end", "?");
  await editor.title.expectCaretOf("bob", true);
  await bobsEditor.focusPublic();
  await editor.title.expectCaretOf("bob", false);

  // When Bob moves on, he's gone from the event.
  await new TeamsColumn(bob).clickTeam(teamName);
  await editor.presence.expectNobodyElse();
  await editor.title.expectCaretOf("bob", false);

  await cleanUp(alice, team, id);
});

test("someone with the event open in two tabs has one avatar (STU-05 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Tabs"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.title.type("Hello there");

  const bob = await signedIn(browser, dexUsers.bob);
  const firstTab = new EventEditor(bob);
  await firstTab.goto(team, id);
  await firstTab.title.expectText("Hello there");
  const secondTab = new EventEditor(await bob.context().newPage());
  await secondTab.goto(team, id);
  await secondTab.title.expectText("Hello there");

  // Alice has heard of the second tab once its caret shows in her title.
  await secondTab.title.typeAt("end", "!");
  await editor.title.expectCaretOf("bob", true);
  await editor.presence.expectOthersHere("bob");
  await editor.presence.expectAvatarCount(1);

  await cleanUp(alice, team, id);
});
