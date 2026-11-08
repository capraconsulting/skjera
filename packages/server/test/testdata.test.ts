import { readdirSync, readFileSync } from "node:fs";
import * as A from "@automerge/automerge";
import { PgClient } from "@effect/sql-pg";
import {
  type Attendance,
  Database,
  type DocumentId,
  Documents,
  type EventContent,
  Images,
  organizerEmails,
  type TeamId,
  Teams,
  ZonedDateTime as ZonedDateTimeSchema,
} from "@skjera/documents";
import {
  databaseName,
  databaseServerUrl,
  databaseUrl,
} from "@skjera/test/database";
import { Effect, Redacted, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import {
  type Block,
  type Colour,
  clear,
  type EventSpec,
  fill,
  type TeamSpec,
} from "../testdata/fill.ts";
import { layerOn, localDatabase, people, run, teamsAt } from "../testdata.ts";

const serverUrl = databaseServerUrl(process.env);
const issuer = process.env.OAUTH_ISSUER ?? "http://localhost:5556/dex";
const { alice } = people(issuer);

// ---- What docs/acceptance names -------------------------------------------

const acceptance = new URL("../../../docs/acceptance/", import.meta.url);

/** The title of SITE-02's nth past event. */
const past = (n: number) => `AC-1 to AC-7: Past ${n}`;

interface Feature {
  readonly id: string;
  /** The teams the **Events:** section names, else the file's title. */
  readonly teams: ReadonlyArray<string>;
  readonly events: ReadonlyArray<string>;
}

/** Names in «» are teams after "team " or when they start with the file's id; events when they start with AC-n. */
const features = (): ReadonlyArray<Feature> =>
  readdirSync(acceptance)
    .filter((file) => /^[A-Z]+-\d+-.*\.md$/.test(file))
    .sort()
    .flatMap((file) => {
      const text = readFileSync(new URL(file, acceptance), "utf8");
      const heading = /^# (([A-Z]+-\d+): .+)$/m.exec(text);
      const start = text.indexOf("**Events:**");
      if (heading === null || start < 0) return [];
      const [, title = "", id = ""] = heading;
      const rest = text.slice(start);
      const end = rest.search(/^## /m);
      const section = end < 0 ? rest : rest.slice(0, end);

      const teams: Array<string> = [];
      const events: Array<string> = [];
      for (const match of section.matchAll(/«([^»]+)»/g)) {
        const name = match[1] ?? "";
        const before = section.slice(
          Math.max(0, match.index - 30),
          match.index,
        );
        // A name the tester gives during a test is not made beforehand.
        if (/title it $/.test(before)) continue;
        if (
          name.startsWith(`${id}: `) ||
          /team (named exactly )?$/.test(before)
        )
          teams.push(name);
        else if (/^(?:[A-Z]+-\d+ )?AC-\d+/.test(name)) events.push(name);
      }
      for (const line of section.split("\n")) {
        const row = /^\| (AC-\d+[^|]*?) \|/.exec(line);
        if (row?.[1] !== undefined) events.push(row[1]);
      }
      if (/per criterion/.test(section)) {
        // A criterion names its event itself («AC-2: Changed»), or the event
        // is titled after the criterion.
        const own = [
          ...text.matchAll(/«(AC-\d+(?: (?:and|to) AC-\d+)*: [^»]+)»/g),
        ].map((match) => match[1] ?? "");
        const covered = new Set(
          own.flatMap((name) => {
            const range = rangeOf(name);
            return range === undefined
              ? ((name.split(":")[0] ?? "").match(/AC-\d+/g) ?? [])
              : Array.from(
                  { length: range.last - range.first + 1 },
                  (_, step) => `AC-${range.first + step}`,
                );
          }),
        );
        events.push(...own);
        for (const criterion of text.split(/^## /m).slice(1)) {
          const heading = /^((AC-\d+): .+)$/m.exec(criterion);
          if (
            heading?.[1] !== undefined &&
            !covered.has(heading[2] ?? "") &&
            !criterion.includes("**Automated only")
          )
            events.push(heading[1]);
        }
      }
      return [
        {
          id,
          teams: teams.length > 0 ? teams : [title],
          events: [...new Set(events)],
        },
      ];
    });

const named = features();

// ---- Databases of the test's own ------------------------------------------

const client = (url: string) => PgClient.layer({ url: Redacted.make(url) });

const onServer = <A, E>(
  query: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* query(yield* SqlClient.SqlClient);
    }).pipe(Effect.provide(client(serverUrl))),
  );

const newDatabase = async () => {
  const name = databaseName("skjera_testdata");
  await onServer((sql) => sql.unsafe(`CREATE DATABASE ${name}`));
  return { name, url: databaseUrl(serverUrl, name) };
};

const dropDatabase = (name: string) =>
  onServer((sql) => sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`));

type Provided =
  | Teams
  | Documents
  | Attendance
  | Images.Images
  | SqlClient.SqlClient;

/** Runs `effect` on the services `testdata` runs on, in the database at `url`. */
const using = <A, E>(url: string, effect: Effect.Effect<A, E, Provided>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(layerOn(Database.layerFrom(client(url))))),
  );

const query = <A, E>(
  url: string,
  run: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* run(yield* SqlClient.SqlClient);
    }).pipe(Effect.provide(client(url))),
  );

const published = (url: string, team: string) =>
  query(
    url,
    (sql) =>
      sql<{
        title: string;
        starts_at: Date;
        ends_at: Date;
        is_public: boolean;
        allow_guests: boolean;
        max_attendees: number | null;
        send_reminders: boolean;
        cover: { src: string } | null;
        questions: ReadonlyArray<unknown>;
        tags: ReadonlyArray<string>;
        deleted_at: Date | null;
      }>`
      SELECT e.title, e.starts_at, e.ends_at, e.is_public, e.allow_guests,
        e.max_attendees, e.send_reminders, e.cover, e.questions, e.tags, e.deleted_at
      FROM events e JOIN documents d ON d.id = e.id JOIN teams t ON t.id = d.team_id
      WHERE t.name = ${team} ORDER BY e.title`,
  );

const drafts = (url: string, team: string) =>
  query(
    url,
    (sql) =>
      sql<{ title: string; deleted_at: Date | null; is_published: boolean }>`
      SELECT d.title, d.deleted_at, EXISTS (SELECT 1 FROM events e WHERE e.id = d.id) AS is_published
      FROM documents d JOIN teams t ON t.id = d.team_id
      WHERE t.name = ${team} ORDER BY d.title`,
  );

const signedUp = (url: string, team: string, title: string) =>
  query(
    url,
    (sql) =>
      sql<{
        user_subject: string | null;
        user_issuer: string | null;
        email: string | null;
      }>`
      SELECT a.user_subject, a.user_issuer, a.email
      FROM attendees a JOIN events e ON e.id = a.event_id
        JOIN documents d ON d.id = e.id JOIN teams t ON t.id = d.team_id
      WHERE t.name = ${team} AND e.title = ${title} ORDER BY a.created_at`,
  );

const count = (url: string, table: string) =>
  query(url, (sql) =>
    sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql(table)}`.pipe(
      Effect.map(([row]) => row?.n ?? 0),
    ),
  );

const teamNames = (url: string) =>
  query(url, (sql) =>
    sql<{ name: string }>`SELECT name FROM teams ORDER BY name`.pipe(
      Effect.map((rows) => rows.map((row) => row.name)),
    ),
  );

const find = <T extends { title: string }>(
  rows: ReadonlyArray<T>,
  title: string,
) => {
  const row = rows.find((each) => each.title === title);
  if (row === undefined) throw new Error(`No event «${title}»`);
  return row;
};

/** A team and an event made by hand, as in the studio: a draft with a title. */
const handMadeTeam = (name: string) =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    return yield* Effect.orDie(teams.create(name, alice));
  });
