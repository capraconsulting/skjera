import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { PreviewPage } from "../../pom/site/PreviewPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { EventsColumn } from "../../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("the preview shows the draft's changes, and the published page keeps its title (STU-21 AC-1, STU-21 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview draft"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.title.type(" and more");
  await editor.expectSaved();

  const tab = await editor.openPreview();
  const preview = new PreviewPage(tab);
  await preview.expectAt(event.id);
  await preview.expectHeading(`${event.title} and more`);

  const reader = await visitor(browser);
  const published = new EventPage(reader);
  await published.goto(event.id);
  await published.expectHeading(event.title);
  await published.expectNowhere("and more");

  await cleanUp(alice, team, event.id);
});

test("the preview follows the draft without a reload (STU-21 AC-3)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview live"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  const tab = await editor.openPreview();
  const preview = new PreviewPage(tab);
  await preview.expectHeading(event.title);
  // Changed after the preview opened; the tab is never reloaded. At the end:
  // back from the new tab, the caret may be anywhere in the title.
  await editor.title.typeAt("end", " now live");
  await preview.expectHeading(`${event.title} now live`);

  await cleanUp(alice, team, event.id);
});

test("the notice says it is a preview, links to the published page, and stays in view (STU-21 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview notice"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  const preview = new PreviewPage(await editor.openPreview());
  await preview.expectNotice();
  await preview.expectPublishedLink(event.id);
  await preview.expectNoticeInViewAtEnd();

  // Never published: the same notice, with nowhere to link to.
  const draft = await new EventsColumn(alice).newEvent();
  await editor.title.type("Draft notice");
  await editor.times.pick();
  await editor.writePlace();
  await editor.expectSaved();
  const draftPreview = new PreviewPage(await editor.openPreview());
  await draftPreview.expectNotice();
  await draftPreview.expectNoPublishedLink();

  await cleanUp(alice, team, event.id, draft);
});

test("an event never published shows once it has times (STU-21 AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview unpublished"),
  );
  const editor = new EventEditor(alice);
  const event = await new EventsColumn(alice).newEvent();
  await editor.title.type("Not yet out");
  await editor.expectSaved();

  const preview = new PreviewPage(await editor.openPreview());
  await preview.expectNotice();
  await preview.expectNeedsTimes();

  // Times picked in the studio show the page, with no reload.
  await editor.times.pick();
  await editor.writePlace();
  await preview.expectHeading("Not yet out");

  await cleanUp(alice, team, event);
});

test("someone not logged in, or an unknown draft, gets the missing-event message (STU-21 AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview closed"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });

  const reader = await visitor(browser);
  const closed = new PreviewPage(reader);
  await closed.goto(event.id);
  await closed.expectMissing();
  await closed.expectNowhere(event.title);

  // Logged in, but no such draft: in a tab of its own, so the editor stays.
  const unknown = new PreviewPage(await alice.context().newPage());
  await unknown.goto(crypto.randomUUID());
  await unknown.expectMissing();

  // A draft deleted while its preview is open.
  const open = new PreviewPage(await editor.openPreview());
  await open.expectHeading(event.title);
  await editor.delete(event.id);
  await open.expectMissing();

  await new TeamsColumn(alice).delete(team);
});

test("the preview shows the sign-up box, but nothing in it can be used (STU-21 AC-7)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Preview inert"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const preview = new PreviewPage(await editor.openPreview());
  await preview.expectHeading(event.title);
  await preview.expectSignUpUnusable();

  await cleanUp(alice, team, event.id);
});
