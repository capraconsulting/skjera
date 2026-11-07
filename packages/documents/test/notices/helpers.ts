import * as A from "@automerge/automerge";
import { NodeCrypto } from "@effect/platform-node";
import { Email } from "@skjera/email";
import * as EmailTest from "@skjera/email/testing";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer, Schedule } from "effect";
import { SingleRunner } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import {
  type EventContent,
  organizerEmails,
} from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import { type DocumentId, type Locale, SiteSettings } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import * as Mail from "../../src/notices/Mail.tsx";
import { Notifications } from "../../src/notices/Notifications.ts";
import { SalesEvents } from "../../src/notices/SalesEvents.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

// Signups' emails, from signing up to the outbox: through the event's
// mailer on a cluster on the test database. (SITE_URL, SITE_NAME,
// EMAIL_FROM and SIGNING_SECRET as in mise.toml.)

export const outbox = EmailTest.make();

export const cluster = SingleRunner.layer({
  shardingConfig: {
    entityMessagePollInterval: "50 millis",
    entityReplyPollInterval: "50 millis",
  },
}).pipe(Layer.provide(NodeCrypto.layer));

export const TestLayer = Layer.mergeAll(
  Documents.layer,
  Teams.layer,
  Mail.layerMailer,
).pipe(
  Layer.provideMerge(Attendance.layer),
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(SalesEvents.layerTest),
  Layer.provideMerge(Mail.layerNotifications),
  Layer.provideMerge(SiteSettings.layer),
  Layer.provideMerge(Layer.succeed(Email, outbox.email)),
  Layer.provideMerge(cluster),
  Layer.provideMerge(TestDatabase),
);

export const alice = new Identity({
  issuer: "https://idp.example",
  subject: "alice",
  email: "alice@example.com",
  name: "Alice",
});

let teams = 0;
/**
 * A published event open to guests: from 18:00 to 21:00 in Oslo on the 15th
 * of October 2036, or for three hours from `startsAt`.
 */
export const publishedEventOf = (
  options: {
    readonly dietary?: boolean;
    readonly startsAt?: Date;
    readonly reminders?: boolean;
    /** Where it is; null: published before events had a place. */
    readonly place?: string | null;
    /** What the event is; missing: none. */
    readonly summary?: string;
    /** The emails' own subjects and texts, as published; missing: none. */
    readonly emailTexts?: Record<string, unknown>;
  } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const team = yield* (yield* Teams).create(`Mail ${++teams}`, alice);
    const id = yield* (yield* Documents).create("event", team.id, alice);
    const startsAt = options.startsAt ?? new Date("2036-10-15T18:00+02:00");
    const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000);
    yield* sql`
      INSERT INTO events (id, title, starts_at, ends_at, time_zone, body, is_public,
        allow_guests, ask_dietary, send_reminders, place, summary, published_heads,
        published_by_issuer, published_by_subject)
      VALUES (${id}, 'Launch', ${startsAt}, ${endsAt},
        'Europe/Oslo', '[]', true, true, ${options.dietary ?? false},
        ${options.reminders ?? true}, ${options.place === undefined ? "Kantina" : options.place},
        ${options.summary ?? null}, '{}', 'test', 'test')
    `;
    if (options.emailTexts !== undefined) {
      yield* sql`
        UPDATE events SET email_texts = ${JSON.stringify(options.emailTexts)}::jsonb
        WHERE id = ${id}
      `;
    }
    return { id: id as DocumentId, team };
  }).pipe(Effect.orDie);

export const publishedEvent = (
  options: Parameters<typeof publishedEventOf>[0] = {},
) => Effect.map(publishedEventOf(options), ({ id }) => id);

/** The description of an invitation, unfolded and read as text. */
export const descriptionOf = (invitation: string) =>
  invitation
    .replace(/\r?\n[ \t]/g, "")
    .match(/^DESCRIPTION:(.*)$/m)?.[1]
    ?.replace(/\\n/g, "\n")
    .replace(/\\,/g, ",");

/** The organizer line of an invitation, unfolded. */
export const organizerOf = (invitation: string) =>
  invitation.replace(/\r?\n[ \t]/g, "").match(/^ORGANIZER[^\r\n]*/m)?.[0];

/** The emails sent to `address`, once there are `count`. */
export const emailsTo = (address: string, count: number) =>
  Effect.sync(() => outbox.to(address)).pipe(
    Effect.filterOrFail(
      (sent) => sent.length >= count,
      () => "not yet",
    ),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 60 }),
    Effect.orDie,
  );

