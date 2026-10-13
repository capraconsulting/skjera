import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Stream,
} from "effect";
import { SqlClient } from "effect/sql";
import { Announcements, AnnouncementsKept } from "../src/Announcements.ts";
import { Attendance } from "../src/Attendance.ts";
import type { EventContent } from "../src/ContentTypes.ts";
import { DocumentEvents } from "../src/DocumentEvents.ts";
import { Documents } from "../src/Documents.ts";
import type { Answers, Audience, DocumentId, TeamId } from "../src/Model.ts";
import { NoticesKept, Notifications } from "../src/Notifications.ts";
import { Presence } from "../src/Presence.ts";
import { Sync } from "../src/Sync.ts";
import { Teams } from "../src/Teams.ts";
import { TestDatabase } from "./TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });
const bob = new Identity({ issuer: "https://idp.example", subject: "bob" });
const dana = new Identity({ issuer: "https://idp.example", subject: "dana" });

const TestLayer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  Sync.layer,
  Teams.layer,
  Attendance.layer,
  Presence.layer,
).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

/** The published version of an event, as `audience` would pull it. */
const publishedAs = (id: DocumentId, audience: Audience) =>
  Effect.gen(function* () {
    const sync = yield* Sync;
    const pulled = yield* sync.events(undefined, audience);
    return pulled.rows.find((event) => event.id === id);
  });

/** A document's synced row. */
const syncedDocument = (id: DocumentId) =>
  Effect.gen(function* () {
    const sync = yield* Sync;
    const pulled = yield* sync.documents(undefined);
    return pulled.rows.find((document) => document.id === id);
  });

/** An event's signups as `viewer` would pull them, earliest first. */
const signups = (id: DocumentId, viewer: Option.Option<Identity>) =>
  Effect.gen(function* () {
    const sync = yield* Sync;
    const pulled = yield* sync.attendees(undefined, viewer);
    return pulled.rows
      .filter((row) => row.eventId === id)
      .sort((a, b) => a.signedUpAt.getTime() - b.signedUpAt.getTime());
  });

/** The details of an event's signups, as organizers see them. */
const organizerView = (id: DocumentId) =>
  Effect.map(signups(id, Option.some(alice)), (rows) =>
    rows.map((row) => row.details),
  );

/** Why a signup was refused, if it was. */
const problemOf = (error: { readonly _tag: string }) =>
  "problem" in error ? error.problem : undefined;

/** What people can't eat at an event, as its organizers read it. */
const dietaryList = (id: DocumentId) =>
  Effect.flatMap(Attendance, (attendance) => attendance.dietaryPreferences(id));

let teamCount = 0;
/** A team of its own for each test. */
const newTeam = Effect.gen(function* () {
  const teams = yield* Teams;
  teamCount += 1;
  return (yield* teams.create(`Team ${teamCount}`, alice)).id;
}).pipe(Effect.orDie);

// An evening in Oslo, far enough ahead that sign-up stays open.
const start = "2036-10-15T18:00+02:00[Europe/Oslo]";
const end = "2036-10-15T21:00+02:00[Europe/Oslo]";

/** Sets times the way the editor does: values replaced as a whole. */
const setTimes = (
  event: EventContent,
  times: {
    readonly start?: string | null;
    readonly end?: string | null;
    readonly deadline?: string | null;
    readonly foodDeadline?: string | null;
  } = { start, end },
) => {
  const draft = event as Record<string, unknown>;
  for (const [field, value] of Object.entries(times)) {
    draft[field] = value === null ? null : new A.ImmutableString(value);
  }
};

/** Writes the place the way the editor does: text, edited together. */
const setPlace = (event: EventContent, place = "Kantina") => {
  A.updateText(event, ["place"], place);
};

/** Sets the limit the way the editor does: a plain number, or none. */
const setLimit = (event: EventContent, limit: number | null) => {
  const draft = event as { maxAttendees?: number };
  if (limit === null) delete draft.maxAttendees;
  else draft.maxAttendees = limit;
};

/**
 * Sets streaming the way the editor does: a checkbox, and the link as text
 * that the draft may not have a key for yet.
 */
const setStreamed = (event: EventContent, streamed: boolean, link?: string) => {
  const draft = event as { streamed?: boolean; streamLink?: string };
  draft.streamed = streamed;
  if (link === undefined) return;
  if (draft.streamLink === undefined) draft.streamLink = "";
  A.updateText(event, ["streamLink"], link);
};

/**
 * Writes the summary the way the editor does: text under a key that older
 * drafts lack, created when missing.
 */
const setSummary = (event: EventContent, text: string) => {
  const draft = event as { summary?: string };
  if (draft.summary === undefined) draft.summary = "";
  A.updateText(event, ["summary"], text);
};

/** Creates and publishes an event, with the given visibility settings. */
const publishedEvent = Effect.fn(function* (settings: {
  readonly public: boolean;
  readonly guests: boolean;
  readonly dietary?: boolean;
  /** Anything else to set before publishing. */
  readonly edit?: (event: EventContent) => void;
}) {
  const documents = yield* Documents;
  const id = yield* documents.create("event", yield* newTeam, alice);
  const editor = yield* openEditor(id);
  const heads = yield* documents.applyChanges(
    id,
    [
      editor.edit((event) => {
        A.updateText(event, ["title"], "Meetup");
        setTimes(event);
        setPlace(event);
        (event as { public: boolean }).public = settings.public;
        (event as { guests: boolean }).guests = settings.guests;
        (event as { dietary: boolean }).dietary = settings.dietary ?? false;
        settings.edit?.(event);
      }),
    ],
    alice,
  );
  yield* documents.publish(id, heads, alice);
  return id;
});

/** Adds tags as the editor does. */
const addTags = (event: EventContent, ...tags: ReadonlyArray<string>) => {
  (event as unknown as { tags: Array<string> }).tags.push(...tags);
};

/** Sets the questions as the editor does: ids and types immutable. */
const setQuestions = (
  event: EventContent,
  questions: ReadonlyArray<{
    readonly id: string;
    readonly type: "text" | "checkbox" | "choice";
    readonly text: string;
    readonly required?: boolean;
    readonly options?: ReadonlyArray<{
      readonly id: string;
      readonly text: string;
    }>;
  }>,
) => {
  (event as { questions: unknown }).questions = questions.map((question) => ({
    id: new A.ImmutableString(question.id),
    type: new A.ImmutableString(question.type),
    text: question.text,
    required: question.required ?? false,
    options: (question.options ?? []).map((option) => ({
      id: new A.ImmutableString(option.id),
      text: option.text,
    })),
  }));
};

/** Sets the cover as the editor does: `src` immutable, `alt` text. */
const setCover = (event: EventContent, src: string | null) => {
  const draft = event as { cover?: unknown };
  if (src === null) delete draft.cover;
  else draft.cover = { src: new A.ImmutableString(src), alt: "" };
};

