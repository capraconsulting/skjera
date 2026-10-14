import { expect, type Page } from "@playwright/test";

// The embed page in an iframe on another site, as the company's websites show
// it. Needs cdn.jsdelivr.net: the resizer is loaded from there on both sides,
// as the websites do. The site is `WEBSITE_ORIGINS` in mise.toml; the server
// reads it at start.

const resizer = "https://cdn.jsdelivr.net/npm/@open-iframe-resizer/core@2.4.1";

const websitePage = (site: string) => `<!doctype html>
<html>
<body>
<iframe id="events" src="${site}/embed" style="height: 20px; width: 600px"></iframe>
<script type="module">
  import { initialize } from "${resizer}/dist/index.js";
  initialize({}, "#events");
</script>
</body>
</html>`;

/** A website showing the site's embed page in an iframe. */
export class Website {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly firstEvent = () =>
    this.page.frameLocator("#events").getByRole("link").first();

  /** Opens the website at the address in `mise.toml`, framing `site`. */
  async open(site: string): Promise<void> {
    // Chrome blocks a website from framing a page on this machine unless
    // let; in production both are on the internet.
    await this.page.context().grantPermissions(["local-network-access"]);
    await this.page.route("http://website.localhost/", (route) =>
      route.fulfill({ contentType: "text/html", body: websitePage(site) }),
    );
    await this.page.goto("http://website.localhost/");
  }

  async expectEvents(): Promise<void> {
    await expect(this.firstEvent()).toBeVisible();
  }

  /** The iframe takes the height of the page in it, rounded up. */
  async expectFramedAtFullHeight(): Promise<void> {
    const embedded = this.page.frames().find((f) => f.url().endsWith("/embed"));
    expect(embedded, "the embed page is framed").toBeDefined();
    const iframe = this.page.locator("#events");
    await expect
      .poll(async () => {
        const content = await embedded?.evaluate(() =>
          Math.ceil(document.documentElement.getBoundingClientRect().height),
        );
        const height = await iframe.evaluate((el) => el.clientHeight);
        return height === content ? content : -1;
      })
      .toBeGreaterThan(20);
  }

  /**
   * Clicks the first event, checking it opens the event's page on the
   * site, at `site`, in a new tab.
   */
  async clickFirstEventOpeningIn(site: string): Promise<void> {
    const href = await this.firstEvent().getAttribute("href");
    expect(href).toMatch(/^\/events\/[0-9a-f-]+$/);
    const popup = this.page.waitForEvent("popup");
    await this.firstEvent().click();
    await expect(await popup).toHaveURL(`${site}${href}`);
  }
}
