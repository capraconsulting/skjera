import { test } from "@playwright/test";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { cleanUp } from "../../pom/studio/cleanUp.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../../pom/support.ts";

test("a limit shows the places left, and a full event takes no more (AC-1, AC-7, AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
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
  await new Attendance(stranger).expectEmpty();
  await new Attendance(stranger).expectNoText("place");

  // A member and a guest take the two places.
  const bob = await signedIn(browser, "bob@example.com");
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
  await new EventPage(alice).goto(event.id);
  const organizer = new Attendance(alice);
  await organizer.expectText("There are no more places.");
  await organizer.expectNoAttendButton();

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

  await cleanUp(alice, team, event.id, unlimited.id);
});
