import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { expect, test } from "../../fixtures/test.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { WhoIsComing } from "../../pom/site/WhoIsComing.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("signups show up for visitors and organizers without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Live signups"),
  );
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    maxAttendees: 3,
  });
  await editor.attendees.expectEmpty();

  const reader = await visitor(browser);
  const page = new EventPage(reader);
  await page.goto(event.id);
  await page.expectInfoItem("3 places left");

  // Bob signs up: the visitor's places left and Alice's list follow, and the
  // visitor is not told how many are signed up (AC-10).
  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.attend();
  await page.expectInfoItem("2 places left");
  await page.expectNoInfoItem(/attending/);
  await new Attendance(reader).expectNoCount();
  await editor.attendees.expectText("bob@example.com");
  // The visitor can count places, not see who.
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

  // A guest signs up in another window: the visitor's places follow.
  const gina = await visitor(browser);
  await new EventPage(gina).goto(event.id);
  await new Attendance(gina).signUpAsGuest("Gina", "gina@example.org");
  await page.expectInfoItem("1 place left");

  // Those logged in see the count, as before.
  await new EventPage(alice).goto(event.id);
  await new EventPage(alice).expectInfoItem("2 attending");

  // When the last place is taken, visitors are told there are none left.
  const hanna = await visitor(browser);
  await new EventPage(hanna).goto(event.id);
  await new Attendance(hanna).signUpAsGuest("Hanna", "hanna@example.org");
  await page.expectInfoItem("No places left");

  // And he changes his mind.
  await member.cancelAttendance();
  await page.expectInfoItem("1 place left");

  await cleanUp(alice, team, event.id);
});

test("members see who's coming, members and guests apart, without reloading", async ({
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

test("an event not open to guests lists only members", async ({ browser }) => {
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
