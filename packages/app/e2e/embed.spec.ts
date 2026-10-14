import { expect, test } from "@playwright/test";
import {
  newTeam,
  publishedEvent,
  signedIn,
  uniqueTeamName,
  visitor,
} from "./helpers.ts";

// The embed page in an iframe on another site, as the company's websites show
// it. Needs cdn.jsdelivr.net: the resizer is loaded from there on both sides,
// as the websites do. The site is `WEBSITE_ORIGINS` in mise.toml; the server
// and `vite preview` read it and the proxy at start, so restart a running
// one from a shell with that environment.

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

/** The page of a website that shows the embed page, at the address in `mise.toml`. */
const website = async (
  browser: Parameters<typeof visitor>[0],
  site: string | undefined,
) => {
  const page = await visitor(browser);
  await page.route("http://website.localhost/", (route) =>
    route.fulfill({ contentType: "text/html", body: websitePage(site ?? "") }),
  );
  await page.goto("http://website.localhost/");
  return page;
};

test("the website's iframe takes the height of the embed page (AC-6)", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  await newTeam(alice, uniqueTeamName("Embed"));
  await publishedEvent(alice, { public: true });

  const page = await website(browser, baseURL);
  const frame = page.frameLocator("#events");
  await expect(frame.getByRole("link").first()).toBeVisible();

  const iframe = page.locator("#events");
  const embedded = page.frames().find((f) => f.url().endsWith("/embed"));
  if (embedded === undefined) throw new Error("The embed page is not framed");
  // The resizer sets the height of the page's content, rounded up.
  await expect
    .poll(async () => {
      const content = await embedded.evaluate(() =>
        Math.ceil(document.documentElement.getBoundingClientRect().height),
      );
      const height = await iframe.evaluate((el) => el.clientHeight);
      return height === content ? content : -1;
    })
    .toBeGreaterThan(20);
});

test("a click on an event in the iframe opens its page in a new tab (AC-3)", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  await newTeam(alice, uniqueTeamName("Embed"));
  await publishedEvent(alice, { public: true });

  const page = await website(browser, baseURL);
  const link = page.frameLocator("#events").getByRole("link").first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/events\/[0-9a-f-]+$/);

  const popup = page.waitForEvent("popup");
  await link.click();
  await expect(await popup).toHaveURL(`${baseURL}${href}`);
});
