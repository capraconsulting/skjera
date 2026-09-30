import { expect, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  signedIn,
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
  await expect(alice.getByRole("button", { name: "Delete team" })).toHaveCount(
    0,
  );
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
  await alice
    .getByRole("textbox", { name: "Team name" })
    .fill(name.toUpperCase());
  await alice.getByRole("button", { name: "Create team" }).click();
  await expect(alice.getByRole("alert")).toContainText("already a team");

  await deleteTeam(alice, team);
});
