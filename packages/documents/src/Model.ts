import { Schema } from "effect";

// Document identity and publish state, shared by the server and the editor.

/** A UUID; clients may pick it when creating a document. */
export const DocumentId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("DocumentId"),
);
export type DocumentId = typeof DocumentId.Type;

/** A calendar date, without time or time zone: "2026-10-15". */
export const IsoDate = Schema.String.check(
  Schema.makeFilter((value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (match === null) return "Expected a date as YYYY-MM-DD";
    const [year, month, day] = match.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      (date.getUTCMonth() === month - 1 && date.getUTCDate() === day) ||
      "Expected a date that exists"
    );
  }),
);
export type IsoDate = typeof IsoDate.Type;

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

export class DocumentSummary extends Schema.Class<DocumentSummary>(
  "@skjera/documents/DocumentSummary",
)({
  id: DocumentId,
  title: Schema.String,
  date: Schema.NullOr(IsoDate),
  updatedAt: Schema.Date,
  publishedAt: Schema.NullOr(Schema.Date),
  /** The draft differs from the published version, or was never published. */
  hasUnpublishedChanges: Schema.Boolean,
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

export class GuestSignup extends Schema.Class<GuestSignup>(
  "@skjera/documents/GuestSignup",
)({
  /** Cancels this signup. Shown once; only a hash is stored. */
  cancelToken: Schema.String,
}) {}

// Presence: who is where in the studio, and their selection. Short-lived,
// never stored; strings are capped so a message fits a Postgres NOTIFY.

const Bounded = (max: number) =>
  Schema.String.check(
    Schema.makeFilter(
      (value: string) => value.length <= max || `At most ${max} characters`,
    ),
  );

/** Where someone is: a team, and the event they have open, if any. */
export const PresenceLocation = Schema.Struct({
  teamId: TeamId,
  documentId: Schema.NullOr(DocumentId),
});
export type PresenceLocation = typeof PresenceLocation.Type;

/** A selection in one field, as Automerge cursors that survive edits. */
export const PresenceSelection = Schema.Struct({
  field: Bounded(32),
  anchor: Bounded(200),
  head: Bounded(200),
});
export type PresenceSelection = typeof PresenceSelection.Type;

/**
 * What a studio tab says about itself. "hello" asks the others to announce
 * themselves; "leave" says goodbye; "update" is everything in between,
 * including heartbeats.
 */
export const PresenceUpdate = Schema.Struct({
  clientId: Bounded(64),
  /**
   * Counts up with each update from a tab. The server may relay a tab's
   * updates out of order; receivers keep the newest.
   */
  seq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: Schema.Literals(["hello", "update", "leave"]),
  location: Schema.NullOr(PresenceLocation),
  selection: Schema.NullOr(PresenceSelection),
});
export type PresenceUpdate = typeof PresenceUpdate.Type;

export class PresenceUser extends Schema.Class<PresenceUser>(
  "@skjera/documents/PresenceUser",
)({
  issuer: Schema.String,
  subject: Schema.String,
  name: Schema.String,
}) {}

/** An update as relayed to everyone, with who sent it, set by the server. */
export class PresenceMessage extends Schema.TaggedClass<PresenceMessage>()(
  "PresenceMessage",
  { ...PresenceUpdate.fields, user: PresenceUser },
) {}

/** Messages may have been missed: everyone should announce themselves again. */
export class PresenceResync extends Schema.TaggedClass<PresenceResync>()(
  "PresenceResync",
  {},
) {}
