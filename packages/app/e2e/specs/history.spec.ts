import { m } from "@skjera/i18n/messages";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName } from "../fixtures/support.ts";
import { expect, test } from "../fixtures/test.ts";
import { PreviewPage } from "../pom/site/PreviewPage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("the history lists the event's versions, each with who and when (AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("History"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  await editor.openHistory();

  const published = editor.historyEntries("Published").first();
  await expect(published).toBeVisible();
  await expect(published).toContainText(/alice/i);
  await expect(
    editor.historyEntries(m.studio_history_edited()).first(),
  ).toContainText(/alice/i);

  await cleanUp(alice, team, event.id);
});

test("viewing a version shows the event as it was, which later edits do not change (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("History view"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.title.type(" and more");
  await editor.expectSaved();

  await editor.openHistory();
  const preview = new PreviewPage(await editor.viewVersion("Published"));
  await preview.expectHeading(event.title);
  await editor.title.expectText(`${event.title} and more`);

  // The draft changes again; the version does not.
  await editor.title.type(" again");
  await editor.expectSaved();
  await preview.expectHeading(event.title);
  await preview.expectNowhere("again");

  await cleanUp(alice, team, event.id);
});

test("a version that is not change hashes is not found (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("History missing"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  const preview = new PreviewPage(await alice.context().newPage());
  await preview.gotoVersion(event.id, "not-a-version");
  await preview.expectMissing();

  await cleanUp(alice, team, event.id);
});

test("restoring a version asks first, and Cancel changes nothing (AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("History asks"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.title.type(" and more");
  await editor.expectSaved();

  await editor.openHistory();
  const asked = editor.clickRestoreAnswering("Published", "dismiss");
  expect(await asked.question).toBe(
    "Restore this version? The draft becomes as it was then. Nothing is published until you publish.",
  );

  await editor.reload();
  await editor.title.expectText(`${event.title} and more`);

  await cleanUp(alice, team, event.id);
});

test("restoring a version puts its title back in the draft without reloading (AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("History restore"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.title.type(" and more");
  await editor.expectSaved();

  await editor.openHistory();
  const restoring = editor.clickRestoreAnswering("Published", "accept");
  await restoring.question;
  await restoring.done;

  await editor.title.expectText(event.title);

  await cleanUp(alice, team, event.id);
});
