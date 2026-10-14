import { test } from "@playwright/test";
import { EventPage } from "../pom/site/EventPage.ts";
import { HomePage } from "../pom/site/HomePage.ts";
import { EventEditor } from "../pom/studio/EventEditor.ts";
import { EventsColumn } from "../pom/studio/EventsColumn.ts";
import { TeamsColumn } from "../pom/studio/TeamsColumn.ts";
import { signedIn, uniqueTeamName, visitor } from "../pom/support.ts";

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
  await editor.pickTimes();
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
  await editor.pickPastStart();
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

test("the site filters events open to guests and those not, with the tag too (AC-1, AC-2, AC-3, AC-4, AC-5)", async ({
  browser,
}) => {
  test.slow();
  const alice = await signedIn(browser, "alice@example.com");
  const teams = new TeamsColumn(alice);
  const editor = new EventEditor(alice);
  const team = await teams.create(uniqueTeamName("Guest filter"));
  // A tag only this test uses, so the past list holds just D.
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
  await editor.pickPastStart();
  await editor.tags.add(tag);
  await publish(editor);

  const reader = await visitor(browser);
  const home = new HomePage(reader);

  // Neither filter chosen: everything shows (AC-1, AC-2).
  await home.goto();
  await home.expectGuestFilter(null);
  await home.expectEvents("upcoming", [a, b, c]);

  // Choosing one keeps its events and puts it in the address (AC-2, AC-5).
  await home.clickGuestFilter("open");
  await home.expectQuery("yes", null);
  await home.expectGuestFilter("open");
  await home.expectEvents("upcoming", [a, c], [b]);

  // Choosing the other replaces it (AC-2, AC-3).
  await home.clickGuestFilter("not open");
  await home.expectQuery("no", null);
  await home.expectGuestFilter("not open");
  await home.expectEvents("upcoming", [b], [a, c]);

  // Choosing the chosen one again removes it (AC-3).
  await home.clickGuestFilter("not open");
  await home.expectQuery(null, null);
  await home.expectGuestFilter(null);
  await home.expectEvents("upcoming", [a, b, c]);

  // Opening the address shows the same lists (AC-5).
  await home.goto("?guests=yes");
  await home.expectGuestFilter("open");
  await home.expectEvents("upcoming", [a, c], [b]);

  // The tag alone, then the guest filter chosen beside it, then the tag
  // removed (AC-4).
  await home.goto(`?tag=${encodeURIComponent(tag)}`);
  await home.expectEvents("upcoming", [a, b], [c]);
  await home.clickGuestFilter("open");
  await home.expectQuery("yes", tag);
  await home.expectEvents("upcoming", [a], [b, c]);
  await home.clickTagFilter("All");
  await home.expectQuery("yes", null);
  await home.expectEvents("upcoming", [a, c], [b]);

  // Both in the address: the events matching both, in both lists (AC-2,
  // AC-4).
  await home.goto(`?tag=${encodeURIComponent(tag)}&guests=yes`);
  await home.expectEvents("upcoming", [a], [b, c]);
  await home.expectNoEvent(dTitle);
  await home.goto(`?tag=${encodeURIComponent(tag)}&guests=no`);
  await home.expectEvents("upcoming", [b], [a, c]);
  await home.expectEvent(dTitle, "past");

  // An unknown value is no choice (AC-5).
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
