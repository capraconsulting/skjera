import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/** The page a cancel link from an email opens: the event's title, and a button that cancels. */
export class CancelSignupPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly confirmButton = () =>
    this.page.getByRole("button", { name: m.cancel_confirm() });

  /** Opens the link from the email. */
  async goto(link: string): Promise<void> {
    await this.page.goto(link);
  }

  /** The page shows the event's title, and the button that cancels. */
  async expectTitle(title: string): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: title, level: 1 }),
    ).toBeVisible();
    await expect(this.confirmButton()).toBeVisible();
  }

  async confirm(): Promise<void> {
    await this.confirmButton().click();
  }

  async expectText(text: string): Promise<void> {
    await expect(this.page.getByRole("main")).toContainText(text);
  }

  /** Follows the link to the event's page. */
  async clickToEvent(): Promise<void> {
    await this.page.getByRole("link", { name: m.cancel_to_event() }).click();
  }
}
