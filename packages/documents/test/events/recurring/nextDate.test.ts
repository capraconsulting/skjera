import { assert, describe, it } from "@effect/vitest";
import { Cron } from "effect";
import * as Recurring from "../../../src/events/Recurring.ts";

// When a recurring event comes next: the date in the series, kept on the
// clock across time changes, and the daily job's time.

const oslo = "Europe/Oslo";

const { nextDate } = Recurring;

/** The times of an event with only a start and an end. */
const times = (start: string, end: string) => ({
  start,
  end,
  deadline: null,
  foodDeadline: null,
});

describe("The next date", () => {
  it("is the first date in the series whose end has not passed", () => {
    const next = nextDate(
      times(
        "2026-11-10T18:00+01:00[Europe/Oslo]",
        "2026-11-10T21:00+01:00[Europe/Oslo]",
      ),
      { every: 1, unit: "day" },
      new Date("2026-11-13T06:30:00Z"),
    );
    assert.deepStrictEqual(
      next,
      times(
        "2026-11-13T18:00+01:00[Europe/Oslo]",
        "2026-11-13T21:00+01:00[Europe/Oslo]",
      ),
    );
  });

  it("moves the start, end and both deadlines a week, keeping their time of day across winter time", () => {
    const next = nextDate(
      {
        start: "2026-10-22T18:00+02:00[Europe/Oslo]",
        end: "2026-10-22T21:00+02:00[Europe/Oslo]",
        deadline: "2026-10-21T12:00+02:00[Europe/Oslo]",
        foodDeadline: "2026-10-20T12:00+02:00[Europe/Oslo]",
      },
      { every: 1, unit: "week" },
      new Date("2026-10-23T06:30:00Z"),
    );
    assert.deepStrictEqual(next, {
      start: "2026-10-29T18:00+01:00[Europe/Oslo]",
      end: "2026-10-29T21:00+01:00[Europe/Oslo]",
      deadline: "2026-10-28T12:00+01:00[Europe/Oslo]",
      foodDeadline: "2026-10-27T12:00+01:00[Europe/Oslo]",
    });
  });

  it("keeps 18:00 across the change to summer time", () => {
    const next = nextDate(
      times(
        "2027-03-25T18:00+01:00[Europe/Oslo]",
        "2027-03-25T21:00+01:00[Europe/Oslo]",
      ),
      { every: 1, unit: "week" },
      new Date("2027-03-26T06:30:00Z"),
    );
    assert.strictEqual(next.start, "2027-04-01T18:00+02:00[Europe/Oslo]");
    assert.strictEqual(next.end, "2027-04-01T21:00+02:00[Europe/Oslo]");
  });

  it("keeps each deadline's distance to the start on the clock when the clocks change between them", () => {
    const before = nextDate(
      {
        start: "2026-10-19T18:00+02:00[Europe/Oslo]",
        end: "2026-10-19T21:00+02:00[Europe/Oslo]",
        deadline: "2026-10-17T20:00+02:00[Europe/Oslo]",
        foodDeadline: "2026-10-17T19:30+02:00[Europe/Oslo]",
      },
      { every: 1, unit: "week" },
      new Date("2026-10-20T06:30:00Z"),
    );
    assert.strictEqual(before.start, "2026-10-26T18:00+01:00[Europe/Oslo]");
    assert.strictEqual(before.deadline, "2026-10-24T20:00+02:00[Europe/Oslo]");
    assert.strictEqual(
      before.foodDeadline,
      "2026-10-24T19:30+02:00[Europe/Oslo]",
    );

    const after = nextDate(
      {
        start: "2026-10-25T12:00+01:00[Europe/Oslo]",
        end: "2026-10-25T15:00+01:00[Europe/Oslo]",
        deadline: "2026-10-24T12:30+02:00[Europe/Oslo]",
        foodDeadline: "2026-10-24T12:00+02:00[Europe/Oslo]",
      },
      { every: 1, unit: "week" },
      new Date("2026-10-26T06:30:00Z"),
    );
    assert.strictEqual(after.start, "2026-11-01T12:00+01:00[Europe/Oslo]");
    assert.strictEqual(after.deadline, "2026-10-31T12:30+01:00[Europe/Oslo]");
    assert.strictEqual(
      after.foodDeadline,
      "2026-10-31T12:00+01:00[Europe/Oslo]",
    );
  });

  it("leaves a deadline that is not set not set", () => {
    const next = nextDate(
      times(
        "2026-10-22T18:00+02:00[Europe/Oslo]",
        "2026-10-22T21:00+02:00[Europe/Oslo]",
      ),
      { every: 1, unit: "week" },
      new Date("2026-10-23T06:30:00Z"),
    );
    assert.isNull(next.deadline);
    assert.isNull(next.foodDeadline);
  });

  it("takes the last day of a month that is shorter", () => {
    const monthly = nextDate(
      times(
        "2027-01-31T18:00+01:00[Europe/Oslo]",
        "2027-01-31T21:00+01:00[Europe/Oslo]",
      ),
      { every: 1, unit: "month" },
      new Date("2027-02-01T06:30:00Z"),
    );
    assert.strictEqual(monthly.start, "2027-02-28T18:00+01:00[Europe/Oslo]");

    const yearly = nextDate(
      times(
        "2028-02-29T18:00+01:00[Europe/Oslo]",
        "2028-02-29T21:00+01:00[Europe/Oslo]",
      ),
      { every: 1, unit: "year" },
      new Date("2028-03-01T06:30:00Z"),
    );
    assert.strictEqual(yearly.start, "2029-02-28T18:00+01:00[Europe/Oslo]");

    const everyTwo = nextDate(
      times(
        "2027-12-31T18:00+01:00[Europe/Oslo]",
        "2027-12-31T21:00+01:00[Europe/Oslo]",
      ),
      { every: 2, unit: "month" },
      new Date("2028-01-01T06:30:00Z"),
    );
    assert.strictEqual(everyTwo.start, "2028-02-29T18:00+01:00[Europe/Oslo]");
  });

  it("keeps a deadline before the start when the month is shorter", () => {
    const next = nextDate(
      {
        start: "2027-01-31T18:00+01:00[Europe/Oslo]",
        end: "2027-01-31T21:00+01:00[Europe/Oslo]",
        deadline: "2027-01-30T20:00+01:00[Europe/Oslo]",
        foodDeadline: null,
      },
      { every: 1, unit: "month" },
      new Date("2027-02-01T06:30:00Z"),
    );
    assert.strictEqual(next.start, "2027-02-28T18:00+01:00[Europe/Oslo]");
    assert.strictEqual(next.deadline, "2027-02-27T20:00+01:00[Europe/Oslo]");
  });
});

describe("The schedule", () => {
  it("runs at 06:30 UTC whatever zone the process is in", () => {
    const before = process.env.TZ;
    process.env.TZ = oslo;
    try {
      assert.strictEqual(
        Cron.next(
          Recurring.schedule,
          new Date("2026-03-30T06:00:00Z"),
        ).toISOString(),
        "2026-03-30T06:30:00.000Z",
      );
      assert.strictEqual(
        Cron.next(
          Recurring.schedule,
          new Date("2026-03-30T06:30:01Z"),
        ).toISOString(),
        "2026-03-31T06:30:00.000Z",
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
