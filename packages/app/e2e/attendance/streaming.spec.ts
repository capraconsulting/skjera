import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  cleanUp,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import { attendance, attendees, fillGuest } from "./helpers.ts";

test("a streamed event shows its link, asks in person or online, and lists how each comes (AC-1, AC-2, AC-3, AC-4, AC-5)", async ({
  browser,
}) => {
  const link = "https://stream.example/meetup";
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Streamed"));
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    streamed: { link },
  });

  // What the organizer wrote is saved with the event.
  await alice.reload();
  await expect(
    alice.getByRole("checkbox", { name: /The event is streamed/ }),
  ).toBeChecked();
  await expect(
    alice.getByRole("textbox", { name: "Link to the stream" }),
  ).toHaveText(link);

  // Anyone who sees the page gets the link.
  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await expect(
    guest.getByRole("article").getByRole("link", { name: link }),
  ).toHaveAttribute("href", link);

  // The form asks, with neither picked, and is not sent until one is.
  const box = attendance(guest);
  await fillGuest(box, "Gina", "gina@example.org");
  const inPerson = box.getByRole("radio", { name: "In person" });
  const online = box.getByRole("radio", { name: "Online" });
  await expect(inPerson).not.toBeChecked();
  await expect(online).not.toBeChecked();
  await box.getByRole("button", { name: "Sign up" }).click();
  expect(
    await inPerson.evaluate(
      (radio) => (radio as HTMLInputElement).validity.valueMissing,
    ),
  ).toBe(true);
  await expect(box).not.toContainText("You're signed up.");
  await inPerson.check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  // So does a member's.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(
    attendance(bob).getByRole("radio", { name: "Online" }),
  ).not.toBeChecked();
  await attendance(bob).getByRole("radio", { name: "In person" }).check();
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");

  // The guest changes to online: the form starts from what they chose.
  await box.getByRole("button", { name: "Change answers" }).click();
  const form = box.getByRole("form", { name: "Your answers" });
  await expect(form.getByRole("radio", { name: "In person" })).toBeChecked();
  await form.getByRole("radio", { name: "Online" }).check();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(box).toContainText("You're signed up.");

  const row = (name: string) =>
    attendees(alice).getByRole("listitem").filter({ hasText: name });
  await expect(row("Gina")).toContainText("Online");
  await expect(row("bob")).toContainText("In person");

  const downloading = alice.waitForEvent("download");
  await attendees(alice).getByRole("button", { name: "Download CSV" }).click();
  const lines = (
    await readFile((await (await downloading).path()) ?? "", "utf8")
  )
    .trim()
    .split(/\r?\n/);
  expect(lines[0]).toBe(
    "Name,Email,Guest,Attending,Signed up,Changed,Phone,Company",
  );
  expect(lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,Online,/),
    expect.stringMatching(/^bob,bob@example\.com,No,In person,/),
  ]);

  await cleanUp(alice, team, event.id);
});

test("a full streamed event takes no more in person but still takes those online (AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Streamed full"));
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    maxAttendees: 1,
    streamed: {},
  });

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await attendance(bob).getByRole("radio", { name: "In person" }).check();
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");

  // The one place in person is taken: the page says so, and online is open.
  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await expect(box).toContainText("no more places in person");
  await expect(box.getByRole("radio", { name: "In person" })).toBeDisabled();
  await fillGuest(box, "Gina", "gina@example.org");
  await box.getByRole("radio", { name: "Online" }).check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  await cleanUp(alice, team, event.id);
});
