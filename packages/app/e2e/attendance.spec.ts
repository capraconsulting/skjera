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
