import { expect, type Page } from "@playwright/test";

/** The site's footer, as configured (SITE_FOOTER, SITE_OPERATOR, …). */
export class Footer {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly footer = () => this.page.getByRole("contentinfo");

  async expectText(text: string): Promise<void> {
    await expect(this.footer()).toContainText(text);
  }

  async expectLink(name: string, href: string): Promise<void> {
    await expect(this.footer().getByRole("link", { name })).toHaveAttribute(
      "href",
      href,
    );
  }

  async clickPrivacy(): Promise<void> {
    await this.footer().getByRole("link", { name: "Privacy" }).click();
  }
}
