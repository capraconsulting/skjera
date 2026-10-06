import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";

// Document identity and publish state, shared by the server and the editor.

/** A UUID; clients may pick it when creating a document. */
export const DocumentId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("DocumentId"),
);
export type DocumentId = typeof DocumentId.Type;

/**
 * A moment as the time on the clock in a time zone, with the zone's offset
 * then: "2026-10-15T18:00+02:00[Europe/Oslo]" (RFC 9557, as Temporal
 * writes it). The offset has to be the zone's at that time, so the value
 * reads the same with or without time zone rules.
 */
export const ZonedDateTime = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}\[[A-Za-z0-9_/+-]+\]$/.test(
        value,
      )
    ) {
      return "Expected a time like 2026-10-15T18:00+02:00[Europe/Oslo]";
    }
    try {
      // Rejects unknown zones, impossible times, and offsets the zone
      // doesn't have then.
      Temporal.ZonedDateTime.from(value, { offset: "reject" });
      return true;
    } catch {
      return "Expected a time that exists in its time zone";
    }
  }),
);
export type ZonedDateTime = typeof ZonedDateTime.Type;

/** A UUID; clients may pick it when creating a team. */
export const TeamId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("TeamId"),
);
export type TeamId = typeof TeamId.Type;

export class Team extends Schema.Class<Team>("@skjera/documents/Team")({
  id: TeamId,
  name: Schema.String,
  createdAt: Schema.Date,
  /** How many documents the team has; only empty teams can be deleted. */
  documentCount: Schema.Int,
}) {}

/** Hex change hashes identifying a version of a document. */
export const Heads = Schema.Array(Schema.String);
export type Heads = typeof Heads.Type;

export class Publication extends Schema.Class<Publication>(
  "@skjera/documents/Publication",
)({
  /** The version of the draft that was published. */
  heads: Heads,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
}) {}

/**
 * Who is looking: anyone sees public events, signed-in users see all
 * published events.
 */
export type Audience = "anyone" | "members";

/** Signing up for an event without an account. */
export const GuestDetails = Schema.Struct({
  name: Schema.String.check(
    Schema.makeFilter(
      (name: string) =>
        (name.trim() !== "" && name.trim().length <= 100) ||
        "Enter your name (at most 100 characters)",
    ),
  ),
  email: Schema.String.check(
    Schema.makeFilter(
      (email: string) =>
        (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
          email.trim().length <= 254) ||
        "Enter a valid email address",
    ),
  ),
});
export type GuestDetails = typeof GuestDetails.Type;

/** A tag on an event, e.g. "Workshop": trimmed, at most 40 characters. */
export const Tag = Schema.String.check(
  Schema.makeFilter(
    (tag: string) =>
      (tag.trim() === tag && tag !== "" && tag.length <= 40) ||
      "Expected a tag of 1 to 40 characters, without spaces around it",
  ),
);
export type Tag = typeof Tag.Type;

/**
 * A question asked of everyone signing up. "text" takes a written answer,
 * "checkbox" a tick (the text is its label, e.g. "I'll bring a friend"),
 * and "choice" one of its options. Ids keep answers to the question they
 * were given for, whatever is edited.
 */
export const Question = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  type: Schema.Literals(["text", "checkbox", "choice"]),
  text: Schema.String,
  /** Text and choice: an answer is needed. Checkbox: it must be ticked. */
  required: Schema.Boolean,
  /** For choice questions; empty for the others. */
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(Schema.isUUID()),
      text: Schema.String,
    }),
  ),
});
export type Question = typeof Question.Type;

/**
 * Answers given when signing up, by question id: text for text questions,
 * true or false for checkboxes, and the option's id for choices.
 */
export const Answers = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Boolean]),
);
export type Answers = typeof Answers.Type;

/**
 * An answer as stored with the signup: in the words asked and picked then,
 * and as given (`value`, as in `Answers`), to change it later.
 */
export const Answer = Schema.Struct({
  /** The question's id. */
  id: Schema.String,
  question: Schema.String,
  answer: Schema.String,
  value: Schema.Union([Schema.String, Schema.Boolean]),
});
export type Answer = typeof Answer.Type;

export class GuestSignup extends Schema.Class<GuestSignup>(
  "@skjera/documents/GuestSignup",
)({
  /** Cancels this signup. Shown once; only a hash is stored. */
  cancelToken: Schema.String,
}) {}

/**
 * Rich text, as Automerge's `spans()` and pg_automerge's `automerge_spans`
 * give it: runs of text with their marks (bold, links, ...), and blocks
 * (paragraphs, headings, list items, images) that start the text after
 * them.
 */
export const RichText = Schema.Array(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal("text"),
      value: Schema.String,
      marks: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
    Schema.Struct({
      type: Schema.Literal("block"),
      value: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ]),
);
export type RichText = typeof RichText.Type;

/** Where an uploaded image is served (see ImagesApi.ts). */
export const ImageSrc = Schema.String.check(
  Schema.isPattern(/^\/api\/images\/[A-Za-z0-9_-]{22}$/),
);

/** An event's cover image, with a description for those who can't see it. */
export const Cover = Schema.Struct({ src: ImageSrc, alt: Schema.String });
export type Cover = typeof Cover.Type;

// Presence: who has a draft open, and their selection. Shared as automerge-
// repo presence, in ephemeral messages (see DraftSync.ts); never stored.

/** A selection in one field, as Automerge cursors that survive edits. */
export const PresenceSelection = Schema.Struct({
  field: Schema.String,
  anchor: Schema.String,
  head: Schema.String,
});
export type PresenceSelection = typeof PresenceSelection.Type;

/** Who an editor is. The server sets it, whatever the editor sends. */
export const PresenceUser = Schema.Struct({
  issuer: Schema.String,
  subject: Schema.String,
  name: Schema.String,
});
export type PresenceUser = typeof PresenceUser.Type;

/** What an editor shares about itself on a draft it has open. */
export type DraftPresenceState = {
  readonly user: PresenceUser | null;
  readonly selection: PresenceSelection | null;
};
