import { expect, test } from "@playwright/test";
import { dexIssuerUrl } from "@skjera/test";
import { DemoPage } from "../pom/DemoPage.ts";
import { LoginPage } from "../pom/LoginPage.ts";

test("logs in and out through the provider", async ({ page }) => {
  const demo = new DemoPage(page);
  const login = new LoginPage(page);
  await demo.goto();
  await demo.expectLoggedOut();

  await demo.clickLogIn();
  await login.expectShown();
  await login.signIn("alice@example.com");

  await demo.expectAt("/");
  await demo.expectLoggedInAs("alice@example.com");

  const cookies = await demo.cookies();
  expect(cookies.session?.httpOnly).toBe(true);
  expect(cookies.session?.sameSite).toBe("Lax");
  expect(cookies.login).toBe(false);

  await demo.clickLogOut();
  await demo.expectLoggedOut();
  expect((await demo.cookies()).session).toBeUndefined();
});

test("stays at the provider when the password is wrong", async ({ page }) => {
  const login = new LoginPage(page);
  await new DemoPage(page).gotoLogin();
  await login.signIn("bob@example.com", "wrong");
  await login.expectShown();
});

test("returns to the requested page after login", async ({ page }) => {
  const demo = new DemoPage(page);
  await demo.gotoLogin("/api/me");
  await new LoginPage(page).signIn("bob@example.com");
  await demo.expectAt("/api/me");
  expect(JSON.parse(await demo.bodyText())).toMatchObject({
    issuer: dexIssuerUrl(process.env),
    email: "bob@example.com",
    name: "bob",
  });
});

test("refuses to redirect to another site after login", async ({ page }) => {
  const demo = new DemoPage(page);
  await demo.gotoLogin("https://evil.example/");
  await new LoginPage(page).signIn("alice@example.com");
  await demo.expectAt("/");
});

test("rejects a replayed callback", async ({ page }) => {
  const demo = new DemoPage(page);
  const callback = demo.watchCallback();
  await demo.gotoLogin();
  await new LoginPage(page).signIn("alice@example.com");
  await demo.expectLoggedInAs("alice@example.com");

  const url = callback.url();
  expect(url, "a callback request was seen").toBeDefined();
  expect(await demo.revisit(url ?? "")).toBe(400);
});

test("refuses accounts outside the allowed domains", async ({ page }) => {
  const demo = new DemoPage(page);
  const callback = demo.callbackResponse();
  await demo.gotoLogin();
  await new LoginPage(page).signIn("mallory@other.example");

  expect((await callback).status()).toBe(403);
  await demo.expectBodyText("This account is not allowed to sign in.");
  expect((await demo.cookies()).session).toBeUndefined();
});
