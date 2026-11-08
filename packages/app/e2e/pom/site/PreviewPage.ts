import { expect, type Page } from "@playwright/test";
import { m } from "@skjera/i18n/messages";

/** An event's preview: its page as the draft is now, under a fixed notice. */
export class PreviewPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly notice = () => this.page.getByText(m.preview_notice());
  private readonly publishedLink = () =>
    this.page.getByRole("link", { name: m.preview_view_published() });
  // Role queries skip what is inside an `inert` part, so the button is found
  // by its text. The preview is shown to those logged in, so it is a member's.
  private readonly signUpButton = () =>
    this.page.locator("button", { hasText: /^Attend$/ });

  async goto(id: string): Promise<void> {
    await this.page.goto(`/events/${id}/preview`);
  }

  /** The preview of an earlier version, given as the address gives it. */
  async gotoVersion(id: string, version: string): Promise<void> {
    await this.page.goto(`/events/${id}/preview?version=${version}`);
  }

  async expectAt(id: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/events/${id}/preview$`));
  }

  async expectHeading(title: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name: title })).toBeVisible();
  }

  /** The event's organizer is the team named `name`. */
  async expectOrganizer(name: string): Promise<void> {
    await expect(
      this.page.getByRole("listitem").filter({ hasText: "Organizer:" }),
    ).toContainText(name);
  }

  async expectNotice(): Promise<void> {
    await expect(this.notice()).toBeVisible();
  }

  /** The notice is in view where the page is scrolled to its end. */
  async expectNoticeInViewAtEnd(): Promise<void> {
    await this.page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(this.notice()).toBeInViewport();
  }

  /** The notice links to the event's published page. */
  async expectPublishedLink(id: string): Promise<void> {
    await expect(this.publishedLink()).toHaveAttribute("href", `/events/${id}`);
  }

  async expectNoPublishedLink(): Promise<void> {
    await expect(this.notice()).toBeVisible();
    await expect(this.publishedLink()).toHaveCount(0);
  }

  /** The line shown instead of the page while the event lacks times. */
  async expectNeedsTimes(): Promise<void> {
    await expect(this.page.getByText(m.preview_needs_times())).toBeVisible();
  }

  async expectMissing(): Promise<void> {
    await expect(this.page.getByText(m.site_event_missing())).toBeVisible();
  }

  /** Nothing of `text` is anywhere on the page. */
  async expectNowhere(text: string): Promise<void> {
    await expect(this.page.locator("body")).not.toContainText(text);
  }

  /** The sign-up box is shown, but nothing in it can be clicked or reached. */
  async expectSignUpUnusable(): Promise<void> {
    const button = this.signUpButton();
    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => el.closest("[inert]") !== null)).toBe(
      true,
    );
    await button.focus({ timeout: 1_000 }).catch(() => undefined);
    expect(await button.evaluate((el) => document.activeElement === el)).toBe(
      false,
    );
    // A click that goes through anyway changes nothing.
    await button.click({ force: true });
    await expect(button).toBeVisible();
  }
}
