import { readdirSync, readFileSync } from "node:fs";
import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import {
  criteriaOf,
  type Feature as DocFeature,
  eventIn,
  eventsNamed,
  featureOf,
  mentions,
  quotes,
  rangeOf,
  readFeatures,
  titlesByFeature,
  withSteps,
} from "../testdata/acceptance.ts";
import { catalogue } from "../testdata/catalogue.ts";
import type { Block, EventSpec, TeamSpec } from "../testdata/fill.ts";

const acceptance = new URL("../../../docs/acceptance/", import.meta.url);
const docs = readFeatures(acceptance);
const rules = Temporal.Now.zonedDateTimeISO("Europe/Oslo").round({
  smallestUnit: "minute",
  roundingMode: "floor",
});

/** `teams` with the event `from` in the team of `feature` named `to`. */
const renamed = (
  teams: ReadonlyArray<TeamSpec>,
  feature: string,
  from: string,
  to: string,
): ReadonlyArray<TeamSpec> =>
  teams.map((team) =>
    team.name.startsWith(`${feature}:`)
      ? {
          ...team,
          events: team.events.map((each) =>
            each.title === from ? { ...each, title: to } : each,
          ),
        }
      : team,
  );

/** Each event of `teams` that has a title, with its feature and the titles of that feature. */
const eventsOf = (
  teams: ReadonlyArray<TeamSpec>,
  features: ReadonlyMap<string, DocFeature>,
) => {
  const titles = titlesByFeature(teams);
  return teams.flatMap((team) =>
    team.events
      .filter((spec) => spec.title !== "")
      .flatMap((spec) => {
        const id = featureOf(team, spec);
        const feature = id === undefined ? undefined : features.get(id);
        return id === undefined || feature === undefined
          ? []
          : [{ id, feature, spec, titles: titles.get(id) ?? [] }];
      }),
  );
};

/** Events whose name is not «AC-n: …» or «AC-n to AC-m: …». */
const formProblems = (teams: ReadonlyArray<TeamSpec>) =>
  teams.flatMap((team) =>
    team.events
      .filter((spec) => spec.title !== "" && rangeOf(spec.title) === undefined)
      .map((spec) => `${team.name}: «${spec.title}»`),
  );

/** Criteria that name an event, or name none and point to one that does, and lie outside its range. */
const coverProblems = (
  teams: ReadonlyArray<TeamSpec>,
  features: ReadonlyMap<string, DocFeature> = docs,
) =>
  eventsOf(teams, features).flatMap(({ id, feature, spec, titles }) => {
    const range = rangeOf(spec.title);
    if (range === undefined) return [];
    const names = feature.criteria.filter((each) =>
      eventsNamed(feature, each, titles).includes(spec.title),
    );
    const points = feature.criteria.filter(
      (each) =>
        eventsNamed(feature, each, titles).length === 0 &&
        names.some((other) => mentions(each, other.number)),
    );
    return [...names, ...points]
      .filter((each) => each.number < range.first || each.number > range.last)
      .map((each) => `${id} «${spec.title}»: AC-${each.number}`);
  });

/** Ranges whose first or last criterion does not use the event. */
const endsProblems = (
  teams: ReadonlyArray<TeamSpec>,
  features: ReadonlyMap<string, DocFeature> = docs,
) =>
  eventsOf(teams, features).flatMap(({ id, feature, spec, titles }) => {
    const range = rangeOf(spec.title);
    if (range === undefined || range.first === range.last) return [];
    const used = criteriaOf(feature, spec.title, titles);
    return [range.first, range.last]
      .filter((number) => !used.includes(number))
      .map((number) => `${id} «${spec.title}»: AC-${number}`);
  });

/** Names of an event's shape in a feature's steps that no event of the feature has. */
const stepNameProblems = (teams: ReadonlyArray<TeamSpec>) => {
  const titles = titlesByFeature(teams);
  return [...docs.values()].flatMap((feature) =>
    feature.criteria.flatMap((criterion) =>
      quotes(criterion).flatMap((quoted) => {
        const own = titles.get(feature.id) ?? [];
        const found = eventIn(quoted, own);
        if (!found.shaped || found.title !== undefined) return [];
        if (feature.writes.some((name) => quoted.includes(name))) return [];
        // «AC-7: Past …» stands for a run of events.
        const start = quoted.search(/AC-\d/);
        const cut = quoted.indexOf("…", start);
        const stem = cut < 0 ? "" : quoted.slice(start, cut);
        if (stem !== "" && own.some((title) => title.includes(stem))) return [];
        return [`${feature.id} AC-${criterion.number}: «${quoted}»`];
      }),
    ),
  );
};

