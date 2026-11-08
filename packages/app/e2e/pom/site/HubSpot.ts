import { expect, type Page } from "@playwright/test";

const account = "146072525";

/** The address of the account's HubSpot script. */
export const hubSpotScript = `https://js-eu1.hs-scripts.com/${account}.js`;

/** HubSpot's script on a page of the site, answered on this machine. */
export class HubSpot {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Gives the page's browser the site as configured with a HubSpot account,
   * and answers HubSpot's script here: it counts its runs in
   * `window.hubSpotRuns`. Returns the addresses asked for, as they come.
   */
  async install(): Promise<ReadonlyArray<string>> {
    const requested: Array<string> = [];
    const context = this.page.context();
    await context.route("/api/site", async (route) => {
      const response = await route.fetch();
      const site = (await response.json()) as object;
      await route.fulfill({ response, json: { ...site, hubSpot: account } });
    });
    await context.route("https://js-eu1.hs-scripts.com/**", (route) => {
      requested.push(route.request().url());
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.hubSpotRuns = (window.hubSpotRuns ?? 0) + 1;",
      });
    });
    return requested;
  }

  /** Records what the page asks HubSpot for, without answering. */
  recordRequests(): ReadonlyArray<string> {
    const asked: Array<string> = [];
    this.page.on("request", (request) => {
      if (/hubspot|hs-scripts/.test(request.url())) asked.push(request.url());
    });
    return asked;
  }

  /** The script has run `count` times in the page, once it settles. */
  async expectRuns(count: number): Promise<void> {
    await expect.poll(() => this.runs()).toBe(count);
  }

  /** The script has run exactly `count` times, now. */
  async expectRunsNow(count: number): Promise<void> {
    expect(await this.runs()).toBe(count);
  }

  async expectLoaders(count: number): Promise<void> {
    await expect(this.page.locator("script#hs-script-loader")).toHaveCount(
      count,
    );
  }

  /** HubSpot was asked to show its cookie banner. */
  async expectBannerAsked(): Promise<void> {
    expect(
      await this.page.evaluate(() => (window as { _hsp?: unknown })._hsp),
    ).toEqual([["showBanner"]]);
  }

  private runs() {
    return this.page.evaluate(
      () => (window as { hubSpotRuns?: number }).hubSpotRuns ?? 0,
    );
  }
}
