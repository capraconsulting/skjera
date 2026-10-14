import { test } from "@playwright/test";
import { Website } from "../pom/site/Website.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../pom/support.ts";

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
