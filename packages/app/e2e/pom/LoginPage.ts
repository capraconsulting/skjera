import { expect, type Page } from "@playwright/test";
import { dexFormIds, testServerDexIssuerUrl } from "@skjera/test";

/** Dex's login page, where the studio sends people to sign in. */
export class LoginPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async signIn(email: string): Promise<void> {
    await this.page.locator(dexFormIds.login).fill(email);
    await this.page.locator(dexFormIds.password).fill("password");
    await this.page.locator(dexFormIds.submit).click();
  }

  /** Dex is at the machine's test-server address, or localhost without one. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`${testServerDexIssuerUrl(process.env)}/`),
    );
  }
}