const handMadeEvent = (team: TeamId, title: string) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const id = yield* Effect.orDie(documents.create("event", team, alice));
    const snapshot = yield* Effect.orDie(documents.get(id));
    const edited = A.change(A.load<EventContent>(snapshot.draft), (event) => {
      A.updateText(event, ["title"], title);
    });
    const change = A.getLastLocalChange(edited);
    if (change === undefined) throw new Error("no change");
    yield* Effect.orDie(documents.applyChanges(id, [change], alice));
    return id;
  });

const oslo = "Europe/Oslo";
const nowOslo = () =>
  Temporal.Now.zonedDateTimeISO(oslo).round({
    smallestUnit: "minute",
    roundingMode: "floor",
  });

// ---- The names hold to the Test parts of docs/acceptance -------------------

const docs = readFeatures(acceptance);
const rules = nowOslo();

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

// ---- The real catalogue, in a database of its own -------------------------

describe("fill and clear on the catalogue", () => {
  let database: { name: string; url: string };
  const started = nowOslo();
  const teamsOfFile = (id: string) =>
    named.find((feature) => feature.id === id)?.teams ?? [];

  beforeAll(async () => {
    database = await newDatabase();
    await using(database.url, fill(teamsAt(started), people(issuer)));
  }, 120_000);

  afterAll(async () => {
    await dropDatabase(database.name);
  }, 60_000);

  it("makes every team the Events sections name (AC-1)", async () => {
    const made = await teamNames(database.url);
    const expected = named.flatMap((feature) => feature.teams);
    expect(expected.length).toBeGreaterThan(50);
    expect(expected.filter((name) => !made.includes(name))).toEqual([]);
  });

  it("makes no team no section names, apart from Capra Gruppen (AC-1)", async () => {
    const made = await teamNames(database.url);
    const expected = new Set(named.flatMap((feature) => feature.teams));
    expect(
      made.filter((name) => !expected.has(name) && name !== "Capra Gruppen"),
    ).toEqual([]);
  });

  it("makes the events, with the settings, questions, images, tags and signups the files describe (AC-2)", async () => {
    const url = database.url;
    const limit = await published(url, teamsOfFile("SIGN-06")[0] ?? "");
    expect(limit.length).toBeGreaterThan(5);
    expect(limit.every((event) => event.max_attendees === 2)).toBe(true);
    for (const title of [
      "AC-5: Those signed up can still change and cancel",
      "AC-6: A freed place can be taken",
      "AC-8: Full, in place of the form",
      "AC-9: A limit below those signed up",
    ]) {
      const people = await signedUp(
        url,
        teamsOfFile("SIGN-06")[0] ?? "",
        title,
      );
      expect(people.map((each) => each.user_subject === null)).toEqual([
        false,
        true,
      ]);
    }

    const visibility = teamsOfFile("STU-12")[0] ?? "";
    const members = find(
      await published(url, visibility),
      "AC-2 to AC-3: Members only",
    );
    expect(members.is_public).toBe(false);
    const fresh = find(await drafts(url, visibility), "AC-1: New");
    expect(fresh.is_published).toBe(false);

    const page = teamsOfFile("SITE-05")[0] ?? "";
    expect(
      find(await drafts(url, page), "AC-5: Deleted").deleted_at,
    ).not.toBeNull();
    const draft = find(await drafts(url, page), "AC-5: Draft");
    expect(draft.is_published).toBe(false);
    expect(draft.deleted_at).toBeNull();

    const questions = await published(url, teamsOfFile("SIGN-09")[0] ?? "");
    expect(questions.map((event) => event.questions.length)).toEqual([3]);

    const front = await published(url, teamsOfFile("SITE-02")[0] ?? "");
    for (let n = 1; n <= 7; n++) {
      const event = find(front, past(n));
      expect(event.cover).not.toBeNull();
      expect(event.tags).toContain("Past 7");
    }

    const logos = await query(
      url,
      (sql) =>
        sql<{ name: string; logo: string | null; logo_dark: string | null }>`
        SELECT name, logo, logo_dark FROM teams WHERE name LIKE 'STU-02: %' ORDER BY name`,
    );
    const logo = (name: string) =>
      find(
        logos.map((row) => ({ ...row, title: row.name })),
        name,
      );
    expect(logo("STU-02: Logo for light and dark").logo).not.toBeNull();
    expect(logo("STU-02: Logo for light and dark").logo_dark).not.toBeNull();
    expect(logo("STU-02: Light logo only").logo).not.toBeNull();
    expect(logo("STU-02: Light logo only").logo_dark).toBeNull();
    expect(logo("STU-02: No logo").logo).toBeNull();

    // bob is bob as Dex's login makes him; only these events remind.
    const [bob] = await signedUp(
      url,
      teamsOfFile("MAIL-04")[0] ?? "",
      "AC-1 to AC-3: Cancelled",
    );
    expect(bob?.user_issuer).toBe(issuer);
    expect(bob?.user_subject).toBe(
      "CiQwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDISBWxvY2Fs",
    );
    const reminding = await query(
      url,
      (sql) =>
        sql<{ title: string }>`
        SELECT title FROM events WHERE send_reminders AND deleted_at IS NULL ORDER BY title`,
    );
    expect(reminding.map((row) => row.title)).toEqual([
      "AC-1 to AC-3: Reminded",
      "AC-4: Deleted",
      "AC-5 to AC-7: Standard, open to guests",
      "AC-6: On, members only",
    ]);
  });

  it("stores the text of a published event and of a titled draft (AC-3)", async () => {
    const url = database.url;
    const [published] = await query(
      url,
      (sql) =>
        sql<{ first: string }>`
        SELECT e.body->1->>'value' AS first
        FROM events e JOIN documents d ON d.id = e.id JOIN teams t ON t.id = d.team_id
        WHERE t.name = ${teamsOfFile("MAIL-01")[0] ?? ""} AND e.title = 'AC-1 to AC-4: Signed up'`,
    );
    expect(published?.first).toBe(
      "Test steps for MAIL-01 AC-1, AC-2, AC-3 and AC-4.",
    );

    const [titled] = await query(
      url,
      (sql) =>
        sql<{ id: DocumentId }>`
        SELECT d.id FROM documents d JOIN teams t ON t.id = d.team_id
        WHERE t.name = ${teamsOfFile("STU-05")[0] ?? ""} AND d.title = 'AC-1 to AC-5: Presence'`,
    );
    if (titled === undefined)
      throw new Error("No draft «AC-1 to AC-5: Presence»");
    const draft = await using(
      url,
      Effect.gen(function* () {
        const documents = yield* Documents;
        const snapshot = yield* Effect.orDie(documents.get(titled.id));
        return A.load<EventContent>(snapshot.draft);
      }),
    );
    const text = A.spans(draft, ["body"]).flatMap((span) =>
      span.type === "text" ? [span.value] : [],
    );
    expect(text[0]).toMatch(/^Test steps for STU-05 AC-1/);
  });

  it("writes the times the catalogue gives (AC-3)", async () => {
    const team = catalogue(started).find((each) =>
      each.name.startsWith("SIGN-11:"),
    );
    const spec = team?.events.find((each) => each.title === "AC-8: Ended");
    const stored = find(
      await published(database.url, team?.name ?? ""),
      "AC-8: Ended",
    );
    expect(stored.starts_at.getTime()).toBe(spec?.start?.epochMilliseconds);
    expect(stored.ends_at.getTime()).toBe(spec?.end?.epochMilliseconds);
  });

  it("names every event the Events sections name (AC-10)", async () => {
    const url = database.url;
    const missing: Array<string> = [];
    for (const feature of named) {
      const titles = new Set<string>();
      for (const team of feature.teams) {
        for (const row of await drafts(url, team)) titles.add(row.title);
      }
      for (const event of feature.events)
        if (!titles.has(event)) missing.push(`${feature.id}: ${event}`);
    }
    expect(named.flatMap((feature) => feature.events).length).toBeGreaterThan(
      100,
    );
    expect(missing).toEqual([]);
  });

  it("starts over when it runs again, leaving each team and event once (AC-6)", async () => {
    const url = database.url;
    const team = teamsOfFile("SIGN-01")[0] ?? "";
    await using(
      url,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const [row] = yield* Effect.orDie(
          sql<{ id: TeamId }>`SELECT id FROM teams WHERE name = ${team}`,
        );
        if (row === undefined) throw new Error(`No team «${team}»`);
        yield* handMadeEvent(row.id, "Hand-made");
      }),
    );
    expect((await drafts(url, team)).map((row) => row.title)).toContain(
      "Hand-made",
    );

    await using(url, fill(catalogue(started), people(issuer)));

    const teams = await teamNames(url);
    expect(new Set(teams).size).toBe(teams.length);
    expect((await drafts(url, team)).map((row) => row.title)).not.toContain(
      "Hand-made",
    );
    const duplicated: Array<string> = [];
    for (const spec of catalogue(started)) {
      const titles = (await drafts(url, spec.name)).map((row) => row.title);
      if (titles.length !== new Set(titles).size) duplicated.push(spec.name);
      expect(titles.length).toBe(spec.events.length);
    }
    expect(duplicated).toEqual([]);
  }, 120_000);

  it("removes every team, with all that was in it, when cleared (AC-7)", async () => {
    const url = database.url;
    const pictures = await query(
      url,
      (sql) =>
        sql<{ src: string }>`
        SELECT logo AS src FROM teams WHERE logo IS NOT NULL
        UNION SELECT cover->>'src' FROM events WHERE cover IS NOT NULL`,
    );
    expect(pictures.length).toBeGreaterThan(1);
    expect(await count(url, "tags")).toBeGreaterThan(0);
    await using(url, clear(catalogue(started)));
    expect(await teamNames(url)).toEqual([]);
    expect(await count(url, "tags")).toBe(0);
    const stored = await using(
      url,
      Effect.gen(function* () {
        const images = yield* Images.Images;
        return yield* Effect.forEach(pictures, ({ src }) =>
          images.get(src.split("/").pop() ?? ""),
        );
      }),
    );
    expect(stored.every((image) => image._tag === "None")).toBe(true);
    for (const table of [
      "documents",
      "events",
      "attendees",
      "dietary_preferences",
      "document_actors",
    ])
      expect(await count(url, table)).toBe(0);
  }, 120_000);

  it("never queues an email or a Slack post (AC-5)", async () => {
    const tables = await query(
      database.url,
      (sql) =>
        sql<{ n: number }>`
        SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_name LIKE 'cluster\\_%'`,
    );
    expect(tables[0]?.n).toBe(0);
  });
});

