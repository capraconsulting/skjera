import { dexUsers } from "@skjera/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { expect, test } from "../fixtures/test.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("discarding changes asks first, and Cancel keeps them", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Discard asks"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  // Published and up to date: nothing to discard.
  await editor.expectNoButton("Discard changes");

  await editor.title.typeAt("end", "!");
  await editor.expectSaved();
  await editor.expectButton("Discard changes");

  const asked = editor.clickDiscardAnswering("dismiss");
  expect(await asked.question).toBe(
    "Discard the changes that aren't published? The event goes back to how it is published, and the changes are lost.",
  );
  // Still changed for the server, not only for this page.
  await editor.reload();
  await editor.title.expectText(`${event.title}!`);
  await editor.expectButton("Discard changes");

  await cleanUp(alice, team, event.id);
});

test("discarding changes puts the published title back and says the event is published", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Discarded"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  await editor.title.typeAt("end", "!");
  await editor.expectSaved();
  await editor.expectPublishEnabled();

  const discarding = editor.clickDiscardAnswering("accept");
  await discarding.question;
  await discarding.done;

  // Without reloading.
  await editor.title.expectText(event.title);
  await editor.expectPublished();
  await editor.expectPublishedButtonDisabled();
  await editor.expectNoButton("Discard changes");

  await cleanUp(alice, team, event.id);
});
