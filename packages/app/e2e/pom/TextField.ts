import { expect, type Locator } from "@playwright/test";

/**
 * A text editor in the studio or the playground: the title, the body, the
 * place, an email's text. Typed into the way people type.
 */
export class TextField {
  private readonly editor: Locator;

  constructor(editor: Locator) {
    this.editor = editor;
  }

  /** Types `text` where the caret is, focusing the field first. */
  async type(text: string): Promise<void> {
    await this.editor.pressSequentially(text);
  }

  async press(key: string): Promise<void> {
    await this.editor.press(key);
  }

  async click(): Promise<void> {
    await this.editor.click();
  }

  async focus(): Promise<void> {
    await this.editor.focus();
  }

  /**
   * Types at the start or end. Uses the keyboard directly, since
   * `pressSequentially` focuses the element again and can move the caret.
   */
  async typeAt(where: "start" | "end", text: string): Promise<void> {
    await this.placeCaret(where);
    await this.editor.page().keyboard.type(text);
  }

  /** Types `text` where the caret is, a key at a time, `delay` ms each. */
  async typeKeys(text: string, delay: number): Promise<void> {
    for (const key of text) {
      await this.editor.page().keyboard.type(key, { delay });
    }
  }

  async text(): Promise<string> {
    return (await this.editor.textContent()) ?? "";
  }

  async expectText(text: string | RegExp): Promise<void> {
    await expect(this.editor).toHaveText(text);
  }

  async expectVisible(): Promise<void> {
    await expect(this.editor).toBeVisible();
  }

  async expectAbsent(): Promise<void> {
    await expect(this.editor).toHaveCount(0);
  }

  async expectLink(name: string): Promise<void> {
    await expect(this.editor.getByRole("link", { name })).toBeVisible();
  }

  /** The text `name` is linked, to `href`. */
  async expectLinkTo(name: string, href: string): Promise<void> {
    await expect(this.editor.getByRole("link", { name })).toHaveAttribute(
      "href",
      href,
    );
  }

  async expectNoLink(name: string): Promise<void> {
    await expect(this.editor.getByRole("link", { name })).toHaveCount(0);
  }

  /** Someone else's caret in the field, with their name. */
  async expectCaretOf(name: string, shown: boolean): Promise<void> {
    const caret = this.editor.locator(`[data-name="${name}"]`);
    if (shown) await expect(caret).toBeVisible();
    else await expect(caret).toHaveCount(0);
  }

  /** As if the window lost focus: switched to another window or app. */
  async leaveWindow(): Promise<void> {
    await this.editor.evaluate((editor) => {
      document.hasFocus = () => false;
      (editor as HTMLElement).blur();
    });
  }

  /** As if the window has focus again. */
  async returnToWindow(): Promise<void> {
    await this.editor.evaluate(() => {
      document.hasFocus = () => true;
    });
  }

  /**
   * Puts the caret at the start or end, and checks it stays there:
   * ProseMirror sometimes writes its own selection back right after, so
   * it's put there again until it holds.
   */
  async placeCaret(where: "start" | "end"): Promise<void> {
    await expect(async () => {
      await this.setCaret(where);
      expect(await this.caretOffset()).toBe(
        where === "start"
          ? 0
          : await this.editor.evaluate(
              (element) =>
                (element.querySelector("p") ?? element).textContent?.length,
            ),
      );
    }).toPass({ timeout: 5_000 });
  }

  /** Sets the selection after focusing the editor. */
  private setCaret(where: "start" | "end") {
    return this.editor.evaluate((element, atStart) => {
      (element as HTMLElement).focus();
      const range = document.createRange();
      range.selectNodeContents(element.querySelector("p") ?? element);
      range.collapse(atStart);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, where === "start");
  }

  /** Where the caret is in the first paragraph, in characters. */
  private caretOffset() {
    return this.editor.evaluate((element) => {
      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) return null;
      const caret = selection.getRangeAt(0);
      if (!caret.collapsed || !element.contains(caret.startContainer))
        return null;
      const before = document.createRange();
      before.selectNodeContents(element.querySelector("p") ?? element);
      before.setEnd(caret.startContainer, caret.startOffset);
      return before.toString().length;
    });
  }
}
