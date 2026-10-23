import { expect, test } from "@playwright/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { Mailbox } from "../pom/Mailbox.ts";
import { Attendance } from "../pom/site/Attendance.ts";
import { EventPage } from "../pom/site/EventPage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("unpublishing asks first, and Cancel keeps the event published", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Unpublish asks"),
  );
  const editor = new EventEditor(alice);

  // A draft that was never published has nothing to take off.
  const draft = await new EventsColumn(alice).newEvent();
  await editor.title.type("Never published");
  await editor.expectStatus("Not published");
  await editor.expectNoButton("Unpublish");

  const event = await editor.createPublished({ public: true, guests: true });
  await editor.expectButton("Unpublish");
  const asked = editor.clickUnpublishAnswering("dismiss");
  expect(await asked.question).toBe(
    "Unpublish this event? It's taken off the site and kept here as a draft.",
  );
  // Still published for the server, not only for this page.
  await editor.reload();
  await editor.expectPublished();
  await editor.expectButton("Unpublish");

  await cleanUp(alice, team, draft, event.id);
});

test("unpublishing an event people signed up for cancels it for them and keeps the draft", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Unpublished"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const guest = await visitor(browser);
  const page = new EventPage(guest);
  await page.goto(event.id);
  await new Attendance(guest).signUpAsGuest(
    "Gina",
    `gina-${crypto.randomUUID()}@example.org`,
  );
  const other = await visitor(browser);
  await new EventPage(other).goto(event.id);
  await new Attendance(other).signUpAsGuest(
    "Gus",
    `gus-${crypto.randomUUID()}@example.org`,
  );
  await editor.attendees.expectText("Gina");
  await editor.attendees.expectText("Gus");

  // Bob has the event open too.
  const bob = await signedIn(browser, "bob@example.com");
  const bobsEditor = new EventEditor(bob);
  await bobsEditor.goto(team, event.id);
  await bobsEditor.expectPublished();

  const unpublishing = editor.clickUnpublishAnswering("accept");
  expect(await unpublishing.question).toBe(
    "Unpublish this event? It's taken off the site and kept here as a draft, and the 2 people signed up are emailed that it's cancelled.",
  );
  await unpublishing.done;

  // Kept as a draft, with its content.
  await editor.expectStatus("Not published");
  await editor.expectNoButton("Unpublish");
  await editor.title.expectText(event.title);
  await new EventsColumn(alice).expectEvent(event.title, "Draft");
  // Bob sees it without reloading.
  await bobsEditor.expectStatus("Not published");
  await bobsEditor.expectNoButton("Unpublish");
  // Gone from the site, as a deleted event is.
  await page.reload();
  await page.expectNotPublished();

  await new Mailbox().clearCancellations(event.id, event.title, 2);
  await cleanUp(alice, team, event.id);
});

test("an unpublished event can be edited and published again", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Published again"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const unpublishing = editor.clickUnpublishAnswering("accept");
  await unpublishing.question;
  await unpublishing.done;
  await editor.expectStatus("Not published");

  await editor.title.typeAt("end", "!");
  await editor.expectSaved();
  await editor.expectPublishEnabled();
  await editor.publish();

  const guest = await visitor(browser);
  const page = new EventPage(guest);
  await page.goto(event.id);
  await page.expectHeading(`${event.title}!`);

  await cleanUp(alice, team, event.id);
});
