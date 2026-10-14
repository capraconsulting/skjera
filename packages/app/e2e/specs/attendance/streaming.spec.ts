import { expect, test } from "@playwright/test";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { cleanUp } from "../../pom/studio/cleanUp.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../../pom/support.ts";

test("a streamed event shows its link, asks in person or online, and lists how each comes (AC-1, AC-2, AC-3, AC-4, AC-5)", async ({
  browser,
}) => {
  const link = "https://stream.example/meetup";
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Streamed"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    streamed: { link },
  });

  // What the organizer wrote is saved with the event.
  await editor.reload();
  await editor.expectStreamed();
  await editor.streamLink.expectText(link);

  // Anyone who sees the page gets the link.
  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new EventPage(guest).expectStreamLink(link);

  // The form asks, with neither picked, and is not sent until one is.
  const box = new Attendance(guest);
  await box.fillName("Gina");
  await box.fillEmail("gina@example.org");
  await box.expectOption("In person", "unchecked");
  await box.expectOption("Online", "unchecked");
  await box.clickSignUp();
  await box.expectOptionMissing("In person");
  await box.expectNotSignedUp();
  await box.checkOption("In person");
  await box.clickSignUp();
  await box.expectSignedUp();

  // So does a member's.
  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.expectOption("Online", "unchecked");
  await member.checkOption("In person");
  await member.attend();

  // The guest changes to online: the form starts from what they chose.
  await box.clickChangeAnswers();
  await box.answers.expectOption("In person", "checked");
  await box.answers.checkOption("Online");
  await box.answers.clickSaveChanges();
  await box.expectSignedUp();

  await editor.attendees.expectRow("Gina", "Online");
  await editor.attendees.expectRow("bob", "In person");

  const csv = await editor.attendees.downloadCsv();
  expect(csv.lines[0]).toBe(
    "Name,Email,Guest,Attending,Signed up,Changed,Phone,Company",
  );
  expect(csv.lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,Online,/),
    expect.stringMatching(/^bob,bob@example\.com,No,In person,/),
  ]);

  await cleanUp(alice, team, event.id);
});

test("a full streamed event takes no more in person but still takes those online (AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Streamed full"),
  );
  const event = await new EventEditor(alice).createPublished({
    public: true,
    guests: true,
    maxAttendees: 1,
    streamed: {},
  });

  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.checkOption("In person");
  await member.attend();

  // The one place in person is taken: the page says so, and online is open.
  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  const box = new Attendance(guest);
  await box.expectText("no more places in person");
  await box.expectOption("In person", "disabled");
  await box.fillName("Gina");
  await box.fillEmail("gina@example.org");
  await box.checkOption("Online");
  await box.clickSignUp();
  await box.expectSignedUp();

  await cleanUp(alice, team, event.id);
});
