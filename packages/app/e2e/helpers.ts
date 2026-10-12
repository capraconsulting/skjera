import {
  type Browser,
  expect,
  type Locator,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import { locales } from "@skjera/i18n/runtime";

// The smallest valid PNG: one transparent pixel.
export const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

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
  await expect(page.getByTestId("me")).toHaveAttribute("title", email);
  return page;
};

/**
 * Controls a page's live connections to the server: its WebSockets.
 * Set it up before the page opens the socket, e.g. before navigating.
 */
export const connection = async (page: Page) => {
  let online = true;
  const open = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/automerge$/, (ws) => {
    if (!online) {
      ws.close();
      return;
    }
    ws.connectToServer();
    open.add(ws);
  });
  return {
    offline: async () => {
      online = false;
      for (const ws of open) await ws.close();
      open.clear();
    },
    online: () => {
      online = true;
    },
  };
};

export const title = (page: Page) =>
  page.getByRole("textbox", { name: "Title" });
export const body = (page: Page) => page.getByRole("textbox", { name: "Body" });
export const place = (page: Page) =>
  page.getByRole("textbox", { name: "Place", exact: true });

/** Where events are, unless a test says otherwise. */
export const defaultPlace = "Kantina";

/** Writes where the open event is. */
export const writePlace = async (page: Page, text = defaultPlace) => {
  await place(page).pressSequentially(text);
  await expect(place(page)).toHaveText(text);
};

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

/**
 * Gives a team a logo for a theme through its logo dialog, and returns the
 * logo's address.
 */
export const setTeamLogo = async (
  page: Page,
  teamId: string,
  theme: "light" | "dark",
) => {
  await page.goto(`/studio/teams/${teamId}`);
  await openTeamMenu(page, teamId);
  await page.getByRole("button", { name: "Logo…" }).click();
  const dialog = page.getByRole("dialog", { name: "Team logo" });
  await dialog.getByLabel(`Logo file for the ${theme} theme`).setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  const logo = dialog.getByRole("img", { name: `Logo for the ${theme} theme` });
  await expect(logo).toBeVisible();
  const src = await logo.getAttribute("src");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
  return src ?? "";
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
 * and the site. Its attendees are emailed that it's cancelled: once they
 * are, the emails about it are cleared (they link to it). Tests end with
 * this, so they leave no events, or emails, behind.
 */
export const deleteEvent = async (page: Page, id: string) => {
  const eventTitle = (await title(page).textContent()) ?? "";
  // Who's signed up now: freshly pulled, as someone may just have left.
  await page.reload();
  const heading = page
    .getByRole("region", { name: "Attendees" })
    .getByRole("heading", { name: /^Attendees \(\d+\)$/ });
  const signedUp = Number(/\d+/.exec((await heading.textContent()) ?? "")?.[0]);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  // Back on the event's team, without the event.
  await expect(page).toHaveURL(/\/studio\/teams\/[0-9a-f-]+$/);
  await expect(page.locator(`a[href$="/events/${id}"]`)).toHaveCount(0);

  await page.goto(`/events/${id}`);
  await expect(page.getByText("isn't published")).toBeVisible();
  // (Titles are unique: see publishedEvent.) In each one's language.
  const subjects: ReadonlyArray<string> = locales.map((locale) =>
    m.email_cancelled_subject({ title: eventTitle }, { locale }),
  );
  const cancelled = async () => {
    // Mailpit matches subjects by what they contain: "Signup cancelled: …"
    // too.
    const { messages } = (await mailpit(
      `/search?query=${encodeURIComponent(`subject:"${eventTitle}"`)}`,
    )) as { messages: ReadonlyArray<MailpitSummary> };
    return messages.filter((message) => subjects.includes(message.Subject));
  };
  if (signedUp > 0) {
    await expect.poll(async () => (await cancelled()).length).toBe(signedUp);
    await mailpit("/messages", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: (await cancelled()).map((each) => each.ID) }),
    });
  }
  await deleteEmailsAbout(id);
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
 * Sets the event to start at 18:00 on the 15th of next month, so sign-up
 * is open; it ends two hours later. Returns the day as the site shows it
 * ("Sunday, November 15, 2026").
 */
