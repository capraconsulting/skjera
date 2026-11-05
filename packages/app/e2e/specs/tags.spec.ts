import { m } from "@skjera/i18n/messages";
import { signedIn, uniqueTeamName, visitor } from "../fixtures/support.ts";
import { test } from "../fixtures/test.ts";
import { Header } from "../pom/Header.ts";
import { EventPage } from "../pom/site/EventPage.ts";
import { HomePage } from "../pom/site/HomePage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";

/** Publishes the open event, public, done tagging. */
const publish = async (editor: EventEditor) => {
  await editor.tags.close();
  await editor.writePlace();
  await editor.checkPublic();
  await editor.publish();
};

test("events are tagged, and the site groups and filters them", async ({
  browser,
}) => {
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const events = new EventsColumn(alice);
  const editor = new EventEditor(alice);
  const team = await teams.create(uniqueTeamName("Tags"));

  // A new tag shows as one to add, with a plus.
  const coming = await events.newEvent();
  const comingTitle = `Coming ${coming.slice(-12)}`;
  await editor.title.type(comingTitle);
  await editor.times.pick();
  const fresh = `Pottery ${coming.slice(-6)}`;
  await editor.tags.fill(fresh);
  await editor.tags.expectSuggestion(`${fresh} (new tag)`);
  await editor.tags.add(fresh);
  await editor.tags.expectTag(fresh);
  // Taken off again, so it's not published as a suggestion.
  await editor.tags.remove(fresh);
  await editor.tags.expectNone();

  await editor.tags.add("Workshop");
  await editor.tags.expectTag("Workshop");
  await publish(editor);

  // A past event, tagged with what the studio now suggests.
  const past = await events.newEvent();
  const pastTitle = `Was ${past.slice(-12)}`;
  await editor.title.type(pastTitle);
  await editor.times.pickPastStart();
  await editor.tags.add("Social");
  // Published tags are suggested: picked from the list, as written there.
  await editor.tags.fill("work");
  await editor.tags.expectSuggestion("work (new tag)");
  await editor.tags.pickSuggestion("Workshop");
  await editor.tags.expectTags([/Social/, /Workshop/]);
  await publish(editor);

  // The site: upcoming first, then past; filters only for active events.
  const reader = await visitor(browser);
  const home = new HomePage(reader);
  await home.goto();
  await home.expectEvent(comingTitle, "upcoming");
  await home.expectEvent(pastTitle, "past");
  await home.expectTagFilter("Workshop", "shown");
  await home.expectTagFilter("Social", "absent");

  await home.goto("?tag=Social");
  await home.expectNoEvent(comingTitle);
  await home.expectEvent(pastTitle);

  await home.clickTagFilter("All");
  await home.clickTagFilter("Workshop");
  await home.expectUrl(/\?tag=Workshop$/);
  await home.expectTagFilter("Workshop", "chosen");
  await home.expectEvent(comingTitle);
  await home.expectEvent(pastTitle);

  // An event's tags lead back to the filtered list.
  await home.clickEvent(pastTitle);
  await new EventPage(reader).clickTag("Social");
  await home.expectUrl(/\?tag=Social$/);

  await editor.delete(past);
  await editor.goto(team, coming);
  await editor.delete(coming);
  await teams.delete(team);
});

