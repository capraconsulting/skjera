import { expect, test } from "@playwright/test";
import { cleanUp } from "../../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../../fixtures/support.ts";
import { Mailbox } from "../../pom/Mailbox.ts";
import { Attendance, CancelByEmail } from "../../pom/site/Attendance.ts";
import { CancelSignupPage } from "../../pom/site/CancelSignupPage.ts";
import { EventPage } from "../../pom/site/EventPage.ts";
import { EventEditor } from "../../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../../pom/studio/TeamsColumn.ts";

test("guests sign up with their name and email", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Guests"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const closed = await editor.createPublished({ public: true });

  const guest = await visitor(browser);
  const page = new EventPage(guest);
  const attendance = new Attendance(guest);
  await page.goto(event.id);
  // This event doesn't ask about food.
  await attendance.expectNoField("Dietary preferences");
  await attendance.signUpAsGuest("Gina", "gina@example.org");
  await attendance.expectText("1 attending");
  // The browser remembers, so the guest can still cancel later.
  await page.reload();
  await attendance.expectSignedUp();

  // One signup per email.
  const other = await visitor(browser);
  await new EventPage(other).goto(event.id);
  const twice = new Attendance(other);
  await twice.fillName("Gi");
  await twice.fillEmail("GINA@example.org");
  await twice.clickSignUp();
  await twice.expectAlert("already signed up");

  await editor.goto(team, event.id);
  await editor.attendees.expectText("Gina");
  await editor.attendees.expectText("Guest");

  await attendance.cancelSignup();
  await attendance.expectEmpty();
  await attendance.expectSignUpButton(true);

  // Without guest signups, visitors are asked to log in.
  await page.goto(closed.id);
  await attendance.expectLogInToAttend();

  await cleanUp(alice, team, event.id, closed.id);
});

test("a guest form says what is wrong by each field, and refuses a member's email address", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Checks"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  const box = new Attendance(guest);

  // A one-letter name stops in the form: nothing is sent (AC-2).
  await box.fillName("G");
  await box.fillEmail("g@example.org");
  await box.clickSignUp();
  await box.expectFieldMessage(
    "Your name",
    "Enter your name, at least 2 characters",
  );
  await box.expectEmpty();

  // A member's email address is refused by the server, by the email field (AC-1).
  await box.fillName("Bob");
  await box.fillEmail("bob@example.com");
  await box.clickSignUp();
  await box.expectFieldMessage(
    "Your email",
    "Log in to sign up for the event!",
  );
  await box.expectNotSignedUp();

  await box.fillEmail("bob@example.org");
  await box.clickSignUp();
  await box.expectSignedUp();

  // The form changing a guest's answers checks the phone number too (AC-4).
  await box.clickChangeAnswers();
  await box.answers.fillPhone("111");
  await box.answers.clickSaveChanges();
  await box.answers.expectFieldMessage(
    "Your phone number",
    "Enter a valid mobile number",
  );
  await box.answers.expectField("Your phone number");

  await cleanUp(alice, team, event.id);
});

test("a guest's forms have a hidden field, and one with it filled in is refused (AC-1, AC-2, AC-8)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Bots"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  const box = new Attendance(guest);
  const refusal = "Something went wrong. The form as filled in isn't valid.";

  // People never reach it with the keyboard (AC-1).
  await box.expectHiddenFieldSkipped(
    { role: "textbox", name: "Your name" },
    { role: "button", name: "Sign up" },
  );

  // The form for cancelling by email has one too, and a bot's is refused (AC-8).
  const byEmail = new CancelByEmail(guest);
  await byEmail.expectHiddenFieldSkipped();
  await byEmail.fillEmail("bot@example.org");
  await byEmail.fillHiddenField("buy now");
  await byEmail.submit();
  await byEmail.expectText(refusal);

  // A bot fills it in: nothing is saved (AC-2).
  await box.fillName("Bot");
  await box.fillEmail("bot@example.org");
  await box.fillHiddenField("buy now");
  await box.clickSignUp();
  await box.expectAlert(refusal);
  await box.expectEmpty();
  await box.expectSignUpButton(true);

  await box.fillName("Gina");
  await box.fillEmail("gina@example.org");
  await box.fillHiddenField("");
  await box.clickSignUp();
  await box.expectSignedUp();

  // The same for cancelling (AC-1, AC-2).
  await box.expectHiddenFieldSkipped(
    { role: "button", name: "Change answers" },
    { role: "button", name: "Cancel my signup" },
  );
  await box.fillHiddenField("buy now");
  await box.cancelSignup();
  await box.expectAlert(refusal);
  await box.expectSignedUp();

  await box.fillHiddenField("");
  await box.cancelSignup();
  await box.expectEmpty();

  await cleanUp(alice, team, event.id);
});

