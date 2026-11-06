import { Authentication } from "@skjera/oauth/api";
import { Pulled, Token } from "@skjera/snapsync/schema";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ContentTypeName } from "../events/ContentTypes.ts";
import {
  AdSource,
  Answer,
  Cover,
  DocumentId,
  Heads,
  Organizer,
  Question,
  RichText,
  TeamId,
  TeamLogos,
} from "../Model.ts";

// Clients keep copies of tables. A pull returns the rows that changed since
// the token of the previous pull, which rows were deleted, and the token to
// pull from next time (see @skjera/snapsync).

export const TeamRow = Schema.Struct({
  id: TeamId,
  name: Schema.String,
  ...TeamLogos.fields,
  createdAt: Schema.Date,
});
export type TeamRow = typeof TeamRow.Type;

/** A tag some published event has had: suggestions for tagging. */
export const TagRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type TagRow = typeof TagRow.Type;

/**
 * A document without its content, which is synced separately, but with what
 * lists of documents show from it.
 */
export const DocumentRow = Schema.Struct({
  id: DocumentId,
  type: ContentTypeName,
  teamId: TeamId,
  title: Schema.String,
  /** When the event starts, and the zone it was set in. */
  startsAt: Schema.NullOr(Schema.Date),
  timeZone: Schema.NullOr(Schema.String),
  /** The draft's version, sorted like `EventRow.publishedHeads`. */
  draftHeads: Heads,
  /** The draft's tags, as written. */
  tags: Schema.Array(Schema.String),
  /** When the event was first published; kept after it is unpublished. */
  firstPublishedAt: Schema.NullOr(Schema.Date),
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
});
export type DocumentRow = typeof DocumentRow.Type;

/** The published version of an event: what the site shows. */
export const EventRow = Schema.Struct({
  id: DocumentId,
  title: Schema.String,
  /** What the event is, in a sentence or two; null: none. */
  summary: Schema.NullOr(Schema.String),
  startsAt: Schema.Date,
  endsAt: Schema.Date,
  /** Signing up and cancelling close then; when it starts if null. */
  signupDeadline: Schema.NullOr(Schema.Date),
  /** The zone the times were set in, to show them in: "Europe/Oslo". */
  timeZone: Schema.String,
  body: RichText,
  cover: Schema.NullOr(Cover),
  /** Who organizes it: its team, as it is now. */
  organizer: Organizer,
  /** Visible without logging in. */
  isPublic: Schema.Boolean,
  /** People without an account can sign up to attend. */
  allowGuests: Schema.Boolean,
  /** Food is served: those signing up may give their dietary preferences. */
  askDietary: Schema.Boolean,
  /** What or where people eat. */
  food: Schema.String,
  /** Dietary preferences are asked until then; until sign-up closes if null. */
  foodDeadline: Schema.NullOr(Schema.Date),
  /** Asked of everyone signing up. */
  questions: Schema.Array(Question),
  /** Without duplicates. */
  tags: Schema.Array(Schema.String),
  /** Where it is, as written; null for events published before events had a place. */
  place: Schema.NullOr(Schema.String),
  /** The most who can sign up; null: no limit. */
  maxAttendees: Schema.NullOr(Schema.Int),
  /** Don't show how many places are left. */
  hidePlacesLeft: Schema.Boolean,
  /** Those signing up say whether they come in person or follow online. */
  isStreamed: Schema.Boolean,
  /** Where it is streamed; null: no link (yet), and always while not streamed. */
  streamLink: Schema.NullOr(Schema.String),
  /**
   * Sent to HubSpot as a Marketing Event, with its sign-ups: its guest form
   * asks for a job title and is kept out of HubSpot's collected forms.
   */
  isSalesEvent: Schema.Boolean,
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
  /** A guest's phone number and company, when they gave them. */
  phone: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  /** The ad they came from, when the address of the event's page said. */
  source: Schema.NullOr(AdSource),
  /** Asked for invitations and the newsletter when signing up. */
  consent: Schema.Boolean,
  /** Answers to the event's questions, as asked and picked then. */
  answers: Schema.Array(Answer),
  /** Signed up without an account. */
  guest: Schema.Boolean,
});
export type AttendeeDetails = typeof AttendeeDetails.Type;

/** A signup for a published event. */
export const AttendeeRow = Schema.Struct({
  id: Schema.String,
  eventId: DocumentId,
  signedUpAt: Schema.Date,
  /** When its answers last changed. */
  changedAt: Schema.Date,
  /** The signed-in user's own signup. Guests keep track in their browser. */
  mine: Schema.Boolean,
  /**
   * Follows online rather than in person. Counts only while the event is
   * streamed; anyone looking at a public event counts places left in person.
   */
  online: Schema.Boolean,
  /** Who it is: for signed-in users only; anyone else can only count. */
  details: Schema.NullOr(AttendeeDetails),
});
export type AttendeeRow = typeof AttendeeRow.Type;

const since = { since: Schema.optionalKey(Token) };

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
    HttpApiEndpoint.get("tags", "/api/sync/tags", {
      query: since,
      success: Pulled(TagRow),
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