/** A feature whose criteria have these steps, each a line of one step. */
const fixture = (
  id: string,
  criteria: ReadonlyArray<readonly [number, string]>,
): ReadonlyMap<string, DocFeature> =>
  new Map([
    [
      id,
      {
        id,
        teams: [],
        events: [],
        writes: [],
        criteria: criteria.map(([number, step]) => ({
          number,
          heading: `AC-${number}: Criterion ${number}`,
          steps: [`- **Given** ${step}`],
        })),
      },
    ],
  ]);

const stu20 = (...titles: ReadonlyArray<string>): TeamSpec => ({
  name: "STU-20: Unpublishing",
  events: titles.map((title) => ({ title })),
});

describe("the names of the test events hold to docs/acceptance", () => {
  it("starts every name with «AC-n» or «AC-n to AC-m» (AC-1)", () => {
    expect(formProblems(catalogue(rules))).toEqual([]);
  });

  it("names the first and last criterion that use the event (AC-1)", () => {
    expect(endsProblems(catalogue(rules))).toEqual([]);
    // AC-2 names only «AC-3: Nobody signed up»; AC-3 and AC-10 name the range's event.
    const stranger = fixture("STU-20", [
      [2, "«AC-3: Nobody signed up»"],
      [3, "«AC-2 to AC-10: Signed up»"],
      [10, "«AC-2 to AC-10: Signed up»"],
    ]);
    expect(
      endsProblems(
        [stu20("AC-2 to AC-10: Signed up", "AC-3: Nobody signed up")],
        stranger,
      ),
    ).toEqual(["STU-20 «AC-2 to AC-10: Signed up»: AC-2"]);
  });

  it("fails when a name doesn't cover every criterion that names the event (AC-2)", () => {
    expect(coverProblems(catalogue(rules))).toEqual([]);
    const narrow = fixture("STU-20", [
      [1, "«AC-3: Nobody signed up»"],
      [2, "«AC-3: Nobody signed up»"],
      [3, "«AC-3: Nobody signed up»"],
    ]);
    expect(coverProblems([stu20("AC-3: Nobody signed up")], narrow)).toEqual([
      "STU-20 «AC-3: Nobody signed up»: AC-1",
      "STU-20 «AC-3: Nobody signed up»: AC-2",
    ]);
  });

  it("fails when a criterion that points to the event lies outside its range (AC-2)", () => {
    // AC-14 names no event, and mentions AC-4, which names this one.
    const pointing = fixture("STU-20", [
      [3, "«AC-3 to AC-12: Signed up»"],
      [4, "«AC-3 to AC-12: Signed up»"],
      [14, "the unpublished event of AC-4"],
    ]);
    expect(
      coverProblems([stu20("AC-3 to AC-12: Signed up")], pointing),
    ).toEqual(["STU-20 «AC-3 to AC-12: Signed up»: AC-14"]);
    expect(
      coverProblems([stu20("AC-3 to AC-14: Signed up")], pointing),
    ).toEqual([]);
  });

  it("holds every name in the steps to an event of the test data (AC-6)", () => {
    const teams = catalogue(rules);
    expect(stepNameProblems(teams)).toEqual([]);
    expect(
      stepNameProblems(
        renamed(
          teams,
          "STU-20",
          "AC-3 to AC-14: Signed up",
          "AC-3 to AC-12: Signed up",
        ),
      ).length,
    ).toBeGreaterThan(0);
  });
});

// ---- The text of each event -------------------------------------------------

const firstLine = (spec: EventSpec | undefined): string =>
  spec?.body?.[0]?.text ?? "";

const eventNamed = (
  teams: ReadonlyArray<TeamSpec>,
  feature: string,
  title: string,
): EventSpec => {
  const spec = teams
    .find((team) => team.name.startsWith(`${feature}:`))
    ?.events.find((each) => each.title === title);
  if (spec === undefined) throw new Error(`No event «${title}» in ${feature}`);
  return spec;
};

