import { expect, test } from "@playwright/test";
import {
  cleanUp,
  deleteEmailsTo,
  emailTo,
  newTeam,
  place,
  publishedEvent,
  signedIn,
  typeAt,
  uniqueTeamName,
  visitor,
} from "../helpers.ts";
import { attendance, attendees, signUpAsGuest } from "./helpers.ts";

test("moving an event emails who signed up, once the organizer agrees", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Moved"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await signUpAsGuest(attendance(guest), "Gina", address);
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

  await cleanUp(alice, team, event.id);
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
  await signUpAsGuest(attendance(guest), "Gina", address);
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

  await cleanUp(alice, team, event.id);
});

test("an organizer writes the signed-up email's own subject and text (AC-1)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Own email"));
  const event = await publishedEvent(alice, { public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;
  const wording = "Welcome, we saved you a seat";

  // Opening a published event does not make it unpublished: the fields of an
  // email are not created until it is opened.
  await alice.reload();
  await expect(alice.getByTestId("status")).toContainText("Published");

  await alice.getByRole("button", { name: "Signed-up email" }).click();
  const subject = alice.getByRole("textbox", {
    name: "Subject of the signed-up email",
  });
  await subject.pressSequentially(wording);
  await expect(subject).toHaveText(wording);
  const text = alice.getByRole("textbox", {
    name: "Text of the signed-up email",
  });
  await text.pressSequentially("Bring a friend");
  await expect(text).toHaveText("Bring a friend");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await alice.getByRole("button", { name: "Publish" }).click();
  await expect(alice.getByTestId("status")).toContainText("Published");

  const guest = await visitor(browser);
  await guest.goto(`/events/${event.id}`);
  await signUpAsGuest(attendance(guest), "Gina", address);

  // The written subject and text, then the event, and the guest's own link.
  const signedUp = await emailTo(address, wording);
  expect(signedUp.text).toContain("Bring a friend");
  expect(signedUp.text).toContain(event.title);
  expect(signedUp.text).toMatch(
    new RegExp(`http\\S*/events/${event.id}\\?guest=\\S+`),
  );

  await cleanUp(alice, team, event.id);
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
  await signUpAsGuest(attendance(guest), "Gina", address);
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
  await cleanUp(alice, team);
});
