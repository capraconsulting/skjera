import { Schema } from "effect";

// Document identity and publish state, shared by the server and the editor.

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"));
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

export const TeamId = Schema.String.pipe(Schema.brand("TeamId"));
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

/** An event as the public site shows it: only ever the published version. */
export class PublishedEvent extends Schema.Class<PublishedEvent>(
  "@skjera/documents/PublishedEvent",
)({
  id: DocumentId,
  title: Schema.String,
  date: IsoDate,
  body: Schema.String,
  /** Visible without logging in. */
  isPublic: Schema.Boolean,
  /** People without an account can sign up to attend. */
  allowGuests: Schema.Boolean,
  /** Guests must give their dietary preferences when signing up. */
  askDietary: Schema.Boolean,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
}) {}

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
  /** Required when the event asks for it; ignored otherwise. */
  dietary: Schema.optionalKey(Schema.String),
});
export type GuestDetails = typeof GuestDetails.Type;

/** Attendance as the person looking at an event sees it. */
export class EventAttendance extends Schema.Class<EventAttendance>(
  "@skjera/documents/EventAttendance",
)({
  count: Schema.Int,
  /** The signed-in user is attending. Guests keep track in their browser. */
  attending: Schema.Boolean,
}) {}

export class GuestSignup extends Schema.Class<GuestSignup>(
  "@skjera/documents/GuestSignup",
)({
  /** Cancels this signup. Shown once; only a hash is stored. */
  cancelToken: Schema.String,
}) {}

/** Someone attending an event, as organizers see them. */
export class Attendee extends Schema.Class<Attendee>(
  "@skjera/documents/Attendee",
)({
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  /** What they can't eat, when the event asked. */
  dietary: Schema.NullOr(Schema.String),
  /** Signed up without an account. */
  guest: Schema.Boolean,
  signedUpAt: Schema.Date,
}) {}
