// Which criteria of docs/acceptance use a test event, and the manual test
// steps of those criteria, read from the docs when the data is filled in.
import { readdirSync, readFileSync } from "node:fs";
import type { Block, EventSpec, TeamSpec } from "./fill.ts";

export interface Criterion {
  readonly number: number;
  /** The criterion's heading line, such as «AC-3: The question says who is told». */
  readonly heading: string;
  /** The lines between **Test** and **Automated**; none for «Automated only». */
  readonly steps: ReadonlyArray<string>;
}

export interface Feature {
  readonly id: string;
  readonly criteria: ReadonlyArray<Criterion>;
  /** Names the file has the tester write, so the test data doesn't make them. */
  readonly writes: ReadonlyArray<string>;
}

/** The directory of the feature files, from this module and not the working folder. */
export const acceptanceDirectory = new URL(
  "../../../docs/acceptance/",
  import.meta.url,
);

// ---- Reading the feature files ---------------------------------------------

const criteriaOfFile = (text: string): ReadonlyArray<Criterion> =>
  text
    .split(/^## /m)
    .slice(1)
    .flatMap((section) => {
      const lines = section.split("\n");
      const heading = /^(AC-(\d+): .+)$/.exec(lines[0] ?? "");
      if (heading?.[1] === undefined) return [];
      const start = lines.findIndex((line) => line.startsWith("**Test**"));
      const rest = start < 0 ? [] : lines.slice(start + 1);
      const end = rest.findIndex((line) => line.startsWith("**Automated"));
      const steps = (end < 0 ? rest : rest.slice(0, end))
        .map((line) => line.trim())
        .filter((line) => line !== "");
      return [{ number: Number(heading[2]), heading: heading[1], steps }];
    });

/** Every feature file of `directory`, by feature id. */
export const readFeatures = (
  directory: URL = acceptanceDirectory,
): ReadonlyMap<string, Feature> => {
  const features = new Map<string, Feature>();
  for (const file of readdirSync(directory).sort()) {
    if (!/^[A-Z]+-\d+-.*\.md$/.test(file)) continue;
    const text = readFileSync(new URL(file, directory), "utf8");
    const id = /^# ([A-Z]+-\d+): /m.exec(text)?.[1];
    if (id === undefined) continue;
    features.set(id, {
      id,
      criteria: criteriaOfFile(text),
      writes: [
        ...text.matchAll(/(?:title it|write the title|writes) «([^»]+)»/g),
      ].map((match) => match[1] ?? ""),
    });
  }
  return features;
};

// ---- Names ------------------------------------------------------------------

/** A feature id before AC, as in «EXT-04 AC-3: …» in the shared team. */
const featurePrefix = /^(?!AC-)[A-Z]+-\d+ (?=AC-\d)/;

/** An event's title without the id of its feature before AC. */
export const nameOf = (title: string): string =>
  title.replace(featurePrefix, "");

/** The criteria a name starts with: «AC-n: …» or «AC-n to AC-m: …». */
export const rangeOf = (
  title: string,
): { readonly first: number; readonly last: number } | undefined => {
  const match = /^AC-(\d+)(?: to AC-(\d+))?: /.exec(nameOf(title));
  if (match === null) return undefined;
  const first = Number(match[1]);
  const last = match[2] === undefined ? first : Number(match[2]);
  return first <= last && (match[2] === undefined || first < last)
    ? { first, last }
    : undefined;
};

/** The feature an event is for: its team's id, else the id its title starts with. */
export const featureOf = (
  team: TeamSpec,
  spec: EventSpec,
): string | undefined =>
  /^([A-Z]+-\d+):/.exec(team.name)?.[1] ??
  /^((?!AC-)[A-Z]+-\d+) AC-\d/.exec(spec.title)?.[1];

/** The titles of the events in each feature's teams. */
export const titlesByFeature = (
  teams: ReadonlyArray<TeamSpec>,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const titles = new Map<string, Array<string>>();
  for (const team of teams)
    for (const spec of team.events) {
      const id = featureOf(team, spec);
      if (id === undefined || spec.title === "") continue;
      titles.set(id, [...(titles.get(id) ?? []), spec.title]);
    }
  return titles;
};

// ---- Which criteria use an event --------------------------------------------

/** Where a name of an event's shape starts: «[feature id ]AC-n…: ». */
const shape = /(?:(?!AC-)[A-Z]+-\d+ )?AC-\d+(?:(?:,| and| to) AC-\d+)*: /;

/** The texts in « » in a criterion's steps. */
export const quotes = (criterion: Criterion): ReadonlyArray<string> =>
  [...criterion.steps.join("\n").matchAll(/«([^»]+)»/g)].map(
    (match) => match[1] ?? "",
  );

/**
 * Whether `quoted` holds a name of an event's shape, and which of `titles` it
 * starts with from there: the longest one that ends the text or goes on with
 * something other than a letter or a digit.
 */
export const eventIn = (
  quoted: string,
  titles: ReadonlyArray<string>,
): { readonly shaped: boolean; readonly title?: string } => {
  const start = shape.exec(quoted)?.index;
  if (start === undefined) return { shaped: false };
  const rest = quoted.slice(start);
  let best: string | undefined;
  for (const title of titles)
    for (const candidate of new Set([title, nameOf(title)]))
      if (
        rest.startsWith(candidate) &&
        !/[\p{L}\p{N}]/u.test(rest[candidate.length] ?? "") &&
        (best === undefined || title.length > best.length)
      )
        best = title;
  return best === undefined ? { shaped: true } : { shaped: true, title: best };
};

/** The events of `feature` that a criterion's steps name in full. */
export const eventsNamed = (
  feature: Feature,
  criterion: Criterion,
  titles: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const all = [...titles, ...feature.writes];
  return [
    ...new Set(
      quotes(criterion).flatMap((quoted) => {
        const found = eventIn(quoted, all);
        if (found.title !== undefined) return [found.title];
        // «AC-1 to AC-7: Past …» stands for a run of events.
        const start = shape.exec(quoted)?.index;
        const cut = quoted.indexOf("…");
        if (!found.shaped || start === undefined || cut < start) return [];
        const stem = quoted.slice(start, cut);
        return all.filter((title) => title.startsWith(stem));
      }),
    ),
  ];
};

/** Whether the steps, outside their « », mention criterion `number` of the same feature. */
export const mentions = (criterion: Criterion, number: number): boolean =>
  new RegExp(`(?<![A-Z]+-\\d+ )\\bAC-${number}(?!\\d)`).test(
    criterion.steps.join("\n").replace(/«[^»]*»/g, ""),
  );

/**
 * The criteria that use the event: for «AC-n: …», criterion n. For
 * «AC-n to AC-m: …», each criterion in the range with a manual test that names
 * the event, names no event of its feature, or mentions a criterion that uses
 * it; this repeats until nothing more is added.
 */
export const criteriaOf = (
  feature: Feature,
  title: string,
  titles: ReadonlyArray<string>,
): ReadonlyArray<number> => {
  const range = rangeOf(title);
  if (range === undefined) return [];
  if (range.first === range.last) return [range.first];
  const tested = feature.criteria.filter(
    (criterion) =>
      criterion.steps.length > 0 &&
      criterion.number >= range.first &&
      criterion.number <= range.last,
  );
  const using = new Set<Criterion>();
  for (const criterion of tested) {
    const named = eventsNamed(feature, criterion, titles);
    if (named.length === 0 || named.includes(title)) using.add(criterion);
  }
  for (let added = true; added; ) {
    added = false;
    for (const criterion of tested)
      if (
        !using.has(criterion) &&
        [...using].some((other) => mentions(criterion, other.number))
      ) {
        using.add(criterion);
        added = true;
      }
  }
  return [...using].map((criterion) => criterion.number).sort((a, b) => a - b);
};

// ---- The text of an event ---------------------------------------------------

/** "AC-3", "AC-3 and AC-4", "AC-3, AC-4 and AC-5". */
const listed = (numbers: ReadonlyArray<number>): string => {
  const names = numbers.map((number) => `AC-${number}`);
  const last = names.at(-1);
  return names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${last}`;
};

/** A step as the editor shows it: no list dash, no bold, no code marks. */
const plain = (line: string): string =>
  line.replace(/^- /, "").replaceAll("**", "").replaceAll("`", "");

/** The blocks of an event's text: its criteria, then each one's heading and steps. */
export const description = (
  feature: Feature,
  numbers: ReadonlyArray<number>,
): ReadonlyArray<Block> => {
  if (numbers.length === 0)
    return [
      {
        kind: "paragraph",
        text: `No manual test of ${feature.id} uses this event.`,
      },
    ];
  return [
    {
      kind: "paragraph",
      text: `Test steps for ${feature.id} ${listed(numbers)}.`,
    },
    ...numbers.flatMap((number): ReadonlyArray<Block> => {
      const criterion = feature.criteria.find((each) => each.number === number);
      if (criterion === undefined) return [];
      return [
        { kind: "heading", text: criterion.heading },
        ...criterion.steps.map((line): Block => {
          const text = plain(line);
          return line.startsWith("- ")
            ? { kind: "item", text }
            : { kind: "paragraph", text };
        }),
      ];
    }),
  ];
};

/**
 * `teams`, with each event given the text `description` makes. An event that
 * has a text of its own keeps it, and an empty event stays empty.
 */
export const withSteps = (
  teams: ReadonlyArray<TeamSpec>,
  features: ReadonlyMap<string, Feature>,
): ReadonlyArray<TeamSpec> => {
  const titles = titlesByFeature(teams);
  return teams.map((team) => ({
    ...team,
    events: team.events.map((spec) => {
      if (spec.body !== undefined || spec.state === "empty") return spec;
      const id = featureOf(team, spec);
      const feature = id === undefined ? undefined : features.get(id);
      if (id === undefined || feature === undefined) return spec;
      const numbers = criteriaOf(feature, spec.title, titles.get(id) ?? []);
      return { ...spec, body: description(feature, numbers) };
    }),
  }));
};