export const pickTimes = async (page: Page) => {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth() + 1, 15);
  const month = day.toLocaleDateString("en-US", { month: "long" });
  const field = page.getByRole("button", { name: "Start date" });
  await field.click();
  await page.getByRole("button", { name: /next month/i }).click();
  await page
    .getByRole("button", {
      name: new RegExp(`${month} 15th, ${day.getFullYear()}`),
    })
    .click();
  await page.getByLabel("Start time").fill("18:00");
  const shown = day.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  await expect(field).toHaveText(shown);
  await expect(page.getByLabel("Start time")).toHaveValue("18:00");
  await expect(page.getByLabel("End time")).toHaveValue("20:00");
  return shown;
};

/**
 * Creates an event in the open team, fills it in and publishes it. Returns
 * its id and title.
 */
export const publishedEvent = async (
  page: Page,
  options: {
    readonly public: boolean;
    readonly guests?: boolean;
    readonly dietary?: boolean;
    /** The most who can sign up; none by default. */
    readonly maxAttendees?: number;
    /** Streamed, with a link to the stream if given; not streamed by default. */
    readonly streamed?: { readonly link?: string };
    /** Tags, added one by one; none by default. */
    readonly tags?: ReadonlyArray<string>;
  },
) => {
  const id = await newEvent(page);
  const eventTitle = `Meetup ${id.slice(-12)}`;
  await title(page).pressSequentially(eventTitle);
  await pickTimes(page);
  await writePlace(page);
  if (options.tags !== undefined && options.tags.length > 0) {
    const tagInput = page.getByRole("combobox", { name: "Tags" });
    for (const tag of options.tags) {
      await tagInput.fill(tag);
      await tagInput.press("Enter");
    }
    // Done tagging: the suggestions close.
    await tagInput.press("Escape");
  }
  if (options.public) {
    await page.getByRole("checkbox", { name: /Public event/ }).check();
  }
  if (options.guests) {
    await page.getByRole("checkbox", { name: /Guests can sign up/ }).check();
  }
  if (options.dietary) {
    await page.getByRole("checkbox", { name: /Food is served/ }).check();
  }
  if (options.maxAttendees !== undefined) {
    await page
      .getByRole("spinbutton", { name: "Maximum attendees" })
      .fill(String(options.maxAttendees));
  }
  if (options.streamed !== undefined) {
    await page.getByRole("checkbox", { name: /The event is streamed/ }).check();
    if (options.streamed.link !== undefined) {
      const link = page.getByRole("textbox", { name: "Link to the stream" });
      await link.pressSequentially(options.streamed.link);
      await expect(link).toHaveText(options.streamed.link);
    }
  }
  await expect(page.getByTestId("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("status")).toContainText("Published");
  return { id, title: eventTitle };
};

/** Mailpit's API (compose.yml): where the server's emails go in development. */
const mailpit = async (path: string, init?: RequestInit) => {
  const response = await fetch(`http://localhost:8025/api/v1${path}`, init);
  if (!response.ok) throw new Error(`Mailpit: ${response.status} ${path}`);
  return response.headers.get("content-type")?.includes("json")
    ? response.json()
    : response.text();
};

interface MailpitSummary {
  readonly ID: string;
  readonly Subject: string;
}

/** The email to `address` with `subject`, once it has come: its text and MIME. */
export const emailTo = async (address: string, subject: string) => {
  let found: MailpitSummary | undefined;
  await expect
    .poll(
      async () => {
        const { messages } = (await mailpit(
          `/search?query=${encodeURIComponent(`to:"${address}"`)}`,
        )) as { messages: ReadonlyArray<MailpitSummary> };
        found = messages.find((message) => message.Subject === subject);
        return found !== undefined;
      },
      { message: `an email to ${address}: ${subject}` },
    )
    .toBe(true);
  const { Text } = (await mailpit(`/message/${found?.ID}`)) as {
    readonly Text: string;
  };
  const raw = (await mailpit(`/message/${found?.ID}/raw`)) as string;
  return { text: Text, raw };
};

/** Clears the emails about the event `id` out of Mailpit. */
const deleteEmailsAbout = (id: string) =>
  mailpit(`/search?query=${encodeURIComponent(`"${id}"`)}`, {
    method: "DELETE",
  });

/** Clears the emails to `address` out of Mailpit. */
export const deleteEmailsTo = (address: string) =>
  mailpit(`/search?query=${encodeURIComponent(`to:"${address}"`)}`, {
    method: "DELETE",
  });
