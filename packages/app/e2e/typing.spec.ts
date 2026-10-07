import { expect, type Page, test } from "@playwright/test";
import {
  body,
  connection,
  deleteEvent,
  deleteTeam,
  eventPath,
  newEvent,
  newTeam,
  placeCaret,
  signedIn,
  typeAt,
  uniqueTeamName,
} from "./helpers.ts";

/** Characters in `text`, sorted, to compare text regardless of interleaving. */
const letters = (text: string) => [...text].sort().join("");

/** Types `text` a key at a time, as fast as a quick typist. */
const typeFast = async (page: Page, text: string) => {
  for (const key of text) await page.keyboard.type(key, { delay: 15 });
};

test("no keystroke is lost when two people type at once", async ({
  browser,
}) => {
  test.slow();
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Typing"));
  const id = await newEvent(alice);
  const bob = await signedIn(browser, "bob@example.com");
  await bob.goto(eventPath(team, id));
  await expect(body(bob)).toBeVisible();

  // Both type into the body at once, each at their own end of it.
  const fromAlice = "alice types this text, quickly and without pause. ".repeat(
    3,
  );
  const fromBob = "BOB TYPES THIS OTHER TEXT AT THE SAME TIME! ".repeat(3);
  await body(alice).pressSequentially("[]");
  await expect(body(bob)).toHaveText("[]");
  await placeCaret(body(alice), "start");
  await placeCaret(body(bob), "end");
  await Promise.all([typeFast(alice, fromAlice), typeFast(bob, fromBob)]);

  // Everything arrives everywhere, with nothing lost or doubled.
  const expected = letters(`[]${fromAlice}${fromBob}`);
  for (const page of [alice, bob]) {
    await expect
      .poll(async () => letters((await body(page).textContent()) ?? ""), {
        timeout: 15_000,
      })
      .toBe(expected);
  }
  const text = await body(alice).textContent();
  await expect(body(bob)).toHaveText(text ?? "");
  // Each person's text stays in one piece.
  expect(text).toContain(fromAlice);
  expect(text).toContain(fromBob);

  // And the server has it all.
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await expect(bob.getByTestId("status")).toContainText("Saved");
  const fresh = await signedIn(browser, "alice@example.com");
  await fresh.goto(eventPath(team, id));
  await expect(body(fresh)).toHaveText(text ?? "");

  await deleteEvent(alice, id);
  await deleteTeam(alice, team);
});

test("edits made offline are kept, and synced once back online", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Offline"));
  const id = await newEvent(alice);
  await body(alice).pressSequentially("Alice was here.");

  const bob = await signedIn(browser, "bob@example.com");
  const bobsConnection = await connection(bob);
  await bob.goto(eventPath(team, id));
  await expect(body(bob)).toHaveText("Alice was here.");

  // Bob loses his connection, and keeps writing while Alice does too.
  await bobsConnection.offline();
  await typeAt(body(bob), "end", " Bob wrote this offline.");
  await typeAt(body(alice), "start", "Hi! ");
  await expect(bob.getByTestId("status")).toContainText("Saving");
  await bob.waitForTimeout(500);
  await expect(body(alice)).toHaveText("Hi! Alice was here.");

  // His edits survive reloading the page, and merge with Alice's.
  bobsConnection.online();
  await bob.reload();
  const merged = "Hi! Alice was here. Bob wrote this offline.";
  await expect(body(bob)).toHaveText(merged);
  await expect(body(alice)).toHaveText(merged);
  await expect(bob.getByTestId("status")).toContainText("Saved");

  await deleteEvent(alice, id);
  await deleteTeam(alice, team);
});

/** How many records the studio keeps in this browser's IndexedDB. */
const localRecords = (page: Page) =>
  page.evaluate(async () => {
    let count = 0;
    for (const { name } of await indexedDB.databases()) {
      if (name === undefined || !name.startsWith("skjera ")) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (db.objectStoreNames.contains("documents")) {
        count += await new Promise<number>((resolve, reject) => {
          const request = db
            .transaction("documents")
            .objectStore("documents")
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      db.close();
    }
    return count;
  });

test("logging out deletes the local copies", async ({ browser }) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await newTeam(alice, uniqueTeamName("Logout"));
  const id = await newEvent(alice);
  await body(alice).pressSequentially("Kept here for a while");
  await expect(alice.getByTestId("status")).toContainText("Saved");
  await expect.poll(() => localRecords(alice)).toBeGreaterThan(0);

  await alice.getByRole("button", { name: "Account menu" }).click();
  await alice.getByRole("button", { name: "Log out" }).click();
  await expect(alice.getByTestId("me")).toHaveCount(0);
  expect(await localRecords(alice)).toBe(0);

  const again = await signedIn(browser, "alice@example.com");
  await again.goto(eventPath(team, id));
  await expect(body(again)).toHaveText("Kept here for a while");
  await deleteEvent(again, id);
  await deleteTeam(again, team);
});
