import { expect, test } from "@playwright/test";
import {
  cleanUp,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import { attendance, fillGuest } from "./helpers.ts";

test("dietary preferences are optional, and organizers see them without names (AC-1, AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Dinner"));
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    dietary: true,
  });

  // A member attends without answering, and has no answers to change.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  const member = attendance(bob);
  const memberDietary = member.getByRole("textbox", {
    name: "Dietary preferences",
  });
  await expect(memberDietary).not.toHaveAttribute("required");
  await member.getByRole("button", { name: "Attend" }).click();
  await expect(member).toContainText("You're attending.");
  await expect(
    member.getByRole("button", { name: "Change answers" }),
  ).toHaveCount(0);

  // A guest signs up without answering, too.
  const signUpAsGuest = async (name: string, dietary?: string) => {
    const page = await visitor(browser);
    await page.goto(`/events/${event.id}`);
    const box = attendance(page);
    await fillGuest(box, name, `${name.toLowerCase()}@example.org`);
    const field = box.getByRole("textbox", { name: "Dietary preferences" });
    await expect(field).not.toHaveAttribute("required");
    if (dietary !== undefined) await field.fill(dietary);
    await box.getByRole("button", { name: "Sign up" }).click();
    await expect(box).toContainText("You're signed up.");
    return page;
  };
  await signUpAsGuest("Hana");
  await signUpAsGuest("Gina", "Fish");
  await signUpAsGuest("Ivar", "Vegan");

  // The organizer sees the two texts and how many, and no names with them.
  await alice.reload();
  const given = alice.getByRole("region", { name: "Dietary preferences" });
  await expect(
    given.getByRole("heading", { name: "Dietary preferences (2)" }),
  ).toBeVisible();
  await expect(given.getByRole("listitem")).toHaveText(["Fish", "Vegan"]);
  for (const name of ["bob", "Hana", "Gina", "Ivar"]) {
    await expect(given).not.toContainText(name);
  }

  // Only signed-in users can read the list.
  const stranger = await visitor(browser);
  const refused = await stranger.request.get(
    `/api/events/${event.id}/dietary-preferences`,
  );
  expect(refused.status()).toBe(401);

  await cleanUp(alice, team, event.id);
});
