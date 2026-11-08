import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { LoginPage } from "../../pom/LoginPage.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { HomePage } from "../../pom/site/HomePage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("a members-only event opens from its link for visitors, asking them to log in", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
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
  await page.expectInternalOnly();
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
  await new LoginPage(anonymous).signIn(dexUsers.bob);
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
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Attend"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: false });

  const bob = await signedIn(browser, dexUsers.bob);
  await new EventPage(bob).goto(event.id);
  const attendance = new Attendance(bob);
  await attendance.expectEmpty();
  // Right after attending, the box says where the confirmation goes (AC-1).
  await attendance.attend(dexUsers.bob);
  await attendance.expectText("1 attending");
  await new EventPage(bob).reload();
  await attendance.expectText("You're attending.");

  // The organizer sees who is coming.
  await editor.reload();
  await editor.attendees.expectText(dexUsers.bob);

  // Cancelling says whether the confirmation email was sent (AC-2).
  await attendance.cancelAttendance();
  await attendance.expectCancelled();
  // Saved: the organizer sees it.
  await editor.attendees.expectEmpty();

  await cleanUp(alice, team, event.id);
});

test("the front page marks the upcoming events the reader has signed up for (SITE-02 AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Marked"));
  const editor = new EventEditor(alice);
  const membersEvent = await editor.createPublished({
    public: true,
    guests: true,
  });
  const guestsEvent = await editor.createPublished({
    public: true,
    guests: true,
  });
  const signedUp = "You're signed up";

  // A member, from their signup.
  const bob = await signedIn(browser, dexUsers.bob);
  await new EventPage(bob).goto(membersEvent.id);
  await new Attendance(bob).attend();
  const bobsHome = new HomePage(bob);
  await bobsHome.goto();
  await bobsHome.expectEventSays(membersEvent.title, signedUp);
  await bobsHome.expectEventDoesNotSay(guestsEvent.title, signedUp);

  // A guest, from the signup their browser remembers.
  const guest = await visitor(browser);
  await new EventPage(guest).goto(guestsEvent.id);
  await new Attendance(guest).signUpAsGuest("Gina", "gina@example.org");
  const guestsHome = new HomePage(guest);
  await guestsHome.goto();
  await guestsHome.expectEventSays(guestsEvent.title, signedUp);
  await guestsHome.expectEventDoesNotSay(membersEvent.title, signedUp);

  // Someone who signed up for neither sees no mark on either.
  const stranger = await visitor(browser);
  const strangersHome = new HomePage(stranger);
  await strangersHome.goto();
  await strangersHome.expectEventDoesNotSay(membersEvent.title, signedUp);
  await strangersHome.expectEventDoesNotSay(guestsEvent.title, signedUp);

  await cleanUp(alice, team, membersEvent.id, guestsEvent.id);
});