/** An editor session: a replica of the draft with its own actor id. */
const openEditor = Effect.fn(function* (
  id: Parameters<Documents["Service"]["get"]>[0],
) {
  const documents = yield* Documents;
  const snapshot = yield* documents.get(id);
  let doc = A.load<EventContent>(snapshot.draft);
  return {
    doc: () => doc,
    /** Makes a local change and returns it, as the editor would send it. */
    edit: (fn: (event: EventContent) => void) => {
      doc = A.change(doc, fn);
      const change = A.getLastLocalChange(doc);
      if (change === undefined) throw new Error("no change");
      return change;
    },
    receive: (changes: Uint8Array) => {
      doc = A.loadIncremental(doc, changes);
    },
  };
});

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Documents", (it) => {
  it.effect("creates a document with the id a client picked, once", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const team = yield* newTeam;
      const id = crypto.randomUUID() as DocumentId;
      assert.strictEqual(yield* documents.create("event", team, alice, id), id);
      // A retry is fine, and doesn't reset the draft.
      const editor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Kept"))],
        alice,
      );
      assert.strictEqual(yield* documents.create("event", team, alice, id), id);
      const draft = A.load<EventContent>((yield* documents.get(id)).draft);
      assert.strictEqual(draft.title, "Kept");
    }),
  );

  it.effect(
    "tells Announcements once when an event is first published (AC-1)",
    () =>
      Effect.gen(function* () {
        const kept = yield* AnnouncementsKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const told = (yield* Ref.get(kept)).filter((event) => event === id);
        assert.deepStrictEqual(told, [id]);
      }),
  );

  it.effect(
    "tells Announcements nothing when a published event is published again (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const kept = yield* AnnouncementsKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const editor = yield* openEditor(id);
        // A new title, then moved a day.
        const retitled = yield* documents.applyChanges(
          id,
          [editor.edit((event) => A.updateText(event, ["title"], "Meetup 2"))],
          alice,
        );
        yield* documents.publish(id, retitled, alice);
        const moved = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) =>
              setTimes(event, {
                start: "2036-10-16T18:00+02:00[Europe/Oslo]",
                end: "2036-10-16T21:00+02:00[Europe/Oslo]",
              }),
            ),
          ],
          alice,
        );
        yield* documents.publish(id, moved, alice);
        const told = (yield* Ref.get(kept)).filter((event) => event === id);
        assert.deepStrictEqual(told, [id]);
      }),
  );

  it.effect("creates an empty draft", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const snapshot = yield* documents.get(id);
      assert.strictEqual(snapshot.type, "event");
      assert.deepStrictEqual(A.toJS(A.load(snapshot.draft)), {
        title: "",
        summary: "",
        body: "",
        start: null,
        end: null,
        deadline: null,
        public: false,
        guests: false,
        dietary: false,
        food: "",
        foodDeadline: null,
        questions: [],
        tags: [],
        reminders: true,
        place: "",
      });
      assert.deepStrictEqual(
        snapshot.heads,
        A.getHeads(A.load(snapshot.draft)),
      );
    }),
  );

  it.effect("merges edits from two users and syncs them", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const aliceEditor = yield* openEditor(id);
      const bobEditor = yield* openEditor(id);

      yield* documents.applyChanges(
        id,
        [aliceEditor.edit((event) => A.updateText(event, ["title"], "Hello"))],
        alice,
      );
      const heads = yield* documents.applyChanges(
        id,
        [bobEditor.edit((event) => A.updateText(event, ["body"], "World"))],
        bob,
      );

      // Each editor fetches only what it is missing.
      const forAlice = yield* documents.changesSince(
        id,
        A.getHeads(aliceEditor.doc()),
      );
      aliceEditor.receive(forAlice.changes);
      bobEditor.receive(
        (yield* documents.changesSince(id, A.getHeads(bobEditor.doc())))
          .changes,
      );
      assert.deepStrictEqual([...forAlice.heads].sort(), [...heads].sort());
      for (const editor of [aliceEditor, bobEditor]) {
        assert.deepStrictEqual(A.toJS(editor.doc()), {
          title: "Hello",
          summary: "",
          body: "World",
          start: null,
          end: null,
          deadline: null,
          public: false,
          guests: false,
          dietary: false,
          food: "",
          foodDeadline: null,
          questions: [],
          tags: [],
          reminders: true,
          place: "",
        });
        assert.deepStrictEqual(
          [...A.getHeads(editor.doc())].sort(),
          [...heads].sort(),
        );
      }
    }),
  );

  it.effect("accepts re-sent changes as a no-op", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const change = editor.edit((event) =>
        A.updateText(event, ["title"], "Once"),
      );
      const first = yield* documents.applyChanges(id, [change], alice);
      const again = yield* documents.applyChanges(id, [change], alice);
      assert.deepStrictEqual(again, first);
    }),
  );

  it.effect("only accepts changes from the sender's own actor ids", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const aliceEditor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [aliceEditor.edit((event) => A.updateText(event, ["title"], "Mine"))],
        alice,
      );

      // Alice's actor id is hers now: Bob can't make changes under it.
      let forged = A.load<EventContent>(
        A.save(aliceEditor.doc()),
        A.getActorId(aliceEditor.doc()),
      );
      forged = A.change(forged, (event) =>
        A.updateText(event, ["title"], "Not yours"),
      );
      const change = A.getLastLocalChange(forged);
      if (change === undefined) throw new Error("no change");
      const sent = yield* Effect.flip(
        documents.applyChanges(id, [change], bob),
      );
      assert.strictEqual(sent._tag, "ActorNotAllowed");

      // Alice's next session has a new actor id, and can send too.
      const nextSession = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [nextSession.edit((event) => A.updateText(event, ["title"], "Still"))],
        alice,
      );
    }),
  );

  it.effect("rejects changes that don't fit the content type", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const before = (yield* documents.get(id)).heads;

      const extraField = yield* Effect.flip(
        documents.applyChanges(
          id,
          [editor.edit((event) => Object.assign(event, { secret: "x" }))],
          alice,
        ),
      );
      assert.strictEqual(extraField._tag, "InvalidContent");

      // The rejected change stays in that replica, so later changes build on
      // it; a rejected editor has to reload. Use a fresh one.
      const fresh = yield* openEditor(id);
      const wrongType = yield* Effect.flip(
        documents.applyChanges(
          id,
          [fresh.edit((event) => Object.assign(event, { title: 42 }))],
          alice,
        ),
      );
      assert.strictEqual(wrongType._tag, "InvalidContent");

      assert.deepStrictEqual((yield* documents.get(id)).heads, before);
    }),
  );

  it.effect("only accepts times that exist, in their time zone", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      for (const time of [
        "2036-10-15",
        "2036-10-15T18:00",
        "2036-10-15T18:00+02:00",
        "2036-02-30T18:00+01:00[Europe/Oslo]",
        // Oslo is +01:00 in winter.
        "2036-01-15T18:00+02:00[Europe/Oslo]",
        "2036-10-15T18:00+02:00[Europe/Atlantis]",
      ]) {
        const editor = yield* openEditor(id);
        const error = yield* Effect.flip(
          documents.applyChanges(
            id,
            [editor.edit((event) => setTimes(event, { start: time }))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", time);
      }
      const editor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              start: "2036-01-15T18:00:30+01:00[Europe/Oslo]",
              deadline: "2036-01-15T12:00-05:00[America/New_York]",
            }),
          ),
        ],
        alice,
      );
    }),
  );

  it.effect("rejects changes whose dependencies it hasn't seen", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      editor.edit((event) => A.updateText(event, ["title"], "First"));
      const second = editor.edit((event) =>
        A.updateText(event, ["title"], "Second"),
      );
      const error = yield* Effect.flip(
        documents.applyChanges(id, [second], alice),
      );
      assert.strictEqual(error._tag, "InvalidChanges");
    }),
  );

  it.effect("publishes the cover image, which has to be an uploaded one", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const src = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";

      const elsewhere = yield* openEditor(id);
      const error = yield* Effect.flip(
        documents.applyChanges(
          id,
          [
            elsewhere.edit((event) => {
              setCover(event, "https://example.com/x.png");
            }),
          ],
          alice,
        ),
      );
      assert.strictEqual(error._tag, "InvalidContent");

      const editor = yield* openEditor(id);
      const withCover = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            setTimes(event);
            setPlace(event);
            setCover(event, src);
          }),
          editor.edit((event) =>
            A.updateText(event, ["cover", "alt"], "A full room"),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, withCover, alice);
      const cover = sql<{ cover: unknown }>`
        SELECT cover FROM events WHERE id = ${id}
      `;
      assert.deepStrictEqual(yield* cover, [
        { cover: { src, alt: "A full room" } },
      ]);

      // Taken off again.
      const without = yield* documents.applyChanges(
        id,
        [editor.edit((event) => setCover(event, null))],
        alice,
      );
      yield* documents.publish(id, without, alice);
      assert.deepStrictEqual(yield* cover, [{ cover: null }]);
    }),
  );

  it.effect("publishes the version the user saw", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const seen = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Launch");
            // A heading, and a paragraph with a bold word.
            A.splitBlock(event, ["body"], 0, {
              type: new A.ImmutableString("heading"),
              parents: [],
              attrs: { level: 2 },
            });
            A.splice(event, ["body"], 1, 0, "News");
            A.splitBlock(event, ["body"], 5, {
              type: new A.ImmutableString("paragraph"),
              parents: [],
              attrs: {},
            });
            A.splice(event, ["body"], 6, 0, "We're live");
            A.mark(
              event,
              ["body"],
              { start: 12, end: 16, expand: "none" },
              "strong",
              true,
            );
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      // Someone keeps typing while Alice clicks publish.
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Launch day!"))],
        alice,
      );

      const first = yield* documents.publish(id, seen, alice);
      assert.deepStrictEqual(first.heads, seen);
      const [row] = yield* sql<{
        title: string;
        body: unknown;
        starts_at: Date;
        ends_at: Date;
        signup_deadline: Date | null;
        time_zone: string;
      }>`
        SELECT title, body, starts_at, ends_at, signup_deadline, time_zone
        FROM events WHERE id = ${id}
      `;
      // The body keeps its structure.
      assert.deepStrictEqual(row, {
        title: "Launch",
        body: [
          {
            type: "block",
            value: { type: "heading", attrs: { level: 2 }, parents: [] },
          },
          { type: "text", value: "News" },
          {
            type: "block",
            value: { type: "paragraph", attrs: {}, parents: [] },
          },
          { type: "text", value: "We're " },
          { type: "text", value: "live", marks: { strong: true } },
        ],
        starts_at: new Date("2036-10-15T16:00:00Z"),
        ends_at: new Date("2036-10-15T19:00:00Z"),
        signup_deadline: null,
        time_zone: "Europe/Oslo",
      });

      const latest = (yield* documents.get(id)).heads;
      const second = yield* documents.publish(id, latest, alice);
      assert.deepStrictEqual(second.firstPublishedAt, first.firstPublishedAt);
      assert.isTrue(second.publishedAt >= first.publishedAt);
      const [updated] = yield* sql<{ title: string }>`
        SELECT title FROM events WHERE id = ${id}
      `;
      assert.strictEqual(updated?.title, "Launch day!");
    }),
  );

  it.effect(
    "refuses to publish without a title, times or a place, or an unknown version (AC-2)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id);
        const blank = (yield* documents.get(id)).heads;
        const dated = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setTimes(event);
              setPlace(event);
            }),
          ],
          alice,
        );
        const empty = yield* Effect.flip(documents.publish(id, blank, alice));
        assert.strictEqual(
          empty.message,
          "Add a title, a start time, an end time and a place before publishing",
        );
        const untitled = yield* Effect.flip(
          documents.publish(id, dated, alice),
        );
        assert.strictEqual(untitled.message, "Add a title before publishing");

        // A place of nothing but spaces is no place.
        for (const place of ["", "  "]) {
          const placeless = yield* documents.applyChanges(
            id,
            [
              editor.edit((event) => {
                A.updateText(event, ["title"], "Endless");
                setPlace(event, place);
              }),
            ],
            alice,
          );
          const unplaced = yield* Effect.flip(
            documents.publish(id, placeless, alice),
          );
          assert.strictEqual(unplaced.message, "Add a place before publishing");
        }

        const titled = yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              setPlace(event);
              setTimes(event, { end: null });
            }),
          ],
          alice,
        );
        const undated = yield* Effect.flip(
          documents.publish(id, titled, alice),
        );
        assert.strictEqual(
          undated.message,
          "Add an end time before publishing",
        );

        // The times have to make sense together.
        for (const [times, message] of [
          [{ end: start }, "The event has to end after it starts"],
          [
            { end, deadline: "2036-10-15T18:01+02:00[Europe/Oslo]" },
            "The sign-up deadline can't be after the event starts",
          ],
          [
            { end: "2036-10-15T20:00+01:00[Europe/London]", deadline: null },
            "The times have to be in the same time zone",
          ],
        ] as const) {
          const heads = yield* documents.applyChanges(
            id,
            [editor.edit((event) => setTimes(event, times))],
            alice,
          );
          const refused = yield* Effect.flip(
            documents.publish(id, heads, alice),
          );
          assert.strictEqual(refused.message, message);
        }

        const unknown = yield* Effect.flip(
          documents.publish(id, ["00".repeat(32)], alice),
        );
        assert.strictEqual(unknown._tag, "PublishRejected");
      }),
  );

  it.effect("syncs what lists show, in step with the draft", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const team = yield* newTeam;
      const id = yield* documents.create("event", team, alice);
      const editor = yield* openEditor(id);
      const find = syncedDocument(id);
      // Nothing unpublished: the draft is the version published.
      const unpublished = Effect.gen(function* () {
        const draft = yield* find;
        const published = yield* publishedAs(id, "members");
        return draft?.draftHeads.join() !== published?.publishedHeads.join();
      });

      const draft = yield* find;
      assert.deepStrictEqual(
        [draft?.title, draft?.startsAt, draft?.timeZone],
        ["", null, null],
      );
      assert.deepStrictEqual(draft?.draftHeads, [...A.getHeads(editor.doc())]);
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.isTrue(yield* unpublished);

      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Listed");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      const publication = yield* documents.publish(id, heads, alice);
      const published = yield* find;
      assert.deepStrictEqual(
        [published?.title, published?.startsAt, published?.timeZone],
        ["Listed", new Date("2036-10-15T16:00:00Z"), "Europe/Oslo"],
      );
      assert.isFalse(yield* unpublished);
      assert.deepStrictEqual(
        (yield* publishedAs(id, "members"))?.publishedHeads,
        publication.heads,
      );

      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            A.updateText(event, ["title"], "Listed again"),
          ),
        ],
        alice,
      );
      assert.strictEqual((yield* find)?.title, "Listed again");
      assert.isTrue(yield* unpublished);
    }),
  );

  it.effect("shows the public only what was published", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Public");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );

      // A draft is invisible until it is published.
      assert.isUndefined(yield* publishedAs(id, "members"));

      yield* documents.publish(id, heads, alice);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            A.updateText(event, ["title"], "Secret draft"),
          ),
        ],
        alice,
      );

      // Edits after publishing stay private until republished.
      assert.strictEqual((yield* publishedAs(id, "members"))?.title, "Public");
    }),
  );

  it.effect("deletes a document and its published version", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            A.updateText(event, ["title"], "Short-lived");
            setTimes(event);
            setPlace(event);
          }),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      yield* documents.delete(id, alice);
      assert.strictEqual(
        (yield* Effect.flip(documents.get(id)))._tag,
        "DocumentNotFound",
      );
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.strictEqual(
        (yield* Effect.flip(documents.delete(id, alice)))._tag,
        "DocumentNotFound",
      );
    }),
  );

  it.effect("keeps events in their team", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const [red, blue] = [yield* newTeam, yield* newTeam];
      const redEvent = yield* documents.create("event", red, alice);
      const blueEvent = yield* documents.create("event", blue, alice);

      assert.strictEqual((yield* syncedDocument(redEvent))?.teamId, red);
      assert.strictEqual((yield* syncedDocument(blueEvent))?.teamId, blue);
      assert.strictEqual((yield* documents.get(redEvent)).teamId, red);
    }),
  );

  it.effect("creates events only in existing teams", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const error = yield* Effect.flip(
        documents.create(
          "event",
          "01a0f2ff-0000-7000-8000-000000000000" as TeamId,
          alice,
        ),
      );
      assert.strictEqual(error._tag, "TeamNotFound");
    }),
  );

  it.effect("creates a team with the id a client picked, once", () =>
    Effect.gen(function* () {
      const teams = yield* Teams;
      const id = crypto.randomUUID() as TeamId;
      const created = yield* teams.create("Picked", alice, id);
      assert.strictEqual(created.id, id);
      // A retry gets the same team rather than an error.
      const again = yield* teams.create("Picked", alice, id);
      assert.deepStrictEqual(
        [again.id, again.name],
        [created.id, created.name],
      );
    }),
  );

  it.effect("creates and deletes teams", () =>
    Effect.gen(function* () {
      const teams = yield* Teams;
      const documents = yield* Documents;
      const team = yield* teams.create("  Zebra crew  ", alice);
      assert.strictEqual(team.name, "Zebra crew");
      assert.strictEqual((yield* teams.get(team.id)).name, "Zebra crew");

      // Names are unique regardless of case, and can't be blank.
      const taken = yield* Effect.flip(teams.create("zebra CREW", bob));
      assert.strictEqual(taken._tag, "InvalidTeamName");
      const blank = yield* Effect.flip(teams.create("   ", bob));
      assert.strictEqual(blank._tag, "InvalidTeamName");

      // Renaming follows the same rules as creating.
      const other = yield* teams.create("Other crew", alice);
      const renamed = yield* teams.rename(team.id, "  Zebra squad ");
      assert.strictEqual(renamed.name, "Zebra squad");
      const clash = yield* Effect.flip(teams.rename(team.id, "OTHER crew"));
      assert.strictEqual(clash._tag, "InvalidTeamName");
      yield* teams.delete(other.id);

      // A team with events can't be deleted; an empty one can.
      const event = yield* documents.create("event", team.id, alice);
      assert.strictEqual((yield* teams.get(team.id)).documentCount, 1);
      const notEmpty = yield* Effect.flip(teams.delete(team.id));
      assert.strictEqual(notEmpty._tag, "TeamNotEmpty");
      // Deleted, it's kept, but doesn't count: the team goes, and it too.
      yield* documents.delete(event, alice);
      assert.strictEqual((yield* teams.get(team.id)).documentCount, 0);
      yield* teams.delete(team.id);
      const gone = yield* Effect.flip(teams.get(team.id));
      assert.strictEqual(gone._tag, "TeamNotFound");
    }),
  );

  it.effect("shows members-only events to signed-in users only", () =>
    Effect.gen(function* () {
      const membersOnly = yield* publishedEvent({
        public: false,
        guests: true,
      });
      const open = yield* publishedEvent({ public: true, guests: true });

      assert.isUndefined(yield* publishedAs(membersOnly, "anyone"));
      const seen = yield* publishedAs(membersOnly, "members");
      // Guests only ever apply to public events.
      assert.isFalse(seen?.isPublic);
      assert.isFalse(seen?.allowGuests);
      assert.isTrue((yield* publishedAs(open, "anyone"))?.allowGuests);
    }),
  );

  it.effect("lets members sign up and change their mind", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: false, guests: false });

      yield* attendance.attend(id, alice);
      yield* attendance.attend(id, alice);
      yield* attendance.attend(id, bob);
      const forAlice = yield* signups(id, Option.some(alice));
      assert.strictEqual(forAlice.length, 2);
      assert.deepStrictEqual(
        forAlice.map((row) => row.mine),
        [true, false],
      );

      yield* attendance.leave(id, alice);
      const after = yield* signups(id, Option.some(alice));
      assert.strictEqual(after.length, 1);
      assert.isFalse(after[0]?.mine);

      // Members-only events don't exist for anyone signed out.
      assert.deepStrictEqual(yield* signups(id, Option.none()), []);
    }),
  );

  it.effect("closes signing up and cancelling at the deadline", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, alice);
      const token = yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });

      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              deadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
            }),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      for (const refused of [
        attendance.attend(id, bob),
        attendance.leave(id, alice),
        attendance.attendAsGuest(id, { name: "Gus", email: "gus@example.org" }),
        attendance.leaveAsGuest(id, token),
      ] as ReadonlyArray<Effect.Effect<unknown, { readonly _tag: string }>>) {
        const error = yield* Effect.flip(refused);
        assert.deepStrictEqual(
          [error._tag, "message" in error ? error.message : undefined],
          ["SignupRejected", "Sign-up for this event has closed"],
        );
      }
      assert.strictEqual((yield* organizerView(id)).length, 2);
    }),
  );

  it.effect("gives guests a token that emails sent later can carry", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      const signup = crypto.randomUUID();
      const token = yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { id: signup },
      );
      // The same, made again from the signup alone; another's differs.
      assert.strictEqual(attendance.guestToken(signup), token);
      assert.notStrictEqual(attendance.guestToken(crypto.randomUUID()), token);
      yield* attendance.leaveAsGuest(id, attendance.guestToken(signup));
      assert.deepStrictEqual(yield* organizerView(id), []);
    }),
  );

  it.effect("publishes whether attendees are reminded: yes, unless not", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const reminds = (id: DocumentId) =>
        sql<{ send_reminders: boolean }>`
          SELECT send_reminders FROM events WHERE id = ${id}
        `.pipe(Effect.map(([row]) => row?.send_reminders));
      const fresh = yield* publishedEvent({ public: false, guests: false });
      assert.strictEqual(yield* reminds(fresh), true);
      const off = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => {
          (event as { reminders: boolean }).reminders = false;
        },
      });
      assert.strictEqual(yield* reminds(off), false);
      // Drafts from before there was a choice.
      const older = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => {
          delete (event as { reminders?: boolean }).reminders;
        },
      });
      assert.strictEqual(yield* reminds(older), true);
    }),
  );

  it.effect(
    "publishes the limit and whether places left are hidden, none and shown when unset (AC-1)",
    () =>
      Effect.gen(function* () {
        const limited = yield* publishedEvent({
          public: true,
          guests: false,
          edit: (event) => {
            setLimit(event, 30);
            (event as { hidePlacesLeft?: boolean }).hidePlacesLeft = true;
          },
        });
        const row = yield* publishedAs(limited, "anyone");
        assert.strictEqual(row?.maxAttendees, 30);
        assert.isTrue(row?.hidePlacesLeft);

        // A new event, or a draft from before, has neither.
        const unset = yield* publishedEvent({ public: true, guests: false });
        const bare = yield* publishedAs(unset, "anyone");
        assert.isNull(bare?.maxAttendees);
        assert.isFalse(bare?.hidePlacesLeft);
      }),
  );

  it.effect("takes a limit that is a whole number of at least one (AC-1)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const accepted = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [accepted.edit((event) => setLimit(event, 1))],
        alice,
      );
      for (const limit of [0, -1, 1.5]) {
        const editor = yield* openEditor(id);
        const error = yield* Effect.flip(
          documents.applyChanges(
            id,
            [editor.edit((event) => setLimit(event, limit))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", String(limit));
      }
      const removing = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [removing.edit((event) => setLimit(event, null))],
        alice,
      );
    }),
  );

  it.effect(
    "takes a repeat of 1 to 7 days, weeks, months or years, and refuses the rest (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const setRepeat =
          (every: number, unit: string) => (event: EventContent) => {
            const draft = event as Record<string, unknown>;
            draft.recurring = true;
            draft.repeatEvery = every;
            draft.repeatUnit = new A.ImmutableString(unit);
          };
        for (const [every, unit] of [
          [1, "day"],
          [7, "week"],
          [3, "month"],
          [2, "year"],
        ] as const) {
          const editor = yield* openEditor(id);
          yield* documents.applyChanges(
            id,
            [editor.edit(setRepeat(every, unit))],
            alice,
          );
        }
        for (const [every, unit] of [
          [0, "week"],
          [8, "week"],
          [1.5, "week"],
          [1, "fortnight"],
        ] as const) {
          const editor = yield* openEditor(id);
          const error = yield* Effect.flip(
            documents.applyChanges(
              id,
              [editor.edit(setRepeat(every, unit))],
              alice,
            ),
          );
          assert.strictEqual(error._tag, "InvalidContent", `${every} ${unit}`);
        }
      }),
  );

  it.effect("counts members and guests together against the limit (AC-2)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setLimit(event, 2),
      });
      yield* attendance.attend(id, alice);
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });

      const member = yield* Effect.flip(attendance.attend(id, bob));
      assert.strictEqual(member._tag, "SignupRejected");
      const guest = yield* Effect.flip(
        attendance.attendAsGuest(id, { name: "Gus", email: "gus@example.org" }),
      );
      assert.strictEqual(guest._tag, "SignupRejected");
      assert.strictEqual((yield* organizerView(id)).length, 2);
    }),
  );

  it.effect("refuses a signup to a full event, saying it is full (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setLimit(event, 1),
      });
      yield* attendance.attend(id, alice);

      for (const refused of [
        attendance.attend(id, bob),
        attendance.attendAsGuest(id, { name: "Gus", email: "gus@example.org" }),
      ] as ReadonlyArray<
        Effect.Effect<
          unknown,
          { readonly _tag: string; readonly problem?: unknown }
        >
      >) {
        const error = yield* Effect.flip(refused);
        assert.deepStrictEqual(
          [error._tag, error.problem, "message" in error && error.message],
          ["SignupRejected", { _tag: "EventFull" }, "This event is full"],
        );
      }
      assert.strictEqual((yield* organizerView(id)).length, 1);
    }),
  );

  it.effect(
    "gives the last place to one of two who sign up at once (AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => setLimit(event, 1),
        });

        // A held lock on attendees stops inserts, so both signups have read
        // the event before either inserts.
        const held = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const holder = yield* Effect.gen(function* () {
          yield* sql`LOCK TABLE attendees IN SHARE MODE`;
          yield* Deferred.succeed(held, undefined);
          yield* Deferred.await(release);
        }).pipe(sql.withTransaction, Effect.forkChild);
        yield* Deferred.await(held);

        const outcome = (who: Identity) =>
          attendance.attend(id, who).pipe(
            Effect.as("signed up"),
            Effect.catchTag("SignupRejected", (error) =>
              Effect.succeed(error.problem._tag),
            ),
            Effect.orDie,
          );
        const both = yield* Effect.all([outcome(alice), outcome(bob)], {
          concurrency: "unbounded",
        }).pipe(Effect.forkChild);

        // Wait until both are held up: one on the lock, one on the event.
        const waiting = sql<{ count: number }>`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `.pipe(Effect.map(([row]) => row?.count ?? 0));
        while ((yield* waiting) < 2) yield* Effect.sleep("50 millis");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holder);

        assert.deepStrictEqual((yield* Fiber.join(both)).sort(), [
          "EventFull",
          "signed up",
        ]);
        assert.strictEqual((yield* organizerView(id)).length, 1);
      }).pipe(Effect.timeout("10 seconds")),
  );

  it.effect(
    "lets those signed up to a full event sign up again, change and cancel (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
          edit: (event) => setLimit(event, 2),
        });
        yield* attendance.attend(id, alice, { dietary: "None" });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { dietary: "None" },
        );

        // Nothing changes, and nobody is refused.
        yield* attendance.attend(id, alice, { dietary: "None" });
        yield* attendance.change(id, { user: alice }, {});
        yield* attendance.change(id, { cancelToken: token }, {});
        assert.strictEqual((yield* organizerView(id)).length, 2);

        yield* attendance.leave(id, alice);
        yield* attendance.leaveAsGuest(id, token);
        assert.deepStrictEqual(yield* organizerView(id), []);
      }),
  );

  it.effect("accepts a signup for a place a cancel freed (AC-6)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => setLimit(event, 1),
      });
      yield* attendance.attend(id, alice);
      const refused = yield* Effect.flip(attendance.attend(id, bob));
      assert.strictEqual(refused._tag, "SignupRejected");

      yield* attendance.leave(id, alice);
      yield* attendance.attend(id, bob);
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => each?.name),
        ["bob"],
      );
    }),
  );

  it.effect(
    "publishes a limit below those signed up, and refuses until enough cancel (AC-9)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: false, guests: false });
        yield* attendance.attend(id, alice);
        yield* attendance.attend(id, bob);

        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setLimit(event, 1))],
          alice,
        );
        yield* documents.publish(id, heads, alice);
        assert.strictEqual(
          (yield* publishedAs(id, "members"))?.maxAttendees,
          1,
        );
        assert.strictEqual((yield* organizerView(id)).length, 2);

        const refused = () => Effect.flip(attendance.attend(id, dana));
        assert.strictEqual((yield* refused())._tag, "SignupRejected");
        yield* attendance.leave(id, bob);
        assert.strictEqual((yield* refused())._tag, "SignupRejected");
        yield* attendance.leave(id, alice);
        yield* attendance.attend(id, dana);
        assert.strictEqual((yield* organizerView(id)).length, 1);
      }),
  );

  it.effect("publishes whether the event is streamed and its link (AC-1)", () =>
    Effect.gen(function* () {
      const streamed = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) =>
          setStreamed(event, true, "https://stream.example/meetup"),
      });
      const row = yield* publishedAs(streamed, "anyone");
      assert.isTrue(row?.isStreamed);
      assert.strictEqual(row?.streamLink, "https://stream.example/meetup");

      // A draft from before streaming has neither.
      const older = yield* publishedEvent({ public: true, guests: false });
      const bare = yield* publishedAs(older, "anyone");
      assert.isFalse(bare?.isStreamed);
      assert.isNull(bare?.streamLink);
    }),
  );

  it.effect(
    "refuses a link that is not a web address, and takes none or a blank one (AC-1)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        for (const link of ["stream.example/meetup", "javascript:alert(1)"]) {
          const id = yield* documents.create("event", yield* newTeam, alice);
          const editor = yield* openEditor(id);
          const heads = yield* documents.applyChanges(
            id,
            [
              editor.edit((event) => {
                A.updateText(event, ["title"], "Meetup");
                setTimes(event);
                setPlace(event);
                setStreamed(event, true, link);
              }),
            ],
            alice,
          );
          const error = yield* Effect.flip(documents.publish(id, heads, alice));
          assert.deepStrictEqual(
            [error._tag, "problem" in error && error.problem],
            ["PublishRejected", { _tag: "StreamLinkNotWeb" }],
            link,
          );
        }

        for (const link of [undefined, "", " \t "]) {
          const id = yield* publishedEvent({
            public: true,
            guests: false,
            edit: (event) => setStreamed(event, true, link),
          });
          const row = yield* publishedAs(id, "anyone");
          assert.isTrue(row?.isStreamed, String(link));
          assert.isNull(row?.streamLink, String(link));
        }
      }),
  );

  it.effect("publishes the summary trimmed (AC-1)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) =>
          setSummary(event, "  Coffee and a talk about Effect. \n"),
      });
      const row = yield* publishedAs(id, "anyone");
      assert.strictEqual(row?.summary, "Coffee and a talk about Effect.");
    }),
  );

  it.effect(
    "publishes a blank summary, or none from an older draft, as none (AC-1)",
    () =>
      Effect.gen(function* () {
        for (const text of ["", " \t \n"]) {
          const id = yield* publishedEvent({
            public: true,
            guests: false,
            edit: (event) => setSummary(event, text),
          });
          const row = yield* publishedAs(id, "anyone");
          assert.isNull(row?.summary, JSON.stringify(text));
        }
        // A draft from before events had a summary has no key for it.
        const older = yield* publishedEvent({
          public: true,
          guests: false,
          edit: (event) => {
            delete (event as { summary?: string }).summary;
          },
        });
        assert.isNull((yield* publishedAs(older, "anyone"))?.summary);
      }),
  );

  it.effect("syncs an event without a summary with summary null (AC-2)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({ public: false, guests: false });
      const row = yield* publishedAs(id, "members");
      assert.isNull(row?.summary);
    }),
  );

  it.effect("publishes no link for an event that is not streamed (AC-1)", () =>
    Effect.gen(function* () {
      const id = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) =>
          setStreamed(event, false, "https://stream.example/meetup"),
      });
      const row = yield* publishedAs(id, "anyone");
      assert.isFalse(row?.isStreamed);
      assert.isNull(row?.streamLink);
    }),
  );

  it.effect(
    "refuses a signup to a streamed event without in person or online (AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => setStreamed(event, true),
        });
        for (const refused of [
          attendance.attend(id, alice),
          attendance.attendAsGuest(id, {
            name: "Gina",
            email: "gina@example.org",
          }),
        ] as ReadonlyArray<
          Effect.Effect<
            unknown,
            { readonly _tag: string; readonly problem?: unknown }
          >
        >) {
          const error = yield* Effect.flip(refused);
          assert.deepStrictEqual(
            [error._tag, error.problem],
            ["SignupRejected", { _tag: "AttendanceMissing" }],
          );
        }
        assert.deepStrictEqual(yield* organizerView(id), []);
      }),
  );

  it.effect("stores whether each signup is in person or online (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setStreamed(event, true),
      });
      yield* attendance.attend(id, alice, { online: true });
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { online: false },
      );
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.online),
        [true, false],
      );
    }),
  );

  it.effect("takes a signup to an event not streamed as in person (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, alice, { online: true });
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.online),
        [false, false],
      );
    }),
  );

  it.effect(
    "lets those signed up change between in person and online, and keeps the choice when left out (AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => setStreamed(event, true),
        });
        yield* attendance.attend(id, alice, { online: false });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        const online = () =>
          Effect.map(signups(id, Option.none()), (rows) =>
            rows.map((row) => row.online),
          );

        yield* attendance.change(id, { user: alice }, { online: true });
        yield* attendance.change(id, { cancelToken: token }, { online: true });
        assert.deepStrictEqual(yield* online(), [true, true]);

        yield* attendance.change(id, { user: alice }, { online: false });
        yield* attendance.change(id, { cancelToken: token }, { online: false });
        assert.deepStrictEqual(yield* online(), [false, false]);

        // Left out, the choice stays.
        yield* attendance.change(id, { user: alice }, { online: true });
        yield* attendance.change(id, { user: alice }, {});
        assert.deepStrictEqual(yield* online(), [true, false]);
      }),
  );

  it.effect("refuses a change to online after sign-up closes (AC-4)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => setStreamed(event, true),
      });
      yield* attendance.attend(id, alice, { online: false });

      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              deadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
            }),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      const error = yield* Effect.flip(
        attendance.change(id, { user: alice }, { online: true }),
      );
      assert.strictEqual(error._tag, "SignupRejected");
      assert.deepStrictEqual(
        (yield* signups(id, Option.some(alice))).map((row) => row.online),
        [false],
      );
    }),
  );

  it.effect(
    "counts only those in person against the limit of a streamed event (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: false });

        for (const refused of [
          attendance.attend(id, bob, { online: false }),
          attendance.attendAsGuest(
            id,
            { name: "Gus", email: "gus@example.org" },
            { online: false },
          ),
        ] as ReadonlyArray<
          Effect.Effect<
            unknown,
            { readonly _tag: string; readonly problem?: unknown }
          >
        >) {
          const error = yield* Effect.flip(refused);
          assert.deepStrictEqual(
            [error._tag, error.problem],
            ["SignupRejected", { _tag: "EventFull" }],
          );
        }

        // Online takes no place, so a full event takes it.
        yield* attendance.attend(id, bob, { online: true });
        assert.strictEqual((yield* organizerView(id)).length, 2);
      }),
  );

  it.effect(
    "takes someone in person when only those online fill the limit (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: true });
        yield* attendance.attend(id, bob, { online: true });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        assert.strictEqual((yield* organizerView(id)).length, 3);
      }),
  );

  it.effect(
    "refuses a change to in person when no place is left, until one is free (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: false });
        yield* attendance.attend(id, bob, { online: true });
        const online = () =>
          Effect.map(signups(id, Option.some(alice)), (rows) =>
            rows.map((row) => row.online),
          );

        const error = yield* Effect.flip(
          attendance.change(id, { user: bob }, { online: false }),
        );
        assert.deepStrictEqual(
          [error._tag, "problem" in error && error.problem],
          ["SignupRejected", { _tag: "EventFull" }],
        );
        assert.deepStrictEqual(yield* online(), [false, true]);

        yield* attendance.change(id, { user: alice }, { online: true });
        yield* attendance.change(id, { user: bob }, { online: false });
        assert.deepStrictEqual(yield* online(), [true, false]);
      }),
  );

  it.effect(
    "lets someone in person on a full streamed event stay, saying in person again (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const member = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(member, alice, { online: false });
        yield* attendance.change(member, { user: alice }, { online: false });
        assert.deepStrictEqual(
          (yield* signups(member, Option.some(alice))).map((row) => row.online),
          [false],
        );

        const guest = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        const token = yield* attendance.attendAsGuest(
          guest,
          { name: "Gina", email: "gina@example.org" },
          { online: false },
        );
        yield* attendance.change(
          guest,
          { cancelToken: token },
          { online: false },
        );
        assert.deepStrictEqual(
          (yield* signups(guest, Option.none())).map((row) => row.online),
          [false],
        );
      }),
  );

  it.effect(
    "counts everyone in person once the event is published as not streamed (AC-7)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => {
            setStreamed(event, true);
            setLimit(event, 1);
          },
        });
        yield* attendance.attend(id, alice, { online: true });

        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setStreamed(event, false))],
          alice,
        );
        yield* documents.publish(id, heads, alice);

        for (const online of [false, true]) {
          const error = yield* Effect.flip(
            attendance.attend(id, bob, { online }),
          );
          assert.deepStrictEqual(
            [error._tag, "problem" in error && error.problem],
            ["SignupRejected", { _tag: "EventFull" }],
            String(online),
          );
        }
      }),
  );

  it.effect(
    "counts a signup that says online as in person when not streamed (AC-7)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: false,
          guests: false,
          edit: (event) => setLimit(event, 2),
        });
        yield* attendance.attend(id, alice);
        yield* attendance.attend(id, bob);
        const error = yield* Effect.flip(
          attendance.attend(id, dana, { online: true }),
        );
        assert.deepStrictEqual(
          [error._tag, "problem" in error && error.problem],
          ["SignupRejected", { _tag: "EventFull" }],
        );
      }),
  );

  it.effect("takes a place in a draft from before events had one (AC-1)", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);
      yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            delete (event as { place?: string }).place;
          }),
        ],
        alice,
      );
      // Without a place, the draft takes other changes, and then a place.
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Older"))],
        alice,
      );
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) => {
            (event as { place?: string }).place = "";
          }),
          editor.edit((event) => setPlace(event, "Kantina, 2. etasje")),
        ],
        alice,
      );
      const draft = A.load<EventContent>((yield* documents.get(id)).draft);
      assert.strictEqual(draft.place, "Kantina, 2. etasje");
      assert.deepStrictEqual(
        [...A.getHeads(editor.doc())].sort(),
        [...heads].sort(),
      );
    }),
  );

  it.effect(
    "tells attendees when a republish gives the event another place (AC-5, AC-6)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const kept = yield* NoticesKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        const carol = new Identity({
          issuer: "https://idp.example",
          subject: "carol",
          email: "carol@example.com",
          name: "Carol",
        });
        yield* attendance.attend(id, carol);
        yield* attendance.attend(id, bob); // No email to tell.
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        const changes = Ref.get(kept).pipe(
          Effect.map((all) =>
            all
              .filter((notice) => notice.kind === "eventChanged")
              .filter((notice) => notice.event === id),
          ),
        );
        const editor = yield* openEditor(id);
        const republish = (edit: (event: EventContent) => void) =>
          documents
            .applyChanges(id, [editor.edit(edit)], alice)
            .pipe(
              Effect.flatMap((heads) => documents.publish(id, heads, alice)),
            );

        // Anything but its place: nobody is told.
        yield* republish((event) => A.updateText(event, ["title"], "Meetup!"));
        assert.deepStrictEqual(yield* changes, []);

        // Another place, at the same times: everyone with an email is, once
        // each, with the place it was.
        const moved = yield* republish((event) => setPlace(event, "Aula"));
        const told = yield* changes;
        assert.deepStrictEqual(
          told.map((notice) => notice.attendee.name).sort(),
          ["Carol", "Gina"],
        );
        for (const notice of told) {
          assert.strictEqual(
            notice.version,
            String(moved.publishedAt.getTime()),
          );
          assert.strictEqual(notice.previousPlace, "Kantina");
          assert.isUndefined(notice.previously);
        }

        // Both at once: one notice each, with both.
        const both = yield* republish((event) => {
          setPlace(event, "Torget");
          setTimes(event, {
            start: "2036-10-16T18:00+02:00[Europe/Oslo]",
            end: "2036-10-16T21:00+02:00[Europe/Oslo]",
          });
        });
        const latest = (yield* changes).filter(
          (notice) => notice.version === String(both.publishedAt.getTime()),
        );
        assert.deepStrictEqual(
          latest.map((notice) => notice.attendee.name).sort(),
          ["Carol", "Gina"],
        );
        for (const notice of latest) {
          assert.strictEqual(notice.previousPlace, "Aula");
          assert.deepStrictEqual(notice.previously, {
            startsAt: "2036-10-15T16:00:00.000Z",
            endsAt: "2036-10-15T19:00:00.000Z",
          });
        }
      }),
  );

  it.effect(
    "tells attendees of an event published before when it gets a place (AC-5)",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const kept = yield* NoticesKept;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        // As published before events had a place.
        yield* sql`UPDATE events SET place = NULL WHERE id = ${id}`;
        const editor = yield* openEditor(id);
        const heads = yield* documents.applyChanges(
          id,
          [editor.edit((event) => setPlace(event, "Aula"))],
          alice,
        );
        yield* documents.publish(id, heads, alice);
        const told = (yield* Ref.get(kept))
          .filter((notice) => notice.kind === "eventChanged")
          .filter((notice) => notice.event === id);
        assert.strictEqual(told.length, 1);
        assert.strictEqual(told[0]?.previousPlace, "");
        assert.isUndefined(told[0]?.previously);
      }),
  );

  it.effect("keeps a deleted event, telling attendees it's cancelled", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const sql = yield* SqlClient.SqlClient;
      const kept = yield* NoticesKept;
      const cancellations = (event: DocumentId) =>
        Ref.get(kept).pipe(
          Effect.map((all) =>
            all.filter(
              (notice) =>
                notice.kind === "eventCancelled" && notice.event === event,
            ),
          ),
        );
      const id = yield* publishedEvent({ public: true, guests: true });
      const carol = new Identity({
        issuer: "https://idp.example",
        subject: "carol",
        email: "carol@example.com",
        name: "Carol",
      });
      yield* attendance.attend(id, carol);
      yield* attendance.attend(id, bob); // No email to tell.
      const token = yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });

      yield* documents.delete(id, bob);
      assert.deepStrictEqual(
        (yield* cancellations(id)).map((notice) => notice.attendee.name).sort(),
        ["Carol", "Gina"],
      );
      // Kept, marked deleted, with who did it.
      const [row] = yield* sql<{
        deleted: boolean;
        deleted_by_subject: string;
        signups: number;
      }>`
        SELECT d.deleted_at IS NOT NULL AND e.deleted_at IS NOT NULL AS deleted,
          d.deleted_by_subject,
          (SELECT count(*)::int FROM attendees WHERE event_id = d.id) AS signups
        FROM documents d JOIN events e ON e.id = d.id WHERE d.id = ${id}
      `;
      assert.deepStrictEqual(row, {
        deleted: true,
        deleted_by_subject: "bob",
        signups: 3,
      });
      // Otherwise gone: from the studio, the site and signing up.
      assert.isUndefined(yield* syncedDocument(id));
      assert.isUndefined(yield* publishedAs(id, "members"));
      assert.deepStrictEqual(yield* organizerView(id), []);
      assert.strictEqual(
        (yield* Effect.flip(attendance.attend(id, alice)))._tag,
        "EventNotFound",
      );
      assert.strictEqual(
        (yield* Effect.flip(attendance.leaveAsGuest(id, token)))._tag,
        "SignupNotFound",
      );

      // An event that's over just goes.
      const past = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) =>
          setTimes(event, {
            start: "2020-10-15T18:00+02:00[Europe/Oslo]",
            end: "2020-10-15T21:00+02:00[Europe/Oslo]",
          }),
      });
      yield* sql`
        INSERT INTO attendees (event_id, name, email, cancel_token_hash)
        VALUES (${past}, 'Gina', 'gina@example.org', ${crypto.randomUUID()})
      `;
      yield* documents.delete(past, alice);
      assert.deepStrictEqual(yield* cancellations(past), []);
    }),
  );

  it.effect("tells attendees when a republish moves the event", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const kept = yield* NoticesKept;
      const id = yield* publishedEvent({ public: true, guests: true });
      const carol = new Identity({
        issuer: "https://idp.example",
        subject: "carol",
        email: "carol@example.com",
        name: "Carol",
      });
      yield* attendance.attend(id, carol);
      yield* attendance.attend(id, bob); // No email to tell.
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });
      const changes = Ref.get(kept).pipe(
        Effect.map((all) =>
          all
            .filter((notice) => notice.kind === "eventChanged")
            .filter((notice) => notice.event === id),
        ),
      );
      const editor = yield* openEditor(id);
      const republish = (edit: (event: EventContent) => void) =>
        documents
          .applyChanges(id, [editor.edit(edit)], alice)
          .pipe(Effect.flatMap((heads) => documents.publish(id, heads, alice)));

      // Anything but its time: nobody is told.
      yield* republish((event) => A.updateText(event, ["title"], "Meetup!"));
      assert.deepStrictEqual(yield* changes, []);

      // A day later: everyone with an email is, once each.
      const moved = yield* republish((event) =>
        setTimes(event, {
          start: "2036-10-16T18:00+02:00[Europe/Oslo]",
          end: "2036-10-16T21:00+02:00[Europe/Oslo]",
        }),
      );
      const told = yield* changes;
      assert.deepStrictEqual(
        told.map((notice) => notice.attendee.name).sort(),
        ["Carol", "Gina"],
      );
      for (const notice of told) {
        assert.strictEqual(notice.event, id);
        assert.strictEqual(notice.version, String(moved.publishedAt.getTime()));
        assert.deepStrictEqual(notice.previously, {
          startsAt: "2036-10-15T16:00:00.000Z",
          endsAt: "2036-10-15T19:00:00.000Z",
        });
      }
      assert.isTrue(
        told.some((notice) => notice.attendee.guest),
        "the guest's notice says so, for their link",
      );
    }),
  );

  it.effect("lets guests sign up where allowed, once per email", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const closed = yield* publishedEvent({ public: true, guests: false });
      const rejected = yield* Effect.flip(
        attendance.attendAsGuest(closed, {
          name: "Gina",
          email: "gina@example.org",
        }),
      );
      assert.strictEqual(rejected._tag, "SignupRejected");

      const id = yield* publishedEvent({ public: true, guests: true });
      const token = yield* attendance.attendAsGuest(id, {
        name: " Gina ",
        email: "gina@example.org",
      });
      const again = yield* Effect.flip(
        attendance.attendAsGuest(id, {
          name: "Gina again",
          email: "GINA@example.org",
        }),
      );
      assert.strictEqual(again._tag, "SignupRejected");
      yield* attendance.attend(id, bob);

      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.name, each?.guest]),
        [
          ["Gina", true],
          ["bob", false],
        ],
      );
      // Anyone else can count them, but not see who they are.
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.details),
        [null, null],
      );

      // Only the token given to the guest cancels their signup.
      const wrong = yield* Effect.flip(attendance.leaveAsGuest(id, "guess"));
      assert.strictEqual(wrong._tag, "SignupNotFound");
      const elsewhere = yield* Effect.flip(
        attendance.leaveAsGuest(closed, token),
      );
      assert.strictEqual(elsewhere._tag, "SignupNotFound");
      yield* attendance.leaveAsGuest(id, token);
      assert.strictEqual((yield* signups(id, Option.none())).length, 1);
    }),
  );

  it.effect("keeps a guest's phone number and company, trimmed (AC-2)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
        phone: " +47 900 00 000 ",
        company: " Acme ",
      });
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [["+47 900 00 000", "Acme"]],
      );
    }),
  );

  it.effect(
    "keeps nothing for a phone number and company left blank (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
          company: "  ",
        });
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => [
            each?.phone,
            each?.company,
          ]),
          [[null, null]],
        );
      }),
  );

  it.effect(
    "lets a guest change their phone number and company, and keeps them when left out (AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const token = yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
          phone: "111",
          company: "Acme",
        });
        const contact = () =>
          Effect.map(organizerView(id), (rows) =>
            rows.map((each) => [each?.phone, each?.company]),
          );

        yield* attendance.change(
          id,
          { cancelToken: token },
          { phone: " 222 ", company: "Initech" },
        );
        assert.deepStrictEqual(yield* contact(), [["222", "Initech"]]);

        yield* attendance.change(id, { cancelToken: token }, { phone: "" });
        assert.deepStrictEqual(yield* contact(), [[null, "Initech"]]);

        yield* attendance.change(id, { cancelToken: token }, {});
        assert.deepStrictEqual(yield* contact(), [[null, "Initech"]]);
      }),
  );

  it.effect("gives a member's signup no phone number or company (AC-5)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, bob);
      yield* attendance.change(
        id,
        { user: bob },
        { phone: "111", company: "Acme" },
      );
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [[null, null]],
      );
    }),
  );

  it.effect(
    "keeps dietary preferences for the event, trimmed, in the order of the text (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        assert.isTrue((yield* publishedAs(id, "anyone"))?.askDietary);

        yield* attendance.attend(id, alice, { dietary: " Vegan " });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "g@example.org" },
          { dietary: "Fish" },
        );
        assert.deepStrictEqual(yield* dietaryList(id), ["Fish", "Vegan"]);

        // Members-only events can ask too.
        const membersOnly = yield* publishedEvent({
          public: false,
          guests: false,
          dietary: true,
        });
        yield* attendance.attend(membersOnly, bob, { dietary: "Halal" });
        assert.deepStrictEqual(yield* dietaryList(membersOnly), ["Halal"]);
      }),
  );

  it.effect(
    "keeps a dietary preference once, and none from a refused signup (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        assert.deepStrictEqual(yield* dietaryList(id), ["Vegan"]);

        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "g@example.org" },
          { dietary: "Fish" },
        );
        const taken = yield* Effect.flip(
          attendance.attendAsGuest(
            id,
            { name: "Gina", email: "g@example.org" },
            { dietary: "Nuts" },
          ),
        );
        assert.deepStrictEqual(problemOf(taken), { _tag: "EmailTaken" });
        assert.deepStrictEqual(yield* dietaryList(id), ["Fish", "Vegan"]);
      }),
  );

  it.effect(
    "keeps nothing that says who gave a dietary preference or when (AC-2)",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const columns = yield* sql<{ column_name: string }>`
          SELECT column_name FROM information_schema.columns
          WHERE table_name = 'dietary_preferences'
          ORDER BY column_name
        `;
        assert.deepStrictEqual(
          columns.map((column) => column.column_name),
          ["event_id", "id", "text"],
        );
        const [id] = yield* sql<{ column_default: string }>`
          SELECT column_default FROM information_schema.columns
          WHERE table_name = 'dietary_preferences' AND column_name = 'id'
        `;
        assert.strictEqual(id?.column_default, "gen_random_uuid()");
      }),
  );

  it.effect(
    "refuses a dietary preference over 500 characters, and keeps nothing (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        const member = yield* Effect.flip(
          attendance.attend(id, alice, { dietary: "x".repeat(501) }),
        );
        assert.strictEqual(member._tag, "SignupRejected");
        assert.deepStrictEqual(problemOf(member), { _tag: "DietaryTooLong" });
        const guest = yield* Effect.flip(
          attendance.attendAsGuest(
            id,
            { name: "Gina", email: "g@example.org" },
            { dietary: "x".repeat(501) },
          ),
        );
        assert.deepStrictEqual(problemOf(guest), { _tag: "DietaryTooLong" });
        assert.deepStrictEqual(yield* organizerView(id), []);
        assert.deepStrictEqual(yield* dietaryList(id), []);

        yield* attendance.attend(id, alice, { dietary: "x".repeat(500) });
        assert.strictEqual((yield* dietaryList(id))[0]?.length, 500);
      }),
  );

  it.effect("signs up without a dietary preference (AC-3)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
      });
      yield* attendance.attend(id, alice);
      yield* attendance.attend(id, bob, { dietary: "" });
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "g@example.org" },
        { dietary: "   " },
      );
      assert.strictEqual((yield* organizerView(id)).length, 3);
      assert.deepStrictEqual(yield* dietaryList(id), []);
    }),
  );

  it.effect(
    "takes dietary preferences only while the event serves food (AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const plain = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attend(plain, alice, { dietary: "Vegan" });
        yield* attendance.attendAsGuest(
          plain,
          { name: "Gus", email: "gus@example.org" },
          { dietary: "Vegan" },
        );

        const late = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
          edit: (event) =>
            setTimes(event, {
              foodDeadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
            }),
        });
        const published = yield* publishedAs(late, "anyone");
        assert.strictEqual(
          published?.foodDeadline?.toISOString(),
          "2020-01-15T11:00:00.000Z",
        );
        // Still open to sign up; dietary preferences are no longer taken.
        yield* attendance.attend(late, alice);
        yield* attendance.attend(late, bob, { dietary: "Vegan" });

        assert.strictEqual((yield* organizerView(plain)).length, 2);
        assert.strictEqual((yield* organizerView(late)).length, 2);
        assert.deepStrictEqual(yield* dietaryList(plain), []);
        assert.deepStrictEqual(yield* dietaryList(late), []);
      }),
  );

  it.effect(
    "lists dietary preferences by the text, not the order given (AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        yield* attendance.attend(id, bob, { dietary: "fish" });
        yield* attendance.attend(id, dana, { dietary: "Apple" });
        assert.deepStrictEqual(yield* dietaryList(id), [
          "Apple",
          "fish",
          "Vegan",
        ]);
      }),
  );

  it.effect("gives no dietary preference with a signup's details (AC-5)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
      });
      yield* attendance.attend(id, alice, { dietary: "Vegan" });
      const details = yield* organizerView(id);
      assert.strictEqual(details.length, 1);
      assert.isFalse(
        details.some((each) => each !== null && "dietary" in each),
      );
    }),
  );

  it.effect(
    "leaves dietary preferences as they are when signups change, cancel or are removed (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          dietary: true,
        });
        yield* attendance.attend(id, alice, { dietary: "Vegan" });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "g@example.org" },
          { dietary: "Fish" },
        );
        yield* attendance.attend(id, bob, { dietary: "Nuts" });
        const all = ["Fish", "Nuts", "Vegan"];

        yield* attendance.change(id, { user: alice }, { dietary: "Halal" });
        assert.deepStrictEqual(yield* dietaryList(id), all);
        yield* attendance.change(id, { cancelToken: token }, {});
        assert.deepStrictEqual(yield* dietaryList(id), all);
        yield* attendance.leave(id, alice);
        assert.deepStrictEqual(yield* dietaryList(id), all);
        yield* attendance.leaveAsGuest(id, token);
        assert.deepStrictEqual(yield* dietaryList(id), all);

        const [remaining] = yield* signups(id, Option.some(alice));
        yield* attendance.remove(remaining?.id ?? "");
        assert.deepStrictEqual(yield* organizerView(id), []);
        assert.deepStrictEqual(yield* dietaryList(id), all);
      }),
  );

  it.effect(
    "refuses to publish half-made questions or a late food deadline",
    () =>
      Effect.gen(function* () {
        const documents = yield* Documents;
        const id = yield* documents.create("event", yield* newTeam, alice);
        const editor = yield* openEditor(id);
        const refusal = (edit: (event: EventContent) => void) =>
          Effect.gen(function* () {
            const heads = yield* documents.applyChanges(
              id,
              [editor.edit(edit)],
              alice,
            );
            const error = yield* Effect.flip(
              documents.publish(id, heads, alice),
            );
            return error.message;
          });
        yield* documents.applyChanges(
          id,
          [
            editor.edit((event) => {
              A.updateText(event, ["title"], "Questions");
              setTimes(event);
              setPlace(event);
            }),
          ],
          alice,
        );
        const option = () => ({ id: crypto.randomUUID(), text: "Yes" });
        const question = {
          id: crypto.randomUUID(),
          type: "choice",
          text: "Coming by bike?",
        } as const;

        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [{ ...question, type: "text", text: " " }]),
          ),
          "Every question needs its text",
        );
        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [{ ...question, options: [option()] }]),
          ),
          "Choice questions need at least two options, all filled in",
        );
        assert.strictEqual(
          yield* refusal((event) =>
            setQuestions(event, [
              { ...question, options: [option(), { ...option(), text: "" }] },
            ]),
          ),
          "Choice questions need at least two options, all filled in",
        );
        assert.strictEqual(
          yield* refusal((event) => {
            setQuestions(event, []);
            setTimes(event, {
              deadline: "2036-10-14T12:00+02:00[Europe/Oslo]",
              foodDeadline: "2036-10-14T12:01+02:00[Europe/Oslo]",
            });
          }),
          "The food deadline can't be after sign-up closes",
        );
      }),
  );

  it.effect("asks the event's questions, and keeps the answers as given", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const [where, swim, size, friend] = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      const [small, large] = [crypto.randomUUID(), crypto.randomUUID()];
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) =>
          setQuestions(event, [
            { id: where, type: "text", text: "Where did you hear of it?" },
            {
              id: swim,
              type: "checkbox",
              text: "I accept the risks of swimming",
              required: true,
            },
            {
              id: size,
              type: "choice",
              text: "Towel size",
              required: true,
              options: [
                { id: small, text: "Small" },
                { id: large, text: "Large" },
              ],
            },
            { id: friend, type: "checkbox", text: "I bring a friend" },
          ]),
      });
      assert.deepStrictEqual(
        (yield* publishedAs(id, "anyone"))?.questions.map((q) => q.text),
        [
          "Where did you hear of it?",
          "I accept the risks of swimming",
          "Towel size",
          "I bring a friend",
        ],
      );

      const refused = (answers: Answers) =>
        Effect.flip(attendance.attend(id, alice, { answers })).pipe(
          Effect.map((error) => error.message),
        );
      assert.strictEqual(
        yield* refused({ [size]: small }),
        "Tick “I accept the risks of swimming” to sign up",
      );
      assert.strictEqual(
        yield* refused({ [swim]: true }),
        "Answer “Towel size”",
      );
      assert.strictEqual(
        yield* refused({ [swim]: true, [size]: "medium" }),
        "Pick one of the answers to “Towel size”",
      );
      assert.strictEqual(
        yield* refused({
          [swim]: true,
          [size]: small,
          [where]: "x".repeat(1001),
        }),
        "Keep your answer to “Where did you hear of it?” shorter",
      );

      yield* attendance.attend(id, alice, {
        answers: {
          [swim]: true,
          [size]: large,
          [where]: " A poster ",
          other: "x",
        },
      });
      yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { answers: { [swim]: true, [size]: small, [friend]: true } },
      );
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => each?.answers),
        [
          [
            {
              id: where,
              question: "Where did you hear of it?",
              answer: "A poster",
              value: "A poster",
            },
            {
              id: swim,
              question: "I accept the risks of swimming",
              answer: "Yes",
              value: true,
            },
            { id: size, question: "Towel size", answer: "Large", value: large },
            {
              id: friend,
              question: "I bring a friend",
              answer: "No",
              value: false,
            },
          ],
          [
            {
              id: swim,
              question: "I accept the risks of swimming",
              answer: "Yes",
              value: true,
            },
            { id: size, question: "Towel size", answer: "Small", value: small },
            {
              id: friend,
              question: "I bring a friend",
              answer: "Yes",
              value: true,
            },
          ],
        ],
      );
    }),
  );

  it.effect("publishes tags once each, and collects them to suggest", () =>
    Effect.gen(function* () {
      const sync = yield* Sync;
      const name = `Tag ${crypto.randomUUID().slice(0, 8)}`;
      const id = yield* publishedEvent({
        public: true,
        guests: false,
        edit: (event) => {
          // As two people adding the same tag at once leave it.
          addTags(event, name, "Workshop", name.toUpperCase(), name);
        },
      });
      assert.deepStrictEqual((yield* publishedAs(id, "anyone"))?.tags, [
        name,
        "Workshop",
      ]);

      // Published again, or by another event in other letters: still once.
      yield* publishedEvent({
        public: false,
        guests: false,
        edit: (event) => addTags(event, name.toLowerCase()),
      });
      const suggested = (yield* sync.tags(undefined)).rows
        .map((row) => row.name)
        .filter((tag) => tag.toLowerCase() === name.toLowerCase());
      assert.deepStrictEqual(suggested, [name]);

      // Tags are trimmed, and short.
      const documents = yield* Documents;
      const draft = yield* documents.create("event", yield* newTeam, alice);
      for (const tag of [" Padded", "", "x".repeat(41)]) {
        const editor = yield* openEditor(draft);
        const error = yield* Effect.flip(
          documents.applyChanges(
            draft,
            [editor.edit((event) => addTags(event, tag))],
            alice,
          ),
        );
        assert.strictEqual(error._tag, "InvalidContent", tag);
      }
    }),
  );

  it.effect("lets people change their answers until sign-up closes", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const size = crypto.randomUUID();
      const [small, large] = [crypto.randomUUID(), crypto.randomUUID()];
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        dietary: true,
        edit: (event) =>
          setQuestions(event, [
            {
              id: size,
              type: "choice",
              text: "Towel size",
              required: true,
              options: [
                { id: small, text: "Small" },
                { id: large, text: "Large" },
              ],
            },
          ]),
      });
      yield* attendance.attend(id, alice, { answers: { [size]: small } });
      const token = yield* attendance.attendAsGuest(
        id,
        { name: "Gina", email: "gina@example.org" },
        { answers: { [size]: small } },
      );
      const view = Effect.map(organizerView(id), (rows) =>
        rows.map((each) => each?.answers[0]?.answer),
      );

      yield* attendance.change(
        id,
        { user: alice },
        { answers: { [size]: large } },
      );
      yield* attendance.change(
        id,
        { cancelToken: token },
        { answers: { [size]: large } },
      );
      assert.deepStrictEqual(yield* view, ["Large", "Large"]);

      // Changes are checked like signups, and need a signup to change.
      const invalid = yield* Effect.flip(
        attendance.change(id, { user: alice }, { answers: {} }),
      );
      assert.strictEqual(invalid.message, "Answer “Towel size”");
      const nobody = yield* Effect.flip(
        attendance.change(id, { user: bob }, { answers: { [size]: small } }),
      );
      assert.strictEqual(nobody._tag, "SignupNotFound");
      const wrongToken = yield* Effect.flip(
        attendance.change(
          id,
          { cancelToken: "guess" },
          { answers: { [size]: small } },
        ),
      );
      assert.strictEqual(wrongToken._tag, "SignupNotFound");

      const editor = yield* openEditor(id);

      // Not after sign-up closes.
      const closing = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              deadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
            }),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, closing, alice);
      const closed = yield* Effect.flip(
        attendance.change(id, { user: alice }, { answers: { [size]: large } }),
      );
      assert.strictEqual(closed.message, "Sign-up for this event has closed");
    }),
  );

  it.effect("lets organizers take people off, whenever", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, alice);
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
      });
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            setTimes(event, {
              deadline: "2020-01-15T12:00+01:00[Europe/Oslo]",
            }),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);

      const [first] = yield* signups(id, Option.some(alice));
      assert.isDefined(first);
      yield* attendance.remove(first?.id ?? "");
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => each?.name),
        ["Gina"],
      );
      const again = yield* Effect.flip(attendance.remove(first?.id ?? ""));
      assert.strictEqual(again._tag, "SignupNotFound");
    }),
  );

  it.effect("ends subscriptions with just an interrupt", () =>
    Effect.gen(function* () {
      const events = yield* DocumentEvents;
      const fiber = yield* Stream.unwrap(events.subscribe).pipe(
        Stream.runDrain,
        Effect.forkChild,
      );
      yield* Effect.sleep("50 millis");
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        assert.deepStrictEqual(
          exit.cause.reasons.map((reason) => reason._tag),
          ["Interrupt"],
        );
      }
    }),
  );

  it.effect("announces committed changes with their heads", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const events = yield* DocumentEvents;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const next = yield* (yield* events.subscribe).pipe(
        Stream.filter(
          (event) =>
            event._tag === "DocumentChanged" &&
            event.id === id &&
            event.op === "UPDATE",
        ),
        Stream.runHead,
        Effect.forkChild,
      );
      const heads = yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Ping"))],
        alice,
      );
      const event = yield* Fiber.join(next);
      assert.isTrue(event._tag === "Some");
      if (event._tag === "Some" && event.value._tag === "DocumentChanged") {
        assert.deepStrictEqual(event.value.heads, heads);
      }
    }).pipe(Effect.scoped, Effect.timeout("5 seconds")),
  );

  it.effect("reconnects the listener and asks subscribers to catch up", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const events = yield* DocumentEvents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* documents.create("event", yield* newTeam, alice);
      const editor = yield* openEditor(id);

      const received = yield* (yield* events.subscribe).pipe(
        Stream.filter(
          (event) =>
            event._tag === "ListenerReconnected" ||
            (event.id === id && event.op === "UPDATE"),
        ),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild,
      );

      // Drop the listening connection, as a network failure would.
      yield* sql`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = current_database() AND query LIKE 'LISTEN%'
      `;
      yield* Effect.sleep("1500 millis");
      yield* documents.applyChanges(
        id,
        [editor.edit((event) => A.updateText(event, ["title"], "Still here"))],
        alice,
      );

      const tags = (yield* Fiber.join(received)).map((event) => event._tag);
      assert.deepStrictEqual(tags, ["ListenerReconnected", "DocumentChanged"]);
    }).pipe(Effect.scoped, Effect.timeout("10 seconds")),
  );

  it.effect(
    "sets, replaces and removes a team's logos on their own (AC-1)",
    () =>
      Effect.gen(function* () {
        const teams = yield* Teams;
        const id = yield* newTeam;
        const light = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
        const dark = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";
        const darker = "/api/images/CCCCCCCCCCCCCCCCCCCCCC";
        const logos = (team: {
          logo: string | null;
          logoDark: string | null;
        }) => [team.logo, team.logoDark];

        assert.deepStrictEqual(logos(yield* teams.get(id)), [null, null]);

        // The light logo alone.
        assert.deepStrictEqual(
          logos(yield* teams.setLogos(id, { logo: light })),
          [light, null],
        );
        // The dark logo replaced, the light one left as it is.
        yield* teams.setLogos(id, { logoDark: dark });
        assert.deepStrictEqual(
          logos(yield* teams.setLogos(id, { logoDark: darker })),
          [light, darker],
        );
        // Removed one by one.
        assert.deepStrictEqual(
          logos(yield* teams.setLogos(id, { logo: null })),
          [null, darker],
        );
        assert.deepStrictEqual(
          logos(yield* teams.setLogos(id, { logoDark: null })),
          [null, null],
        );
        assert.deepStrictEqual(logos(yield* teams.get(id)), [null, null]);

        const missing = yield* Effect.flip(
          teams.setLogos(crypto.randomUUID() as TeamId, { logo: light }),
        );
        assert.strictEqual(missing._tag, "TeamNotFound");
      }),
  );
});