// ---- Small catalogues, in a second database -------------------------------

describe("fill and clear on small catalogues", () => {
  let database: { name: string; url: string };
  const sharedId = "019f0000-0000-7000-8000-00000000c0a1";

  const open = (title: string, now = nowOslo()) => ({
    title,
    public: true,
    guests: true,
    place: "Kantina",
    start: now.add({ days: 7 }),
    end: now.add({ days: 7, hours: 2 }),
  });
  const small = (now = nowOslo()): ReadonlyArray<TeamSpec> => [
    {
      name: "Small one",
      events: [open("AC-1: One", now), open("AC-2: Two", now)],
    },
    {
      name: "Capra Gruppen",
      sharedId,
      events: [open("EXT-04 AC-3: Organiser", now)],
    },
  ];

  beforeAll(async () => {
    database = await newDatabase();
  }, 60_000);

  afterAll(async () => {
    await dropDatabase(database.name);
  }, 60_000);

  it("refuses a guest where guests can't sign up, naming the team and the event (AC-4)", async () => {
    const now = nowOslo();
    const closed: ReadonlyArray<TeamSpec> = [
      {
        name: "Closed team",
        events: [
          {
            ...open("Closed event", now),
            guests: false,
            signups: [
              { who: "guest", name: "Gina", email: "gina@guests.example.org" },
            ],
          },
        ],
      },
    ];
    const failure = await using(
      database.url,
      Effect.flip(fill(closed, people(issuer))),
    );
    expect(failure).toMatchObject({
      team: "Closed team",
      event: "Closed event",
      reason: "GuestsNotAllowed",
    });
    await using(database.url, clear(closed));
  }, 60_000);

  it("refuses an event that ends before it starts, as publishing does (AC-4)", async () => {
    const now = nowOslo();
    const backwards: ReadonlyArray<TeamSpec> = [
      {
        name: "Backwards team",
        events: [
          {
            ...open("Backwards", now),
            end: now.add({ days: 7 }).subtract({ hours: 1 }),
          },
        ],
      },
    ];
    const failure = await using(
      database.url,
      Effect.flip(fill(backwards, people(issuer))),
    );
    expect(failure).toMatchObject({
      event: "Backwards",
      reason: "EndsBeforeStart",
    });
    await using(database.url, clear(backwards));
  }, 60_000);

  it("leaves a team and an event made by hand as they were, and adds to a hand-made Capra Gruppen (AC-8)", async () => {
    const url = database.url;
    await using(
      url,
      Effect.gen(function* () {
        yield* handMadeEvent((yield* handMadeTeam("Hand-made")).id, "Mine");
        yield* handMadeEvent(
          (yield* handMadeTeam("Capra Gruppen")).id,
          "Mine too",
        );
      }),
    );

    await using(url, fill(small(), people(issuer)));
    expect((await drafts(url, "Hand-made")).map((row) => row.title)).toEqual([
      "Mine",
    ]);
    expect(
      (await drafts(url, "Capra Gruppen")).map((row) => row.title),
    ).toEqual(["EXT-04 AC-3: Organiser", "Mine too"]);

    await using(url, clear(small()));
    expect((await drafts(url, "Hand-made")).map((row) => row.title)).toEqual([
      "Mine",
    ]);
    expect(
      (await drafts(url, "Capra Gruppen")).map((row) => row.title),
    ).toEqual(["Mine too"]);
    expect(await teamNames(url)).toEqual(["Capra Gruppen", "Hand-made"]);
  }, 60_000);

  it("keeps an empty Capra Gruppen made by hand (AC-8)", async () => {
    const url = database.url;
    await query(
      url,
      (sql) =>
        sql`DELETE FROM documents WHERE team_id IN (SELECT id FROM teams WHERE name = 'Capra Gruppen')`,
    );
    await using(url, fill(small(), people(issuer)));
    await using(url, clear(small()));
    expect(await teamNames(url)).toContain("Capra Gruppen");
    expect(await drafts(url, "Capra Gruppen")).toEqual([]);
  }, 60_000);

  it("removes the Capra Gruppen it made itself, once nothing else is in it (AC-7)", async () => {
    const url = database.url;
    await query(url, (sql) => sql`DELETE FROM documents`);
    await query(url, (sql) => sql`DELETE FROM teams`);
    await using(url, fill(small(), people(issuer)));
    expect(await teamNames(url)).toContain("Capra Gruppen");
    await using(url, clear(small()));
    expect(await teamNames(url)).not.toContain("Capra Gruppen");
  }, 60_000);
});

