import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";
import type { Locale } from "@skjera/i18n/runtime";

/** The operator's details, as `mise.toml` sets them for the browser tests. */
export const configuredOperator = {
  name: "Skjera",
  orgNumber: "123 456 789",
  address: "Storgata 1, 0150 Oslo",
  email: "privacy@skjera.localhost",
};

/** The policy's sections, by the message that is their heading. */
const sections = {
  controller: m.privacy_controller_heading,
  rights: m.privacy_rights_heading,
  subjects: m.privacy_subjects_heading,
  collect: m.privacy_collect_heading,
  purpose: m.privacy_purpose_heading,
  processing: m.privacy_processing_heading,
  sharing: m.privacy_sharing_heading,
  security: m.privacy_security_heading,
  cookies: m.privacy_cookies_heading,
  contact: m.privacy_contact_heading,
};
type Section = keyof typeof sections;

/** The site's `privacy` as `/api/site` gives it. */
type SitePrivacy = { operator: string } & Record<string, string>;

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
  /** The part under `section`'s heading. */
  private readonly part = (section: Section) =>
    this.page.locator("section").filter({
      has: this.page.getByRole("heading", {
        name: sections[section]({}, { locale: this.locale }),
        level: 2,
        exact: true,
      }),
    });
  private readonly cookieSettings = () =>
    this.part("rights").getByRole("button", {
      name: m.privacy_cookie_settings({}, { locale: this.locale }),
    });

  async goto(): Promise<void> {
    await this.page.goto("/privacy");
  }

  /**
   * Gives the page's browser the site as configured, but with its `privacy`
   * as `change` makes it.
   */
  private async reroutePrivacy(
    change: (privacy: SitePrivacy) => SitePrivacy,
  ): Promise<void> {
    await this.page.context().route("/api/site", async (route) => {
      const response = await route.fetch();
      const site = (await response.json()) as { privacy: SitePrivacy };
      await route.fulfill({
        response,
        json: { ...site, privacy: change(site.privacy) },
      });
    });
  }

  /**
   * Gives the page's browser the site as configured with its privacy policy
   * kept at `url`, and answers `url` here with a page of its own.
   */
  async keptElsewhere(url: string): Promise<void> {
    await this.reroutePrivacy((privacy) => ({ ...privacy, url }));
    await this.page.context().route(url, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>The policy</title><p>Kept elsewhere</p>",
      }),
    );
  }

  /** Gives the page's browser the site with only its operator's name set. */
  async withOnlyOperator(): Promise<void> {
    await this.reroutePrivacy(({ operator }) => ({ operator }));
  }

  /** The visitor has been sent on to `url`. */
  async expectSentTo(url: string): Promise<void> {
    await expect(this.page).toHaveURL(url);
    await expect(this.page.getByText("Kept elsewhere")).toBeVisible();
  }

  async expectAt(): Promise<void> {
    await expect(this.page).toHaveURL(/\/privacy$/);
  }

  /** The browser tab's title. */
  async expectTabTitle(title: string): Promise<void> {
    await expect(this.page).toHaveTitle(title);
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

  /** The policy has a section under each of Skjer's headings. */
  async expectSections(): Promise<void> {
    for (const section of Object.keys(sections) as Section[]) {
      await expect(this.part(section)).toHaveCount(1);
    }
  }

  async expectInPart(section: Section, text: string): Promise<void> {
    await expect(this.part(section)).toContainText(text);
  }

  /** The policy names the operator as responsible, with the details set. */
  async expectOperatorDetails(): Promise<void> {
    const { name, orgNumber, address, email } = configuredOperator;
    await this.expectInPart("controller", name);
    await this.expectInPart("controller", orgNumber);
    await this.expectInPart("controller", address);
    await expect(
      this.part("contact").getByRole("link", { name: email }),
    ).toHaveAttribute("href", `mailto:${email}`);
  }

  /** Without the details, no line for them, and the operator is to be asked. */
  async expectNoOperatorDetails(): Promise<void> {
    const { name, orgNumber, address } = configuredOperator;
    await expect(this.policy()).not.toContainText(orgNumber);
    await expect(this.policy()).not.toContainText(address);
    await expect(this.policy().locator("a[href^='mailto:']")).toHaveCount(0);
    await this.expectInPart(
      "contact",
      m.privacy_ask_operator({ operator: name }, { locale: this.locale }),
    );
  }

  async expectNoText(text: string): Promise<void> {
    await expect(this.policy()).not.toContainText(text);
  }

  async expectCookiesText(text: string): Promise<void> {
    await this.expectInPart("cookies", text);
  }

  async clickCookieSettings(): Promise<void> {
    await this.cookieSettings().click();
  }

  async expectNoCookieSettings(): Promise<void> {
    await expect(this.cookieSettings()).toHaveCount(0);
  }
}
