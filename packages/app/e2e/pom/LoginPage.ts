import { expect, type Page } from "@playwright/test";
import { testServerDexIssuerUrl } from "@skjera/test";

/** Dex's login page, where the studio sends people to sign in. */
export class LoginPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async signIn(email: string): Promise<void> {
    await this.page.locator("#login").fill(email);
    await this.page.locator("#password").fill("password");
    await this.page.locator("#submit-login").click();
  }

  /** Dex is at the machine's test-server address, or localhost without one. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`${testServerDexIssuerUrl(process.env)}/`),
    );
  }
}
