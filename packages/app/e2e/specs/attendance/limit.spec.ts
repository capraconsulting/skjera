import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { Attendance, CancelByEmail } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("a limit shows the places left, and a full event takes no more (SIGN-06 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Limit"));
  const editor = new EventEditor(alice);
  const unlimited = await editor.createPublished({ public: true });
  const event = await editor.createPublished({
    public: true,
    guests: true,
    maxAttendees: 2,
  });

  // Without a limit, the page says nothing about places.
  const stranger = await visitor(browser);
  await new EventPage(stranger).goto(unlimited.id);
  await new Attendance(stranger).expectNoCount();
  await new Attendance(stranger).expectNoText("place");

  // A member and a guest take the two places.
  const bob = await signedIn(browser, dexUsers.bob);
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.expectText("2 places left");
  await member.attend();
  await member.expectText("1 place left");

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", "gina@example.org");

  // Others are told there are no more places, instead of the form.
  const other = await visitor(browser);
  const otherPage = new EventPage(other);
  const others = new Attendance(other);
  await otherPage.goto(event.id);
  await others.expectText("There are no more places.");
  await others.expectSignUpButton(false);
  await others.expectLogInIfSignedUp();
  // A full event is still open for sign-up: those who lost their email cancel from here.
  await new CancelByEmail(other).expectShown();
  await new EventPage(alice).goto(event.id);
  const organizer = new Attendance(alice);
  await organizer.expectText("There are no more places.");
  await organizer.expectNoAttendButton();

  // Those signed up can still change what they gave while it's full.
  const gina = new Attendance(guest);
  await gina.clickChangeAnswers();
  await gina.answers.fillPhone("900 00 000");
  await gina.answers.clickSaveChanges();
  await gina.expectSignedUp();
  await editor.goto(team, event.id);
  await editor.attendees.expectRow("Gina", "900 00 000");

  // Those signed up are still let in, and cancelling frees the place.
  await member.expectAttending();
  await member.cancelAttendance();
  await otherPage.reload();
  await others.expectSignUpButton(true);
  await others.expectText("1 place left");

  // Hidden, the page no longer says how many places are left.
  await editor.goto(team, event.id);
  await editor.checkHidePlacesLeft();
  await editor.publish();
  await otherPage.reload();
  await others.expectSignUpButton(true);
  await others.expectNoText("place left");

  // The place Bob freed is taken by someone new.
  await others.signUpAsGuest("Gus", "gus@example.org");

  await cleanUp(alice, team, event.id, unlimited.id);
});

test("a signup sent once the event is full is refused, saying it is full", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Last place"),
  );
  const event = await new EventEditor(alice).createPublished({
    public: true,
    guests: true,
    maxAttendees: 1,
  });

  // Gus has the form open, and from then on his page doesn't catch up: its
  // pulls fail.
  const late = await visitor(browser);
  await new EventPage(late).goto(event.id);
  const gus = new Attendance(late);
  await gus.fillName("Gus");
  await gus.fillEmail("gus@example.org");
  await late.route("**/api/sync/**", (route) => route.abort());

  // Gina takes the last place first.
  const first = await visitor(browser);
  await new EventPage(first).goto(event.id);
  await new Attendance(first).signUpAsGuest("Gina", "gina@example.org");

  await gus.clickSignUp();
  await gus.expectAlert("This event is full");
  await gus.expectNotSignedUp();

  await cleanUp(alice, team, event.id);
});

test("a limit below those signed up keeps them, and takes no one new", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Lowered"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const bob = await signedIn(browser, dexUsers.bob);
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.attend();
  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", "gina@example.org");

  // Lowered to one, below the two signed up: it can still be published.
  await editor.fillMaxAttendees(1);
  await editor.publish();
  await editor.reload();
  await editor.attendees.expectText(dexUsers.bob);
  await editor.attendees.expectText("Gina");

  const other = await visitor(browser);
  await new EventPage(other).goto(event.id);
  const others = new Attendance(other);
  await others.expectText("There are no more places.");
  await others.expectSignUpButton(false);
  await new EventPage(bob).reload();
  await member.expectAttending();

  await cleanUp(alice, team, event.id);
});
