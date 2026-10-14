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
  guests,
  members,
  pulled,
  signUpAsGuest,
  whoIsComing,
} from "./helpers.ts";

test("signups show up for visitors and organizers without reloading (AC-4, AC-5)", async ({
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
  await expect(whoIsComing(reader)).toHaveCount(0);
  await expect(reader.locator("body")).not.toContainText(/\bbob\b/i);

  // Nor does the API tell: every row a pull without a session returns has no
  // details, page by page.
  const bodies: string[] = [];
  let since: string | undefined;
  for (let more = true; more; ) {
    const response = await reader.request.get("/api/sync/attendees", {
      params: since === undefined ? {} : { since },
    });
    expect(response.ok()).toBe(true);
    bodies.push(await response.text());
    const pull = JSON.parse(bodies.at(-1) ?? "{}") as {
      rows: { details: unknown }[];
      more: boolean;
      token: string;
    };
    for (const row of pull.rows) expect(row.details).toBeNull();
    ({ more, token: since } = pull);
  }
  expect(bodies.join("")).not.toContain("bob@example.com");

  // And he changes his mind.
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(attendance(reader)).toContainText("Nobody has signed up yet.");
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  await cleanUp(alice, team, event.id);
});

test("members see who's coming, members and guests apart, without reloading (AC-1, AC-2, AC-3, AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Who is coming"));
  const event = await publishedEvent(alice, { public: true, guests: true });

  // Nobody yet: each kind says so.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(members(bob)).toContainText("Members (0)");
  await expect(members(bob)).toContainText("No members have signed up yet.");
  await expect(guests(bob)).toContainText("Guests (0)");
  await expect(guests(bob)).toContainText("No guests have signed up yet.");

  // A guest signs up: Bob sees her among the guests, not the members.
  const gina = await visitor(browser);
  await gina.goto(`/events/${event.id}`);
  const form = attendance(gina);
  await signUpAsGuest(form, "Gina", "gina@example.org");
  await expect(guests(bob)).toContainText("Guests (1)", pulled);
  await expect(guests(bob)).toContainText("Gina");
  await expect(members(bob)).toContainText("Members (0)");
  await expect(members(bob)).not.toContainText("Gina");

  // A member attends: Alice, with the page open, sees him among the members.
  await alice.goto(`/events/${event.id}`);
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(members(alice)).toContainText("Members (1)", pulled);
  await expect(members(alice)).toContainText("bob");

  // They change their minds.
  await form.getByRole("button", { name: "Cancel my signup" }).click();
  await expect(guests(bob)).toContainText(
    "No guests have signed up yet.",
    pulled,
  );
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(members(alice)).toContainText(
    "No members have signed up yet.",
    pulled,
  );

  await cleanUp(alice, team, event.id);
});

test("an event not open to guests lists only members (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Members list"));
  const event = await publishedEvent(alice, { public: true });

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(members(bob)).toBeVisible();
  await expect(guests(bob)).toHaveCount(0);

  await cleanUp(alice, team, event.id);
});
