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
  await page.goto("/studio/posts");
  await signInAtDex(page, email);
  await expect(page.getByTestId("me")).toHaveText(email);
  return page;
};

export const title = (page: Page) =>
  page.getByRole("textbox", { name: "Title" });
export const body = (page: Page) => page.getByRole("textbox", { name: "Body" });

/** Creates a post from the studio's posts list and returns its id. */
export const newPost = async (page: Page) => {
  await page.getByRole("button", { name: "New post" }).click();
  await expect(page).toHaveURL(/\/studio\/posts\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname.split("/").pop() ?? "";
};

/**
 * Deletes the post open in the editor, and checks it's gone from the studio
 * and the site. Tests end with this, so they leave no posts behind.
 */
export const deletePost = async (page: Page, id: string) => {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/studio\/posts$/);
  await expect(page.locator(`a[href="/studio/posts/${id}"]`)).toHaveCount(0);

  await page.goto(`/posts/${id}`);
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