export const spanBlock = (
  type: string,
  attrs: Record<string, unknown> = {},
  isEmbed = false,
) => ({
  type: "block",
  value: { type, attrs, parents: [], ...(isEmbed ? { isEmbed } : {}) },
});

/** A written text, as published: a heading, a paragraph with a bold run and a link, a list item. */
export const writtenText = [
  spanBlock("heading", { level: 2 }),
  { type: "text", value: "Big news" },
  spanBlock("paragraph"),
  { type: "text", value: "We are " },
  { type: "text", value: "live", marks: { strong: true } },
  { type: "text", value: " and " },
  {
    type: "text",
    value: "read the docs",
    marks: {
      link: JSON.stringify({ href: "https://example.org/docs", title: "" }),
    },
  },
  spanBlock("unordered-list-item"),
  { type: "text", value: "Bring a friend" },
];

export const kinds = organizerEmails.map(({ kind }) => kind);

/** A subject and a text written for each of the four emails. */
export const writtenEverywhere = Object.fromEntries(
  organizerEmails.flatMap(({ kind, subject, text }) => [
    [subject, `Written for ${kind}`],
    [text, writtenText],
  ]),
);

/**
 * A guest's emails about an event, in the order they go out: signed up,
 * moved, new place, both, signup cancelled, event cancelled.
 */
export const journey = (event: DocumentId, locale: Locale) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const attendance = yield* Attendance;
    const notifications = yield* Notifications;
    const signup = crypto.randomUUID();
    const address = `guest-${signup}@example.org`;
    const name = "Gina";
    const token = yield* attendance.attendAsGuest(
      event,
      { name, email: address },
      { id: signup, locale },
    );
    yield* emailsTo(address, 1);
    const attendee = { id: signup, name, email: address, guest: true, locale };
    const previously = {
      startsAt: "2036-10-14T16:00:00.000Z",
      endsAt: "2036-10-14T19:00:00.000Z",
    };
    const notices = [
      { version: "time", previously },
      { version: "place", previousPlace: "Hall" },
      { version: "both", previously, previousPlace: "Hall" },
    ];
    for (const [index, notice] of notices.entries()) {
      yield* notifications.eventChanged({ event, attendee, ...notice });
      yield* emailsTo(address, 2 + index);
    }
    yield* attendance.leaveAsGuest(event, token);
    yield* emailsTo(address, 5);
    yield* sql`UPDATE events SET deleted_at = now() WHERE id = ${event}`;
    yield* notifications.eventCancelled({ event, attendee });
    const sent = yield* emailsTo(address, 6);
    return { sent: sent.map((email) => email.message), token, signup };
  });

/** Edits an event's draft the way the studio does, and returns the new heads. */
export const editDraft = (
  id: DocumentId,
  edit: (event: EventContent) => void,
) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const snapshot = yield* documents.get(id);
    const doc = A.change(A.load<EventContent>(snapshot.draft), edit);
    const change = A.getLastLocalChange(doc);
    if (change === undefined) throw new Error("no change");
    return yield* documents.applyChanges(id, [change], alice);
  }).pipe(Effect.orDie);

/** Writes a field of an email: text under a key older drafts lack. */
export const writeField = (event: EventContent, key: string, text: string) => {
  const draft = event as Record<string, unknown>;
  if (draft[key] === undefined) draft[key] = "";
  A.updateText(event, [key], text);
};

/** Writes a text of one paragraph, as rich text. */
export const writeParagraph = (
  event: EventContent,
  key: string,
  text: string,
) => {
  const draft = event as Record<string, unknown>;
  if (draft[key] === undefined) draft[key] = "";
  A.splitBlock(event, [key], 0, {
    type: new A.ImmutableString("paragraph"),
    parents: [],
    attrs: {},
  });
  A.splice(event, [key], 1, 0, text);
};

/** A draft that can be published: open to guests, at the usual time. */
export const draftEvent = Effect.gen(function* () {
  const team = yield* (yield* Teams).create(`Mail ${++teams}`, alice);
  const id = yield* (yield* Documents).create("event", team.id, alice);
  const heads = yield* editDraft(id, (event) => {
    A.updateText(event, ["title"], "Launch");
    A.updateText(event, ["place"], "Kantina");
    const draft = event as Record<string, unknown>;
    draft["start"] = new A.ImmutableString(
      "2036-10-15T18:00+02:00[Europe/Oslo]",
    );
    draft["end"] = new A.ImmutableString("2036-10-15T21:00+02:00[Europe/Oslo]");
    draft["public"] = true;
    draft["guests"] = true;
  });
  return { id, heads };
}).pipe(Effect.orDie);
