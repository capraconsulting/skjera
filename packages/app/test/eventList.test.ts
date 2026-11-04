import { describe, expect, it } from "vitest";
import {
  defaultOrder,
  eventOrders,
  readOrder,
  searchEvents,
  sortEvents,
} from "../src/routes/studio/eventList.ts";

const event = (
  id: string,
  title: string,
  tags: ReadonlyArray<string> = [],
) => ({ id, title, tags });

describe("searchEvents", () => {
  const events = [
    event("a", "Julebord", ["Sosialt"]),
    event("b", "Fagkveld", ["Fag"]),
    event("c", "", []),
  ];
  const idsOf = (text: string) =>
    searchEvents(events, text).map(({ id }) => id);

  it("finds an event by its title, ignoring case (AC-1)", () => {
    expect(idsOf("JULE")).toEqual(["a"]);
    expect(idsOf("kveld")).toEqual(["b"]);
  });

  it("finds an event by one of its tags, ignoring case (AC-1)", () => {
    expect(idsOf("sosi")).toEqual(["a"]);
    expect(idsOf("FAG")).toEqual(["b"]);
  });

  it("lists every event while the text is empty or only spaces (AC-1)", () => {
    expect(idsOf("")).toEqual(["a", "b", "c"]);
    expect(idsOf("   ")).toEqual(["a", "b", "c"]);
  });

  it("ignores spaces around the text (AC-1)", () => {
    expect(idsOf("  jule ")).toEqual(["a"]);
  });

  it("gives no event when nothing matches (AC-4)", () => {
    expect(idsOf("finnes ikke")).toEqual([]);
  });
});

describe("sortEvents", () => {
  const at = (day: number) => new Date(Date.UTC(2036, 0, day));
  // Made in turn: first, second, third. The first was edited last.
  const first = {
    id: "first",
    startsAt: at(10),
    createdAt: at(1),
    updatedAt: at(9),
  };
  const second = {
    id: "second",
    startsAt: at(20),
    createdAt: at(2),
    updatedAt: at(3),
  };
  const third = {
    id: "third",
    startsAt: null,
    createdAt: at(3),
    updatedAt: at(4),
  };
  const idsOf = (order: Parameters<typeof sortEvents>[1]) =>
    sortEvents([second, third, first], order).map(({ id }) => id);

  it("puts the most recently edited first for «Sist endret» (AC-2)", () => {
    expect(idsOf("updated")).toEqual(["first", "third", "second"]);
  });

  it("puts the one made last first for «Opprettet» (AC-2)", () => {
    expect(idsOf("created")).toEqual(["third", "second", "first"]);
  });

  it("puts the latest start first for «Dato for arrangementet», and no start last (AC-2)", () => {
    expect(idsOf("starts")).toEqual(["second", "first", "third"]);
  });

  it("breaks a tie by last edited, then by id, so rows keep their places (AC-2)", () => {
    const same = at(5);
    const tied = [
      { id: "b", startsAt: same, createdAt: same, updatedAt: at(6) },
      { id: "a", startsAt: same, createdAt: same, updatedAt: at(6) },
      { id: "c", startsAt: same, createdAt: same, updatedAt: at(7) },
    ];
    expect(sortEvents(tied, "created").map(({ id }) => id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("returns a new array and leaves the one given as it was (AC-2)", () => {
    const given = [second, third, first];
    const sorted = sortEvents(given, "created");
    expect(sorted).not.toBe(given);
    expect(given.map(({ id }) => id)).toEqual(["second", "third", "first"]);
  });
});

describe("readOrder", () => {
  it("reads each order stored (AC-6)", () => {
    for (const order of eventOrders) expect(readOrder(order)).toBe(order);
  });

  it("starts at «Sist endret» (AC-2)", () => {
    expect(defaultOrder).toBe("updated");
    expect(readOrder(null)).toBe("updated");
  });

  it("falls back to «Sist endret» for an unknown or damaged value (AC-6)", () => {
    expect(readOrder("oldest")).toBe("updated");
    expect(readOrder("")).toBe("updated");
    expect(readOrder('{"order":"created"}')).toBe("updated");
  });
});
