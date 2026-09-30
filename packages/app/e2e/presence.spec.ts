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

test("an event shows who else has it open, with their cursors", async ({
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

  // Alice sees Bob in the event, and Bob sees Alice.
  await expect(avatarsIn(alice, "Editor")).toHaveAccessibleName("bob");
  await expect(avatarsIn(bob, "Editor")).toHaveAccessibleName("alice");

  // Hovering an avatar shows the name.
  const name = avatarsIn(alice, "Editor").getByText("bob");
  await expect(name).toBeHidden();
  await avatarsIn(alice, "Editor").hover();
  await expect(name).toBeVisible();

  // Bob's caret shows up in Alice's title, with his name.
  await typeAt(title(bob), "end", "!");
  await expect(title(alice)).toHaveText(/Hello there!/);
  const bobsCaret = title(alice).locator('[data-name="bob"]');
  await expect(bobsCaret).toBeVisible();

  // It stays while Bob is in another window, as if he alt-tabbed away...
  await title(bob).evaluate((editor) => {
    document.hasFocus = () => false;
    (editor as HTMLElement).blur();
  });
  await bob.waitForTimeout(500);
  await expect(bobsCaret).toBeVisible();

  // ...and goes when he focuses something else on the page.
  await bob.evaluate(() => {
    document.hasFocus = () => true;
  });
  await typeAt(title(bob), "end", "?");
  await expect(bobsCaret).toBeVisible();
  await bob.getByRole("checkbox", { name: /Public event/ }).focus();
  await expect(bobsCaret).toHaveCount(0);

  // When Bob moves on, he's gone from the event.
  await teamLink(bob, teamName).click();
  await expect(avatarsIn(alice, "Editor")).toHaveCount(0);
  await expect(title(alice).locator('[data-name="bob"]')).toHaveCount(0);

  await deleteEvent(alice, id);
  await deleteTeam(alice, team);
});
