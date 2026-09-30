import { expect, test } from "@playwright/test";
import {
  deletePost,
  deleteTeam,
  newPost,
  newTeam,
  postPath,
  signedIn,
  title,
  uniqueTeamName,
} from "./helpers.ts";

test("posts are created in a team and listed under it", async ({ browser }) => {
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

  // Bob creates a post in Alice's team.
  await bob.goto(`/studio/teams/${red}`);
  const post = await newPost(bob);
  await expect(bob.getByRole("link", { name: redName })).toBeVisible();
  await title(bob).pressSequentially("Red news");
  // The posts column follows the editor.
  await expect(
    bob.getByRole("region", { name: "Posts" }).getByRole("link", {
      name: /Red news/,
    }),
  ).toBeVisible();
  // A link with the wrong team leads to the right one.
  await bob.goto(postPath(blue, post));
  await expect(bob).toHaveURL(new RegExp(`${postPath(red, post)}$`));
  await expect(title(bob)).toHaveText("Red news");

  await alice.goto(`/studio/teams/${red}`);
  await expect(alice.getByRole("link", { name: "Red news" })).toBeVisible();
  // A team with posts can't be deleted.
  await expect(alice.getByRole("button", { name: "Delete team" })).toHaveCount(
    0,
  );
  await alice.goto(`/studio/teams/${blue}`);
  await expect(alice.getByText("No posts yet.")).toBeVisible();

  await bob.goto(postPath(red, post));
  await deletePost(bob, post);
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