test("Guests can sign up shows unticked on a members-only event, and as it was set once public again", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Visible"));
  const editor = new EventEditor(alice);
  const open = await editor.createPublished({ public: true, guests: true });

  // A public event: it can be changed, and stays as it is set.
  await editor.expectGuests(true, true);
  await editor.uncheckGuests();
  await editor.expectGuests(false, true);
  await editor.checkGuests();

  // Members only: off, and unchangeable.
  await editor.uncheckPublic();
  await editor.expectGuests(false, false);
  // Public again: as the organizer left it.
  await editor.checkPublic();
  await editor.expectGuests(true, true);

  // Set off, it stays off through members only and back.
  await editor.uncheckGuests();
  await editor.uncheckPublic();
  await editor.expectGuests(false, false);
  await editor.checkPublic();
  await editor.expectGuests(false, true);

  await cleanUp(alice, team, open.id);
});

test("guests give a phone number and a company, and organizers see, search and export them", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Contact"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.attendees.expectEmpty();
  await editor.attendees.expectNoSearch();

  const guest = await visitor(browser);
  await new EventPage(guest).goto(event.id);
  const box = new Attendance(guest);
  await box.expectField("Your phone number");
  await box.expectField("Your company");
  // The names HubSpot recognises, as Skjer's form has them.
  for (const [label, name] of [
    ["Your name", "firstname"],
    ["Your email", "email"],
    ["Your phone number", "telephone"],
    ["Your company", "company"],
  ] as const) {
    await box.expectFieldName(label, name);
  }
  await box.fillName("Gina");
  await box.fillEmail("gina@example.org");
  await box.fillPhone("900 00 000");
  await box.fillCompany("Acme");
  await box.clickSignUp();
  await box.expectSignedUp();

  const bob = await signedIn(browser, "bob@example.com");
  await new EventPage(bob).goto(event.id);
  await new Attendance(bob).attend();

  // The event asks nothing else, and the guest can still change these two.
  await box.clickChangeAnswers();
  await box.answers.expectFieldValue("Your phone number", "900 00 000");
  await box.answers.expectFieldValue("Your company", "Acme");
  await box.answers.expectFieldName("Your phone number", "telephone");
  await box.answers.fillPhone("911 11 111");
  await box.answers.fillCompany("Initech");
  await box.answers.clickSaveChanges();
  await box.expectSignedUp();

  await editor.reload();
  await editor.attendees.expectRow("Gina", "911 11 111");
  await editor.attendees.expectRow("Gina", "Initech");

  const csv = await editor.attendees.downloadCsv();
  expect(csv.lines[0]).toBe("Name,Email,Guest,Signed up,Changed,Phone,Company");
  expect(csv.lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,gina@example\.org,Yes,.*,911 11 111,Initech$/),
    expect.stringMatching(/^bob,bob@example\.com,No,.*,,$/),
  ]);

  // Searching narrows the list, not the count or the spreadsheet.
  await editor.attendees.expectSearch();
  await editor.attendees.search("initech");
  await editor.attendees.expectRow("Gina", "Initech");
  await editor.attendees.expectNoText("bob@example.com");
  expect(await editor.attendees.count()).toBe(2);
  const narrowed = await editor.attendees.downloadCsv();
  expect(narrowed.lines.slice(1).sort()).toEqual([
    expect.stringMatching(/^Gina,/),
    expect.stringMatching(/^bob,/),
  ]);

  await cleanUp(alice, team, event.id);
});

