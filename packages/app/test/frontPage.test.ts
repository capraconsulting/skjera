import type { EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { baseLocale, overwriteGetLocale } from "@skjera/i18n/runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  frontPageLists,
  paged,
  pageSize,
  rowMarks,
  upcomingAndPast,
} from "../src/site/frontPage.ts";

const hour = 3_600_000;
const day = 24 * hour;
const now = new Date("2026-11-10T12:00:00Z");

const event = (
  name: string,
  startsAt: Date,
  endsAt = new Date(startsAt.getTime() + 2 * hour),
) => ({ name, startsAt, endsAt });

const names = (events: ReadonlyArray<{ readonly name: string }>) =>
  events.map((each) => each.name);

type Marked = Pick<
  EventRow,
  "startsAt" | "endsAt" | "timeZone" | "allowGuests" | "tags"
>;

const marked = (overrides: Partial<Marked> = {}): Marked => ({
  startsAt: new Date(now.getTime() + day),
  endsAt: new Date(now.getTime() + day + 2 * hour),
  timeZone: "Europe/Oslo",
  allowGuests: true,
  tags: [],
  ...overrides,
});

describe("upcomingAndPast", () => {
  it("lists upcoming soonest first and past latest first (AC-4)", () => {
    const { upcoming, past } = upcomingAndPast(
      [
        event("in a week", new Date(now.getTime() + 7 * day)),
        event("over 3", new Date(now.getTime() - 9 * day)),
        event("tomorrow", new Date(now.getTime() + day)),
        event("over 1", new Date(now.getTime() - 3 * day)),
        event("over 2", new Date(now.getTime() - 5 * day)),
        event("going on", new Date(now.getTime() - hour)),
      ],
      now,
    );
    expect(names(upcoming)).toEqual(["going on", "tomorrow", "in a week"]);
    expect(names(past)).toEqual(["over 1", "over 2", "over 3"]);
  });

  it("keeps an event going on now among the upcoming (AC-7)", () => {
    const going = event(
      "going on",
      new Date(now.getTime() - hour),
      new Date(now.getTime() + hour),
    );
    const { upcoming, past } = upcomingAndPast(
      [event("tomorrow", new Date(now.getTime() + day)), going],
      now,
    );
    expect(names(upcoming)).toContain("going on");
    expect(names(past)).toEqual([]);
  });
});

describe("paged", () => {
  const items = (count: number) => Array.from({ length: count }, (_, i) => i);

  it("pages at six (AC-1)", () => {
    expect(pageSize).toBe(6);
  });

  it("shows the first six of 13 and says more are hidden (AC-1)", () => {
    const { shown, more } = paged(items(13), pageSize);
    expect(shown).toEqual([0, 1, 2, 3, 4, 5]);
    expect(more).toBe(true);
  });

  it("hides nothing when there are exactly six (AC-1)", () => {
    const { shown, more } = paged(items(6), pageSize);
    expect(shown).toHaveLength(6);
    expect(more).toBe(false);
  });

  it("shows six more each time until all are shown (AC-2)", () => {
    const all = items(13);
    const twelve = paged(all, pageSize * 2);
    expect(twelve.shown).toHaveLength(12);
    expect(twelve.more).toBe(true);
    const thirteen = paged(all, pageSize * 3);
    expect(thirteen.shown).toHaveLength(13);
    expect(thirteen.more).toBe(false);
  });

  it("pages past events the same way, the latest first (AC-3)", () => {
    const { past } = upcomingAndPast(
      Array.from({ length: 8 }, (_, i) =>
        event(`over ${i}`, new Date(now.getTime() - (i + 1) * day)),
      ),
      now,
    );
    const first = paged(past, pageSize);
    expect(names(first.shown)).toEqual([
      "over 0",
      "over 1",
      "over 2",
      "over 3",
      "over 4",
      "over 5",
    ]);
    expect(first.more).toBe(true);
    const second = paged(past, pageSize * 2);
    expect(second.shown).toHaveLength(8);
    expect(second.more).toBe(false);
  });
});

