import { assert, describe, it } from "@effect/vitest";
import {
  type FeedEvent,
  feed,
  invitation,
  parseAddress,
} from "../../src/site/Calendar.ts";

const invite = (
  method: "REQUEST" | "CANCEL",
  sequence = 0,
  cancelled = false,
  place?: string,
  description?: string,
) =>
  invitation({
    method,
    event: {
      id: "launch",
      title: "Launch",
      startsAt: new Date("2036-10-15T18:00+02:00"),
      endsAt: new Date("2036-10-15T21:00+02:00"),
      url: "https://skjera.test/events/launch",
      sequence,
      cancelled,
      ...(place === undefined ? {} : { place }),
      ...(description === undefined ? {} : { description }),
    },
    attendee: { name: "Gina", email: "gina@example.org" },
    organizer: { name: "Skjera", email: "events@skjera.test" },
    site: { name: "Skjera", host: "skjera.test" },
  });

describe("Calendar", () => {
  it("invites: one event, the same id each time, in UTC", () => {
    const ics = invite("REQUEST", 3);
    assert.include(ics, "METHOD:REQUEST");
    assert.include(ics, "UID:launch@skjera.test");
    assert.include(ics, "SEQUENCE:3");
    assert.include(ics, "DTSTART:20361015T160000Z");
    assert.include(ics, "DTEND:20361015T190000Z");
    assert.include(ics, "URL;VALUE=URI:https://skjera.test/events/launch");
    assert.match(ics, /ORGANIZER;CN="Skjera":mailto:events@skjera.test/);
    // Long lines are folded: unfolded, the attendee is one.
    const attendee =
      /^ATTENDEE;.*$/m.exec(ics.replace(/\r\n /g, ""))?.[0] ?? "";
    assert.include(attendee, "PARTSTAT=ACCEPTED");
    assert.include(attendee, "RSVP=FALSE");
    assert.include(attendee, 'CN="Gina":MAILTO:gina@example.org');
    assert.strictEqual(ics.match(/BEGIN:VEVENT/g)?.length, 1);
  });

  it("cancels the same event", () => {
    const ics = invite("CANCEL", 4);
    assert.include(ics, "METHOD:CANCEL");
    assert.include(ics, "UID:launch@skjera.test");
    assert.include(ics, "SEQUENCE:4");
    // For the attendee only: the event goes on.
    assert.notInclude(ics, "STATUS:CANCELLED");
  });

  it("cancels the event for everyone", () => {
    const ics = invite("CANCEL", 5, true);
    assert.include(ics, "METHOD:CANCEL");
    assert.include(ics, "STATUS:CANCELLED");
  });

  it("puts the place in the invitation, to add and to cancel", () => {
    for (const method of ["REQUEST", "CANCEL"] as const) {
      const ics = invite(method, 1, false, "Kantina").replace(/\r\n /g, "");
      assert.include(ics, "LOCATION:Kantina");
    }
  });

  it("leaves the location out of an event without a place", () => {
    assert.notInclude(invite("REQUEST"), "LOCATION");
  });

  it("describes the event by its summary, then its link, to add and to cancel", () => {
    for (const method of ["REQUEST", "CANCEL"] as const) {
      const ics = invite(method, 1, false, undefined, "Coffee, and a talk.");
      // Unfolded, and read as iCalendar writes text: \n and \, escaped.
      const description =
        /^DESCRIPTION:(.*)$/m
          .exec(ics.replace(/\r\n /g, ""))?.[1]
          ?.replace(/\\n/g, "\n")
          .replace(/\\,/g, ",") ?? "";
      assert.strictEqual(
        description,
        "Coffee, and a talk.\n\nhttps://skjera.test/events/launch",
      );
      assert.include(ics, "URL;VALUE=URI:https://skjera.test/events/launch");
    }
  });

  it("describes an event without a summary by its link, as before", () => {
    const ics = invite("REQUEST");
    assert.include(ics, "DESCRIPTION:https://skjera.test/events/launch");
  });

  it("reads who emails come from", () => {
    assert.deepStrictEqual(parseAddress("Skjera <events@skjera.test>"), {
      name: "Skjera",
      email: "events@skjera.test",
    });
    assert.deepStrictEqual(parseAddress("<events@skjera.test>"), {
      name: "events@skjera.test",
      email: "events@skjera.test",
    });
    assert.deepStrictEqual(parseAddress("events@skjera.test"), {
      name: "events@skjera.test",
      email: "events@skjera.test",
    });
  });
});

const feedSite = {
  name: "Example Events",
  host: "skjera.test",
  locale: "nb",
} as const;

const launch = (fields: Partial<FeedEvent> = {}): FeedEvent => ({
  id: "launch",
  title: "Launch",
  startsAt: new Date("2036-10-15T18:00+02:00"),
  endsAt: new Date("2036-10-15T21:00+02:00"),
  url: "https://skjera.test/events/launch",
  ...fields,
});

/** A property's value, unfolded and unescaped as iCalendar writes text. */
const property = (ics: string, name: string) =>
  new RegExp(`^${name}:(.*)$`, "m")
    .exec(ics.replace(/\r\n /g, ""))?.[1]
    ?.replace(/\\n/g, "\n")
    .replace(/\\,/g, ",");

describe("Calendar feed", () => {
  it("is a published calendar named after the site, with one event each (AC-1)", () => {
    const ics = feed({
      events: [launch(), launch({ id: "party", title: "Party" })],
      site: feedSite,
    });
    assert.strictEqual(property(ics, "X-WR-CALNAME"), "Example Events");
    assert.include(ics, "METHOD:PUBLISH");
    assert.strictEqual(ics.match(/BEGIN:VEVENT/g)?.length, 2);
  });

  it("gives an event its id, title, place, times in UTC, page and description", () => {
    const ics = feed({
      events: [launch({ place: "Kantina", summary: "Coffee, and a talk." })],
      site: feedSite,
    });
    assert.include(ics, "UID:launch@skjera.test");
    assert.include(ics, "SUMMARY:Launch");
    assert.include(ics.replace(/\r\n /g, ""), "LOCATION:Kantina");
    assert.include(ics, "DTSTART:20361015T160000Z");
    assert.include(ics, "DTEND:20361015T190000Z");
    assert.include(ics, "URL;VALUE=URI:https://skjera.test/events/launch");
    assert.strictEqual(
      property(ics, "DESCRIPTION"),
      "Coffee, and a talk.\n\nMeld deg på eller av arrangementet: https://skjera.test/events/launch",
    );
  });

  it("describes an event without a summary by the sentence alone, and has no place", () => {
    const ics = feed({ events: [launch()], site: feedSite });
    assert.strictEqual(
      property(ics, "DESCRIPTION"),
      "Meld deg på eller av arrangementet: https://skjera.test/events/launch",
    );
    assert.notInclude(ics, "LOCATION");
  });

  it("marks every event as not taking up time", () => {
    const ics = feed({
      events: [launch(), launch({ id: "party", title: "Party" })],
      site: feedSite,
    });
    assert.deepStrictEqual(ics.match(/^TRANSP:.*$/gm), [
      "TRANSP:TRANSPARENT",
      "TRANSP:TRANSPARENT",
    ]);
  });
});
