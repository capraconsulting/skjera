import { expect, type Page } from "@playwright/test";
import { dexFormIds, dexIssuerUrl } from "@skjera/test";

/** Dex's login page, where the demo sends people to sign in. */
export class LoginPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async signIn(login: string, password = "password"): Promise<void> {
    await this.page.locator(dexFormIds.login).fill(login);
    await this.page.locator(dexFormIds.password).fill(password);
    await this.page.locator(dexFormIds.submit).click();
  }

  /** Still at Dex, asking for the login again. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(dexIssuerUrl(process.env)));
    await expect(this.page.locator(dexFormIds.login)).toBeVisible();
  }
}
