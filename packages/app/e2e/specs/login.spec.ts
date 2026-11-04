import { visitor } from "../fixtures/support.ts";
import { expect, test } from "../fixtures/test.ts";
import { Header } from "../pom/Header.ts";
import { LoginPage } from "../pom/LoginPage.ts";
import { AccountPage } from "../pom/site/AccountPage.ts";
import { HomePage } from "../pom/site/HomePage.ts";
import { LoginFailedPage } from "../pom/site/LoginFailedPage.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("an account that is not allowed gets a page in the visitor's language (AC-1, AC-5, AC-6)", async ({
  browser,
}) => {
  const page = await visitor(browser);
  const header = new Header(page);
  await new HomePage(page).goto();
  await header.selectLanguage("Bokmål");
  await header.expectPageLanguage("nb");

  // The studio sends the visitor to log in; mallory's domain is not allowed.
  const failed = new LoginFailedPage(page, "nb");
  const status = failed.callbackStatus();
  await new TeamsColumn(page).goto();
  const login = new LoginPage(page);
  await login.expectShown();
  await login.signIn("mallory@other.example");

  expect(await status).toBe(403);
  await failed.expectDenied();

  // Picking another language on it keeps the page.
  await header.selectLanguage("English", "Språk");
  await header.expectPageLanguage("en");
  await new LoginFailedPage(page, "en").expectDenied();

  await new LoginFailedPage(page, "en").clickFrontPage();
  await new HomePage(page).expectAt();
  await header.expectSignedOut();
  await header.expectLogIn();
});

test("an expired login offers to log in again, back where it started (AC-2, AC-4)", async ({
  browser,
}) => {
  const page = await visitor(browser);
  const failed = new LoginFailedPage(page);
  const callback = failed.watchCallback();

  await new AccountPage(page).goto();
  const login = new LoginPage(page);
  await login.expectShown();
  await login.signIn("bob@example.com");
  await new AccountPage(page).expectAt();

  // The callback has been answered once: opening it again is a replay.
  const address = callback.url();
  expect(address).toBeDefined();
  await failed.openCallback(address ?? "");
  await failed.expectExpired();

  await failed.clickLogInAgain();
  await login.signIn("bob@example.com");
  await new AccountPage(page).expectAt();
  await new Header(page).expectSignedInAs("bob@example.com");
});

test("a login that didn't work offers to log in again, back where it started (AC-3, AC-4)", async ({
  browser,
}) => {
  const page = await visitor(browser);
  const failed = new LoginFailedPage(page);

  await new AccountPage(page).goto();
  const login = new LoginPage(page);
  await login.expectShown();

  // The provider's answer can't be used: the state is not the login's.
  await failed.openCallback("/auth/callback?code=x&state=forged");
  await failed.expectFailed();

  await failed.clickLogInAgain();
  await login.signIn("bob@example.com");
  await new AccountPage(page).expectAt();
  await new Header(page).expectSignedInAs("bob@example.com");
});
