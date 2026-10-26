import { expect, type Page } from "@playwright/test";

/** The signed-in user's own settings. */
export class AccountPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly main = () => this.page.getByRole("main");

  async goto(): Promise<void> {
    await this.page.goto("/account");
  }

  async expectAt(): Promise<void> {
    await expect(this.page).toHaveURL(/\/account$/);
  }

  async expectHeading(name: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name })).toBeVisible();
  }

  async expectText(text: string): Promise<void> {
    await expect(this.main()).toContainText(text);
  }

  async pickTheme(
    theme: "Dark" | "Light" | "Same as the system",
  ): Promise<void> {
    await this.main().getByRole("radio", { name: theme }).check();
  }

  async expectThemePicked(
    theme: "Dark" | "Light" | "Same as the system",
  ): Promise<void> {
    await expect(this.main().getByRole("radio", { name: theme })).toBeChecked();
  }

  async pickLanguage(
    language: "English" | "Bokmål" | "Nynorsk",
  ): Promise<void> {
    await this.page.getByRole("radio", { name: language }).check();
  }
}
