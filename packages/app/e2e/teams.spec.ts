import { expect, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  openNewTeamDialog,
  openTeamMenu,
  pickTimes,
  pixel,
  signedIn,
  teamLink,
  title,
  typeAt,
  uniqueTeamName,
  writePlace,
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

test("the events column shows the team picked, switching without a reload", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const redName = uniqueTeamName("Red");
  const blueName = uniqueTeamName("Blue");
  const red = await newTeam(alice, redName);
  const event = await newEvent(alice);
  await title(alice).pressSequentially("Red only");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  const blue = await newTeam(alice, blueName);

  const listed = alice
    .getByRole("region", { name: "Events" })
    .getByRole("link", { name: /Red only/ });
  await alice.goto(`/studio/teams/${red}`);
  await expect(listed).toBeVisible();
  // From one team to the other in the team list, in the same page.
  await teamLink(alice, blueName).click();
  await expect(alice).toHaveURL(new RegExp(`/studio/teams/${blue}$`));
  await expect(alice.getByText("No events yet.")).toBeVisible();
  await expect(listed).toHaveCount(0);
  await teamLink(alice, redName).click();
  await expect(listed).toBeVisible();

  await alice.goto(eventPath(red, event));
  await deleteEvent(alice, event);
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
  // The team shown while it was being created is gone again. (Link names
  // match regardless of case.)
  await expect(teamLink(alice, name)).toHaveCount(1);
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
  const before = uniqueTeamName("Before");
  const team = await newTeam(alice, before);
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
  // Refused: the team keeps its name.
  await expect(teamLink(alice, before)).toBeVisible();
  await expect(teamLink(alice, takenName)).toHaveCount(1);
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
  await pickTimes(bob);
  await writePlace(bob);
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

  // Bob edits it again: the list says it has unpublished changes.
  await typeAt(title(bob), "end", "!");
  const edited = alice
    .getByRole("region", { name: "Events" })
    .getByRole("link", { name: /Launch party!/ });
  await expect(edited).toContainText("Changed");

  await deleteEvent(bob, event);
  await deleteTeam(alice, team);
});

test("a team's logos are chosen, replaced and removed in its logo dialog (AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Logos"));
  await openTeamMenu(alice, team);
  await alice.getByRole("button", { name: "Logo…" }).click();
  const dialog = alice.getByRole("dialog", { name: "Team logo" });
  const light = dialog.getByRole("group", { name: "Light theme" });
  const dark = dialog.getByRole("group", { name: "Dark theme" });
  const logoIn = (field: typeof light, theme: "light" | "dark") =>
    field.getByRole("img", { name: `Logo for the ${theme} theme` });
  const choose = (field: typeof light, theme: "light" | "dark") =>
    field.getByLabel(`Logo file for the ${theme} theme`).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: pixel,
    });

  await expect(logoIn(light, "light")).toHaveCount(0);
  await choose(light, "light");
  await expect(logoIn(light, "light")).toBeVisible();
  await choose(dark, "dark");
  await expect(logoIn(dark, "dark")).toBeVisible();

  // Replaced: another upload, with its own address.
  const first = await logoIn(light, "light").getAttribute("src");
  await light.getByRole("button", { name: "Replace image" }).click();
  await choose(light, "light");
  await expect(logoIn(light, "light")).not.toHaveAttribute("src", first ?? "");
  const replaced = await logoIn(light, "light").getAttribute("src");

  await dark.getByRole("button", { name: "Remove image" }).click();
  await expect(logoIn(dark, "dark")).toHaveCount(0);
  await expect(logoIn(light, "light")).toHaveAttribute("src", replaced ?? "");

  // After a reload the team has the replaced light logo and no dark one.
  await alice.reload();
  await openTeamMenu(alice, team);
  await alice.getByRole("button", { name: "Logo…" }).click();
  await expect(logoIn(light, "light")).toHaveAttribute("src", replaced ?? "");
  await expect(logoIn(dark, "dark")).toHaveCount(0);
  await alice.keyboard.press("Escape");

  await deleteTeam(alice, team);
});
