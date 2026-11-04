import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { test } from "../fixtures/test.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("a published event can be copied, and the copy opens as an event of its own that is not published (AC-1, AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Copied"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  await editor.expectButton("Make a copy");
  const copy = await editor.copy();

  await editor.expectAt(team, copy);
  await editor.title.expectText(event.title);
  await editor.expectStatus("Not published");

  await cleanUp(alice, team, event.id, copy);
});

test("an event that was never published can be copied (AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Draft copy"),
  );
  const editor = new EventEditor(alice);
  const event = await new EventsColumn(alice).newEvent();

  await editor.expectButton("Make a copy");
  const copy = await editor.copy();
  await editor.expectAt(team, copy);

  await cleanUp(alice, team, event, copy);
});
