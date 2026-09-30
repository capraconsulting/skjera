import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  EventNotFound,
  SignInRequired,
  SignupNotFound,
  SignupRejected,
} from "./errors.ts";
import {
  DocumentId,
  EventAttendance,
  GuestDetails,
  GuestSignup,
  PublishedEvent,
} from "./Model.ts";

// The site's API: published events, and signing up for them. Public events
// are there for anyone; with a session, members-only events too.

export class EventsApi extends HttpApiGroup.make("events").add(
  HttpApiEndpoint.get("list", "/api/events", {
    success: Schema.Array(PublishedEvent),
  }),
  HttpApiEndpoint.get("get", "/api/events/:id", {
    params: { id: DocumentId },
    success: PublishedEvent,
    error: EventNotFound,
  }),
  HttpApiEndpoint.get("attendance", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    success: EventAttendance,
    error: EventNotFound,
  }),
  /**
   * Signs up the signed-in user, or, without a session, a guest with the
   * details given. A guest gets the token that cancels their signup.
   */
  HttpApiEndpoint.post("attend", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    payload: Schema.Struct({ guest: Schema.optionalKey(GuestDetails) }),
    success: Schema.NullOr(GuestSignup),
    error: [EventNotFound, SignInRequired, SignupRejected],
  }),
  HttpApiEndpoint.delete("leave", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    error: [EventNotFound, SignInRequired],
  }),
  HttpApiEndpoint.delete("leaveAsGuest", "/api/events/:id/attendance/:token", {
    params: { id: DocumentId, token: Schema.String },
    error: SignupNotFound,
  }),
) {}

/** For clients of the public API; servers add `EventsApi` to their own `HttpApi`. */
export class PublicApi extends HttpApi.make("public").add(EventsApi) {}
