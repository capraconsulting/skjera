import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ContentTypeName } from "./ContentTypes.ts";
import { DocumentId, Heads, IsoDate, TeamId } from "./Model.ts";

// Clients keep copies of tables. A pull returns the rows that changed since
// the snapshot of the previous pull, which rows were deleted, and the
// snapshot to pull from next time.

/**
 * A Postgres snapshot, "xmin:xmax:xip,...": which transactions a pull had
 * seen. Opaque to clients, except for telling whether it includes a given
 * transaction.
 */
export const Snapshot = Schema.String.check(
  Schema.isPattern(/^\d+:\d+:(\d+(,\d+)*)?$/),
);
export type Snapshot = typeof Snapshot.Type;

/** What changed, as rows of type `Row`. */
export const Pulled = <Row extends Schema.Top>(row: Row) =>
  Schema.Struct({
    /** The rows changed since, or every row when `complete`. */
    rows: Schema.Array(row),
    /** Ids of the rows deleted since. */
    deleted: Schema.Array(Schema.String),
    /** Everything there is: start over from `rows`, not from a copy. */
    complete: Schema.Boolean,
    snapshot: Snapshot,
  });

export const TeamRow = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  createdAt: Schema.Date,
});
export type TeamRow = typeof TeamRow.Type;

/** A document without its content, which is synced separately. */
export const DocumentRow = Schema.Struct({
  id: DocumentId,
  type: ContentTypeName,
  teamId: TeamId,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type DocumentRow = typeof DocumentRow.Type;

/** The published version of an event: what the site shows. */
export const EventRow = Schema.Struct({
  id: DocumentId,
  title: Schema.String,
  date: IsoDate,
  body: Schema.String,
  /** Visible without logging in. */
  isPublic: Schema.Boolean,
  /** People without an account can sign up to attend. */
  allowGuests: Schema.Boolean,
  /** Everyone signing up must give their dietary preferences. */
  askDietary: Schema.Boolean,
  /** The version of the draft that was published. */
  publishedHeads: Heads,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
});
export type EventRow = typeof EventRow.Type;

/** Who is coming to an event, for its organizers. */
export const AttendeeDetails = Schema.Struct({
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
  /** What they can't eat, when the event asked. */
  dietary: Schema.NullOr(Schema.String),
  /** Signed up without an account. */
  guest: Schema.Boolean,
});
export type AttendeeDetails = typeof AttendeeDetails.Type;

/** A signup for a published event. */
export const AttendeeRow = Schema.Struct({
  id: Schema.String,
  eventId: DocumentId,
  signedUpAt: Schema.Date,
  /** The signed-in user's own signup. Guests keep track in their browser. */
  mine: Schema.Boolean,
  /** Who it is: for signed-in users only; anyone else can only count. */
  details: Schema.NullOr(AttendeeDetails),
});
export type AttendeeRow = typeof AttendeeRow.Type;

const since = { since: Schema.optionalKey(Snapshot) };

/** Pulls for the studio's tables; signed-in users see all of their rows. */
export class SyncApi extends HttpApiGroup.make("sync")
  .add(
    HttpApiEndpoint.get("teams", "/api/sync/teams", {
      query: since,
      success: Pulled(TeamRow),
    }),
    HttpApiEndpoint.get("documents", "/api/sync/documents", {
      query: since,
      success: Pulled(DocumentRow),
    }),
  )
  .middleware(Authentication) {}

/**
 * Pulls open to anyone, for the site: without a session, only the rows
 * anyone may see.
 */
export class PublicSyncApi extends HttpApiGroup.make("publicSync").add(
  HttpApiEndpoint.get("events", "/api/sync/events", {
    query: since,
    success: Pulled(EventRow),
  }),
  /** Signups: for anyone, those of public events, without who they are. */
  HttpApiEndpoint.get("attendees", "/api/sync/attendees", {
    query: since,
    success: Pulled(AttendeeRow),
  }),
) {}
