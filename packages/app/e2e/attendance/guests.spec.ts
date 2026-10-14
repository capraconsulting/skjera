import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  cleanUp,
  emailTo,
  eventPath,
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import { attendance, attendees, fillGuest, signUpAsGuest } from "./helpers.ts";

test("guests sign up with their name and email", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Guests"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const closed = await publishedEvent(alice, { public: true });

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  // This event doesn't ask about food.
  await expect(
    attendance(guest).getByRole("textbox", { name: "Dietary preferences" }),
  ).toHaveCount(0);
  await signUpAsGuest(attendance(guest), "Gina", "gina@example.org");
  await expect(attendance(guest)).toContainText("1 attending");
  // The browser remembers, so the guest can still cancel later.
  await guest.reload();
  await expect(attendance(guest)).toContainText("You're signed up.");

  // One signup per email.
  const other = await visitor(browser);
  await other.goto(`/events/${event.id}`);
  await fillGuest(attendance(other), "G", "GINA@example.org");
  await attendance(other).getByRole("button", { name: "Sign up" }).click();
  await expect(attendance(other).getByRole("alert")).toContainText(
    "already signed up",
  );

  await alice.goto(eventPath(team, event.id));
  await expect(attendees(alice)).toContainText("Gina");
  await expect(attendees(alice)).toContainText("Guest");

  await attendance(guest)
    .getByRole("button", { name: "Cancel my signup" })
    .click();
  await expect(attendance(guest)).toContainText("Nobody has signed up yet.");
  await expect(
    attendance(guest).getByRole("button", { name: "Sign up" }),
  ).toBeVisible();

  // Without guest signups, visitors are asked to log in.
  await guest.goto(`/events/${closed.id}`);
  await expect(
    attendance(guest).getByRole("link", { name: "Log in to attend" }),
  ).toBeVisible();

  await cleanUp(alice, team, event.id, closed.id);
});

test("guests give a phone number and a company, and organizers see and export them (AC-1, AC-3, AC-4)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Contact"));
  const event = await publishedEvent(alice, { public: true, guests: true });

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await expect(
    box.getByRole("textbox", { name: "Your phone number" }),
  ).toBeVisible();
  await expect(
    box.getByRole("textbox", { name: "Your company" }),
  ).toBeVisible();
  // The names HubSpot recognises, as Skjer's form has them.
  for (const [label, name] of [
    ["Your name", "firstname"],
    ["Your email", "email"],
    ["Your phone number", "telephone"],
    ["Your company", "company"],
  ] as const) {
    await expect(box.getByRole("textbox", { name: label })).toHaveAttribute(
      "name",
      name,
    );
  }
  await fillGuest(box, "Gina", "gina@example.org");
  await box
    .getByRole("textbox", { name: "Your phone number" })
    .fill("900 00 000");
  await box.getByRole("textbox", { name: "Your company" }).fill("Acme");
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");

  // The event asks nothing else, and the guest can still change these two.
  await box.getByRole("button", { name: "Change answers" }).click();
  const form = box.getByRole("form", { name: "Your answers" });
  await expect(
    form.getByRole("textbox", { name: "Your phone number" }),
  ).toHaveValue("900 00 000");
  await expect(form.getByRole("textbox", { name: "Your company" })).toHaveValue(
    "Acme",
  );
  await expect(
    form.getByRole("textbox", { name: "Your phone number" }),
  ).toHaveAttribute("name", "telephone");
  await form
    .getByRole("textbox", { name: "Your phone number" })
    .fill("911 11 111");
  await form.getByRole("textbox", { name: "Your company" }).fill("Initech");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(box).toContainText("You're signed up.");

  await alice.reload();
  const row = attendees(alice)
    .getByRole("listitem")
    .filter({ hasText: "Gina" });
  await expect(row).toContainText("911 11 111");
  await expect(row).toContainText("Initech");

  const downloading = alice.waitForEvent("download");
  await attendees(alice).getByRole("button", { name: "Download CSV" }).click();
  const lines = (
    await readFile((await (await downloading).path()) ?? "", "utf8")
  )
    .trim()
    .split(/\r?\n/);
  expect(lines[0]).toBe("Name,Email,Guest,Signed up,Changed,Phone,Company");
  expect(lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,.*,911 11 111,Initech$/),
    expect.stringMatching(/^bob,bob@example\.com,No,.*,,$/),
  ]);

  await cleanUp(alice, team, event.id);
});

test("a guest's email brings their signup to another browser", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Links"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const first = await visitor(browser);
  await first.goto(`/events/${event.id}`);
  await signUpAsGuest(attendance(first), "Gina", address);

  // The email, with an invitation for their calendar and their own link.
  const signedUp = await emailTo(address, `You're signed up: ${event.title}`);
  expect(signedUp.raw).toMatch(/Content-Type: text\/calendar;.*method=REQUEST/);
  const link = signedUp.text.match(
    new RegExp(`http\\S*/events/${event.id}\\?guest=\\S+`),
  )?.[0];
  expect(link).toBeDefined();

  const second = await visitor(browser);
  await second.goto(link ?? "");
  // Remembered, and out of the address.
  await expect(second).toHaveURL(new RegExp(`/events/${event.id}$`));
  const there = attendance(second);
  await expect(there).toContainText("You're signed up.");
  await there.getByRole("button", { name: "Cancel my signup" }).click();
  await expect(there.getByRole("button", { name: "Sign up" })).toBeVisible();
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");
  const cancelled = await emailTo(address, `Signup cancelled: ${event.title}`);
  expect(cancelled.raw).toMatch(/Content-Type: text\/calendar;.*method=CANCEL/);

  await cleanUp(alice, team, event.id);
});
