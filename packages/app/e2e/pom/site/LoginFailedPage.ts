import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import type { Locale } from "@skjera/i18n/runtime";

type Failure = "denied" | "expired" | "failed";

/** The page a failed login ends on, with its way back. */
export class LoginFailedPage {
  private readonly page: Page;
  /** The language the page is read in. */
  private readonly locale: Locale;

  constructor(page: Page, locale: Locale = "en") {
    this.page = page;
    this.locale = locale;
  }

  private readonly title = (failure: Failure) => {
    const words = {
      denied: m.site_login_denied_title,
      expired: m.site_login_expired_title,
      failed: m.site_login_failed_title,
    };
    return words[failure]({}, { locale: this.locale });
  };
  private readonly logInAgain = () =>
    this.page.getByRole("button", {
      name: m.site_login_again({}, { locale: this.locale }),
    });
  private readonly frontPage = () =>
    this.page.getByRole("link", {
      name: m.site_login_front_page({}, { locale: this.locale }),
    });

  /** The page says what failed, and has the way to the front page. */
  private async expectShown(failure: Failure): Promise<void> {
    await expect(
      this.page.getByRole("heading", { name: this.title(failure), level: 1 }),
    ).toBeVisible();
    await expect(this.frontPage()).toBeVisible();
  }

  async expectDenied(): Promise<void> {
    await this.expectShown("denied");
    await expect(this.logInAgain()).toHaveCount(0);
  }

  async expectExpired(): Promise<void> {
    await this.expectShown("expired");
    await expect(this.logInAgain()).toBeVisible();
  }

  async expectFailed(): Promise<void> {
    await this.expectShown("failed");
    await expect(this.logInAgain()).toBeVisible();
  }

  async clickLogInAgain(): Promise<void> {
    await this.logInAgain().click();
  }

  async clickFrontPage(): Promise<void> {
    await this.frontPage().click();
  }

  /** Records the provider's callback, as the browser follows it. */
  watchCallback(): { readonly url: () => string | undefined } {
    let url: string | undefined;
    this.page.on("request", (request) => {
      if (request.url().includes("/auth/callback")) url = request.url();
    });
    return { url: () => url };
  }

  /** The status of the callback's answer, once it comes. */
  async callbackStatus(): Promise<number> {
    const response = await this.page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === "/auth/callback",
    );
    return response.status();
  }

  /** Opens a callback's address by hand, e.g. one used before or forged. */
  async openCallback(address: string): Promise<void> {
    await this.page.goto(address);
  }
}
