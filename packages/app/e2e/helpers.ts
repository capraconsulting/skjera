import {
  type Browser,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

/** A browser of its own, with no session. */
export const visitor = async (browser: Browser) =>
  (await browser.newContext()).newPage();

export const signInAtDex = async (page: Page, email: string) => {
  await page.locator("#login").fill(email);
  await page.locator("#password").fill("password");
  await page.locator("#submit-login").click();
};

/** A browser of its own for a Dex test user, logged in to the studio. */
export const signedIn = async (browser: Browser, email: string) => {
  const page = await visitor(browser);
  await page.goto("/studio/teams");
  await signInAtDex(page, email);
  await expect(page.getByTestId("me")).toHaveText(email);
  return page;
};

export const title = (page: Page) =>
  page.getByRole("textbox", { name: "Title" });
export const body = (page: Page) => page.getByRole("textbox", { name: "Body" });

const lastPathSegment = (page: Page) =>
  new URL(page.url()).pathname.split("/").pop() ?? "";

/** A team name no other test run uses. */
export const uniqueTeamName = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The teams column's link to a team, which is marked while selected. */
export const teamLink = (page: Page, name: string) =>
  page.getByRole("region", { name: "Teams" }).getByRole("link", { name });

/** Opens the dialog for naming a new team. */
export const openNewTeamDialog = async (page: Page) => {
  await page.getByRole("button", { name: "Team list options" }).click();
  await page.getByRole("button", { name: "New team" }).click();
  const dialog = page.getByRole("dialog", { name: "New team" });
  await expect(dialog).toBeVisible();
  return dialog;
};

/** Opens a team's own "⋯" menu in the teams column. */
export const openTeamMenu = async (page: Page, id: string) => {
  const row = page
    .getByRole("region", { name: "Teams" })
    .getByRole("listitem")
    .filter({ has: page.locator(`a[href="/studio/teams/${id}"]`) });
  await row.hover();
  await row.getByRole("button", { name: /^Options for / }).click();
};

/** Creates a team with the "New team" dialog, opens it and returns its id. */
export const newTeam = async (page: Page, name: string) => {
  await page.goto("/studio/teams");
  const dialog = await openNewTeamDialog(page);
  await dialog.getByRole("textbox", { name: "Team name" }).fill(name);
  await dialog.getByRole("button", { name: "Create team" }).click();
  await expect(dialog).toBeHidden();
  await expect(teamLink(page, name)).toHaveAttribute("aria-current", "page");
  return lastPathSegment(page);
};

/** Creates an event in the open team and returns its id. */
export const newEvent = async (page: Page) => {
  const before = page.url();
  await page.getByRole("button", { name: "New event" }).click();
  // Wait for the new event, also when another one was open.
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(
    /\/studio\/teams\/[0-9a-f-]+\/events\/[0-9a-f-]+$/,
  );
  return lastPathSegment(page);
};

/** The studio URL of an event. */
export const eventPath = (team: string, event: string) =>
  `/studio/teams/${team}/events/${event}`;

/** Deletes a team that has no events left, and checks it's gone. */
export const deleteTeam = async (page: Page, id: string) => {
  await page.goto(`/studio/teams/${id}`);
  await openTeamMenu(page, id);
  await page.getByRole("button", { name: "Delete team" }).click();
  await expect(page).toHaveURL(/\/studio\/teams$/);
  await expect(page.locator(`a[href="/studio/teams/${id}"]`)).toHaveCount(0);
};

/**
 * Deletes the event open in the editor, and checks it's gone from the studio
 * and the site. Tests end with this, so they leave no events behind.
 */
export const deleteEvent = async (page: Page, id: string) => {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  // Back on the event's team, without the event.
  await expect(page).toHaveURL(/\/studio\/teams\/[0-9a-f-]+$/);
  await expect(page.locator(`a[href$="/events/${id}"]`)).toHaveCount(0);

  await page.goto(`/events/${id}`);
  await expect(page.getByText("isn't published")).toBeVisible();
};

/**
 * Puts the caret at the start or end of an editor. Pressing Home/End right
 * after focusing is flaky: 20ms after an editor gains focus, ProseMirror
 * writes its own stored selection back into the DOM, which can land after
 * the key press. So focus, wait that out, then set the selection.
 */
export const placeCaret = (editor: Locator, where: "start" | "end") =>
  editor.evaluate(async (element, atStart) => {
    (element as HTMLElement).focus();
    await new Promise((settled) => setTimeout(settled, 100));
    await new Promise<void>((resolve) => {
      const range = document.createRange();
      range.selectNodeContents(element.querySelector("p") ?? element);
      range.collapse(atStart);
      // ProseMirror reads the new selection in its own `selectionchange`
      // listener, which was added before this one and so runs first.
      document.addEventListener("selectionchange", () => resolve(), {
        once: true,
      });
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
  }, where === "start");

/**
 * Types at the start or end of an editor. Uses the keyboard directly, since
 * `pressSequentially` focuses the element again and can move the caret.
 */
export const typeAt = async (
  editor: Locator,
  where: "start" | "end",
  text: string,
) => {
  await placeCaret(editor, where);
  await editor.page().keyboard.type(text);
};

/**
 * Picks the 15th of the current month in the editor's date field, and
 * returns it as the date the site shows ("Thursday, October 15, 2026").
 */
export const pickDate = async (page: Page) => {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), 15);
  const month = day.toLocaleDateString("en-US", { month: "long" });
  const field = page.getByRole("button", { name: "Date", exact: true });
  await field.click();
  await page
    .getByRole("button", {
      name: new RegExp(`${month} 15th, ${day.getFullYear()}`),
    })
    .click();
  const shown = day.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  await expect(field).toHaveText(shown);
  return shown;
};

/**
 * Creates an event in the open team, fills it in and publishes it. Returns
 * its id and title.
 */
export const publishedEvent = async (
  page: Page,
  options: { readonly public: boolean; readonly guests?: boolean },
) => {
  const id = await newEvent(page);
  const eventTitle = `Meetup ${id.slice(-12)}`;
  await title(page).pressSequentially(eventTitle);
  await pickDate(page);
  if (options.public) {
    await page.getByRole("checkbox", { name: /Public event/ }).check();
  }
  if (options.guests) {
    await page.getByRole("checkbox", { name: /Guests can sign up/ }).check();
  }
  await expect(page.getByTestId("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("status")).toContainText("Published");
  return { id, title: eventTitle };
};
