import { expect, test } from "@playwright/test";
import {
  body,
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  pickDate,
  signedIn,
  title,
  typeAt,
  uniqueTeamName,
} from "./helpers.ts";

test("two users edit an event live, publish it and delete it", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const bob = await signedIn(browser, "bob@example.com");

  const team = await newTeam(alice, uniqueTeamName("Collaboration"));
  const id = await newEvent(alice);
  await bob.goto(alice.url());

  await title(alice).pressSequentially("Hello from Alice");
  await expect(title(bob)).toHaveText("Hello from Alice");

  await body(bob).pressSequentially("Bob writes");
  await expect(body(alice)).toHaveText("Bob writes");

  // Both type into the body at the same time.
  await Promise.all([
    typeAt(body(alice), "end", " and Alice adds"),
    typeAt(body(bob), "start", "First, "),
  ]);
  await expect(body(alice)).toHaveText("First, Bob writes and Alice adds");
  await expect(body(bob)).toHaveText("First, Bob writes and Alice adds");

  // Alice picks the date; Bob sees it too.
  const date = await pickDate(alice);
  await expect(
    bob.getByRole("button", { name: "Date", exact: true }),
  ).toHaveText(date);

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  await bob.goto(`/studio/teams/${team}`);
  const item = bob
    .getByRole("listitem")
    .filter({ has: bob.locator(`a[href="${eventPath(team, id)}"]`) });
  await expect(item).toContainText("Hello from Alice");
  await expect(item).toContainText("Published");

  // Bob has the event open when Alice deletes it.
  await bob.goto(eventPath(team, id));
  await expect(title(bob)).toHaveText("Hello from Alice");
  await deleteEvent(alice, id);
  await expect(bob.getByRole("alert")).toContainText("This event was deleted");
  await deleteTeam(alice, team);
});

test("publishing needs a title and a date", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Untitled"));
  const id = await newEvent(alice);
  await body(alice).pressSequentially("No title here");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByRole("alert")).toHaveText(
    "Add a title and a date before publishing",
  );

  await title(alice).pressSequentially("Titled");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByRole("alert")).toHaveText(
    "Add a date before publishing",
  );
  await expect(alice.getByTestId("status")).toContainText("Not published");

  await deleteEvent(alice, id);
  await deleteTeam(alice, team);
});
