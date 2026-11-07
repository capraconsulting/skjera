import * as A from "@automerge/automerge";
import { assert, describe, it, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { Effect } from "effect";
import {
  discardedMessage,
  restoredMessage,
} from "../../src/events/DiscardChanges.ts";
import { Documents } from "../../src/events/Documents.ts";
import { historyOf } from "../../src/events/History.ts";
import { alice, newTeam, openEditor, TestLayer } from "../helpers.ts";

// The grouping, ordering and naming of the history, on changes made up for
// the purpose; then the history as the database gives it.

type Input = Parameters<typeof historyOf>[0];

const person = (subject: string, name: string | null = null) => ({
  issuer: "https://idp.example",
  subject,
  name,
});
const ann = person("ann", "Ann");
const bob = person("bob", "Bob");

const change = (
  hash: string,
  actor: string,
  time: number,
  deps: ReadonlyArray<string> = [],
  message: string | null = null,
) => ({ hash, actor, time, deps, message });

const publication = (
  heads: ReadonlyArray<string>,
  time: number,
  by: ReturnType<typeof person> | null,
) => ({ heads, at: new Date(time * 1000), by });

/** Ann created the document: her first change is by an actor nobody claimed. */
const base = (overrides: Partial<Input> = {}): Input => ({
  changes: [],
  owners: [
    { actor: "annA", person: ann },
    { actor: "bobA", person: bob },
  ],
  creator: ann,
  publications: [],
  ...overrides,
});

const summary = (entries: ReturnType<typeof historyOf>) =>
  entries.map((entry) => ({
    kind: entry.kind,
    by: entry.by,
    automatic: entry.automatic,
    at: entry.at.getTime() / 1000,
  }));

describe("historyOf", () => {
  it("lists the versions newest first, each with who and when (AC-1)", () => {
    const entries = historyOf(
      base({
        changes: [change("c1", "a0", 1000), change("c2", "bobA", 2000, ["c1"])],
        publications: [publication(["c2"], 3000, ann)],
      }),
    );
    assert.deepStrictEqual(summary(entries), [
      { kind: "published", by: "Ann", automatic: false, at: 3000 },
      { kind: "edited", by: "Bob", automatic: false, at: 2000 },
      { kind: "edited", by: "Ann", automatic: false, at: 1000 },
    ]);
    assert.deepStrictEqual(entries[0]?.heads, ["c2"]);
    assert.deepStrictEqual(entries[2]?.heads, ["c1"]);
  });

  it("names nobody for a person without a name, and marks Skjera's own changes automatic (AC-1)", () => {
    const stranger = person("stranger");
    const entries = historyOf(
      base({
        creator: stranger,
        owners: [{ actor: "strangerA", person: stranger }],
        changes: [
          change("c1", "a0", 1000),
          change("c2", "strangerA", 1100, ["c1"]),
          change("c3", "server", 2000, ["c2"]),
        ],
        publications: [publication(["c3"], 2000, null)],
      }),
    );
    assert.deepStrictEqual(summary(entries), [
      { kind: "published", by: null, automatic: true, at: 2000 },
      { kind: "edited", by: null, automatic: true, at: 2000 },
      { kind: "edited", by: null, automatic: false, at: 1100 },
    ]);
  });

  it("puts a change a publishing does not include after it when both are in one second (AC-1)", () => {
    const entries = historyOf(
      base({
        changes: [
          change("c1", "a0", 4000),
          change("c2", "annA", 4100, ["c1"]),
          change("c3", "annA", 5000, ["c2"]),
        ],
        publications: [publication(["c2"], 5000, ann)],
      }),
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.kind),
      ["edited", "published", "edited"],
    );
    assert.deepStrictEqual(entries[0]?.heads, ["c3"]);
    assert.deepStrictEqual(entries[1]?.heads, ["c2"]);
  });

  it("keeps a publishing newer than a change it includes that an editor stamped later (AC-1)", () => {
    const entries = historyOf(
      base({
        changes: [change("c1", "a0", 4000), change("c2", "annA", 9000, ["c1"])],
        publications: [publication(["c2"], 5000, ann)],
      }),
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.kind),
      ["published", "edited", "edited"],
    );
  });

  it("never dates a change before the change it follows (AC-1)", () => {
    const entries = historyOf(
      base({
        changes: [change("c1", "a0", 5000), change("c2", "bobA", 3000, ["c1"])],
      }),
    );
    assert.deepStrictEqual(summary(entries), [
      { kind: "edited", by: "Bob", automatic: false, at: 5000 },
      { kind: "edited", by: "Ann", automatic: false, at: 5000 },
    ]);
  });

  it("gives one entry for one person's changes close together, whose version is the draft after the last of them (AC-6)", () => {
    const entries = historyOf(
      base({
        changes: [
          change("c1", "a0", 1000),
          change("c2", "annA", 1100, ["c1"]),
          change("c3", "annA", 1500, ["c2"]),
        ],
      }),
    );
    assert.deepStrictEqual(summary(entries), [
      { kind: "edited", by: "Ann", automatic: false, at: 1500 },
    ]);
    assert.deepStrictEqual(entries[0]?.heads, ["c3"]);
  });

  it("gives the heads of both branches when concurrent changes make one entry (AC-6)", () => {
    const entries = historyOf(
      base({
        owners: [
          { actor: "annA", person: ann },
          { actor: "annB", person: ann },
        ],
        changes: [
          change("c1", "a0", 1000),
          change("c2", "annA", 1100, ["c1"]),
          change("c3", "annB", 1100, ["c1"]),
        ],
      }),
    );
    assert.lengthOf(entries, 1);
    assert.deepStrictEqual(entries[0]?.heads, ["c2", "c3"]);
  });

  it("separates changes more than ten minutes apart (AC-6)", () => {
    const apart = historyOf(
      base({
        changes: [
          change("c1", "a0", 1000),
          change("c2", "annA", 1000 + 11 * 60, ["c1"]),
        ],
      }),
    );
    assert.lengthOf(apart, 2);
    const together = historyOf(
      base({
        changes: [
          change("c1", "a0", 1000),
          change("c2", "annA", 1000 + 9 * 60, ["c1"]),
        ],
      }),
    );
    assert.lengthOf(together, 1);
  });

  it("separates changes with another person's change between them (AC-6)", () => {
    const entries = historyOf(
      base({
        changes: [
          change("c1", "a0", 1000),
          change("c2", "bobA", 1100, ["c1"]),
          change("c3", "annA", 1200, ["c2"]),
        ],
      }),
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.by),
      ["Ann", "Bob", "Ann"],
    );
  });

  it("separates changes with a publishing between them, and shows the publishing as an entry of its own (AC-6)", () => {
    const entries = historyOf(
      base({
        changes: [change("c1", "a0", 1000), change("c2", "annA", 1200, ["c1"])],
        publications: [publication(["c1"], 1200, bob)],
      }),
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.kind, entry.by]),
      [
        ["edited", "Ann"],
        ["published", "Bob"],
        ["edited", "Ann"],
      ],
    );
  });

  it("shows each publishing with its publisher and the version it published (AC-6)", () => {
    const entries = historyOf(
      base({
        changes: [change("c1", "a0", 1000), change("c2", "bobA", 2000, ["c1"])],
        publications: [
          publication(["c1"], 1500, ann),
          publication(["c2"], 2500, bob),
        ],
      }),
    );
    assert.deepStrictEqual(
      entries.map((entry) => [entry.kind, entry.by, entry.heads]),
      [
        ["published", "Bob", ["c2"]],
        ["edited", "Bob", ["c2"]],
        ["published", "Ann", ["c1"]],
        ["edited", "Ann", ["c1"]],
      ],
    );
  });

  it("shows a restoring and a discarding as entries of their own, which later changes do not join (AC-7)", () => {
    const entries = historyOf(
      base({
        changes: [
          change("c1", "a0", 1000),
          change("c2", "annA", 1100, ["c1"], restoredMessage),
          change("c3", "annA", 1200, ["c2"]),
          change("c4", "annA", 1300, ["c3"], discardedMessage),
        ],
      }),
    );
    assert.deepStrictEqual(
      entries.map((entry) => entry.kind),
      ["discarded", "edited", "restored", "edited"],
    );
  });

  it("gives the same history whatever order the changes come in (AC-1)", () => {
    const changes = [
      change("c1", "a0", 1000),
      change("c2", "bobA", 1000, ["c1"]),
      change("c3", "annA", 1000, ["c1"]),
      change("c4", "bobA", 1000, ["c2", "c3"]),
    ];
    const forwards = historyOf(base({ changes }));
    const backwards = historyOf(base({ changes: [...changes].reverse() }));
    assert.deepStrictEqual(backwards, forwards);
  });
});

