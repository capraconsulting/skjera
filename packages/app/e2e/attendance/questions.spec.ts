import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  cleanUp,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import {
  attendance,
  attendees,
  expectNoGuestContact,
  fillGuest,
} from "./helpers.ts";

test("events ask their own questions, and say what's served", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Questions"));
  const event = await publishedEvent(alice, { public: true, guests: true });

  // Food, with what's served.
  await alice.getByRole("checkbox", { name: /Food is served/ }).check();
  await alice
    .getByRole("textbox", { name: "What's served" })
    .pressSequentially("Pizza from Lorem");

  // A written answer, a checkbox that must be ticked, and a choice.
  const addQuestion = alice.getByRole("button", { name: "Add question" });
  await addQuestion.click();
  await alice
    .getByRole("textbox", { name: "Question 1", exact: true })
    .fill("Where did you hear of it?");
  await addQuestion.click();
  await alice
    .getByRole("combobox", { name: "Question 2 type" })
    .selectOption("Checkbox");
  await alice
    .getByRole("textbox", { name: "Question 2", exact: true })
    .fill("I accept the risks of swimming");
  await alice
    .getByRole("listitem")
    .filter({ has: alice.getByRole("combobox", { name: "Question 2 type" }) })
    .getByRole("checkbox", { name: "Must be ticked" })
    .check();
  await addQuestion.click();
  await alice
    .getByRole("combobox", { name: "Question 3 type" })
    .selectOption("One of several");
  await alice
    .getByRole("textbox", { name: "Question 3", exact: true })
    .fill("Towel size");
  await alice
    .getByRole("textbox", { name: "Question 3 option 1" })
    .fill("Small");
  await alice
    .getByRole("textbox", { name: "Question 3 option 2" })
    .fill("Large");
  await alice
    .getByRole("listitem")
    .filter({ has: alice.getByRole("combobox", { name: "Question 3 type" }) })
    .getByRole("checkbox", { name: "Required" })
    .check();
  // The order can change.
  await alice.getByRole("button", { name: "Move question 3 up" }).click();
  await expect(
    alice.getByRole("textbox", { name: "Question 2", exact: true }),
  ).toHaveValue("Towel size");

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await expect(guest.getByText("Pizza from Lorem")).toBeVisible();
  const box = attendance(guest);
  await fillGuest(box, "Gina", "gina@example.org");
  await box.getByRole("textbox", { name: "Dietary preferences" }).fill("None");
  await box
    .getByRole("textbox", { name: /Where did you hear of it/ })
    .fill("A poster");
  await box.getByRole("radio", { name: "Large" }).check();
  const risks = box.getByRole("checkbox", {
    name: "I accept the risks of swimming",
  });
  await expect(risks).toHaveAttribute("required");
  await risks.check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  // Organizers see the answers, in the words asked.
  const answer = (question: string) =>
    attendees(alice)
      .getByRole("term")
      .filter({ hasText: question })
      .locator("+ dd");
  await expect(answer("Towel size")).toHaveText("Large");
  await expect(answer("I accept the risks of swimming")).toHaveText("Yes");
  await expect(answer("Where did you hear of it?")).toHaveText("A poster");

  await box.getByRole("button", { name: "Cancel my signup" }).click();
  await expect(box.getByRole("button", { name: "Sign up" })).toBeVisible();
  await cleanUp(alice, team, event.id);
});

test("people change their answers; organizers export and remove them (AC-5, AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Changes"));
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    dietary: true,
  });
  await alice.getByRole("button", { name: "Add question" }).click();
  await alice
    .getByRole("combobox", { name: "Question 1 type" })
    .selectOption("One of several");
  await alice
    .getByRole("textbox", { name: "Question 1", exact: true })
    .fill("Towel size");
  await alice
    .getByRole("textbox", { name: "Question 1 option 1" })
    .fill("Small");
  await alice
    .getByRole("textbox", { name: "Question 1 option 2" })
    .fill("Large");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  // A guest signs up, and changes their mind: the form starts from what
  // they told.
  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await fillGuest(box, "Gina", "gina@example.org");
  await box.getByRole("textbox", { name: "Dietary preferences" }).fill("Vegan");
  await box.getByRole("radio", { name: "Small" }).check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  await box.getByRole("button", { name: "Change answers" }).click();
  const form = box.getByRole("form", { name: "Your answers" });
  // What they can't eat belongs to no one once given: nothing to change.
  await expect(
    form.getByRole("textbox", { name: "Dietary preferences" }),
  ).toHaveCount(0);
  await expect(form.getByRole("radio", { name: "Small" })).toBeChecked();
  await form.getByRole("radio", { name: "Large" }).check();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(box).toContainText("You're signed up.");

  // So does a member, from their own answers.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  const member = attendance(bob);
  await member
    .getByRole("textbox", { name: "Dietary preferences" })
    .fill("Fish");
  await member.getByRole("radio", { name: "Large" }).check();
  await expectNoGuestContact(member);
  await member.getByRole("button", { name: "Attend" }).click();
  await expect(member).toContainText("You're attending.");
  await member.getByRole("button", { name: "Change answers" }).click();
  const memberForm = member.getByRole("form", { name: "Your answers" });
  await expectNoGuestContact(memberForm);
  await expect(memberForm.getByRole("radio", { name: "Large" })).toBeChecked();
  await memberForm.getByRole("radio", { name: "Small" }).check();
  await expect(
    memberForm.getByRole("textbox", { name: "Dietary preferences" }),
  ).toHaveCount(0);
  await memberForm.getByRole("button", { name: "Save changes" }).click();
  await expect(member).toContainText("You're attending.");

  const answer = (name: string) =>
    attendees(alice)
      .getByRole("listitem")
      .filter({ hasText: name })
      .getByRole("term")
      .filter({ hasText: "Towel size" })
      .locator("+ dd");
  await expect(answer("Gina")).toHaveText("Large");
  await expect(answer("bob")).toHaveText("Small");
  // Neither text is with the people: the attendee list holds no dietary
  // preference.
  await expect(attendees(alice)).not.toContainText("Vegan");
  await expect(attendees(alice)).not.toContainText("Fish");

  // A spreadsheet of them, with a column for the question.
  const downloading = alice.waitForEvent("download");
  await attendees(alice).getByRole("button", { name: "Download CSV" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe(`${event.title} attendees.csv`);
  const lines = (await readFile((await file.path()) ?? "", "utf8"))
    .trim()
    .split(/\r?\n/);
  expect(lines[0]).toBe(
    "Name,Email,Guest,Signed up,Changed,Phone,Company,Towel size",
  );
  expect(lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,.*,,,Large$/),
    expect.stringMatching(/^bob,bob@example\.com,No,.*,,,Small$/),
  ]);
  expect(lines.join("\n")).not.toMatch(/Vegan|Fish/);

  // Organizers take people off; the guest sees they're no longer signed up.
  alice.once("dialog", (dialog) => dialog.accept());
  await attendees(alice).getByRole("button", { name: "Remove Gina" }).click();
  await expect(attendees(alice)).not.toContainText("Gina");
  await guest.reload();
  await expect(box.getByRole("button", { name: "Sign up" })).toBeVisible();

  await cleanUp(alice, team, event.id);
});
