import { expect, type Page } from "@playwright/test";
import { expectImagesLoaded } from "../images.ts";

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

  /** A logo shown as an image only: visible, and not inside a link. */
  async expectUnlinkedLogo(name: string): Promise<void> {
    await expect(this.footer().getByRole("img", { name })).toBeVisible();
    await expect(this.footer().getByRole("link", { name })).toHaveCount(0);
  }

  /** The logo image shown now (the theme's version) is this file. */
  async expectLogoFile(name: string, src: string): Promise<void> {
    await expect(this.footer().getByRole("img", { name })).toHaveAttribute(
      "src",
      src,
    );
  }

  /** Every logo shown in the footer has loaded. */
  async expectLogosLoaded(): Promise<void> {
    const images = this.footer().getByRole("img");
    await expectImagesLoaded(images);
  }

  async clickPrivacy(): Promise<void> {
    await this.footer().getByRole("link", { name: "Privacy" }).click();
  }
}
