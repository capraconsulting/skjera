import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import type { Locale } from "@skjera/i18n/runtime";

/** The site's privacy page. */
export class PrivacyPage {
  private readonly page: Page;
  /** The language the page is read in. */
  private readonly locale: Locale;

  constructor(page: Page, locale: Locale = "en") {
    this.page = page;
    this.locale = locale;
  }

  private readonly policy = () => this.page.getByRole("article");
  /** The part on cookies. */
  private readonly cookies = () =>
    this.page.locator("section").filter({
      has: this.page.getByRole("heading", {
        name: m.privacy_cookies_heading({}, { locale: this.locale }),
      }),
    });
  private readonly cookieSettings = () =>
    this.cookies().getByRole("button", {
      name: m.privacy_cookie_settings({}, { locale: this.locale }),
    });

  async goto(): Promise<void> {
    await this.page.goto("/privacy");
  }

  async expectAt(): Promise<void> {
    await expect(this.page).toHaveURL(/\/privacy$/);
  }

  async expectTitle(): Promise<void> {
    await expect(
      this.page.getByRole("heading", {
        name: m.privacy_title({}, { locale: this.locale }),
        level: 1,
      }),
    ).toBeVisible();
  }

  async expectText(text: string): Promise<void> {
    await expect(this.policy()).toContainText(text);
  }

  async expectContactEmail(email: string): Promise<void> {
    await expect(
      this.policy().getByRole("link", { name: email }),
    ).toHaveAttribute("href", `mailto:${email}`);
  }

  async expectCookiesText(text: string): Promise<void> {
    await expect(this.cookies()).toContainText(text);
  }

  async expectCookiesWithout(text: string): Promise<void> {
    await expect(this.cookies()).not.toContainText(text);
  }

  async clickCookieSettings(): Promise<void> {
    await this.cookieSettings().click();
  }

  async expectNoCookieSettings(): Promise<void> {
    await expect(this.cookieSettings()).toHaveCount(0);
  }
}