describe("frontPageLists", () => {
  const listed = (
    name: string,
    startsInDays: number,
    allowGuests: boolean,
    tags: ReadonlyArray<string>,
  ) => ({
    ...event(name, new Date(now.getTime() + startsInDays * day)),
    allowGuests,
    tags,
  });
  const events = [
    listed("up pottery open", 1, true, ["Pottery"]),
    listed("up pottery internal", 2, false, ["Pottery"]),
    listed("up plain open", 3, true, []),
    listed("up plain internal", 4, false, ["Social"]),
    listed("past pottery open", -1, true, ["Pottery"]),
    listed("past plain internal", -2, false, []),
    listed("past social open", -3, true, ["Social"]),
  ];
  const none = { tag: null, allowGuests: null };

  it("narrows the upcoming events by tag, in any case, and keeps every past event (AC-5)", () => {
    const { upcoming, past } = frontPageLists(
      events,
      { ...none, tag: "pottery" },
      now,
    );
    expect(names(upcoming)).toEqual(["up pottery open", "up pottery internal"]);
    expect(names(past)).toEqual([
      "past pottery open",
      "past plain internal",
      "past social open",
    ]);
  });

  it("narrows the upcoming events by who can sign up, and keeps every past event (AC-5)", () => {
    const open = frontPageLists(events, { ...none, allowGuests: true }, now);
    expect(names(open.upcoming)).toEqual(["up pottery open", "up plain open"]);
    expect(open.past).toHaveLength(3);
    const internal = frontPageLists(
      events,
      { ...none, allowGuests: false },
      now,
    );
    expect(names(internal.upcoming)).toEqual([
      "up pottery internal",
      "up plain internal",
    ]);
    expect(internal.past).toHaveLength(3);
  });

  it("narrows by tag and who can sign up together, and by neither not at all (AC-5)", () => {
    const both = frontPageLists(
      events,
      { tag: "Pottery", allowGuests: false },
      now,
    );
    expect(names(both.upcoming)).toEqual(["up pottery internal"]);
    const neither = frontPageLists(events, none, now);
    expect(neither.upcoming).toHaveLength(4);
    expect(neither.past).toHaveLength(3);
  });
});

describe("rowMarks", () => {
  afterEach(() => {
    overwriteGetLocale(() => baseLocale);
  });

  it("marks an event guests can't sign up for with the badge's words, and shows its tags (AC-2)", () => {
    // Bokmål, where the row's badge and the event page's line use different words.
    overwriteGetLocale(() => "nb");
    const internal = rowMarks(
      marked({ allowGuests: false, tags: ["Workshop"] }),
      now,
    );
    expect(internal.audience).toBe(
      m.site_badge_internal_only({}, { locale: "nb" }),
    );
    expect(internal.tags).toEqual(["#Workshop"]);

    expect(rowMarks(marked({ tags: [] }), now).tags).toEqual([]);
  });

  it("shows the day in the event's own time zone (AC-6)", () => {
    // 23:30 on 15 November in New York: already the 16th in UTC and in Oslo.
    const startsAt = new Date("2026-11-16T04:30:00Z");
    const { when } = rowMarks(
      marked({
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * hour),
        timeZone: "America/New_York",
      }),
      new Date("2026-11-10T12:00:00Z"),
    );
    expect(when).toContain("15");
    expect(when).toContain("November");
    expect(when).toContain("2026");
    expect(when).not.toContain("16");
  });

  it("says «Today at» and the start time when the day is today there (AC-6)", () => {
    // 10:00 and 23:30 on 15 November in New York: the same day there, but
    // the 15th and the 16th in UTC.
    const startsAt = new Date("2026-11-16T04:30:00Z");
    const { when } = rowMarks(
      marked({
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * hour),
        timeZone: "America/New_York",
      }),
      new Date("2026-11-15T15:00:00Z"),
    );
    expect(when).toMatch(
      new RegExp(`^${m.site_today_at({ time: "11:30\\s*PM" })}$`),
    );
  });

  it("shows the day, not «Today at», when it is tomorrow there (AC-6)", () => {
    // 08:00 on the 16th in Auckland, while it is 23:00 on the 15th there:
    // the same day in UTC.
    const startsAt = new Date("2026-11-15T19:00:00Z");
    const { when } = rowMarks(
      marked({
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * hour),
        timeZone: "Pacific/Auckland",
      }),
      new Date("2026-11-15T10:00:00Z"),
    );
    expect(when).not.toContain(m.site_today_at({ time: "" }).trim());
    expect(when).toContain("16");
    expect(when).toContain("November");
  });

  it("marks an event going on now, and only that (AC-7)", () => {
    const going = rowMarks(
      marked({
        startsAt: new Date(now.getTime() - hour),
        endsAt: new Date(now.getTime() + hour),
      }),
      now,
    );
    expect(going.happeningNow).toBe(true);
    expect(rowMarks(marked(), now).happeningNow).toBe(false);
  });
});
