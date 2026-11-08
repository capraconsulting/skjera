import type { Page } from "@playwright/test";
import { dexUsers } from "@skjera/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { test } from "../fixtures/test.ts";
import { Header } from "../pom/Header.ts";
import { pixel } from "../pom/images.ts";
import { AccountPage } from "../pom/site/AccountPage.ts";
import { CalendarFeed } from "../pom/site/CalendarFeed.ts";
import { HomePage } from "../pom/site/HomePage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("the account menu uses the canonical login name and leads to settings (ACC-05 AC-1, ACC-05 AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const header = new Header(alice);
  // In the studio, its link says so; on the site, it doesn't.
  await header.expectStudioCurrent(true);

  // Who's signed in: their name from the login, and their email.
  await header.openAccountMenu();
  await header.expectAccountMenuShows("alice");
  await header.expectAccountMenuShows(dexUsers.alice);

  await alice.context().route("/api/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: { ...me, subject: "account-subject", name: "  ", email: "  " },
    });
  });
  await alice.reload();
  await header.openAccountMenu();
  await header.expectAccountMenuShows("account-subject");
  await alice.context().unroute("/api/me");
  await alice.reload();

  await header.openAccountMenu();
  await header.clickAccountSettings();
  const account = new AccountPage(alice);
  await account.expectAt();
  await header.expectStudioCurrent(false);
  await account.expectHeading("Account settings");
  await account.expectText(dexUsers.alice);

  // The theme: picked, or the system's again.
  await account.pickTheme("Dark");
  await header.expectTheme("dark");
  await header.expectThemePicked("Dark");
  // The header's menu and the account page show the same choice.
  await header.pickTheme("Light");
  await account.expectThemePicked("Light");
  await account.pickTheme("Same as the system");
  await header.expectTheme(null);

  // The language: the page comes back in it.
  await account.pickLanguage("Nynorsk");
  await header.expectPageLanguage("nn");
  await account.expectHeading("Kontoinnstillingar");
  await account.pickLanguage("English");
  await header.expectPageLanguage("en");

  await header.logOut();
  await header.expectLogIn();
});

/** Gives the page's browser `/api/me` as the login's identity with `picture`. */
const meWithPicture = async (page: Page, picture: string): Promise<void> => {
  await page.context().route("/api/me", async (route) => {
    const response = await route.fetch();
    const me = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...me, picture } });
  });
};

test("the account menu shows the picture from the login, and the initials with none or one that fails (ACC-01 AC-6)", async ({
  browser,
}) => {
  const bob = await signedIn(browser, dexUsers.bob);
  const header = new Header(bob);
  // The local login has no picture: the menu shows the initials.
  await header.expectNoProfilePicture();

  // With one, the menu shows it instead.
  const picture = "https://pictures.example/bob.png";
  await meWithPicture(bob, picture);
  await bob
    .context()
    .route(picture, (route) =>
      route.fulfill({ contentType: "image/png", body: pixel }),
    );
  await new HomePage(bob).goto();
  await header.expectProfilePicture(picture);

  // One that fails to load leaves the initials.
  const broken = "https://pictures.example/broken.png";
  await meWithPicture(bob, broken);
  await bob.context().route(broken, (route) => route.abort());
  await new HomePage(bob).goto();
  await header.expectNoProfilePicture();
});

test("the header subscribes to the coming events in Google Calendar, beside the account menu", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  await new HomePage(reader).goto();
  await new Header(reader).expectNoSubscribe();

  const alice = await signedIn(browser, dexUsers.alice);
  const header = new Header(alice);
  // Nothing leaves the machine: Google's address is answered here.
  await alice
    .context()
    .route("https://www.google.com/**", (route) => route.fulfill({ body: "" }));
  for (const path of ["/", "/studio/teams"]) {
    await alice.goto(path);
    await header.expectSubscribe();

    // Beside the account menu, not in it.
    await header.openAccountMenu();
    await header.expectAccountMenuWithoutSubscribe();
    await header.closeMenu();
  }

  await new HomePage(alice).goto();
  await header.clickSubscribeOpening(
    `https://www.google.com/calendar/render?cid=webcal://${new URL(alice.url()).host}/api/subscribe`,
  );
});

test("the calendar to subscribe to holds the coming events, members-only too, to anyone", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  const team = await new TeamsColumn(alice).create(uniqueTeamName("Feed"));
  const editor = new EventEditor(alice);
  const open = await editor.createPublished({ public: true });
  const membersOnly = await editor.createPublished({ public: false });
  const deleted = await editor.createPublished({ public: true });
  await editor.delete(deleted.id);

  // Fetched without a session, as Google Calendar does.
  const calendar = await new CalendarFeed(await visitor(browser)).fetch();
  calendar.expectEvent(open.title);
  calendar.expectEvent(membersOnly.title);
  calendar.expectNoEvent(deleted.title);

  await cleanUp(alice, team, open.id, membersOnly.id);
});

test("the header keeps «Abonner» and the account menu in a phone's window", async ({
  browser,
}) => {
  const alice = await signedIn(browser, dexUsers.alice);
  await alice.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/", "/studio/teams"]) {
    await alice.goto(path);
    await new Header(alice).expectSubscribeAndAccountMenuFit();
  }
});