const named = (subject: string, fields: { name?: string; email?: string }) =>
  new Identity({
    issuer: "https://idp.example",
    subject: `${subject}-${crypto.randomUUID()}`,
    ...fields,
  });

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Documents.history", (it) => {
  it.effect("uses the canonical name for history entries (AC-1, AC-2)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const maker = named("maker", { name: "Mia Maker" });
      const mailer = named("mailer", { email: "mailer@example.org" });
      const nameless = named("nameless", { name: "  " });
      const both = named("both", {
        name: "Bea Both",
        email: "bea@example.org",
      });
      const id = yield* documents.create("event", yield* newTeam, maker);
      const edit = (who: Identity, title: string) =>
        Effect.gen(function* () {
          const editor = yield* openEditor(id);
          yield* documents.applyChanges(
            id,
            [editor.edit((event) => A.updateText(event, ["title"], title))],
            who,
          );
        });
      yield* edit(maker, "One");
      yield* edit(mailer, "Two");
      yield* edit(nameless, "Three");
      yield* edit(both, "Four");

      const entries = yield* documents.history(id);
      assert.deepStrictEqual(
        entries.map((entry) => [entry.kind, entry.by, entry.automatic]),
        [
          ["edited", "Bea Both", false],
          ["edited", nameless.subject, false],
          ["edited", "mailer@example.org", false],
          ["edited", "Mia Maker", false],
        ],
      );
    }),
  );

  it.effect(
    "shows each publishing as an entry of its own, with its publisher and the heads it published (AC-6)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const first = named("first", { name: "First Publisher" });
        const second = named("second", { name: "Second Publisher" });
        const id = yield* documents.create("event", yield* newTeam, first);
        const publishAs = (who: Identity, title: string) =>
          Effect.gen(function* () {
            const editor = yield* openEditor(id);
            const heads = yield* documents.applyChanges(
              id,
              [
                editor.edit((event) => {
                  A.updateText(event, ["title"], title);
                  (event as { start: unknown }).start = new A.ImmutableString(
                    "2036-10-15T18:00+02:00[Europe/Oslo]",
                  );
                  (event as { end: unknown }).end = new A.ImmutableString(
                    "2036-10-15T21:00+02:00[Europe/Oslo]",
                  );
                  A.updateText(event, ["place"], "Kantina");
                }),
              ],
              who,
            );
            return (yield* documents.publish(id, heads, who)).heads;
          });
        const firstHeads = yield* publishAs(first, "Meetup");
        const secondHeads = yield* publishAs(second, "Meetup, later");

        const published = (yield* documents.history(id)).filter(
          (entry) => entry.kind === "published",
        );
        assert.deepStrictEqual(
          published.map((entry) => [entry.by, [...entry.heads]]),
          [
            ["Second Publisher", [...secondHeads]],
            ["First Publisher", [...firstHeads]],
          ],
        );
      }),
  );

  it.effect("fails for a document that does not exist (AC-1)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const error = yield* Effect.flip(
        documents.history("00000000-0000-7000-8000-000000000000" as never),
      );
      assert.strictEqual(error._tag, "DocumentNotFound");
    }),
  );

  it.effect(
    "names a person who only made a copy, from the identity they copied with (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const copier = named("copier", { name: "Cora Copier" });
        const source = yield* documents.create("event", yield* newTeam, alice);
        const id = crypto.randomUUID() as typeof source;
        yield* documents.copy(source, id, copier);
        const [newest] = yield* documents.history(id);
        assert.strictEqual(newest?.by, "Cora Copier");
      }),
  );
});
