import { dexUsers } from "@skjera/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { test } from "../../fixtures/test.ts";
import { Header } from "../../pom/Header.ts";
import { LoginPage } from "../../pom/LoginPage.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { HomePage } from "../../pom/site/HomePage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("a guest who came from an ad has it on their signup, after moving between pages and with no cookie choice made (EXT-08 AC-1, EXT-08 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Ad guest"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const guest = await visitor(browser);
  const page = new EventPage(guest);
  await page.gotoLink(
    `/events/${event.id}?utm_source=linkedin&utm_campaign=spring&li_fat_id=abc`,
  );
  await page.clickAllEvents();
  await new HomePage(guest).expectAt();
  await page.goto(event.id);
  await new Attendance(guest).signUpAsGuest("Gina", "gina@example.org");

  await editor.reload();
  await editor.attendees.expectRow(
    "Gina",
    "utm_source: linkedin, utm_campaign: spring, li_fat_id: abc",
  );

  await cleanUp(alice, team, event.id);
});

test("a visitor who came from an ad keeps it through logging in and signing up as a member (EXT-08 AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Ad member"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const bob = await visitor(browser);
  const page = new EventPage(bob);
  await page.gotoLink(`/events/${event.id}?utm_source=linkedin&fbclid=F`);
  await page.expectHeading(event.title);
  await new HomePage(bob).goto();
  await new Header(bob).clickLogIn();
  await new LoginPage(bob).signIn(dexUsers.bob);
  await new Header(bob).expectSignedInAs(dexUsers.bob);
  await page.goto(event.id);
  await new Attendance(bob).attend();

  await editor.reload();
  await editor.attendees.expectRow(
    dexUsers.bob,
    "utm_source: linkedin, fbclid: F",
  );

  await cleanUp(alice, team, event.id);
});
