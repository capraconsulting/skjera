import { ZonedDateTime as ZonedDateTimeSchema } from "@skjera/documents";
import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { catalogue } from "../testdata/catalogue.ts";

const past = (n: number) => `AC-1 to AC-7: Past ${n}`;

describe("catalogue(now)", () => {
  const days = [
    "2036-06-17", // an ordinary day
    "2036-03-29", // the day before summer time starts in Norway
    "2036-10-25", // the day before winter time starts
  ];
  const nows = days.flatMap((day) =>
    Array.from({ length: 48 }, (_, half) =>
      Temporal.Instant.from(`${day}T00:00:00Z`)
        .add({ minutes: half * 30 })
        .toZonedDateTimeISO("UTC"),
    ),
  );
  const minutes = (from: Temporal.ZonedDateTime, to: Temporal.ZonedDateTime) =>
    to.epochMilliseconds / 60000 - from.epochMilliseconds / 60000;

  it("gives every event times that hold together, and that the studio accepts (AC-3)", () => {
    for (const now of nows) {
      for (const team of catalogue(now)) {
        for (const event of team.events) {
          const where = `${team.name} / ${event.title} at ${now}`;
          const { start, end, deadline, foodDeadline } = event;
          if (start !== undefined && end !== undefined)
            expect(minutes(start, end), where).toBeGreaterThan(0);
          if (start !== undefined && deadline !== undefined)
            expect(minutes(deadline, start), where).toBeGreaterThanOrEqual(0);
          if (start !== undefined && foodDeadline !== undefined)
            expect(
              minutes(foodDeadline, deadline ?? start),
              where,
            ).toBeGreaterThanOrEqual(0);
          for (const time of [start, end, deadline, foodDeadline])
            if (time !== undefined)
              Schema.decodeUnknownSync(ZonedDateTimeSchema)(
                time.toString({ smallestUnit: "minute" }),
              );
        }
      }
    }
    // About 50,000 times decoded: half a second here, more than the default
    // five seconds on CI's machines while every package's tests run at once.
  }, 30_000);

  it("keeps sign-up open, and food asked for, when the signups are made (AC-3)", () => {
    for (const now of nows) {
      const later = now.add({ minutes: 2 });
      for (const team of catalogue(now)) {
        for (const event of team.events) {
          const signups = event.signups ?? [];
          if (signups.length === 0 || event.start === undefined) continue;
          const where = `${team.name} / ${event.title} at ${now}`;
          const closes = event.deadline ?? event.start;
          expect(minutes(later, closes), where).toBeGreaterThan(0);
          if (signups.some((signup) => signup.dietary !== undefined))
            expect(
              minutes(later, event.foodDeadline ?? closes),
              where,
            ).toBeGreaterThan(0);
        }
      }
    }
  });

  it("starts the events of a few minutes soon, and sets past and present ones right (AC-3)", () => {
    for (const now of nows) {
      const teams = catalogue(now);
      const find = (prefix: string, title: string) =>
        teams
          .find((team) => team.name.startsWith(prefix))
          ?.events.find((event) => event.title === title);
      for (const [prefix, title] of [
        ["SIGN-11:", "AC-8: Ended"],
        ["MAIL-04:", "AC-4: Over"],
        ["STU-19:", "AC-6: Ended"],
        ["STU-20:", "AC-8 to AC-11: Ended"],
      ] as const) {
        const start = find(prefix, title)?.start;
        expect(start, `${title} at ${now}`).toBeDefined();
        if (start === undefined) continue;
        expect(minutes(now, start)).toBeGreaterThan(0);
        expect(minutes(now, start)).toBeLessThanOrEqual(15);
      }
      for (let n = 1; n <= 7; n++) {
        const end = find("SITE-02:", past(n))?.end;
        expect(end).toBeDefined();
        if (end !== undefined) expect(minutes(now, end)).toBeLessThan(0);
      }
      const going = find("SITE-02:", "AC-5: Going on now");
      if (going?.start === undefined || going.end === undefined)
        throw new Error("no «AC-5: Going on now»");
      expect(minutes(going.start, now)).toBeGreaterThan(0);
      expect(minutes(now, going.end)).toBeGreaterThan(0);
    }
  });
});