test("a guest's email brings their signup to another browser", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Links"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  const first = await visitor(browser);
  await new EventPage(first).goto(event.id);
  await new Attendance(first).signUpAsGuest("Gina", address);

  // The email, with an invitation for their calendar and their own link.
  const signedUp = await new Mailbox().emailTo(
    address,
    `You're signed up: ${event.title}`,
  );
  expect(signedUp.raw).toMatch(/Content-Type: text\/calendar;.*method=REQUEST/);
  const link = signedUp.text.match(
    new RegExp(`http\\S*/events/${event.id}\\?guest=\\S+`),
  )?.[0];
  expect(link).toBeDefined();
  // At the server's own address, as configured.
  expect(link?.startsWith(`${baseURL}/events/`)).toBe(true);

  const second = await visitor(browser);
  const page = new EventPage(second);
  await page.gotoLink(link ?? "");
  // Remembered, and out of the address.
  await page.expectAt(event.id);
  const there = new Attendance(second);
  await there.expectSignedUp();
  await there.expectNoText("no longer leads to a signup");
  await there.cancelSignup();
  await there.expectSignUpButton(true);
  await editor.attendees.expectEmpty();
  const cancelled = await new Mailbox().emailTo(
    address,
    `Signup cancelled: ${event.title}`,
  );
  expect(cancelled.raw).toMatch(/Content-Type: text\/calendar;.*method=CANCEL/);

  await cleanUp(alice, team, event.id);
});

/** The link in the email a guest got on signing up. */
const linkFrom = async (
  address: string,
  event: { id: string; title: string },
) => {
  const email = await new Mailbox().emailTo(
    address,
    `You're signed up: ${event.title}`,
  );
  const link = email.text.match(
    new RegExp(`http\\S*/events/${event.id}\\?guest=\\S+`),
  )?.[0];
  expect(link).toBeDefined();
  return link ?? "";
};

test("a guest changes their answers from another browser", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Elsewhere"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  await editor.questions.add(1, "Where did you hear of it?");
  await editor.questions.checkRule(1, "Required");
  await editor.publish();
  const address = `gina-${crypto.randomUUID()}@example.org`;

  // Gina signs up in one browser...
  const first = await visitor(browser);
  await new EventPage(first).goto(event.id);
  const here = new Attendance(first);
  await here.fillName("Gina");
  await here.fillEmail(address);
  await here.fillPhone("900 00 000");
  await here.fillCompany("Acme");
  await here.fillAnswer(/Where did you hear of it/, "A poster");
  await here.clickSignUp();
  await here.expectSignedUp();
  const link = await linkFrom(address, event);

  // ...and opens her link in another: the form has what she gave.
  const second = await visitor(browser);
  await new EventPage(second).gotoLink(link);
  const there = new Attendance(second);
  await there.expectSignedUp();
  await there.clickChangeAnswers();
  await there.answers.expectFieldValue("Your phone number", "900 00 000");
  await there.answers.expectFieldValue("Your company", "Acme");
  await there.answers.expectFieldValue("Where did you hear of it?", "A poster");

  // Saving it as it is keeps what she gave.
  await there.answers.clickSaveChanges();
  await there.expectSignedUp();
  await editor.reload();
  await editor.attendees.expectRow("Gina", "900 00 000");
  await editor.attendees.expectRow("Gina", "Acme");
  await editor.attendees.expectAnswer("Where did you hear of it?", "A poster");

  // A change from there is what the first browser shows, without a reload.
  await there.clickChangeAnswers();
  await there.answers.fillCompany("Initech");
  await there.answers.clickSaveChanges();
  await there.expectSignedUp();
  await here.clickChangeAnswers();
  await here.answers.expectFieldValue("Your company", "Initech");
  await here.answers.clickSaveChanges();
  await here.expectSignedUp();

  // Taken off by the organizers while her page is open and held back, she
  // is not shown as signed up.
  await first.route("**/api/sync/**", (route) => route.abort());
  await editor.attendees.remove("Gina");
  await editor.reload();
  await editor.attendees.expectEmpty();
  await here.clickChangeAnswers();
  await here.expectSignUpButton(true);
  await here.expectNotSignedUp();

  await cleanUp(alice, team, event.id);
});

