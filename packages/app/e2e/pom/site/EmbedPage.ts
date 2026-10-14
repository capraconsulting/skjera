import { expect, type Page } from "@playwright/test";

/** The page the websites show in an iframe: the next events. */
export class EmbedPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto(): Promise<void> {
    await this.page.goto("/embed");
  }

  async expectEvents(): Promise<void> {
    await expect(this.page.getByRole("link").first()).toBeVisible();
  }
}
