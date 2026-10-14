import { expect, test } from "@playwright/test";
import { Mailbox } from "../../pom/Mailbox.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { cleanUp } from "../../pom/studio/cleanUp.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../../pom/support.ts";

test("moving an event emails who signed up, once the organizer agrees", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Moved"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);
  await editor.attendees.expectText("Gina");

  // Reminded the day before, unless turned off.
  await editor.expectRemindersOn();
  // An hour later.
  await editor.times.fillStartTime("19:00");
  await editor.expectSaved();
  expect(await editor.clickPublishAnswering("dismiss")).toBe(
    "Publish the new time? The person signed up is emailed about it.",
  );
  // Not published, then.
  await editor.expectPublishEnabled();

  await editor.clickPublishAnswering("accept");
  await editor.expectPublished();
  const moved = await new Mailbox().emailTo(
    address,
    `New time: ${event.title}`,
  );
  expect(moved.text).toMatch(/It's now .* 7:00/);
  expect(moved.text).toMatch(/It was .* 6:00/);
  expect(moved.raw).toMatch(/Content-Type: text\/calendar;.*method=REQUEST/);

  await cleanUp(alice, team, event.id);
});

test("a new place emails who signed up, once the organizer agrees (AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Elsewhere"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);
  await editor.attendees.expectText("Gina");

  await editor.place.typeAt("end", ", 2nd floor");
  await editor.expectSaved();
  expect(await editor.clickPublishAnswering("dismiss")).toBe(
    "Publish the new place? The person signed up is emailed about it.",
  );
  // Not published, then.
  await editor.expectPublishEnabled();

  await editor.clickPublishAnswering("accept");
  await editor.expectPublished();
  const moved = await new Mailbox().emailTo(
    address,
    `New place: ${event.title}`,
  );
  expect(moved.text).toContain("It's now at Kantina, 2nd floor.");
  expect(moved.text).toContain("It was at Kantina.");
  expect(moved.raw).toMatch(/Content-Type: text\/calendar;.*method=REQUEST/);

  await cleanUp(alice, team, event.id);
});

test("an organizer writes the signed-up email's own subject and text (AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Own email"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;
  const wording = "Welcome, we saved you a seat";

  // Opening a published event does not make it unpublished: the fields of an
  // email are not created until it is opened.
  await editor.reload();
  await editor.expectPublished();

  await editor.openEmail("Signed-up email");
  await editor.signedUpSubject.type(wording);
  await editor.signedUpSubject.expectText(wording);
  await editor.signedUpText.type("Bring a friend");
  await editor.signedUpText.expectText("Bring a friend");
  await editor.publish();

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);

  // The written subject and text, then the event, and the guest's own link.
  const signedUp = await new Mailbox().emailTo(address, wording);
  expect(signedUp.text).toContain("Bring a friend");
  expect(signedUp.text).toContain(event.title);
  expect(signedUp.text).toMatch(
    new RegExp(`http\\S*/events/${event.id}\\?guest=\\S+`),
  );

  await cleanUp(alice, team, event.id);
});

test("deleting an event emails who signed up that it's cancelled", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Cancelled"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  const page = new EventPage(guest);
  await page.goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);
  await editor.attendees.expectText("Gina");

  const deleting = editor.clickDeleteAnswering("accept");
  expect(await deleting.question).toBe(
    "Delete this event? It's taken off the site, and the person signed up is emailed that it's cancelled.",
  );
  await editor.expectDeleted(event.id);
  await deleting.done;

  const cancelled = await new Mailbox().emailTo(
    address,
    `Cancelled: ${event.title}`,
  );
  expect(cancelled.raw).toMatch(/Content-Type: text\/calendar;.*method=CANCEL/);
  expect(cancelled.raw).toContain("STATUS:CANCELLED");
  await page.reload();
  await page.expectNotPublished();

  await new Mailbox().deleteEmailsTo(address);
  await cleanUp(alice, team);
});