describe("withSteps", () => {
  const given = catalogue(rules);
  const steps = withSteps(given, docs);

  it("lists the criteria that use the event in the first line (AC-3)", () => {
    expect(
      firstLine(eventNamed(steps, "STU-20", "AC-3 to AC-14: Signed up")),
    ).toBe(
      "Test steps for STU-20 AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-11, AC-12 and AC-14.",
    );
    expect(firstLine(eventNamed(steps, "STU-20", "AC-8 to AC-11: Ended"))).toBe(
      "Test steps for STU-20 AC-8 and AC-11.",
    );
  });

  it("lists the criteria that reach the event only through another one (AC-3)", () => {
    // MAIL-01 AC-2 to AC-4 read «bob's email from AC-1».
    expect(
      firstLine(eventNamed(steps, "MAIL-01", "AC-1 to AC-4: Signed up")),
    ).toBe("Test steps for MAIL-01 AC-1, AC-2, AC-3 and AC-4.");
    // An event named after one criterion belongs to that criterion alone.
    expect(
      firstLine(
        eventNamed(steps, "SIGN-06", "AC-3: A full event refuses new sign-ups"),
      ),
    ).toBe("Test steps for SIGN-06 AC-3.");
    // AC-2 and AC-3 name the «AC-2 and AC-3: Refused» that the tester gives.
    expect(
      firstLine(eventNamed(steps, "STU-17", "AC-1 to AC-5: Published")),
    ).toBe("Test steps for STU-17 AC-1, AC-4 and AC-5.");
  });

  it("gives each listed criterion a heading and one item for each step (AC-4)", () => {
    const body = eventNamed(steps, "STU-20", "AC-3 to AC-14: Signed up").body;
    const feature = docs.get("STU-20");
    if (body === undefined || feature === undefined) throw new Error("no body");
    const listed = [3, 4, 5, 6, 7, 9, 11, 12, 14];
    expect(body[0]?.kind).toBe("paragraph");
    expect(
      body.filter((block) => block.kind === "heading").map((b) => b.text),
    ).toEqual(
      listed.map(
        (number) =>
          feature.criteria.find((each) => each.number === number)?.heading,
      ),
    );
    const items = (heading: string) => {
      const from = body.findIndex(
        (block) => block.kind === "heading" && block.text === heading,
      );
      const rest = body.slice(from + 1);
      const next = rest.findIndex((block) => block.kind === "heading");
      return (next < 0 ? rest : rest.slice(0, next)).map(
        (block: Block) => block.text,
      );
    };
    const unpublish = items("AC-3: The question says who is told");
    expect(unpublish).toContain("When you click Unpublish");
    expect(unpublish.length).toBe(
      feature.criteria.find((each) => each.number === 3)?.steps.length,
    );
    // Bold and code marks are taken out; the quotes stay.
    expect(items("AC-4: Off the site at once")).toContain(
      "Then the event is gone from the front page, /embed, /api/public/events and the calendar subscription /api/subscribe",
    );
    expect(
      body
        .filter((block) => block.kind === "item")
        .filter((block) => /\*\*|`|^- /.test(block.text)),
    ).toEqual([]);
  });

  it("gives every event a text, apart from those with their own and the empty one (AC-3)", () => {
    const without = steps.flatMap((team) =>
      team.events
        .filter((each) => each.state !== "empty")
        .filter((each) => (each.body ?? []).length === 0)
        .map((each) => `${team.name}: «${each.title}»`),
    );
    expect(without).toEqual([]);
  });

  it("keeps the text the catalogue gives an event, and leaves the empty event empty (AC-5)", () => {
    const own = given.flatMap((team) =>
      team.events
        .filter((each) => each.body !== undefined)
        .map((each) => ({ team: team.name, spec: each })),
    );
    expect(own.map((each) => each.spec.title)).toEqual([
      "AC-1 to AC-2: Kept on the server",
      "AC-2: Text",
      "AC-1 to AC-4: Members only",
      "AC-5: A members-only event shares its title, summary and image",
      "AC-2: At once",
      "AC-1 to AC-5: Julebord",
    ]);
    for (const { team, spec } of own) {
      const after = steps
        .find((each) => each.name === team)
        ?.events.find((each) => each.title === spec.title);
      expect(after?.body).toEqual(spec.body);
    }
    const empty = steps
      .flatMap((team) => team.events)
      .filter((each) => each.state === "empty");
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((each) => each.body === undefined)).toBe(true);
  });
});

describe("test-data test files", () => {
  it("keeps every test file below 800 lines (AC-4)", () => {
    const directory = new URL("./", import.meta.url);
    const oversized = readdirSync(directory)
      .filter(
        (file) => file.startsWith("testdata") && file.endsWith(".test.ts"),
      )
      .filter(
        (file) =>
          readFileSync(new URL(file, directory), "utf8").split("\\n").length >
          800,
      );
    expect(oversized).toEqual([]);
  });
});
