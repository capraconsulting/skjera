import { expect, type Locator, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/** The studio's own question dialog: the question, Cancel and one more button. */
export class Confirmation {
  private readonly dialog: Locator;

  constructor(page: Page) {
    this.dialog = page.getByRole("alertdialog");
  }

  /** Waits for the question and returns it; it has Cancel and an action. */
  async question(): Promise<string> {
    await expect(this.dialog).toBeVisible();
    await expect(this.dialog.getByRole("button")).toHaveCount(2);
    await expect(
      this.dialog.getByRole("button", { name: m.common_cancel(), exact: true }),
    ).toBeVisible();
    return (await this.dialog.getByRole("heading").textContent()) ?? "";
  }

  /** Chooses the button named for the action. */
  async accept(action: string): Promise<void> {
    await this.dialog
      .getByRole("button", { name: action, exact: true })
      .click();
    await this.expectClosed();
  }

  async dismiss(): Promise<void> {
    await this.dialog
      .getByRole("button", { name: m.common_cancel(), exact: true })
      .click();
    await this.expectClosed();
  }

  async dismissWithEscape(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await this.dialog.press("Escape");
    await this.expectClosed();
  }

  async expectClosed(): Promise<void> {
    await expect(this.dialog).toHaveCount(0);
  }
}
