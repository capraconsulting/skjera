import { expect, test } from "@playwright/test";
import {
  cleanUp,
  eventPath,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import { attendance, signUpAsGuest } from "./helpers.ts";

test("a limit shows the places left, and a full event takes no more (AC-1, AC-7, AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Limit"));
  const unlimited = await publishedEvent(alice, { public: true });
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    maxAttendees: 2,
  });

  // Without a limit, the page says nothing about places.
  const stranger = await visitor(browser);
  await stranger.goto(`/events/${unlimited.id}`);
  await expect(attendance(stranger)).toContainText("Nobody has signed up yet.");
  await expect(attendance(stranger)).not.toContainText("place");

  // A member and a guest take the two places.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(attendance(bob)).toContainText("2 places left");
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(attendance(bob)).toContainText("1 place left");

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await signUpAsGuest(attendance(guest), "Gina", "gina@example.org");

  // Others are told there are no more places, instead of the form.
  const other = await visitor(browser);
  await other.goto(`/events/${event.id}`);
  await expect(attendance(other)).toContainText("There are no more places.");
  await expect(
    attendance(other).getByRole("button", { name: "Sign up" }),
  ).toHaveCount(0);
  await expect(
    attendance(other).getByRole("link", { name: /Signed up\? Log in/ }),
  ).toBeVisible();
  await alice.goto(`/events/${event.id}`);
  await expect(attendance(alice)).toContainText("There are no more places.");
  await expect(
    attendance(alice).getByRole("button", { name: "Attend" }),
  ).toHaveCount(0);

  // Those signed up are still let in, and cancelling frees the place.
  await expect(attendance(bob)).toContainText("You're attending.");
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await other.reload();
  await expect(
    attendance(other).getByRole("button", { name: "Sign up" }),
  ).toBeVisible();
  await expect(attendance(other)).toContainText("1 place left");

  // Hidden, the page no longer says how many places are left.
  await alice.goto(eventPath(team, event.id));
  await alice
    .getByRole("checkbox", { name: /Hide how many places are left/ })
    .check();
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await other.reload();
  await expect(
    attendance(other).getByRole("button", { name: "Sign up" }),
  ).toBeVisible();
  await expect(attendance(other)).not.toContainText("place left");

  await cleanUp(alice, team, event.id, unlimited.id);
});
