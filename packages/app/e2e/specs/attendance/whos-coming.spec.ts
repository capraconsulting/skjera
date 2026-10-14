import { expect, test } from "@playwright/test";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { WhoIsComing } from "../../pom/site/WhoIsComing.ts";
import { cleanUp } from "../../pom/studio/cleanUp.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../../pom/support.ts";

test("signups show up for visitors and organizers without reloading (AC-4, AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Live signups"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true });
  await editor.attendees.expectEmpty();

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  const counted = new Attendance(reader);
  await page.goto(event.id);
  await counted.expectEmpty();

  // Bob signs up: the visitor's count and Alice's list follow.
  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.attend();
  await counted.expectText("1 attending");
  await editor.attendees.expectText("bob@example.com");
  // The visitor can count, not see who.
  await new WhoIsComing(reader).expectHidden();
  await page.expectNowhere("bob@example.com");
  await page.expectNowhere(/\bbob\b/i);

  // Nor does the API tell: every row a pull without a session returns has no
  // details, page by page.
  const bodies = await page.pullSignups();
  for (const body of bodies) {
    const pull = JSON.parse(body) as { rows: { details: unknown }[] };
    for (const row of pull.rows) expect(row.details).toBeNull();
  }
  expect(bodies.join("")).not.toContain("bob@example.com");

  // And he changes his mind.
  await member.cancelAttendance();
  await counted.expectEmpty();
  await editor.attendees.expectEmpty();

  await cleanUp(alice, team, event.id);
});

test("members see who's coming, members and guests apart, without reloading (AC-1, AC-2, AC-3, AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Who is coming"),
  );
  const event = await new EventEditor(alice).createPublished({
    public: true,
    guests: true,
  });

  // Nobody yet: each kind says so.
  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const bobSees = new WhoIsComing(bob);
  await bobSees.expectSays("members", "Members (0)");
  await bobSees.expectSays("members", "No members have signed up yet.");
  await bobSees.expectSays("guests", "Guests (0)");
  await bobSees.expectSays("guests", "No guests have signed up yet.");

  // A guest signs up: Bob sees her among the guests, not the members.
  const gina = await visitor(browser);
  await new EventPage(gina).goto(event.id);
  const form = new Attendance(gina);
  await form.signUpAsGuest("Gina", "gina@example.org");
  await bobSees.expectSays("guests", "Guests (1)");
  await bobSees.expectSays("guests", "Gina");
  await bobSees.expectSays("members", "Members (0)");
  await bobSees.expectNotSaying("members", "Gina");

  // A member attends: Alice, with the page open, sees him among the members.
  await new EventPage(alice).goto(event.id);
  const aliceSees = new WhoIsComing(alice);
  await new Attendance(bob).attend();
  await aliceSees.expectSays("members", "Members (1)");
  await aliceSees.expectSays("members", "bob");

  // They change their minds.
  await form.cancelSignup();
  await bobSees.expectSays("guests", "No guests have signed up yet.");
  await new Attendance(bob).cancelAttendance();
  await aliceSees.expectSays("members", "No members have signed up yet.");

  await cleanUp(alice, team, event.id);
});

test("an event not open to guests lists only members (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Members list"),
  );
  const event = await new EventEditor(alice).createPublished({ public: true });

  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  await new WhoIsComing(bob).expectPart("members", true);
  await new WhoIsComing(bob).expectPart("guests", false);

  await cleanUp(alice, team, event.id);
});
