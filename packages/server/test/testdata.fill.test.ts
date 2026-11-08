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
} from "@skjera/documents";
import {
  databaseName,
  databaseServerUrl,
  databaseUrl,
} from "@skjera/test/database";
import { Effect, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFeatures } from "../testdata/acceptance.ts";
import { catalogue } from "../testdata/catalogue.ts";
import { type Colour, clear, fill, type TeamSpec } from "../testdata/fill.ts";
import { layerOn, people, teamsAt } from "../testdata.ts";

const serverUrl = databaseServerUrl(process.env);
const issuer = process.env.OAUTH_ISSUER ?? "http://localhost:5556/dex";
const { alice } = people(issuer);

const acceptance = new URL("../../../docs/acceptance/", import.meta.url);
const named = [...readFeatures(acceptance).values()].filter(
  (feature) => feature.teams.length > 0,
);
const past = (n: number) => `AC-1 to AC-7: Past ${n}`;

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
