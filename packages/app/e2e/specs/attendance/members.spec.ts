import { test } from "@playwright/test";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { HomePage } from "../../pom/site/HomePage.ts";
import { cleanUp } from "../../pom/studio/cleanUp.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../../pom/support.ts";

test("members-only events are hidden from visitors", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Members"));
  const event = await new EventEditor(alice).createPublished({ public: false });

  const anonymous = await visitor(browser);
  const home = new HomePage(anonymous);
  await home.goto();
  await home.expectNoEvent(event.title);
  const page = new EventPage(anonymous);
  await page.goto(event.id);
  await page.expectNotPublished();

  const bob = await signedIn(browser, "bob@example.com");
  await new HomePage(bob).goto();
  await new HomePage(bob).clickEvent(event.title);
  await new EventPage(bob).expectAt(event.id);
  await new EventPage(bob).expectMembersOnly();

  await cleanUp(alice, team, event.id);
});

test("members attend and change their mind", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Attend"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: false });

  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const attendance = new Attendance(bob);
  await attendance.expectEmpty();
  await attendance.attend();
  await attendance.expectText("1 attending");

  // The organizer sees who is coming.
  await editor.reload();
  await editor.attendees.expectText("bob@example.com");

  await attendance.cancelAttendance();
  await attendance.expectEmpty();
  // Saved: the organizer sees it.
  await editor.attendees.expectEmpty();

  await cleanUp(alice, team, event.id);
});
