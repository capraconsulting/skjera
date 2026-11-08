import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import {
  signedIn,
  uniqueEmail,
  uniqueTeamName,
  visitor,
} from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import { Mailbox } from "../../pom/Mailbox.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("the attendee list offers an email to those signed up only while someone is (MAIL-08 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Mail"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  await editor.attendees.expectEmpty();
  await editor.attendees.expectEmailButton(false);

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", uniqueEmail("gina"));
  await editor.attendees.expectText("Gina");
  await editor.attendees.expectEmailButton(true);
  await editor.attendees.openEmailForm(1);

  await cleanUp(alice, team, event.id);
});

test("an organizer's email goes out once confirmed, and is listed at once (MAIL-08 AC-2, MAIL-08 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Mail"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = uniqueEmail("gina");
  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);
  await editor.attendees.expectText("Gina");
  const subject = `Nytt rom ${crypto.randomUUID()}`;

  await editor.attendees.openEmailForm(1);
  await editor.attendees.fillEmail(subject, "Vi er i rom 3.");

  // Declined: nothing is sent and nothing is listed.
  await editor.attendees.sendEmailAnswering("dismiss");
  await editor.attendees.expectEmailFormOpen();
  await editor.attendees.expectSentEmailCount(0);
  expect(await new Mailbox().subjectsTo(address)).not.toContain(subject);

  // Confirmed: the studio says so, and lists the email.
  await editor.attendees.sendEmailAnswering("accept");
  await editor.attendees.expectSending(1);
  await editor.attendees.expectSentEmail(subject, 1);
  const received = await new Mailbox().emailTo(address, subject);
  expect(received.text).toContain("Vi er i rom 3.");
  expect(received.raw).toMatch(/^Reply-To:.*alice@example\.com/im);

  await cleanUp(alice, team, event.id);
});
