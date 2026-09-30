import { expect, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  openNewTeamDialog,
  openTeamMenu,
  pickDate,
  signedIn,
  teamLink,
  title,
  uniqueTeamName,
} from "./helpers.ts";

test("events are created in a team and listed under it", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");
  const redName = uniqueTeamName("Red");
  const blueName = uniqueTeamName("Blue");
  const red = await newTeam(alice, redName);
  const blue = await newTeam(bob, blueName);

  // Everyone sees every team.
  for (const page of [alice, bob]) {
    await page.goto("/studio/teams");
    await expect(page.getByRole("link", { name: redName })).toBeVisible();
    await expect(page.getByRole("link", { name: blueName })).toBeVisible();
  }

  // Bob creates an event in Alice's team.
  await bob.goto(`/studio/teams/${red}`);
  const event = await newEvent(bob);
  await expect(bob.getByRole("link", { name: redName })).toBeVisible();
  await title(bob).pressSequentially("Red news");
  // The events column follows the editor.
  await expect(
    bob.getByRole("region", { name: "Events" }).getByRole("link", {
      name: /Red news/,
    }),
  ).toBeVisible();
  // A link with the wrong team leads to the right one.
  await bob.goto(eventPath(blue, event));
  await expect(bob).toHaveURL(new RegExp(`${eventPath(red, event)}$`));
  await expect(title(bob)).toHaveText("Red news");

  await alice.goto(`/studio/teams/${red}`);
  await expect(alice.getByRole("link", { name: "Red news" })).toBeVisible();
  // A team with events can't be deleted.
  await openTeamMenu(alice, red);
  await expect(
    alice.getByRole("button", { name: "Delete team" }),
  ).toBeDisabled();
  await expect(
    alice
      .locator(":popover-open")
      .getByText("Only teams without events can be deleted."),
  ).toBeVisible();
  await alice.keyboard.press("Escape");
  await alice.goto(`/studio/teams/${blue}`);
  await expect(alice.getByText("No events yet.")).toBeVisible();

  await bob.goto(eventPath(red, event));
  await deleteEvent(bob, event);
  await deleteTeam(alice, red);
  await deleteTeam(alice, blue);
});

test("team names must be unique", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const name = uniqueTeamName("Unique");
  const team = await newTeam(alice, name);

  await alice.goto("/studio/teams");
  const dialog = await openNewTeamDialog(alice);
  await dialog
    .getByRole("textbox", { name: "Team name" })
    .fill(name.toUpperCase());
  await dialog.getByRole("button", { name: "Create team" }).click();
  // The dialog stays open with the error and the name, for fixing.
  await expect(dialog.getByRole("alert")).toContainText("already a team");
  await expect(dialog.getByRole("textbox", { name: "Team name" })).toHaveValue(
    name.toUpperCase(),
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await deleteTeam(alice, team);
});

test("teams can be renamed", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const taken = await newTeam(alice, uniqueTeamName("Taken"));
  const takenName = (await teamLink(alice, "Taken").textContent()) ?? "";
  const team = await newTeam(alice, uniqueTeamName("Before"));
  const renamed = uniqueTeamName("After");

  const dialog = alice.getByRole("dialog", { name: "Rename team" });
  const rename = async (name: string) => {
    await openTeamMenu(alice, team);
    await alice.getByRole("button", { name: "Rename team…" }).click();
    await dialog.getByRole("textbox", { name: "Team name" }).fill(name);
    await dialog.getByRole("button", { name: "Rename team" }).click();
  };

  await rename(takenName);
  await expect(dialog.getByRole("alert")).toContainText("already a team");
  await alice.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await rename(renamed);
  await expect(dialog).toBeHidden();
  await expect(teamLink(alice, renamed)).toHaveAttribute(
    "aria-current",
    "page",
  );

  await deleteTeam(alice, team);
  await deleteTeam(alice, taken);
});

test("the team list follows others' changes without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");
  await expect(alice.getByRole("region", { name: "Teams" })).toBeVisible();

  // Bob adds a team; it shows up for Alice on her open page.
  const name = uniqueTeamName("Polled");
  const team = await newTeam(bob, name);
  await expect(teamLink(alice, name)).toBeVisible();

  // And disappears once Bob deletes it.
  await deleteTeam(bob, team);
  await expect(teamLink(alice, name)).toHaveCount(0);
});

test("the events column follows others' changes without reloading", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Watched"));
  const events = alice.getByRole("region", { name: "Events" });
  await expect(events.getByText("No events yet.")).toBeVisible();

  // Bob adds and names an event in Alice's team, and she sees it.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/studio/teams/${team}`);
  const event = await newEvent(bob);
  await title(bob).pressSequentially("Added by Bob");
  await expect(
    events.getByRole("link", { name: /Added by Bob/ }),
  ).toBeVisible();

  // And it's gone for her once he deletes it.
  await deleteEvent(bob, event);
  await expect(events.getByText("No events yet.")).toBeVisible();
  await deleteTeam(alice, team);
});

test("publishing shows for others without reloading", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Launches"));
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/studio/teams/${team}`);
  const event = await newEvent(bob);
  await title(bob).pressSequentially("Launch party");
  await pickDate(bob);
  await expect(bob.getByTestId("status")).toContainText("Saved");

  // Alice has it open, unpublished.
  await alice.goto(eventPath(team, event));
  const listed = alice
    .getByRole("region", { name: "Events" })
    .getByRole("link", { name: /Launch party/ });
  await expect(listed).toContainText("Draft");
  await expect(alice.getByTestId("status")).toContainText("Not published");

  // Bob publishes: her footer and the list follow.
  await bob.getByRole("button", { name: "Publish" }).click();
  await expect(bob.getByTestId("status")).toContainText("Published");
  await expect(alice.getByTestId("status")).toContainText("Published");
  await expect(listed).toContainText("Published");

  await deleteEvent(bob, event);
  await deleteTeam(alice, team);
});
