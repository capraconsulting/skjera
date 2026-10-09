import { expect, type Page, test } from "@playwright/test";
import {
  deleteEvent,
  deleteTeam,
  newEvent,
  newTeam,
  pickTimes,
  signedIn,
  title,
  uniqueTeamName,
  visitor,
  writePlace,
} from "./helpers.ts";

const tagInput = (page: Page) => page.getByRole("combobox", { name: "Tags" });
const suggestion = (page: Page, name: string | RegExp) =>
  page.getByRole("option", { name });
const pills = (page: Page) =>
  page.getByRole("list", { name: "Tags on this event" });

/** Publishes the open event, public. */
const publish = async (page: Page) => {
  // Done tagging: the suggestions close.
  await tagInput(page).press("Escape");
  await writePlace(page);
  await page.getByRole("checkbox", { name: /Public event/ }).check();
  await expect(page.getByTestId("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("status")).toContainText("Published");
};

test("events are tagged, and the site groups and filters them", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Tags"));

  // A new tag shows as one to add, with a plus.
  const coming = await newEvent(alice);
  const comingTitle = `Coming ${coming.slice(-12)}`;
  await title(alice).pressSequentially(comingTitle);
  await pickTimes(alice);
  const fresh = `Pottery ${coming.slice(-6)}`;
  await tagInput(alice).fill(fresh);
  await expect(suggestion(alice, `${fresh} (new tag)`)).toBeVisible();
  await tagInput(alice).press("Enter");
  await expect(pills(alice)).toContainText(fresh);
  // Taken off again, so it's not published as a suggestion.
  await alice.getByRole("button", { name: `Remove tag ${fresh}` }).click();
  await expect(pills(alice)).toHaveCount(0);

  await tagInput(alice).fill("Workshop");
  await tagInput(alice).press("Enter");
  await expect(pills(alice)).toContainText("Workshop");
  await publish(alice);

  // A past event, tagged with what the studio now suggests.
  const past = await newEvent(alice);
  const pastTitle = `Was ${past.slice(-12)}`;
  await title(alice).pressSequentially(pastTitle);
  await alice.getByRole("button", { name: "Start date" }).click();
  await alice.getByRole("button", { name: /previous month/i }).click();
  await alice.getByRole("button", { name: /15th, \d{4}/ }).click();
  await tagInput(alice).fill("Social");
  await tagInput(alice).press("Enter");
  // Published tags are suggested: picked from the list, as written there.
  await tagInput(alice).fill("work");
  await expect(suggestion(alice, "work (new tag)")).toBeVisible();
  await suggestion(alice, "Workshop").click();
  await expect(pills(alice).getByRole("listitem")).toHaveText([
    /Social/,
    /Workshop/,
  ]);
  await publish(alice);

  // The site: upcoming first, then past; filters only for active events.
  const reader = await visitor(browser);
  await reader.goto("/");
  const upcoming = reader.getByRole("region", { name: "Upcoming events" });
  const pastEvents = reader.getByRole("region", { name: "Past events" });
  await expect(upcoming.getByRole("link", { name: comingTitle })).toBeVisible();
  await expect(pastEvents.getByRole("link", { name: pastTitle })).toBeVisible();
  const filters = reader.getByRole("navigation", { name: "Filter by tag" });
  await expect(filters.getByRole("button", { name: "Workshop" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Social" })).toHaveCount(0);

  await reader.goto("/?tag=Social");
  await expect(reader.getByRole("link", { name: comingTitle })).toHaveCount(0);
  await expect(reader.getByRole("link", { name: pastTitle })).toBeVisible();

  await filters.getByRole("button", { name: "All" }).click();
  await filters.getByRole("button", { name: "Workshop" }).click();
  await expect(reader).toHaveURL(/\?tag=Workshop$/);
  await expect(
    filters.getByRole("button", { name: "Workshop" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(reader.getByRole("link", { name: comingTitle })).toBeVisible();
  await expect(reader.getByRole("link", { name: pastTitle })).toBeVisible();

  // An event's tags lead back to the filtered list.
  await reader.getByRole("link", { name: pastTitle }).click();
  await reader
    .getByRole("list", { name: "Tags" })
    .getByRole("link", {
      name: "Social",
    })
    .click();
  await expect(reader).toHaveURL(/\?tag=Social$/);

  await deleteEvent(alice, past);
  await alice.goto(`/studio/teams/${team}/events/${coming}`);
  await deleteEvent(alice, coming);
  await deleteTeam(alice, team);
});
