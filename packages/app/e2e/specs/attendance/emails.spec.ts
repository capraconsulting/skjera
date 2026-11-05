import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import { invitationOf, Mailbox } from "../../pom/Mailbox.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

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

  // A new event follows the default; a choice is kept.
  await editor.expectReminders("default");
  await editor.chooseReminders("on");
  await editor.expectSaved();
  await editor.reload();
  await editor.expectReminders("on");
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

test("a new place emails who signed up, once the organizer agrees", async ({
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

test("an organizer writes the signed-up email's own subject and text", async ({
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

  await editor.openEmail("signed up");
  await editor.emailSubject("signed up").type(wording);
  await editor.emailSubject("signed up").expectText(wording);
  await editor.emailText("signed up").type("Bring a friend");
  await editor.emailText("signed up").expectText("Bring a friend");
  await editor.publish();

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);

  // The written subject and text, in place of the standard greeting and
  // opening; then the event, the invitation and the guest's own link.
  const signedUp = await new Mailbox().emailTo(
    address,
    `${wording} ${event.title}`,
  );
  expect(signedUp.text).toContain("Bring a friend");
  expect(signedUp.text).not.toContain("Hi Gina,");
  expect(signedUp.text).not.toContain(`You're signed up for ${event.title}`);
  expect(signedUp.text).toContain(event.title);
  expect(invitationOf(signedUp).location).toBe("Kantina");
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

test("an invitation has the place, the summary and the team as organizer", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teamName = uniqueTeamName("Invited");
  const team = await new TeamsColumn(alice).create(teamName);
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const summary = `Coffee and a talk ${event.id.slice(-6)}`;
  await editor.summary.type(summary);
  await editor.publish();
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);

  const invitation = invitationOf(
    await new Mailbox().emailTo(address, `You're signed up: ${event.title}`),
  );
  expect(invitation.location).toBe("Kantina");
  expect(invitation.description).toContain(summary);
  expect(invitation.organizer).toContain(`CN="${teamName}"`);

  await cleanUp(alice, team, event.id);
});

test("a new time and a new place at once send one email about both", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Both"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);
  await editor.attendees.expectText("Gina");

  await editor.times.fillStartTime("19:00");
  await editor.place.typeAt("end", ", 2nd floor");
  await editor.expectSaved();
  await editor.clickPublishAnswering("accept");
  await editor.expectPublished();
  const both = await new Mailbox().emailTo(
    address,
    `New time and place: ${event.title}`,
  );
  expect(both.text).toMatch(/It's now .* 7:00/);
  expect(both.text).toContain("Kantina, 2nd floor");
  // One email, not one for each.
  expect(
    (await new Mailbox().subjectsTo(address)).filter((subject) =>
      /^New (time|place)/.test(subject),
    ),
  ).toEqual([`New time and place: ${event.title}`]);

  await cleanUp(alice, team, event.id);
});

test("the cancelled, changed and cancelled-event emails go out as written for the event", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Written"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const written = {
    "sign-up cancelled": "Sorry to see you go",
    "event changed": "We moved things around",
    "event cancelled": "No meetup this time",
  } as const;
  for (const [email, subject] of Object.entries(written) as Array<
    [keyof typeof written, string]
  >) {
    await editor.openEmail(email);
    await editor.emailSubject(email).type(subject);
    await editor.emailSubject(email).expectText(subject);
    await editor.emailText(email).type(`${subject}, in a few words`);
  }
  await editor.publish();

  // Gina signs up and cancels.
  const gina = `gina-${crypto.randomUUID()}@example.org`;
  const first = await visitor(browser);
  await new EventPage(first).goto(event.id);
  const ginas = new Attendance(first);
  await ginas.signUpAsGuest("Gina", gina);
  await ginas.cancelSignup();
  const left = await new Mailbox().emailTo(
    gina,
    `${written["sign-up cancelled"]} ${event.title}`,
  );
  expect(left.text).toContain("Sorry to see you go, in a few words");

  // Gus signs up, the event moves, then it's deleted.
  const gus = `gus-${crypto.randomUUID()}@example.org`;
  const second = await visitor(browser);
  await new EventPage(second).goto(event.id);
  await new Attendance(second).signUpAsGuest("Gus", gus);
  await editor.attendees.expectText("Gus");
  await editor.times.fillStartTime("19:00");
  await editor.expectSaved();
  await editor.clickPublishAnswering("accept");
  await editor.expectPublished();
  const moved = await new Mailbox().emailTo(
    gus,
    `${written["event changed"]} ${event.title}`,
  );
  expect(moved.text).toContain("We moved things around, in a few words");

  // Deleted: the attendees' emails have the written subject, not the
  // standard one `delete` waits for.
  const deleting = editor.clickDeleteAnswering("accept");
  await deleting.question;
  await editor.expectDeleted(event.id);
  await deleting.done;
  const cancelled = await new Mailbox().emailTo(
    gus,
    `${written["event cancelled"]} ${event.title}`,
  );
  expect(cancelled.text).toContain("No meetup this time, in a few words");

  await new Mailbox().deleteEmailsTo(gina);
  await new Mailbox().deleteEmailsTo(gus);
  await cleanUp(alice, team);
});

test("a cancelled event's email has the subject published, not a later draft's", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Drafted"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.openEmail("event cancelled");
  await editor.emailSubject("event cancelled").type("Called off");
  await editor.publish();
  // Changed again, but not published.
  await editor.emailSubject("event cancelled").typeAt("end", " for good");
  await editor
    .emailSubject("event cancelled")
    .expectText("Called off for good");
  await editor.expectSaved();
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", address);
  await editor.attendees.expectText("Gina");

  const deleting = editor.clickDeleteAnswering("accept");
  await deleting.question;
  await editor.expectDeleted(event.id);
  await deleting.done;
  await new Mailbox().emailTo(address, `Called off ${event.title}`);
  expect(await new Mailbox().subjectsTo(address)).not.toContain(
    `Called off for good ${event.title}`,
  );

  await new Mailbox().deleteEmailsTo(address);
  await cleanUp(alice, team);
});

test("the question before a new time is published says how many are signed up, when more than one (STU-18 AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Two"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  await new Attendance(bob).attend();
  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest(
    "Gina",
    `gina-${crypto.randomUUID()}@example.org`,
  );
  await editor.attendees.expectText("Gina");
  await editor.attendees.expectText("bob");

  await editor.times.fillStartTime("19:00");
  await editor.expectSaved();
  expect(await editor.clickPublishAnswering("dismiss")).toBe(
    "Publish the new time? The 2 people signed up are emailed about it.",
  );

  await cleanUp(alice, team, event.id);
});
