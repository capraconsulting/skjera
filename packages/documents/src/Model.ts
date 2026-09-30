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