test("the site filters events open to guests and those not, with the tag too", async ({
  browser,
}) => {
  test.slow();
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const team = await teams.create(uniqueTeamName("Guest filter"));
  // A tag only this test uses, so the upcoming list holds just A, B and C.
  const tag = uniqueTeamName("Guests");

  const a = await editor.createPublished({
    public: true,
    guests: true,
    tags: [tag],
  });
  const b = await editor.createPublished({ public: true, tags: [tag] });
  const c = await editor.createPublished({ public: true, guests: true });
  // D is past, not open to guests, tagged.
  const d = await new EventsColumn(alice).newEvent();
  const dTitle = `Was ${d.slice(-12)}`;
  await editor.title.type(dTitle);
  await editor.times.pickPastStart();
  await editor.tags.add(tag);
  await publish(editor);

  const reader = await visitor(browser);
  const home = new HomePage(reader);

  // Neither filter chosen: everything shows.
  await home.goto();
  await home.expectGuestFilter(null);
  await home.expectEvents("upcoming", [a, b, c]);

  // Choosing one keeps its events and puts it in the address.
  await home.clickGuestFilter("open");
  await home.expectQuery("yes", null);
  await home.expectGuestFilter("open");
  await home.expectEvents("upcoming", [a, c], [b]);

  // Choosing the other replaces it.
  await home.clickGuestFilter("not open");
  await home.expectQuery("no", null);
  await home.expectGuestFilter("not open");
  await home.expectEvents("upcoming", [b], [a, c]);

  // Choosing the chosen one again removes it.
  await home.clickGuestFilter("not open");
  await home.expectQuery(null, null);
  await home.expectGuestFilter(null);
  await home.expectEvents("upcoming", [a, b, c]);

  // Opening the address shows the same lists.
  await home.goto("?guests=yes");
  await home.expectGuestFilter("open");
  await home.expectEvents("upcoming", [a, c], [b]);

  // The tag alone, then the guest filter chosen beside it, then the tag
  // removed.
  await home.goto(`?tag=${encodeURIComponent(tag)}`);
  await home.expectEvents("upcoming", [a, b], [c]);
  await home.clickGuestFilter("open");
  await home.expectQuery("yes", tag);
  await home.expectEvents("upcoming", [a], [b, c]);
  await home.clickTagFilter("All");
  await home.expectQuery("yes", null);
  await home.expectEvents("upcoming", [a, c], [b]);

  // Both in the address: the upcoming events matching both. The filters
  // narrow the upcoming events only, so D is under «Past events» either way.
  await home.goto(`?tag=${encodeURIComponent(tag)}&guests=yes`);
  await home.expectEvents("upcoming", [a], [b, c]);
  await home.expectEvent(dTitle, "past");
  await home.goto(`?tag=${encodeURIComponent(tag)}&guests=no`);
  await home.expectEvents("upcoming", [b], [a, c]);
  await home.expectEvent(dTitle, "past");

  // An unknown value is no choice.
  await home.goto("?guests=maybe");
  await home.expectGuestFilter(null);
  await home.expectEvents("upcoming", [a, b, c]);

  await editor.delete(d);
  for (const event of [a, b, c]) {
    await editor.goto(team, event.id);
    await editor.delete(event.id);
  }
  await teams.delete(team);
});

test("the upcoming events show six at a time, and a new filter starts them again (AC-1, AC-2, AC-5, AC-6)", async ({
  browser,
}) => {
  test.slow();
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const team = await teams.create(uniqueTeamName("Paging"));
  // A tag only this test uses, so the upcoming list holds just these seven,
  // none open to guests.
  const tag = uniqueTeamName("Paged");
  const seven = [];
  for (let each = 0; each < 7; each++) {
    seven.push(await editor.createPublished({ public: true, tags: [tag] }));
  }

  const reader = await visitor(browser);
  const home = new HomePage(reader);

  // Six rows and the button; pressing it shows the seventh and removes it.
  await home.goto(`?tag=${encodeURIComponent(tag)}`);
  await home.expectRows("upcoming", 6);
  await home.expectShowMore("upcoming", "there");
  await home.clickShowMore("upcoming");
  await home.expectRows("upcoming", 7);
  await home.expectShowMore("upcoming", "gone");

  // A new filter starts the list again at six.
  await home.clickGuestFilter("not open");
  await home.expectRows("upcoming", 6);
  await home.expectShowMore("upcoming", "there");

  // None is open to guests: the list says so.
  await home.clickGuestFilter("open");
  await home.expectEmpty(
    "upcoming",
    m.site_nothing_upcoming({}, { locale: "en" }),
  );

  for (const event of seven) {
    await editor.goto(team, event.id);
    await editor.delete(event.id);
  }
  await teams.delete(team);
});

test("the guest filters are named in Bokmål and Nynorsk too", async ({
  browser,
}) => {
  const reader = await visitor(browser);
  const home = new HomePage(reader);
  const header = new Header(reader);
  await home.goto();
  for (const [language, locale, label] of [
    ["Bokmål", "nb", "Language"],
    ["Nynorsk", "nn", "Språk"],
  ] as const) {
    await header.selectLanguage(language, label);
    await home.expectGuestFilterNames(
      m.site_filter_by_guests({}, { locale }),
      m.site_filter_open_to_guests({}, { locale }),
      m.site_filter_not_open_to_guests({}, { locale }),
    );
  }
});

test("the front page says so when no event is coming up, or none is over (SITE-02 AC-8)", async ({
  browser,
}) => {
  // The test server's database holds the events of other tests, so the
  // browser's clock empties a list: in 2000 no event is over, in 2100 none
  // is coming up.
  const early = await visitor(browser);
  await early.clock.setFixedTime(new Date("2000-01-01T12:00:00Z"));
  const homeThen = new HomePage(early);
  await homeThen.goto();
  await homeThen.expectEmpty("past", m.site_nothing_past({}, { locale: "en" }));

  const late = await visitor(browser);
  await late.clock.setFixedTime(new Date("2100-01-01T12:00:00Z"));
  const homeLater = new HomePage(late);
  await homeLater.goto();
  await homeLater.expectUpcomingHeading();
  await homeLater.expectEmpty(
    "upcoming",
    m.site_nothing_upcoming({}, { locale: "en" }),
  );
});
