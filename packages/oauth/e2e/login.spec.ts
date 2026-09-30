import { expect, type Page, test } from "@playwright/test";

const signInAtDex = async (
  page: Page,
  login: string,
  password = "password",
) => {
  await page.locator("#login").fill(login);
  await page.locator("#password").fill(password);
  await page.locator("#submit-login").click();
};

test("logs in and out through the provider", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("Not logged in");

  await page.locator("#login").click();
  await expect(page).toHaveURL(/localhost:5556\/dex/);
  await signInAtDex(page, "alice@example.com");

  await expect(page).toHaveURL("/");
  await expect(page.locator("#status")).toHaveText(
    "Logged in as alice@example.com",
  );

  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "skjera_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(cookies.some((cookie) => cookie.name === "skjera_login")).toBe(false);

  await page.locator("#logout").click();
  await expect(page.locator("#status")).toHaveText("Not logged in");
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "skjera_session",
    ),
  ).toBe(false);
});

test("stays at the provider when the password is wrong", async ({ page }) => {
  await page.goto("/auth/login");
  await signInAtDex(page, "bob@example.com", "wrong");
  await expect(page).toHaveURL(/localhost:5556\/dex/);
  await expect(page.locator("#login")).toBeVisible();
});

test("returns to the requested page after login", async ({ page }) => {
  await page.goto("/auth/login?returnTo=/api/me");
  await signInAtDex(page, "bob@example.com");
  await expect(page).toHaveURL("/api/me");
  const me = JSON.parse((await page.locator("body").textContent()) ?? "");
  expect(me).toMatchObject({
    issuer: "http://localhost:5556/dex",
    email: "bob@example.com",
    name: "bob",
  });
});

test("refuses to redirect to another site after login", async ({ page }) => {
  await page.goto("/auth/login?returnTo=https://evil.example/");
  await signInAtDex(page, "alice@example.com");
  await expect(page).toHaveURL("/");
});

test("rejects a replayed callback", async ({ page }) => {
  let callbackUrl: string | undefined;
  page.on("request", (request) => {
    if (request.url().includes("/auth/callback")) callbackUrl = request.url();
  });
  await page.goto("/auth/login");
  await signInAtDex(page, "alice@example.com");
  await expect(page.locator("#status")).toHaveText(
    "Logged in as alice@example.com",
  );

  if (callbackUrl === undefined) throw new Error("No callback request seen");
  const response = await page.goto(callbackUrl);
  expect(response?.status()).toBe(400);
});

test("refuses accounts outside the allowed domains", async ({ page }) => {
  const callback = page.waitForResponse((response) =>
    response.url().includes("/auth/callback"),
  );
  await page.goto("/auth/login");
  await signInAtDex(page, "mallory@other.example");

  expect((await callback).status()).toBe(403);
  await expect(page.locator("body")).toHaveText(
    "This account is not allowed to sign in.",
  );
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => cookie.name === "skjera_session")).toBe(
    false,
  );
});
