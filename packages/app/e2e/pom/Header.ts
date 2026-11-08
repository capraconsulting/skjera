import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/** The header on every page, the site's and the studio's. */
export class Header {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly brand = () =>
    this.page.getByRole("link", {
      name: "Skjera",
      exact: true,
    });
  private readonly studio = () =>
    this.page.getByRole("link", { name: m.common_studio(), exact: true });
  private readonly logIn = () =>
    this.page.getByRole("link", { name: m.common_log_in() });
  private readonly me = () => this.page.getByTestId("me");
  private readonly accountMenuButton = () =>
    this.page.getByRole("button", { name: m.common_account_menu() });
  private readonly accountMenu = () => this.page.locator(":popover-open");
  private readonly subscribe = () =>
    this.page
      .getByRole("banner")
      .getByRole("link", { name: m.common_subscribe() });
  private readonly root = () => this.page.locator("html");

  async clickBrand(): Promise<void> {
    await this.brand().click();
  }

  /**
   * Clicks the site's name, and waits for the session asked for again: on
   * the front page, its loader runs again.
   */
  async clickBrandReloadingSession(): Promise<void> {
    const loaded = this.page.waitForResponse((response) =>
      response.url().endsWith("/api/me"),
    );
    await this.clickBrand();
    await loaded;
  }

  async clickStudio(): Promise<void> {
    await this.studio().click();
  }

  async clickLogIn(): Promise<void> {
    await this.logIn().click();
  }

  async expectLogIn(): Promise<void> {
    await expect(this.logIn()).toBeVisible();
  }

  async expectStudioLink(): Promise<void> {
    await expect(this.studio()).toBeVisible();
  }

  async expectNoStudioLink(): Promise<void> {
    await expect(this.studio()).toHaveCount(0);
  }

  async expectStudioCurrent(current: boolean): Promise<void> {
    if (current) {
      await expect(this.studio()).toHaveAttribute("aria-current", "page");
    } else {
      await expect(this.studio()).not.toHaveAttribute("aria-current");
    }
  }

  async expectSignedInAs(email: string): Promise<void> {
    await expect(this.me()).toHaveAttribute("title", email);
  }

  /** The menu shows the picture from the login, loaded, and not the initials. */
  async expectProfilePicture(src: string): Promise<void> {
    const picture = this.accountMenuButton().locator("img");
    await expect(picture).toHaveAttribute("alt", "Profile picture");
    await expect(picture).toHaveAttribute("src", src);
    await expect
      .poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  }

  /** The menu shows no picture, so it shows the initials. */
  async expectNoProfilePicture(): Promise<void> {
    await expect(this.accountMenuButton()).toBeVisible();
    await expect(this.accountMenuButton().locator("img")).toHaveCount(0);
  }

  async expectSignedOut(): Promise<void> {
    await expect(this.me()).toHaveCount(0);
  }

  async openAccountMenu(): Promise<void> {
    await this.accountMenuButton().click();
  }

  async expectAccountMenuShows(text: string): Promise<void> {
    await expect(this.accountMenu()).toContainText(text);
  }

  async expectAccountMenuWithoutSubscribe(): Promise<void> {
    await expect(
      this.accountMenu().getByRole("link", { name: m.account_settings() }),
    ).toBeVisible();
    await expect(
      this.accountMenu().getByRole("link", { name: m.common_subscribe() }),
    ).toHaveCount(0);
  }

  async clickAccountSettings(): Promise<void> {
    await this.accountMenu()
      .getByRole("link", { name: m.account_settings() })
      .click();
  }

  async logOut(): Promise<void> {
    await this.openAccountMenu();
    await this.page.getByRole("button", { name: m.common_log_out() }).click();
  }

  async closeMenu(): Promise<void> {
    await this.page.keyboard.press("Escape");
  }

  async expectSubscribe(): Promise<void> {
    await expect(this.subscribe()).toBeVisible();
  }

  async expectNoSubscribe(): Promise<void> {
    await expect(
      this.page.getByRole("link", { name: m.common_subscribe() }),
    ).toHaveCount(0);
  }

  /** Follows the Subscribe link, which opens `url` in a new tab. */
  async clickSubscribeOpening(url: string): Promise<void> {
    const popup = this.page.waitForEvent("popup");
    await this.subscribe().click();
    await expect(await popup).toHaveURL(url);
  }

  /** The Subscribe link and the account menu fit the window, whole. */
  async expectSubscribeAndAccountMenuFit(): Promise<void> {
    for (const control of [this.subscribe(), this.accountMenuButton()]) {
      await expect(control).toBeVisible();
      await expect(control).toBeInViewport({ ratio: 1 });
    }
  }

  async selectLanguage(
    language: "English" | "Bokmål" | "Nynorsk",
    label = "Language",
  ): Promise<void> {
    await this.page
      .getByRole("combobox", { name: label })
      .selectOption(language);
  }

  async expectLanguagePicked(
    locale: string,
    label = "Language",
  ): Promise<void> {
    await expect(this.page.getByRole("combobox", { name: label })).toHaveValue(
      locale,
    );
  }

  async expectPageLanguage(locale: string): Promise<void> {
    await expect(this.root()).toHaveAttribute("lang", locale);
  }

  /** Picks a theme from the header's menu: "Light", "Dark" or the system's. */
  async pickTheme(
    theme: "Light" | "Dark" | "Same as the system",
  ): Promise<void> {
    await this.page
      .getByRole("button", { name: m.account_theme(), exact: true })
      .click();
    await this.page.getByRole("button", { name: theme, exact: true }).click();
  }

  /** The theme the header's menu marks as picked. */
  async expectThemePicked(
    theme: "Light" | "Dark" | "Same as the system",
  ): Promise<void> {
    await this.page
      .getByRole("button", { name: m.account_theme(), exact: true })
      .click();
    await expect(
      this.page.getByRole("button", { name: theme, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await this.page.keyboard.press("Escape");
  }

  /** The theme picked, or `null` for the system's. */
  async expectTheme(theme: "light" | "dark" | null): Promise<void> {
    if (theme === null) {
      await expect(this.root()).not.toHaveAttribute("data-theme");
    } else {
      await expect(this.root()).toHaveAttribute("data-theme", theme);
    }
  }

  async expectBackground(color: string): Promise<void> {
    await expect(this.root()).toHaveCSS("background-color", color);
  }

  /** The header's logo, by its file's name (the build adds a hash to it). */
  async expectBrandLogo(file: string, shown: boolean): Promise<void> {
    const logo = this.brand().locator(`img[src*="/${file}-"]`);
    if (shown) await expect(logo).toBeVisible();
    else await expect(logo).toBeHidden();
  }
}