// ---- Images another team or event still shows -----------------------------

describe("clear and the images in use", () => {
  let database: { name: string; url: string };

  beforeAll(async () => {
    database = await newDatabase();
  }, 60_000);

  afterAll(async () => {
    await dropDatabase(database.name);
  }, 60_000);

  const open = (title: string, cover: Colour) => {
    const now = nowOslo();
    return {
      title,
      public: true,
      guests: true,
      place: "Kantina",
      start: now.add({ days: 7 }),
      end: now.add({ days: 7, hours: 2 }),
      cover,
    };
  };

  /** A draft made by hand that `edit` has written into. */
  const handMadeDraft = (
    team: TeamId,
    title: string,
    edit: (draft: EventContent) => void,
  ) =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* Effect.orDie(documents.create("event", team, alice));
      const snapshot = yield* Effect.orDie(documents.get(id));
      const edited = A.change(A.load<EventContent>(snapshot.draft), (doc) => {
        A.updateText(doc, ["title"], title);
        edit(doc);
      });
      const change = A.getLastLocalChange(edited);
      if (change === undefined) throw new Error("no change");
      yield* Effect.orDie(documents.applyChanges(id, [change], alice));
    });

  const imageBlock = (doc: EventContent, key: string, src: string): void => {
    (doc as unknown as Record<string, unknown>)[key] = "";
    A.splitBlock(doc, [key], 0, {
      type: new A.ImmutableString("image"),
      parents: [],
      attrs: {
        src: new A.ImmutableString(src),
        alt: new A.ImmutableString(""),
      },
    });
  };

  it("keeps images in every organiser email text (AC-1)", async () => {
    const url = database.url;
    const catalogueTeams: ReadonlyArray<TeamSpec> = [
      {
        name: "Catalogue team",
        logo: "red",
        events: [
          open("AC-1: Green", "green"),
          open("AC-2: Blue", "blue"),
          open("AC-3: Yellow", "yellow"),
          open("AC-4: Purple", "purple"),
          open("AC-5: Orange", "orange"),
          open("AC-6: Teal", "teal"),
          open("AC-7: Pink", "pink"),
          open("AC-8: Gray", "gray"),
        ],
      },
    ];
    const others: ReadonlyArray<TeamSpec> = [
      { name: "Kept team", events: [open("Published by hand", "teal")] },
    ];
    await using(url, fill(catalogueTeams, people(issuer)));
    await using(url, fill(others, people(issuer)));

    const cover = async (title: string) =>
      (
        await query(
          url,
          (sql) =>
            sql<{
              src: string;
            }>`SELECT cover->>'src' AS src FROM events WHERE title = ${title}`,
        )
      )[0]?.src ?? "";
    const [red, green, blue, yellow, purple, orange, teal, pink, gray] = [
      (
        await query(
          url,
          (sql) =>
            sql<{
              src: string;
            }>`SELECT logo AS src FROM teams WHERE name = 'Catalogue team'`,
        )
      )[0]?.src ?? "",
      await cover("AC-1: Green"),
      await cover("AC-2: Blue"),
      await cover("AC-3: Yellow"),
      await cover("AC-4: Purple"),
      await cover("AC-5: Orange"),
      await cover("AC-6: Teal"),
      await cover("AC-7: Pink"),
      await cover("AC-8: Gray"),
    ];

    // What the catalogue's images are shown by, outside the catalogue.
    await query(
      url,
      (sql) =>
        sql`UPDATE events SET cover = jsonb_build_object('src', ${green}::text, 'alt', '') WHERE title = 'Published by hand'`,
    );
    await using(
      url,
      Effect.gen(function* () {
        const team = yield* handMadeTeam("Hand-made");
        yield* handMadeDraft(team.id, "Draft cover", (doc) => {
          (doc as unknown as Record<string, unknown>).cover = {
            src: new A.ImmutableString(blue),
            alt: "",
          };
        });
        yield* handMadeDraft(team.id, "Draft body", (doc) =>
          imageBlock(doc, "body", yellow),
        );
        const emailImages = [purple, orange, teal, pink];
        for (const [index, { kind, text }] of organizerEmails.entries())
          yield* handMadeDraft(team.id, `Draft ${kind} text`, (doc) =>
            imageBlock(doc, text, emailImages[index] ?? ""),
          );
      }),
    );
    await query(
      url,
      (sql) => sql`UPDATE teams SET logo = ${red} WHERE name = 'Hand-made'`,
    );

    await using(url, clear(catalogueTeams));

    const served = await using(
      url,
      Effect.gen(function* () {
        const images = yield* Images.Images;
        return yield* Effect.forEach(
          [red, green, blue, yellow, purple, orange, teal, pink, gray],
          (src) => images.get(src.split("/").pop() ?? ""),
        );
      }),
    );
    expect(served.map((image) => image._tag)).toEqual([
      "Some", // a team's logo
      "Some", // a published event's cover
      "Some", // a draft's cover
      "Some", // an image in a draft's body
      "Some", // an image in a draft's signed-up email text
      "Some", // an image in a draft's signup-cancelled email text
      "Some", // an image in a draft's event-changed email text
      "Some", // an image in a draft's event-cancelled email text
      "None", // nothing shows it
    ]);
    expect(await teamNames(url)).toEqual(["Hand-made", "Kept team"]);
  }, 120_000);
});

// ---- The catalogue's times, at any hour -----------------------------------

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

// ---- The check on where it runs -------------------------------------------

describe("localDatabase", () => {
  it("refuses a database that is not on localhost or 127.0.0.1 (AC-9)", () => {
    for (const url of [
      "postgres://u:p@db.example.com:5432/skjera",
      "postgres://u:p@10.0.0.5/skjera",
      "postgres://u:p@[::1]:5433/skjera",
      "not a url",
      "",
      undefined,
    ])
      expect(() => localDatabase(url)).toThrow();
  });

  it("takes localhost and 127.0.0.1, on any port and database (AC-9)", () => {
    for (const url of [
      "postgres://skjera:skjera@localhost:5433/skjera",
      "postgres://a:b@127.0.0.1/other",
      "postgres://a:b@localhost:6543/skjera_test",
    ])
      expect(localDatabase(url)).toBe(url);
  });

  it("makes both commands refuse a database elsewhere, naming it, before connecting to anything (AC-9)", async () => {
    for (const command of ["fill", "clear"])
      await expect(
        run(command, { DATABASE_URL: "postgres://u:p@db.example.com:5432/x" }),
      ).rejects.toThrow(/db\.example\.com.*localhost/);
  });
});
