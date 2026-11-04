import { cleanUp } from "../fixtures/cleanUp.ts";
import { connection, signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { expect, test } from "../fixtures/test.ts";
import { Header } from "../pom/Header.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { LocalCopies } from "../pom/studio/LocalCopies.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

/** Characters in `text`, sorted, to compare text regardless of interleaving. */
const letters = (text: string) => [...text].sort().join("");

test("no keystroke is lost when two people type at once", async ({
  browser,
}) => {
  test.slow();
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Typing"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  const bob = await signedIn(browser, "bob@example.com");
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.goto(team, id);
  await bobsEditor.body.expectVisible();

  // Both type into the body at once, each at their own end of it.
  const fromAlice = "alice types this text, quickly and without pause. ".repeat(
    3,
  );
  const fromBob = "BOB TYPES THIS OTHER TEXT AT THE SAME TIME! ".repeat(3);
  await editor.body.type("[]");
  await bobsEditor.body.expectText("[]");
  await editor.body.placeCaret("start");
  await bobsEditor.body.placeCaret("end");
  // As fast as a quick typist.
  await Promise.all([
    editor.body.typeKeys(fromAlice, 15),
    bobsEditor.body.typeKeys(fromBob, 15),
  ]);

  // Everything arrives everywhere, with nothing lost or doubled.
  const expected = letters(`[]${fromAlice}${fromBob}`);
  for (const each of [editor, bobsEditor]) {
    await expect
      .poll(async () => letters(await each.body.text()), { timeout: 15_000 })
      .toBe(expected);
  }
  const text = await editor.body.text();
  await bobsEditor.body.expectText(text);
  // Each person's text stays in one piece.
  expect(text).toContain(fromAlice);
  expect(text).toContain(fromBob);

  // And the server has it all.
  await editor.expectSaved();
  await bobsEditor.expectSaved();
  const fresh = await signedIn(browser, "alice@example.com");
  const freshEditor = new EventEditor(fresh);
  await freshEditor.goto(team, id);
  await freshEditor.body.expectText(text);

  await cleanUp(alice, team, id);
});

test("edits made offline are kept, and synced once back online", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Offline"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.body.type("Alice was here.");

  const bob = await signedIn(browser, "bob@example.com");
  const bobsConnection = await connection(bob);
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.goto(team, id);
  await bobsEditor.body.expectText("Alice was here.");

  // Bob loses his connection, and keeps writing while Alice does too.
  await bobsConnection.offline();
  await bobsEditor.body.typeAt("end", " Bob wrote this offline.");
  await editor.body.typeAt("start", "Hi! ");
  await bobsEditor.expectStatus("Saving");
  // A while later, Bob's text still hasn't reached Alice.
  await editor.body.expectTextStays("Hi! Alice was here.");

  // His edits survive reloading the page, and merge with Alice's.
  bobsConnection.online();
  await bobsEditor.reload();
  const merged = "Hi! Alice was here. Bob wrote this offline.";
  await bobsEditor.body.expectText(merged);
  await editor.body.expectText(merged);
  await bobsEditor.expectSaved();

  await cleanUp(alice, team, id);
});

test("logging out deletes the local copies", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Logout"));
  const id = await new EventsColumn(alice).newEvent();
  const editor = new EventEditor(alice);
  await editor.body.type("Kept here for a while");
  await editor.expectSaved();
  const copies = new LocalCopies(alice);
  await copies.expectSome();

  const header = new Header(alice);
  await header.logOut();
  await header.expectSignedOut();
  await copies.expectNone();

  const again = await signedIn(browser, "alice@example.com");
  const againEditor = new EventEditor(again);
  await againEditor.goto(team, id);
  await againEditor.body.expectText("Kept here for a while");
  await cleanUp(again, team, id);
});
