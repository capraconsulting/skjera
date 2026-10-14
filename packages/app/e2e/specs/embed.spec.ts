import { expect, test } from "@playwright/test";
import { cleanUp } from "../fixtures/cleanUp.ts";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { EmbedPage } from "../pom/site/EmbedPage.ts";
import { HubSpot } from "../pom/site/HubSpot.ts";
import { Website } from "../pom/site/Website.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

test("the website's iframe takes the height of the embed page", async ({
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

test("a click on an event in the iframe opens its page in a new tab", async ({
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

test("only the websites set up may frame the embed page", async ({
  browser,
  baseURL,
}) => {
  const website = new Website(await visitor(browser));
  await website.open(baseURL ?? "", "http://elsewhere.localhost");
  await website.expectFramingRefused();
});

test("the websites set up may read the coming public events from the browser, in Skjer's format; others may not", async ({
  browser,
  baseURL,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teamName = uniqueTeamName("Public API");
  const team = await new TeamsColumn(alice).create(teamName);
  const editor = new EventEditor(alice);
  const event = await editor.createPublished({ public: true, guests: true });
  const membersOnly = await editor.createPublished({ public: false });
  // One that has ended.
  const past = await new EventsColumn(alice).newEvent();
  const pastTitle = `Was ${past.slice(-12)}`;
  await editor.title.type(pastTitle);
  await editor.times.pickPastStart();
  await editor.writePlace();
  await editor.checkPublic();
  await editor.publish();

  const allowed = new Website(await visitor(browser));
  await allowed.open(baseURL ?? "");
  const events = (await allowed.readPublicEvents(baseURL ?? "")) ?? [];
  const titles = events.map((each) => each["title"]);
  expect(titles).toContain(event.title);
  expect(titles).not.toContain(membersOnly.title);
  expect(titles).not.toContain(pastTitle);
  // Skjer's eleven fields, as the websites read them.
  expect(events.find((each) => each["title"] === event.title)).toEqual({
    id: event.id,
    title: event.title,
    start: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
    end: expect.stringMatching(/Z$/),
    place: "Kantina",
    summary: null,
    category: null,
    organisers: teamName,
    isDigital: false,
    openForExternals: true,
    url: `${baseURL}/events/${event.id}`,
  });

  const elsewhere = new Website(await visitor(browser));
  await elsewhere.open(baseURL ?? "", "http://elsewhere.localhost");
  expect(await elsewhere.readPublicEvents(baseURL ?? "")).toBeNull();

  await cleanUp(alice, team, event.id, membersOnly.id, past);
});

test("the embed page loads nothing from HubSpot", async ({ browser }) => {
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
