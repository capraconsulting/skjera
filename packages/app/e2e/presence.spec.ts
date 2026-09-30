import { expect, type Page, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  signedIn,
  teamLink,
  title,
  typeAt,
  uniqueTeamName,
} from "./helpers.ts";

const avatarsIn = (page: Page, column: string) =>
  page.getByRole("region", { name: column }).getByTestId("avatar");

test("the studio shows who is where, with their cursors", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teamName = uniqueTeamName("Presence");
  const team = await newTeam(alice, teamName);
  const id = await newEvent(alice);
  await title(alice).pressSequentially("Hello there");

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(eventPath(team, id));
  await expect(title(bob)).toHaveText("Hello there");

  // Alice sees Bob in the event, on it in the list, and in the team.
  await expect(avatarsIn(alice, "Editor")).toHaveAttribute("title", "bob");
  await expect(avatarsIn(alice, "Events")).toHaveAttribute("title", "bob");
  await expect(teamLink(alice, teamName).getByTestId("avatar")).toHaveAttribute(
    "title",
    "bob",
  );
  // And Bob sees Alice.
  await expect(avatarsIn(bob, "Editor")).toHaveAttribute("title", "alice");

  // Bob's caret shows up in Alice's title, with his name.
  await typeAt(title(bob), "end", "!");
  await expect(title(alice)).toHaveText(/Hello there!/);
  await expect(title(alice).locator('[data-name="bob"]')).toBeVisible();

  // When Bob moves on, he leaves the event but stays in the team.
  await teamLink(bob, teamName).click();
  await expect(avatarsIn(alice, "Editor")).toHaveCount(0);
  await expect(title(alice).locator('[data-name="bob"]')).toHaveCount(0);
  await expect(teamLink(alice, teamName).getByTestId("avatar")).toHaveAttribute(
    "title",
    "bob",
  );

  await deleteEvent(alice, id);
  await deleteTeam(alice, team);
});
