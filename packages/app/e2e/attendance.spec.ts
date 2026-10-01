import { expect, type Page, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  eventPath,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

const attendance = (page: Page) =>
  page.getByRole("region", { name: "Attendance" });
const attendees = (page: Page) =>
  page.getByRole("region", { name: "Attendees" });

test("members-only events are hidden from visitors", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Members"));
  const event = await publishedEvent(alice, { public: false });

  const anonymous = await visitor(browser);
  await anonymous.goto("/");
  await expect(anonymous.getByRole("link", { name: event.title })).toHaveCount(
    0,
  );
  await anonymous.goto(`/events/${event.id}`);
  await expect(anonymous.getByText("isn't published")).toBeVisible();

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto("/");
  await bob.getByRole("link", { name: event.title }).click();
  await expect(bob).toHaveURL(new RegExp(`/events/${event.id}$`));
  await expect(
    bob.getByRole("article").getByText("Members only"),
  ).toBeVisible();

  await alice.goto(eventPath(team, event.id));
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("members attend and change their mind", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Attend"));
  const event = await publishedEvent(alice, { public: false });

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(attendance(bob)).toContainText("Nobody has signed up yet.");
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(attendance(bob)).toContainText("1 attending");

  // The organizer sees who is coming.
  await alice.reload();
  await expect(attendees(alice)).toContainText("bob@example.com");

  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(attendance(bob)).toContainText("Nobody has signed up yet.");

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("guests sign up with their name and email", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Guests"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const closed = await publishedEvent(alice, { public: true });

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  // This event doesn't ask about food.
  await expect(
    attendance(guest).getByRole("textbox", { name: "Dietary preferences" }),
  ).toHaveCount(0);
  await attendance(guest)
    .getByRole("textbox", { name: "Your name" })
    .fill("Gina");
  await attendance(guest)
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await attendance(guest).getByRole("button", { name: "Sign up" }).click();
  await expect(attendance(guest)).toContainText("You're signed up.");
  await expect(attendance(guest)).toContainText("1 attending");
  // The browser remembers, so the guest can still cancel later.
  await guest.reload();
  await expect(attendance(guest)).toContainText("You're signed up.");

  // One signup per email.
  const other = await visitor(browser);
  await other.goto(`/events/${event.id}`);
  await attendance(other).getByRole("textbox", { name: "Your name" }).fill("G");
  await attendance(other)
    .getByRole("textbox", { name: "Your email" })
    .fill("GINA@example.org");
  await attendance(other).getByRole("button", { name: "Sign up" }).click();
  await expect(attendance(other).getByRole("alert")).toContainText(
    "already signed up",
  );

  await alice.goto(eventPath(team, event.id));
  await expect(attendees(alice)).toContainText("Gina");
  await expect(attendees(alice)).toContainText("Guest");

  await attendance(guest)
    .getByRole("button", { name: "Cancel my signup" })
    .click();
  await expect(attendance(guest)).toContainText("Nobody has signed up yet.");
  await expect(
    attendance(guest).getByRole("button", { name: "Sign up" }),
  ).toBeVisible();

  // Without guest signups, visitors are asked to log in.
  await guest.goto(`/events/${closed.id}`);
  await expect(
    attendance(guest).getByRole("link", { name: "Log in to attend" }),
  ).toBeVisible();

  await deleteEvent(alice, event.id);
  await alice.goto(eventPath(team, closed.id));
  await deleteEvent(alice, closed.id);
  await deleteTeam(alice, team);
});

test("everyone gives dietary preferences when the event asks", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Dinner"));
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    dietary: true,
  });

  // A member answers before attending.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  const member = attendance(bob);
  const memberDietary = member.getByRole("textbox", {
    name: "Dietary preferences",
  });
  await expect(memberDietary).toHaveAttribute("required");
  await memberDietary.fill("Vegan");
  await member.getByRole("button", { name: "Attend" }).click();
  await expect(member).toContainText("You're attending.");

  // So does a guest.
  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  const dietary = box.getByRole("textbox", { name: "Dietary preferences" });
  await expect(dietary).toHaveAttribute("required");
  await dietary.fill("Vegetarian, no nuts");
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  await alice.reload();
  await expect(attendees(alice)).toContainText("Diet: Vegan");
  await expect(attendees(alice)).toContainText("Diet: Vegetarian, no nuts");

  await box.getByRole("button", { name: "Cancel my signup" }).click();
  await expect(box.getByRole("button", { name: "Sign up" })).toBeVisible();
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

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
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
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
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("signups show up for visitors and organizers without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Live signups"));
  const event = await publishedEvent(alice, { public: true });
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  await expect(attendance(reader)).toContainText("Nobody has signed up yet.");

  // Bob signs up: the visitor's count and Alice's list follow.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(attendance(reader)).toContainText("1 attending");
  await expect(attendees(alice)).toContainText("bob@example.com");
  // The visitor can count, not see who.
  await expect(reader.getByText("bob@example.com")).toHaveCount(0);

  // And he changes his mind.
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(attendance(reader)).toContainText("Nobody has signed up yet.");
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});
