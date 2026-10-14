import { expect, test } from "@playwright/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { EmbedPage } from "../pom/site/EmbedPage.ts";
import { HubSpot } from "../pom/site/HubSpot.ts";
import { Website } from "../pom/site/Website.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("the website's iframe takes the height of the embed page (AC-6)", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  await new TeamsColumn(alice).create(uniqueTeamName("Embed"));
  await new EventEditor(alice).createPublished({ public: true });

  const website = new Website(await visitor(browser));
  await website.open(baseURL ?? "");
  await website.expectEvents();
  await website.expectFramedAtFullHeight();
});

test("a click on an event in the iframe opens its page in a new tab (AC-3)", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  await new TeamsColumn(alice).create(uniqueTeamName("Embed"));
  await new EventEditor(alice).createPublished({ public: true });

  const website = new Website(await visitor(browser));
  await website.open(baseURL ?? "");
  await website.expectEvents();
  await website.clickFirstEventOpeningIn(baseURL ?? "");
});

test("only the websites set up may frame the embed page (AC-5)", async ({
  browser,
  baseURL,
}) => {
  const website = new Website(await visitor(browser));
  await website.open(baseURL ?? "", "http://elsewhere.localhost");
  await website.expectFramingRefused();
});

test("the websites set up may read the public events from the browser, others not (AC-7, AC-8)", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("Public API"),
  );
  const event = await new EventEditor(alice).createPublished({ public: true });

  const allowed = new Website(await visitor(browser));
  await allowed.open(baseURL ?? "");
  expect(await allowed.readPublicEvents(baseURL ?? "")).toContain(event.title);

  const elsewhere = new Website(await visitor(browser));
  await elsewhere.open(baseURL ?? "", "http://elsewhere.localhost");
  expect(await elsewhere.readPublicEvents(baseURL ?? "")).toBeNull();

  await cleanUp(alice, team, event.id);
});

test("the embed page loads nothing from HubSpot (AC-2)", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const team = await new TeamsColumn(alice).create(
    uniqueTeamName("No HubSpot"),
  );
  const event = await new EventEditor(alice).createPublished({ public: true });

  const reader = await visitor(browser);
  const hubSpot = new HubSpot(reader);
  const asked = await hubSpot.install();
  const embed = new EmbedPage(reader);
  await embed.goto();
  await embed.expectEvents();
  await hubSpot.waitForIdle();
  expect(asked).toEqual([]);
  await hubSpot.expectLoaders(0);

  await cleanUp(alice, team, event.id);
});
