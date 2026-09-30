import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  EventNotFound,
  SignInRequired,
  SignupNotFound,
  SignupRejected,
} from "./errors.ts";
import { DocumentId, GuestDetails, GuestSignup } from "./Model.ts";

// The site's API for signing up to published events. Public events are
// there for anyone; with a session, members-only events too. The events
// themselves are synced (see SyncApi.ts).

export class EventsApi extends HttpApiGroup.make("events").add(
  /**
   * Signs up the signed-in user, or, without a session, a guest with the
   * details given. A guest gets the token that cancels their signup.
   * `dietary` is required when the event asks for it.
   */
  HttpApiEndpoint.post("attend", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    payload: Schema.Struct({
      /** The signup's id, picked by the client. */
      id: Schema.String.check(Schema.isUUID()),
      guest: Schema.optionalKey(GuestDetails),
      dietary: Schema.optionalKey(Schema.String),
    }),
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
