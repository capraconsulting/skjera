import { expect, test } from "@playwright/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("dietary preferences are optional, and organizers see them without names", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Dinner"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    dietary: true,
  });

  // A member attends without answering, and has no answers to change.
  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.expectFieldOptional("Dietary preferences");
  await member.attend();
  await member.expectNoChangeAnswers();

  // A guest signs up without answering, too.
  const signUpAsGuest = async (name: string, dietary?: string) => {
    const page = await visitor(browser);
    await new EventPage(page).goto(event.id);
    const box = new Attendance(page);
    await box.fillName(name);
    await box.fillEmail(`${name.toLowerCase()}@example.org`);
    await box.expectFieldOptional("Dietary preferences");
    if (dietary !== undefined) await box.fillDietaryPreferences(dietary);
    await box.clickSignUp();
    await box.expectSignedUp();
    return box;
  };
  await signUpAsGuest("Hana");
  const gina = await signUpAsGuest("Gina", "Fish");
  await signUpAsGuest("Ivar", "Vegan");

  // The organizer sees the two texts and how many, and no names with them.
  await editor.reload();
  await editor.attendees.expectDietaryPreferences(["Fish", "Vegan"]);
  for (const name of ["bob", "Hana", "Gina", "Ivar"]) {
    await editor.attendees.expectDietaryPreferencesWithout(name);
  }

  // Nothing ties them to anyone, so cancelling, or being taken off, leaves
  // them with the event.
  await gina.cancelSignup();
  await gina.expectSignUpButton(true);
  await member.cancelAttendance();
  await editor.attendees.remove("Ivar");
  await editor.attendees.expectNoText("Ivar");
  await editor.reload();
  await editor.attendees.expectDietaryPreferences(["Fish", "Vegan"]);

  // Only signed-in users can read the list.
  const stranger = await visitor(browser);
  expect(await new EventPage(stranger).dietaryPreferencesStatus(event.id)).toBe(
    401,
  );

  await cleanUp(alice, team, event.id);
});

test("the food deadline is set and cleared in the studio, and the event page says by when (AC-8, AC-9)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Food"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    dietary: true,
  });
  const reader = await visitor(browser);
  const page = new EventPage(reader);
  const attendance = new Attendance(reader);
  const byWhen = "Dietary preferences by";

  // The event starts on the 15th of next month: the 14th is before that.
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth() + 1, 14);
  const shown = day.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // No food deadline: the page says nothing about by when.
  await page.goto(event.id);
  await attendance.expectText(/Sign-up closes/);
  await attendance.expectNoText(byWhen);

  // Set, it shows under the sign-up's own deadline.
  await editor.times.pickFoodDeadline(day, "next");
  await editor.times.expectFoodDeadline(shown, "12:00");
  await editor.publish();
  await page.reload();
  await attendance.expectText(new RegExp(`${byWhen} ${shown}.*12:00\\s*PM`));
  await attendance.expectDietaryDeadline(false);

  // Cleared, the field is empty and the page says nothing again.
  await editor.times.clearFoodDeadline();
  await editor.times.expectNoFoodDeadline();
  await editor.publish();
  await page.reload();
  await attendance.expectText(/Sign-up closes/);
  await attendance.expectNoText(byWhen);

  // One that has passed is still shown, marked as passed (AC-4).
  await editor.times.setPassedFoodDeadline("previous");
  await editor.publish();
  await page.reload();
  await attendance.expectDietaryDeadline(true);

  // Food not served: no one is asked, whatever the deadline.
  await editor.times.pickFoodDeadline(day, "next");
  await editor.uncheckFoodServed();
  await editor.publish();
  await page.reload();
  await attendance.expectText(/Sign-up closes/);
  await attendance.expectNoText(byWhen);

  await cleanUp(alice, team, event.id);
});

test("the food deadline is still shown, marked as passed, once sign-up has closed (AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Closed"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    dietary: true,
  });

  await editor.times.setPassedFoodDeadline("previous");
  await editor.times.setPassedDeadline();
  await editor.publish();

  const reader = await visitor(browser);
  await new EventPage(reader).goto(event.id);
  const attendance = new Attendance(reader);
  await attendance.expectText("Sign-up has closed.");
  await attendance.expectDietaryDeadline(true);

  await cleanUp(alice, team, event.id);
});
