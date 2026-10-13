import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  deleteEmailsTo,
  deleteEvent,
  deleteTeam,
  emailTo,
  eventPath,
  newTeam,
  place,
  publishedEvent,
  signedIn,
  typeAt,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

const attendance = (page: Page) =>
  page.getByRole("region", { name: "Attendance" });
const attendees = (page: Page) =>
  page.getByRole("region", { name: "Attendees" });
const whoIsComing = (page: Page) =>
  page.getByRole("region", { name: "Who's coming" });
const members = (page: Page) =>
  whoIsComing(page).getByRole("region", { name: /^Members/ });
const guests = (page: Page) =>
  whoIsComing(page).getByRole("region", { name: /^Guests/ });
/** Another browser's change comes with a pull: a few pulls' time, when busy. */
const pulled = { timeout: 20_000 };

/** Members aren't asked for a phone number or a company. */
const expectNoGuestContact = async (within: Locator) => {
  await expect(
    within.getByRole("textbox", { name: "Your phone number" }),
  ).toHaveCount(0);
  await expect(
    within.getByRole("textbox", { name: "Your company" }),
  ).toHaveCount(0);
};

test("members-only events are hidden from visitors", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Members"));
  const event = await publishedEvent(alice, { public: false });

  const anonymous = await visitor(browser);
  await anonymous.goto("/");
  await expect(anonymous.getByRole("link", { name: event.title })).toHaveCount(
    0,
  );
  await anonymous.goto(`/events/${event.id}`);
  await expect(anonymous.getByText("isn't published")).toBeVisible();

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto("/");
  await bob.getByRole("link", { name: event.title }).click();
  await expect(bob).toHaveURL(new RegExp(`/events/${event.id}$`));
  await expect(
    bob.getByRole("article").getByText("Members only"),
  ).toBeVisible();

  await alice.goto(eventPath(team, event.id));
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("members attend and change their mind", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Attend"));
  const event = await publishedEvent(alice, { public: false });

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(attendance(bob)).toContainText("Nobody has signed up yet.");
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(attendance(bob)).toContainText("1 attending");

  // The organizer sees who is coming.
  await alice.reload();
  await expect(attendees(alice)).toContainText("bob@example.com");

  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(attendance(bob)).toContainText("Nobody has signed up yet.");
  // Saved: the organizer sees it.
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

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
  await attendance(guest)
    .getByRole("textbox", { name: "Your name" })
    .fill("Gina");
  await attendance(guest)
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await attendance(guest).getByRole("button", { name: "Sign up" }).click();
  await expect(attendance(guest)).toContainText("You're signed up.");
  await expect(attendance(guest)).toContainText("1 attending");
  // The browser remembers, so the guest can still cancel later.
  await guest.reload();
  await expect(attendance(guest)).toContainText("You're signed up.");

  // One signup per email.
  const other = await visitor(browser);
  await other.goto(`/events/${event.id}`);
  await attendance(other).getByRole("textbox", { name: "Your name" }).fill("G");
  await attendance(other)
    .getByRole("textbox", { name: "Your email" })
    .fill("GINA@example.org");
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

  await deleteEvent(alice, event.id);
  await alice.goto(eventPath(team, closed.id));
  await deleteEvent(alice, closed.id);
  await deleteTeam(alice, team);
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
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
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

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("a limit shows the places left, and a full event takes no more (AC-1, AC-7, AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Limit"));
  const unlimited = await publishedEvent(alice, { public: true });
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    maxAttendees: 2,
  });

  // Without a limit, the page says nothing about places.
  const stranger = await visitor(browser);
  await stranger.goto(`/events/${unlimited.id}`);
  await expect(attendance(stranger)).toContainText("Nobody has signed up yet.");
  await expect(attendance(stranger)).not.toContainText("place");

  // A member and a guest take the two places.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(attendance(bob)).toContainText("2 places left");
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(attendance(bob)).toContainText("1 place left");

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await attendance(guest)
    .getByRole("textbox", { name: "Your name" })
    .fill("Gina");
  await attendance(guest)
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await attendance(guest).getByRole("button", { name: "Sign up" }).click();
  await expect(attendance(guest)).toContainText("You're signed up.");

  // Others are told there are no more places, instead of the form.
  const other = await visitor(browser);
  await other.goto(`/events/${event.id}`);
  await expect(attendance(other)).toContainText("There are no more places.");
  await expect(
    attendance(other).getByRole("button", { name: "Sign up" }),
  ).toHaveCount(0);
  await expect(
    attendance(other).getByRole("link", { name: /Signed up\? Log in/ }),
  ).toBeVisible();
  await alice.goto(`/events/${event.id}`);
  await expect(attendance(alice)).toContainText("There are no more places.");
  await expect(
    attendance(alice).getByRole("button", { name: "Attend" }),
  ).toHaveCount(0);

  // Those signed up are still let in, and cancelling frees the place.
  await expect(attendance(bob)).toContainText("You're attending.");
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await other.reload();
  await expect(
    attendance(other).getByRole("button", { name: "Sign up" }),
  ).toBeVisible();
  await expect(attendance(other)).toContainText("1 place left");

  // Hidden, the page no longer says how many places are left.
  await alice.goto(eventPath(team, event.id));
  await alice
    .getByRole("checkbox", { name: /Hide how many places are left/ })
    .check();
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  await other.reload();
  await expect(
    attendance(other).getByRole("button", { name: "Sign up" }),
  ).toBeVisible();
  await expect(attendance(other)).not.toContainText("place left");

  await deleteEvent(alice, event.id);
  await alice.goto(eventPath(team, unlimited.id));
  await deleteEvent(alice, unlimited.id);
  await deleteTeam(alice, team);
});

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
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
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

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
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
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await box.getByRole("radio", { name: "Online" }).check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
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
  const box = attendance(first);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box.getByRole("textbox", { name: "Your email" }).fill(address);
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

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

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("moving an event emails who signed up, once the organizer agrees", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Moved"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box.getByRole("textbox", { name: "Your email" }).fill(address);
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");
  await expect(attendees(alice)).toContainText("Gina");

  // Reminded the day before, unless turned off.
  await expect(
    alice.getByRole("checkbox", { name: /Remind attendees/ }),
  ).toBeChecked();
  // An hour later.
  await alice.getByLabel("Start time").fill("19:00");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  const publish = alice.getByRole("button", { name: "Publish" });
  const asked: Array<string> = [];
  alice.once("dialog", (dialog) => {
    asked.push(dialog.message());
    return dialog.dismiss();
  });
  await publish.click();
  expect(asked).toEqual([
    "Publish the new time? The person signed up is emailed about it.",
  ]);
  // Not published, then.
  await expect(publish).toBeEnabled();

  alice.once("dialog", (dialog) => dialog.accept());
  await publish.click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  const moved = await emailTo(address, `New time: ${event.title}`);
  expect(moved.text).toMatch(/It's now .* 7:00/);
  expect(moved.text).toMatch(/It was .* 6:00/);
  expect(moved.raw).toMatch(/Content-Type: text\/calendar;.*method=REQUEST/);

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("a new place emails who signed up, once the organizer agrees (AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Elsewhere"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box.getByRole("textbox", { name: "Your email" }).fill(address);
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");
  await expect(attendees(alice)).toContainText("Gina");

  await typeAt(place(alice), "end", ", 2nd floor");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  const publish = alice.getByRole("button", { name: "Publish" });
  const asked: Array<string> = [];
  alice.once("dialog", (dialog) => {
    asked.push(dialog.message());
    return dialog.dismiss();
  });
  await publish.click();
  expect(asked).toEqual([
    "Publish the new place? The person signed up is emailed about it.",
  ]);
  // Not published, then.
  await expect(publish).toBeEnabled();

  alice.once("dialog", (dialog) => dialog.accept());
  await publish.click();
  await expect(alice.getByTestId("status")).toContainText("Published");
  const moved = await emailTo(address, `New place: ${event.title}`);
  expect(moved.text).toContain("It's now at Kantina, 2nd floor.");
  expect(moved.text).toContain("It was at Kantina.");
  expect(moved.raw).toMatch(/Content-Type: text\/calendar;.*method=REQUEST/);

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("deleting an event emails who signed up that it's cancelled", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Cancelled"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box.getByRole("textbox", { name: "Your email" }).fill(address);
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");
  await expect(attendees(alice)).toContainText("Gina");

  const asked: Array<string> = [];
  alice.once("dialog", (dialog) => {
    asked.push(dialog.message());
    return dialog.accept();
  });
  await alice.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(alice).toHaveURL(/\/studio\/teams\/[0-9a-f-]+$/);
  expect(asked).toEqual([
    "Delete this event? It's taken off the site, and the person signed up is emailed that it's cancelled.",
  ]);

  const cancelled = await emailTo(address, `Cancelled: ${event.title}`);
  expect(cancelled.raw).toMatch(/Content-Type: text\/calendar;.*method=CANCEL/);
  expect(cancelled.raw).toContain("STATUS:CANCELLED");
  await guest.reload();
  await expect(guest.getByText("isn't published")).toBeVisible();

  await deleteEmailsTo(address);
  await deleteTeam(alice, team);
});

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
    await box.getByRole("textbox", { name: "Your name" }).fill(name);
    await box
      .getByRole("textbox", { name: "Your email" })
      .fill(`${name.toLowerCase()}@example.org`);
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

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("events ask their own questions, and say what's served", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Questions"));
  const event = await publishedEvent(alice, { public: true, guests: true });

  // Food, with what's served.
  await alice.getByRole("checkbox", { name: /Food is served/ }).check();
  await alice
    .getByRole("textbox", { name: "What's served" })
    .pressSequentially("Pizza from Lorem");

  // A written answer, a checkbox that must be ticked, and a choice.
  const addQuestion = alice.getByRole("button", { name: "Add question" });
  await addQuestion.click();
  await alice
    .getByRole("textbox", { name: "Question 1", exact: true })
    .fill("Where did you hear of it?");
  await addQuestion.click();
  await alice
    .getByRole("combobox", { name: "Question 2 type" })
    .selectOption("Checkbox");
  await alice
    .getByRole("textbox", { name: "Question 2", exact: true })
    .fill("I accept the risks of swimming");
  await alice
    .getByRole("listitem")
    .filter({ has: alice.getByRole("combobox", { name: "Question 2 type" }) })
    .getByRole("checkbox", { name: "Must be ticked" })
    .check();
  await addQuestion.click();
  await alice
    .getByRole("combobox", { name: "Question 3 type" })
    .selectOption("One of several");
  await alice
    .getByRole("textbox", { name: "Question 3", exact: true })
    .fill("Towel size");
  await alice
    .getByRole("textbox", { name: "Question 3 option 1" })
    .fill("Small");
  await alice
    .getByRole("textbox", { name: "Question 3 option 2" })
    .fill("Large");
  await alice
    .getByRole("listitem")
    .filter({ has: alice.getByRole("combobox", { name: "Question 3 type" }) })
    .getByRole("checkbox", { name: "Required" })
    .check();
  // The order can change.
  await alice.getByRole("button", { name: "Move question 3 up" }).click();
  await expect(
    alice.getByRole("textbox", { name: "Question 2", exact: true }),
  ).toHaveValue("Towel size");

  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await expect(guest.getByText("Pizza from Lorem")).toBeVisible();
  const box = attendance(guest);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await box.getByRole("textbox", { name: "Dietary preferences" }).fill("None");
  await box
    .getByRole("textbox", { name: /Where did you hear of it/ })
    .fill("A poster");
  await box.getByRole("radio", { name: "Large" }).check();
  const risks = box.getByRole("checkbox", {
    name: "I accept the risks of swimming",
  });
  await expect(risks).toHaveAttribute("required");
  await risks.check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  // Organizers see the answers, in the words asked.
  const answer = (question: string) =>
    attendees(alice)
      .getByRole("term")
      .filter({ hasText: question })
      .locator("+ dd");
  await expect(answer("Towel size")).toHaveText("Large");
  await expect(answer("I accept the risks of swimming")).toHaveText("Yes");
  await expect(answer("Where did you hear of it?")).toHaveText("A poster");

  await box.getByRole("button", { name: "Cancel my signup" }).click();
  await expect(box.getByRole("button", { name: "Sign up" })).toBeVisible();
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("people change their answers; organizers export and remove them (AC-5, AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Changes"));
  const event = await publishedEvent(alice, {
    public: true,
    guests: true,
    dietary: true,
  });
  await alice.getByRole("button", { name: "Add question" }).click();
  await alice
    .getByRole("combobox", { name: "Question 1 type" })
    .selectOption("One of several");
  await alice
    .getByRole("textbox", { name: "Question 1", exact: true })
    .fill("Towel size");
  await alice
    .getByRole("textbox", { name: "Question 1 option 1" })
    .fill("Small");
  await alice
    .getByRole("textbox", { name: "Question 1 option 2" })
    .fill("Large");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  // A guest signs up, and changes their mind: the form starts from what
  // they told.
  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  const box = attendance(guest);
  await box.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await box
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await box.getByRole("textbox", { name: "Dietary preferences" }).fill("Vegan");
  await box.getByRole("radio", { name: "Small" }).check();
  await box.getByRole("button", { name: "Sign up" }).click();
  await expect(box).toContainText("You're signed up.");

  await box.getByRole("button", { name: "Change answers" }).click();
  const form = box.getByRole("form", { name: "Your answers" });
  // What they can't eat belongs to no one once given: nothing to change.
  await expect(
    form.getByRole("textbox", { name: "Dietary preferences" }),
  ).toHaveCount(0);
  await expect(form.getByRole("radio", { name: "Small" })).toBeChecked();
  await form.getByRole("radio", { name: "Large" }).check();
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(box).toContainText("You're signed up.");

  // So does a member, from their own answers.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  const member = attendance(bob);
  await member
    .getByRole("textbox", { name: "Dietary preferences" })
    .fill("Fish");
  await member.getByRole("radio", { name: "Large" }).check();
  await expectNoGuestContact(member);
  await member.getByRole("button", { name: "Attend" }).click();
  await expect(member).toContainText("You're attending.");
  await member.getByRole("button", { name: "Change answers" }).click();
  const memberForm = member.getByRole("form", { name: "Your answers" });
  await expectNoGuestContact(memberForm);
  await expect(memberForm.getByRole("radio", { name: "Large" })).toBeChecked();
  await memberForm.getByRole("radio", { name: "Small" }).check();
  await expect(
    memberForm.getByRole("textbox", { name: "Dietary preferences" }),
  ).toHaveCount(0);
  await memberForm.getByRole("button", { name: "Save changes" }).click();
  await expect(member).toContainText("You're attending.");

  const answer = (name: string) =>
    attendees(alice)
      .getByRole("listitem")
      .filter({ hasText: name })
      .getByRole("term")
      .filter({ hasText: "Towel size" })
      .locator("+ dd");
  await expect(answer("Gina")).toHaveText("Large");
  await expect(answer("bob")).toHaveText("Small");
  // Neither text is with the people: the attendee list holds no dietary
  // preference.
  await expect(attendees(alice)).not.toContainText("Vegan");
  await expect(attendees(alice)).not.toContainText("Fish");

  // A spreadsheet of them, with a column for the question.
  const downloading = alice.waitForEvent("download");
  await attendees(alice).getByRole("button", { name: "Download CSV" }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe(`${event.title} attendees.csv`);
  const lines = (await readFile((await file.path()) ?? "", "utf8"))
    .trim()
    .split(/\r?\n/);
  expect(lines[0]).toBe(
    "Name,Email,Guest,Signed up,Changed,Phone,Company,Towel size",
  );
  expect(lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,.*,,,Large$/),
    expect.stringMatching(/^bob,bob@example\.com,No,.*,,,Small$/),
  ]);
  expect(lines.join("\n")).not.toMatch(/Vegan|Fish/);

  // Organizers take people off; the guest sees they're no longer signed up.
  alice.once("dialog", (dialog) => dialog.accept());
  await attendees(alice).getByRole("button", { name: "Remove Gina" }).click();
  await expect(attendees(alice)).not.toContainText("Gina");
  await guest.reload();
  await expect(box.getByRole("button", { name: "Sign up" })).toBeVisible();

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("signups show up for visitors and organizers without reloading (AC-4, AC-5)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Live signups"));
  const event = await publishedEvent(alice, { public: true });
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  const reader = await visitor(browser);
  await reader.goto(`/events/${event.id}`);
  await expect(attendance(reader)).toContainText("Nobody has signed up yet.");

  // Bob signs up: the visitor's count and Alice's list follow.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(attendance(reader)).toContainText("1 attending");
  await expect(attendees(alice)).toContainText("bob@example.com");
  // The visitor can count, not see who.
  await expect(reader.getByText("bob@example.com")).toHaveCount(0);
  await expect(whoIsComing(reader)).toHaveCount(0);
  await expect(reader.locator("body")).not.toContainText(/\bbob\b/i);

  // Nor does the API tell: every row a pull without a session returns has no
  // details, page by page.
  const bodies: string[] = [];
  let since: string | undefined;
  for (let more = true; more; ) {
    const response = await reader.request.get("/api/sync/attendees", {
      params: since === undefined ? {} : { since },
    });
    expect(response.ok()).toBe(true);
    bodies.push(await response.text());
    const pull = JSON.parse(bodies.at(-1) ?? "{}") as {
      rows: { details: unknown }[];
      more: boolean;
      token: string;
    };
    for (const row of pull.rows) expect(row.details).toBeNull();
    ({ more, token: since } = pull);
  }
  expect(bodies.join("")).not.toContain("bob@example.com");

  // And he changes his mind.
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(attendance(reader)).toContainText("Nobody has signed up yet.");
  await expect(attendees(alice)).toContainText("Nobody has signed up yet.");

  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("members see who's coming, members and guests apart, without reloading (AC-1, AC-2, AC-3, AC-6)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Who is coming"));
  const event = await publishedEvent(alice, { public: true, guests: true });

  // Nobody yet: each kind says so.
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(members(bob)).toContainText("Members (0)");
  await expect(members(bob)).toContainText("No members have signed up yet.");
  await expect(guests(bob)).toContainText("Guests (0)");
  await expect(guests(bob)).toContainText("No guests have signed up yet.");

  // A guest signs up: Bob sees her among the guests, not the members.
  const gina = await visitor(browser);
  await gina.goto(`/events/${event.id}`);
  const form = attendance(gina);
  await form.getByRole("textbox", { name: "Your name" }).fill("Gina");
  await form
    .getByRole("textbox", { name: "Your email" })
    .fill("gina@example.org");
  await form.getByRole("button", { name: "Sign up" }).click();
  await expect(form).toContainText("You're signed up.");
  await expect(guests(bob)).toContainText("Guests (1)", pulled);
  await expect(guests(bob)).toContainText("Gina");
  await expect(members(bob)).toContainText("Members (0)");
  await expect(members(bob)).not.toContainText("Gina");

  // A member attends: Alice, with the page open, sees him among the members.
  await alice.goto(`/events/${event.id}`);
  await attendance(bob).getByRole("button", { name: "Attend" }).click();
  await expect(attendance(bob)).toContainText("You're attending.");
  await expect(members(alice)).toContainText("Members (1)", pulled);
  await expect(members(alice)).toContainText("bob");

  // They change their minds.
  await form.getByRole("button", { name: "Cancel my signup" }).click();
  await expect(guests(bob)).toContainText(
    "No guests have signed up yet.",
    pulled,
  );
  await attendance(bob)
    .getByRole("button", { name: "Cancel attendance" })
    .click();
  await expect(members(alice)).toContainText(
    "No members have signed up yet.",
    pulled,
  );

  await alice.goto(eventPath(team, event.id));
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});

test("an event not open to guests lists only members (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Members list"));
  const event = await publishedEvent(alice, { public: true });

  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(`/events/${event.id}`);
  await expect(members(bob)).toBeVisible();
  await expect(guests(bob)).toHaveCount(0);

  await alice.goto(eventPath(team, event.id));
  await deleteEvent(alice, event.id);
  await deleteTeam(alice, team);
});
