// Exercise an already-deployed disposable preview. Credentials are read from
// a private local journal; never print them or include login traces.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { EventEditor } from "./pom/studio/EventEditor.ts";
import { TeamsColumn } from "./pom/studio/TeamsColumn.ts";

const journal = process.argv[2];
if (!journal) throw new Error("Pass the private preview journal path");
const state = JSON.parse(readFileSync(journal, "utf8"));
const email = state.email ?? "alice@example.com";
const browser = await chromium.launch({ headless: true });
let stage = "login";
try {
  const context = await browser.newContext({ baseURL: state.url });
  const anonymous = await browser.newContext({ baseURL: state.url });
  expect((await anonymous.request.get("/api/me")).status()).toBe(401);
  const page = await context.newPage();
  await page.goto("/studio/teams");
  await page.locator("#login").fill(email);
  await page.locator("#password").fill(state.password);
  await page.locator("#submit-login").click();
  await expect(page).toHaveURL(`${state.url}/studio/teams`, {
    timeout: 60_000,
  });
  const me = await context.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect((await me.json()).email).toBe(email);
  const session = (await context.cookies()).find((cookie) => cookie.httpOnly);
  expect(session?.secure).toBe(true);
  console.log(
    "PASS: browser OIDC login through Dex and secure authenticated session",
  );

  stage = "database write";
  await new TeamsColumn(page).create(`Preview smoke ${state.pr}`);
  const event = await new EventEditor(page).createPublished({ public: true });
  state.documentId = event.id;
  console.log(
    "PASS: authenticated application creates a team and publishes an Automerge document in PostgreSQL",
  );
  await page.screenshot({ path: join(dirname(journal), "preview.png") });

  stage = "S3 image upload";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  const options = {
    headers: { Origin: state.url, "Content-Type": "application/octet-stream" },
    data: png,
  };
  expect((await anonymous.request.post("/api/images", options)).status()).toBe(
    401,
  );
  expect(
    (
      await context.request.post("/api/images", {
        ...options,
        headers: { ...options.headers, Origin: "https://attacker.invalid" },
      })
    ).status(),
  ).toBe(403);
  const uploaded = await context.request.post("/api/images", options);
  expect(uploaded.status()).toBe(201);
  const image = await uploaded.json();
  expect(image.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  const stored = await anonymous.request.get(image.url);
  expect(stored.status()).toBe(200);
  expect(stored.headers()["content-type"]).toBe("image/png");
  expect(stored.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await stored.body()).toEqual(png);
  expect(
    (
      await anonymous.request.get("/api/images/AAAAAAAAAAAAAAAAAAAAAA")
    ).status(),
  ).toBe(404);
  state.uploadedKey = image.id;
  writeFileSync(journal, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  });
  const oldError = join(dirname(journal), "browser-error.log");
  if (existsSync(oldError)) unlinkSync(oldError);
  console.log(
    "PASS: authenticated S3 upload, anonymous image read, missing-object response and CSRF/auth checks",
  );
} catch (error) {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  writeFileSync(join(dirname(journal), "browser-error.log"), detail, {
    mode: 0o600,
  });
  console.error(
    `Preview browser check failed during ${stage}; see the private browser-error.log`,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
