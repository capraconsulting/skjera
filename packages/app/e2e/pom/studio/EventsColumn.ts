import { expect, type Page } from "@playwright/test";

/** The studio's events column: the open team's events. */
export class EventsColumn {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly region = () =>
    this.page.getByRole("region", { name: "Events" });
  private readonly link = (title: string | RegExp) =>
    this.region().getByRole("link", { name: title });

  /** Creates an event in the open team and returns its id. */
  async newEvent(): Promise<string> {
    const before = this.page.url();
    await this.page.getByRole("button", { name: "New event" }).click();
    // Wait for the new event, also when another one was open.
    await expect(this.page).not.toHaveURL(before);
    await expect(this.page).toHaveURL(
      /\/studio\/teams\/[0-9a-f-]+\/events\/[0-9a-f-]+$/,
    );
    return new URL(this.page.url()).pathname.split("/").pop() ?? "";
  }

  /** The event is listed, saying `status` if given ("Draft", "Published"). */
  async expectEvent(title: string | RegExp, status?: string): Promise<void> {
    if (status === undefined) await expect(this.link(title)).toBeVisible();
    else await expect(this.link(title)).toContainText(status);
  }

  async expectNoEvent(title: string | RegExp): Promise<void> {
    await expect(this.link(title)).toHaveCount(0);
  }

  async expectEmpty(): Promise<void> {
    await expect(this.region().getByText("No events yet.")).toBeVisible();
  }

  /** The event's row, by its studio address, says `text`. */
  async expectRow(path: string, text: string): Promise<void> {
    await expect(
      this.page
        .getByRole("listitem")
        .filter({ has: this.page.locator(`a[href="${path}"]`) }),
    ).toContainText(text);
  }
}
