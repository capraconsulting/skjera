import { expect, test } from "@playwright/test";
import {
  cleanUp,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import { attendance, attendees } from "./helpers.ts";

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

  await cleanUp(alice, team, event.id);
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
  // Saved: the organizer sees it.
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  await cleanUp(alice, team, event.id);
});
