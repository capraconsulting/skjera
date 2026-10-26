import { expect, type Page } from "@playwright/test";

/** An event's page on the site: what was published. */
export class EventPage {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly article = () => this.page.getByRole("article");
  private readonly times = () => this.article().locator("time");
  private readonly body = () => this.page.getByTestId("event-body");

  async goto(id: string): Promise<void> {
    await this.page.goto(`/events/${id}`);
  }

  /** Opens a link to the page, e.g. a guest's from an email. */
  async gotoLink(url: string): Promise<void> {
    await this.page.goto(url);
  }

  async reload(): Promise<void> {
    await this.page.reload();
  }

  async expectAt(id: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`/events/${id}$`));
  }

  /** The browser tab's title. */
  async expectTabTitle(title: string): Promise<void> {
    await expect(this.page).toHaveTitle(title);
  }

  async expectNotPublished(): Promise<void> {
    await expect(this.page.getByText("isn't published")).toBeVisible();
  }

  async expectHeading(title: string): Promise<void> {
    await expect(this.page.getByRole("heading", { name: title })).toBeVisible();
  }

  /** The day, then the hours. */
  async expectTimes(day: string, hours: RegExp): Promise<void> {
    await expect(this.times().nth(0)).toContainText(day);
    await expect(this.times().nth(1)).toHaveText(hours);
  }

  async expectHours(hours: RegExp): Promise<void> {
    await expect(this.times().nth(1)).toHaveText(hours);
  }

  async expectText(text: string): Promise<void> {
    await expect(this.article()).toContainText(text);
  }

  /** Anywhere on the page. */
  async expectShows(text: string): Promise<void> {
    await expect(this.page.getByText(text)).toBeVisible();
  }

  /** Nowhere on the page: neither as text nor in the page's own words. */
  async expectNowhere(text: string | RegExp): Promise<void> {
    if (typeof text === "string") {
      await expect(this.page.getByText(text)).toHaveCount(0);
    }
    await expect(this.page.locator("body")).not.toContainText(text);
  }

  async expectMembersOnly(): Promise<void> {
    await expect(this.article().getByText("Members only")).toBeVisible();
  }

  async expectStreamLink(link: string): Promise<void> {
    await expect(
      this.article().getByRole("link", { name: link }),
    ).toHaveAttribute("href", link);
  }

  /** Says the event is streamed, with no link to the stream. */
  async expectStreamedWithoutLink(): Promise<void> {
    await expect(
      this.article().getByText("Streamed", { exact: true }),
    ).toBeVisible();
    await expect(
      this.article().getByRole("link", { name: /^https?:\/\// }),
    ).toHaveCount(0);
  }

  async clickTag(name: string): Promise<void> {
    await this.page
      .getByRole("list", { name: "Tags" })
      .getByRole("link", { name })
      .click();
  }

  async expectBodyHeading(name: string, level: number): Promise<void> {
    await expect(
      this.body().getByRole("heading", { name, level }),
    ).toBeVisible();
  }

  async expectFirstParagraph(text: string): Promise<void> {
    await expect(this.body().getByRole("paragraph").first()).toHaveText(text);
  }

  async expectBold(text: string): Promise<void> {
    await expect(this.body().locator("strong")).toHaveText(text);
  }

  async expectListItems(items: ReadonlyArray<string>): Promise<void> {
    await expect(this.body().getByRole("listitem")).toHaveText([...items]);
  }

  async expectBodyLink(name: string, href: string): Promise<void> {
    await expect(this.body().getByRole("link", { name })).toHaveAttribute(
      "href",
      href,
    );
  }

  /** An image in the body, at `src`, loaded as the image it is. */
  async expectBodyImage(name: string, src?: RegExp): Promise<void> {
    const image = this.body().getByRole("img", { name });
    if (src === undefined) {
      await expect(image).toBeVisible();
      return;
    }
    await expect(image).toHaveAttribute("src", src);
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBe(1);
  }

  async expectBodyImageCount(count: number): Promise<void> {
    await expect(this.body().locator('img[src*="/api/images/"]')).toHaveCount(
      count,
    );
  }

  /** The headers an image in the body is served with. */
  async imageHeaders(src: string): Promise<Record<string, string>> {
    return (await this.page.request.get(src)).headers();
  }

  async expectCover(name: string, src: string): Promise<void> {
    await expect(this.page.getByRole("img", { name })).toHaveAttribute(
      "src",
      src,
    );
  }

  async expectNoImages(): Promise<void> {
    await expect(this.article().locator("img")).toHaveCount(0);
  }

  /** The organizer's logo, named by the team. */
  async expectOrganizerLogo(team: string, src: string): Promise<void> {
    await expect(
      this.article().getByRole("img", { name: team }),
    ).toHaveAttribute("src", src);
  }

  async expectNoOrganizerLogo(): Promise<void> {
    await expect(this.article().getByRole("img")).toHaveCount(0);
  }

  /** The logo at `src` is shown, or hidden for the theme. */
  async expectLogo(src: string, shown: boolean): Promise<void> {
    const logo = this.article().locator(`img[src="${src}"]`);
    if (shown) await expect(logo).toBeVisible();
    else await expect(logo).toBeHidden();
  }

  /** A tag a shared link to the page shows, as the page has it. */
  async expectSharingTag(
    name: string,
    content: string | RegExp,
  ): Promise<void> {
    await expect(this.sharingTag(name)).toHaveAttribute("content", content);
  }

  async expectNoSharingTag(name: string): Promise<void> {
    await expect(this.sharingTag(name)).toHaveCount(0);
  }

  private readonly sharingTag = (name: string) =>
    this.page.locator(
      `head meta[property="${name}"], head meta[name="${name}"]`,
    );

  /** Asks the API for the signups, page by page, as this page's browser. */
  async pullSignups(): Promise<ReadonlyArray<string>> {
    const bodies: string[] = [];
    let since: string | undefined;
    for (let more = true; more; ) {
      const response = await this.page.request.get("/api/sync/attendees", {
        params: since === undefined ? {} : { since },
      });
      expect(response.ok()).toBe(true);
      bodies.push(await response.text());
      ({ more, token: since } = JSON.parse(bodies.at(-1) ?? "{}") as {
        more: boolean;
        token: string;
      });
    }
    return bodies;
  }

  /** The status of asking for the event's dietary preferences. */
  async dietaryPreferencesStatus(id: string): Promise<number> {
    return (
      await this.page.request.get(`/api/events/${id}/dietary-preferences`)
    ).status();
  }
}
