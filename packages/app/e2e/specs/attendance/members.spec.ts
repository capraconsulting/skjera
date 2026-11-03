import { test } from "@playwright/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { LoginPage } from "../../pom/LoginPage.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { HomePage } from "../../pom/site/HomePage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("a members-only event opens from its link for visitors, asking them to log in", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Members"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: false });
  const text = `Members only text ${event.id.slice(-6)}`;
  await editor.body.type(text);
  await editor.cover.chooseFile();
  await editor.cover.expect(/^\/api\/images\//);
  const cover = await editor.cover.src();
  await editor.cover.description.type("A full room");
  await editor.publish();

  // A second visitor keeps the link open while the event is unpublished.
  const watcher = await visitor(browser);
  await new EventPage(watcher).goto(event.id);
  await new EventPage(watcher).expectHeading(event.title);

  // Opening the link shows the event, and asks to log in to sign up.
  const anonymous = await visitor(browser);
  const page = new EventPage(anonymous);
  await page.goto(event.id);
  await page.expectHeading(event.title);
  await page.expectText("Kantina");
  await page.expectText(text);
  await page.expectCover("A full room", cover);
  await page.expectMembersOnly();
  const attendance = new Attendance(anonymous);
  await attendance.expectText("You need to log in to sign up for this event");
  await attendance.expectLogInButton();
  await attendance.expectSignUpButton(false);
  await attendance.expectNoAttendButton();

  // What it was fetched by doesn't list it on the front page.
  await page.clickAllEvents();
  const home = new HomePage(anonymous);
  await home.expectAt();
  await home.expectNoEvent(event.title);

  // Logging in from the box leads back to the event, to attend.
  await page.goto(event.id);
  await attendance.clickLogIn();
  await new LoginPage(anonymous).signIn("bob@example.com");
  await page.expectAt(event.id);
  await attendance.expectEmpty();
  await attendance.expectNoText("You need to log in");

  // Unpublished: the page open at the second visitor follows.
  const unpublishing = editor.clickUnpublishAnswering("accept");
  await unpublishing.question;
  await unpublishing.done;
  await new EventPage(watcher).expectNotPublished();

  // An address that is no event's id is no event.
  const stranger = new EventPage(await visitor(browser));
  await stranger.goto("nothing");
  await stranger.expectNotPublished();

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
