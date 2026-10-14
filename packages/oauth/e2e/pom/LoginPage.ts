import { expect, type Page } from "@playwright/test";

/** Dex's login page, where the demo sends people to sign in. */
export class LoginPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async signIn(login: string, password = "password"): Promise<void> {
    await this.page.locator("#login").fill(login);
    await this.page.locator("#password").fill(password);
    await this.page.locator("#submit-login").click();
  }

  /** Still at Dex, asking for the login again. */
  async expectShown(): Promise<void> {
    await expect(this.page).toHaveURL(/localhost:5556\/dex/);
    await expect(this.page.locator("#login")).toBeVisible();
  }
}
