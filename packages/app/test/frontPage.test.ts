import type { EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { baseLocale, overwriteGetLocale } from "@skjera/i18n/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { rowMarks, upcomingAndPast } from "../src/site/frontPage.ts";

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
