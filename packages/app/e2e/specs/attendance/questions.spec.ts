import { expect, test } from "@playwright/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { Attendance } from "../../pom/site/Attendance.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("events ask their own questions, and say what's served", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Questions"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  // Food, with what's served.
  await editor.checkFoodServed();
  await editor.whatsServed.type("Pizza from Lorem");

  // A written answer, a checkbox that must be ticked, and a choice.
  await editor.questions.add(1, "Where did you hear of it?");
  await editor.questions.add(2, "I accept the risks of swimming", "Checkbox");
  await editor.questions.checkRule(2, "Must be ticked");
  await editor.questions.add(3, "Towel size", "One of several");
  await editor.questions.fillOption(3, 1, "Small");
  await editor.questions.fillOption(3, 2, "Large");
  await editor.questions.checkRule(3, "Required");
  // The order can change.
  await editor.questions.moveUp(3);
  await editor.questions.expect(2, "Towel size");

  await editor.publish();

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  await new EventPage(guest).expectShows("Pizza from Lorem");
  const box = new Attendance(guest);
  await box.fillName("Gina");
  await box.fillEmail("gina@example.org");
  await box.fillDietaryPreferences("None");
  await box.fillAnswer(/Where did you hear of it/, "A poster");
  await box.checkOption("Large");
  await box.expectBoxRequired("I accept the risks of swimming");
  await box.checkBox("I accept the risks of swimming");
  await box.clickSignUp();
  await box.expectSignedUp();

  // Organizers see the answers, in the words asked.
  await editor.attendees.expectAnswer("Towel size", "Large");
  await editor.attendees.expectAnswer("I accept the risks of swimming", "Yes");
  await editor.attendees.expectAnswer("Where did you hear of it?", "A poster");

  await box.cancelSignup();
  await box.expectSignUpButton(true);
  await cleanUp(alice, team, event.id);
});

test("people change their answers; organizers export and remove them", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Changes"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({
    public: true,
    guests: true,
    dietary: true,
  });
  await editor.questions.add(1, "Towel size", "One of several");
  await editor.questions.fillOption(1, 1, "Small");
  await editor.questions.fillOption(1, 2, "Large");
  await editor.publish();

  // A guest signs up, and changes their mind: the form starts from what
  // they told.
  const guest = await visitor(browser);
  const page = new EventPage(guest);
  await page.goto(event.id);
  const box = new Attendance(guest);
  await box.fillName("Gina");
  await box.fillEmail("gina@example.org");
  await box.fillDietaryPreferences("Vegan");
  await box.checkOption("Small");
  await box.clickSignUp();
  await box.expectSignedUp();

  await box.clickChangeAnswers();
  // What they can't eat belongs to no one once given: nothing to change.
  await box.answers.expectNoField("Dietary preferences");
  await box.answers.expectOption("Small", "checked");
  await box.answers.checkOption("Large");
  await box.answers.clickSaveChanges();
  await box.expectSignedUp();

  // So does a member, from their own answers.
  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  const member = new Attendance(bob);
  await member.fillDietaryPreferences("Fish");
  await member.checkOption("Large");
  await member.expectNoGuestContact();
  await member.attend();
  await member.clickChangeAnswers();
  await member.answers.expectNoGuestContact();
  await member.answers.expectOption("Large", "checked");
  await member.answers.checkOption("Small");
  await member.answers.expectNoField("Dietary preferences");
  await member.answers.clickSaveChanges();
  await member.expectAttending();

  await editor.attendees.expectAnswer("Towel size", "Large", "Gina");
  await editor.attendees.expectAnswer("Towel size", "Small", "bob");
  // Neither text is with the people: the attendee list holds no dietary
  // preference.
  await editor.attendees.expectNoText("Vegan");
  await editor.attendees.expectNoText("Fish");

  // A spreadsheet of them, with a column for the question.
  const csv = await editor.attendees.downloadCsv();
  expect(csv.filename).toBe(`${event.title} attendees.csv`);
  expect(csv.lines[0]).toBe(
    "Name,Email,Guest,Signed up,Changed,Phone,Company,Towel size",
  );
  expect(csv.lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,.*,,,Large$/),
    expect.stringMatching(/^bob,bob@example\.com,No,.*,,,Small$/),
  ]);
  expect(csv.lines.join("\n")).not.toMatch(/Vegan|Fish/);

  // Organizers take people off; the guest sees they're no longer signed up.
  await editor.attendees.remove("Gina");
  await editor.attendees.expectNoText("Gina");
  await page.reload();
  await box.expectSignUpButton(true);

  await cleanUp(alice, team, event.id);
});
