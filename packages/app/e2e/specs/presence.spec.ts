import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { test } from "../fixtures/test.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("an event shows who else has it open, with their cursors", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teamName = uniqueTeamName("Presence");
  const team = await new TeamsColumn(alice).create(teamName);
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.title.type("Hello there");

  const bob = await signedIn(browser, "bob@example.com");
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

  // It stays while Bob is in another window, as if he alt-tabbed away...
  await bobsEditor.title.leaveWindow();
  await editor.title.expectCaretStays("bob");

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
