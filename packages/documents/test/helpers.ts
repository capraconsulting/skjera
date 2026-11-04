import * as A from "@automerge/automerge";
import { Identity } from "@skjera/oauth/api";
import { Deferred, Effect, Fiber, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../src/attendance/Attendance.ts";
import type { EventContent } from "../src/events/ContentTypes.ts";
import { DocumentEvents } from "../src/events/DocumentEvents.ts";
import { Documents } from "../src/events/Documents.ts";
import { Presence } from "../src/events/Presence.ts";
import type { Audience, DocumentId } from "../src/Model.ts";
import { Announcements } from "../src/notices/Announcements.ts";
import { Notifications } from "../src/notices/Notifications.ts";
import { Sync } from "../src/server/Sync.ts";
import { Teams } from "../src/Teams.ts";
import { TestDatabase } from "./TestDatabase.ts";

export const alice = new Identity({
  issuer: "https://idp.example",
  subject: "alice",
});
export const bob = new Identity({
  issuer: "https://idp.example",
  subject: "bob",
});
export const dana = new Identity({
  issuer: "https://idp.example",
  subject: "dana",
});

export const TestLayer = Layer.mergeAll(
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
export const publishedAs = (id: DocumentId, audience: Audience) =>
  Effect.gen(function* () {
    const sync = yield* Sync;
    const pulled = yield* sync.events(undefined, audience);
    return pulled.rows.find((event) => event.id === id);
  });

/** A document's synced row. */
export const syncedDocument = (id: DocumentId) =>
  Effect.gen(function* () {
    const sync = yield* Sync;
    const pulled = yield* sync.documents(undefined);
    return pulled.rows.find((document) => document.id === id);
  });

/** An event's signups as `viewer` would pull them, earliest first. */
export const signups = (id: DocumentId, viewer: Option.Option<Identity>) =>
  Effect.gen(function* () {
    const sync = yield* Sync;
    const pulled = yield* sync.attendees(undefined, viewer);
    return pulled.rows
      .filter((row) => row.eventId === id)
      .sort((a, b) => a.signedUpAt.getTime() - b.signedUpAt.getTime());
  });

/** The details of an event's signups, as organizers see them. */
export const organizerView = (id: DocumentId) =>
  Effect.map(signups(id, Option.some(alice)), (rows) =>
    rows.map((row) => row.details),
  );

/** Why a signup was refused, if it was. */
export const problemOf = (error: { readonly _tag: string }) =>
  "problem" in error ? error.problem : undefined;

/** What people can't eat at an event, as its organizers read it. */
export const dietaryList = (id: DocumentId) =>
  Effect.flatMap(Attendance, (attendance) => attendance.dietaryPreferences(id));

let teamCount = 0;
/** A team of its own for each test. */
export const newTeam = Effect.gen(function* () {
  const teams = yield* Teams;
  teamCount += 1;
  return (yield* teams.create(`Team ${teamCount}`, alice)).id;
}).pipe(Effect.orDie);

// An evening in Oslo, far enough ahead that sign-up stays open.
export const start = "2036-10-15T18:00+02:00[Europe/Oslo]";
export const end = "2036-10-15T21:00+02:00[Europe/Oslo]";

/** Sets times the way the editor does: values replaced as a whole. */
export const setTimes = (
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
export const setPlace = (event: EventContent, place = "Kantina") => {
  A.updateText(event, ["place"], place);
};

/** Sets the limit the way the editor does: a plain number, or none. */
export const setLimit = (event: EventContent, limit: number | null) => {
  const draft = event as { maxAttendees?: number };
  if (limit === null) delete draft.maxAttendees;
  else draft.maxAttendees = limit;
};

/**
 * Sets streaming the way the editor does: a checkbox, and the link as text
 * that the draft may not have a key for yet.
 */
export const setStreamed = (
  event: EventContent,
  streamed: boolean,
  link?: string,
) => {
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
export const setSummary = (event: EventContent, text: string) => {
  const draft = event as { summary?: string };
  if (draft.summary === undefined) draft.summary = "";
  A.updateText(event, ["summary"], text);
};

/**
 * Writes one of an email's own subjects or texts the way the studio does:
 * text under a key that older drafts lack, created when missing.
 */
export const setEmailField = (
  event: EventContent,
  key: string,
  text: string,
) => {
  const draft = event as Record<string, unknown>;
  if (draft[key] === undefined) draft[key] = "";
  A.updateText(event, [key], text);
};

/**
 * Writes an email's text as rich text: a heading, a list item and a
 * paragraph with a bold word.
 */
export const setEmailRichText = (event: EventContent, key: string) => {
  const draft = event as Record<string, unknown>;
  if (draft[key] === undefined) draft[key] = "";
  A.splitBlock(event, [key], 0, {
    type: new A.ImmutableString("heading"),
    parents: [],
    attrs: { level: 2 },
  });
  A.splice(event, [key], 1, 0, "News");
  A.splitBlock(event, [key], 5, {
    type: new A.ImmutableString("unordered-list-item"),
    parents: [],
    attrs: {},
  });
  A.splice(event, [key], 6, 0, "Bring a friend");
  A.splitBlock(event, [key], 20, {
    type: new A.ImmutableString("paragraph"),
    parents: [],
    attrs: {},
  });
  A.splice(event, [key], 21, 0, "We're live");
  A.mark(event, [key], { start: 27, end: 31, expand: "none" }, "strong", true);
};

export const emailKinds = [
  "signedUp",
  "signupCancelled",
  "eventChanged",
  "eventCancelled",
] as const;

/** Creates and publishes an event, with the given visibility settings. */
export const publishedEvent = Effect.fn(function* (settings: {
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
export const addTags = (
  event: EventContent,
  ...tags: ReadonlyArray<string>
) => {
  (event as unknown as { tags: Array<string> }).tags.push(...tags);
};

/** Sets the questions as the editor does: ids and types immutable. */
export const setQuestions = (
  event: EventContent,
  questions: ReadonlyArray<{
    readonly id: string;
    readonly type: "text" | "checkbox" | "choice";
    readonly text: string;
    readonly label?: string;
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
    ...(question.label === undefined ? {} : { label: question.label }),
    required: question.required ?? false,
    options: (question.options ?? []).map((option) => ({
      id: new A.ImmutableString(option.id),
      text: option.text,
    })),
  }));
};

/** Sets the cover as the editor does: `src` immutable, `alt` text. */
export const setCover = (event: EventContent, src: string | null) => {
  const draft = event as { cover?: unknown };
  if (src === null) delete draft.cover;
  else draft.cover = { src: new A.ImmutableString(src), alt: "" };
};

/** An editor session: a replica of the draft with its own actor id. */
export const openEditor = Effect.fn(function* (
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

/**
 * Starts `write` while `table` is locked, interrupts it as a client going
 * away would, then lets the lock go, and waits for the interrupt to end.
 */
export const interruptedWhileLocked = <A, E, R>(
  table: string,
  write: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const held = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const holder = yield* Effect.gen(function* () {
      yield* sql.unsafe(`LOCK TABLE ${table} IN SHARE MODE`);
      yield* Deferred.succeed(held, undefined);
      yield* Deferred.await(release);
    }).pipe(sql.withTransaction, Effect.forkChild);
    yield* Deferred.await(held);

    const writing = yield* Effect.forkChild(write);
    // Until it waits for the lock.
    const waiting = sql<{ count: number }>`
      SELECT count(*)::int AS count FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `.pipe(Effect.map(([row]) => row?.count ?? 0));
    while ((yield* waiting) < 1) yield* Effect.sleep("20 millis");

    const interrupting = yield* Effect.forkChild(Fiber.interrupt(writing));
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(holder);
    yield* Fiber.join(interrupting);
  });