test("a guest who lost the email cancels by typing their address, and confirming from a link (AC-1, AC-3, AC-4, AC-5, AC-6, AC-7)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Lost"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;

  // Gina signs up in one browser...
  const first = await visitor(browser);
  await new EventPage(first).goto(event.id);
  await new Attendance(first).signUpAsGuest("Gina", address);

  // ...and, with no link, asks to cancel from another (AC-1).
  const second = await visitor(browser);
  await new EventPage(second).goto(event.id);
  const form = new CancelByEmail(second);
  await form.expectShown();

  // An address nobody signed up with is told so (AC-4).
  await form.fillEmail(`nobody-${crypto.randomUUID()}@example.org`);
  await form.submit();
  await form.expectText("Sorry, we can't find a signup with this email.");

  // Her address is sent a link (AC-3).
  await form.fillEmail(address);
  await form.submit();
  await form.expectText(
    `An email has been sent to ${address} with a link to confirm cancelling.`,
  );
  const email = await new Mailbox().emailTo(
    address,
    `Confirm cancelling: ${event.title}`,
  );
  const link = email.text.match(
    new RegExp(`http\\S*/events/${event.id}/cancel\\?token=\\S+`),
  )?.[0];
  expect(link).toBeDefined();

  // Opening the link cancels nothing (AC-5)...
  const third = await visitor(browser);
  const confirmPage = new CancelSignupPage(third);
  await confirmPage.goto(link ?? "");
  await confirmPage.expectTitle(event.title);
  await editor.goto(team, event.id);
  await editor.attendees.expectText("Gina");

  // ...pressing the button does (AC-6).
  await confirmPage.confirm();
  await confirmPage.expectText(
    "You're no longer signed up for the event 👋 We've sent you a confirmation by email.",
  );
  await editor.attendees.expectEmpty();

  // The link is used: the page says so, and leads to the event (AC-7).
  await confirmPage.goto(link ?? "");
  await confirmPage.expectText(
    "This link has been used, or the signup is no longer there.",
  );
  await confirmPage.clickToEvent();
  await new EventPage(third).expectAt(event.id);

  await cleanUp(alice, team, event.id);
});

test("a link that leads to no signup says so", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Gone"));
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const address = `gina-${crypto.randomUUID()}@example.org`;
  const gone = "This link no longer leads to a signup.";

  const first = await visitor(browser);
  await new EventPage(first).goto(event.id);
  const here = new Attendance(first);
  await here.fillName("Gina");
  await here.fillEmail(address);
  await here.clickSignUp();
  await here.expectSignedUp();
  const link = await linkFrom(address, event);

  // Another token: the page says so, and offers the usual sign-up.
  const second = await visitor(browser);
  const page = new EventPage(second);
  await page.gotoLink(link.replace(/token=[^&\s]*/, "token=not-hers"));
  const there = new Attendance(second);
  await there.expectText(gone);
  await there.expectNotSignedUp();
  await there.expectSignUpButton(true);
  // Nothing was remembered from it.
  await page.reload();
  await there.expectNoText(gone);
  await there.expectNotSignedUp();
  await there.expectSignUpButton(true);

  // Once she has cancelled, her own link leads nowhere either.
  await here.cancelSignup();
  await here.expectSignUpButton(true);
  await editor.attendees.expectEmpty();
  const third = await visitor(browser);
  await new EventPage(third).gotoLink(link);
  const after = new Attendance(third);
  await after.expectText(gone);
  await after.expectNotSignedUp();

  await cleanUp(alice, team, event.id);
});
