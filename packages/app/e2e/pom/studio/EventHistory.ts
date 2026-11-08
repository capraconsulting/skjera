import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

export class EventHistory {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly dialog = () =>
    this.page.getByRole("dialog", { name: m.studio_history() });

  async open(): Promise<void> {
    await this.page
      .getByRole("button", { name: m.studio_history(), exact: true })
      .click();
    await expect(this.dialog()).toBeVisible();
    await expect(this.dialog().getByRole("listitem").first()).toBeVisible();
  }

  entries(kind: string) {
    return this.dialog().getByRole("listitem").filter({ hasText: kind });
  }

  async viewVersion(kind: string): Promise<Page> {
    const opening = this.page.context().waitForEvent("page");
    await this.entries(kind)
      .first()
      .getByRole("link", { name: m.studio_history_view(), exact: true })
      .click();
    const preview = await opening;
    await preview.waitForLoadState();
    return preview;
  }
}
