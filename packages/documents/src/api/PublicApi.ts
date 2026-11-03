import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  Answers,
  DocumentId,
  GuestCompany,
  GuestDetails,
  GuestPhone,
  GuestSignup,
  Locale,
} from "../Model.ts";
import {
  DocumentNotFound,
  EventNotFound,
  InvitationRejected,
  SignInRequired,
  SignupNotFound,
  SignupRejected,
  TooManyAttempts,
} from "./errors.ts";
import { EventRow } from "./SyncApi.ts";

// The site's API for signing up to published events. Public events are
// there for anyone; with a session, members-only events too. The events
// themselves are synced (see SyncApi.ts), and read by their address for
// the page of a members-only event, which the synced copy of someone not
// logged in doesn't hold.

/** What changing a signup sends: as when signing up. */
const SignupChange = Schema.Struct({
  answers: Schema.optionalKey(Answers),
  /** Follows online rather than in person; asked while the event is streamed. */
  online: Schema.optionalKey(Schema.Boolean),
  /** A guest's own, kept as given when left out; a member's are ignored. */
  phone: Schema.optionalKey(GuestPhone),
  company: Schema.optionalKey(GuestCompany),
});

/** A guest's own signup, as stored: to start changing it from. */
export const StoredGuestSignup = Schema.Struct({
  /** The attendee row. */
  id: Schema.String,
  phone: Schema.NullOr(Schema.String),
  company: Schema.NullOr(Schema.String),
  /** By question id, as when signing up. */
  answers: Answers,
});
export type StoredGuestSignup = typeof StoredGuestSignup.Type;

export class EventsApi extends HttpApiGroup.make("events").add(
  /** A published event, members-only ones too, for anyone with its address. */
  HttpApiEndpoint.get("event", "/api/events/:id", {
    params: { id: DocumentId },
    success: EventRow,
    error: EventNotFound,
  }),
  /**
   * Signs up the signed-in user, or, without a session, a guest with the
   * details given. A guest gets the token that cancels their signup.
   * `dietary` is optional, and kept for the event while it asks for it;
   * `answers` are required for its required questions.
   */
  HttpApiEndpoint.post("attend", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    payload: Schema.Struct({
      /** The signup's id, picked by the client. */
      id: Schema.String.check(Schema.isUUID()),
      guest: Schema.optionalKey(GuestDetails),
      dietary: Schema.optionalKey(Schema.String),
      /** Answers to the event's questions, by question id. */
      answers: Schema.optionalKey(Answers),
      /** Required while the event is streamed: online, or else in person. */
      online: Schema.optionalKey(Schema.Boolean),
      /** The language they signed up in: emails to them are in it too. */
      locale: Schema.optionalKey(Locale),
      /** The guest form's hidden field: only a bot fills it in, and is refused. */
      honeypot: Schema.optionalKey(Schema.String),
    }),
    success: Schema.NullOr(GuestSignup),
    error: [EventNotFound, SignInRequired, SignupRejected, TooManyAttempts],
  }),
  HttpApiEndpoint.delete("leave", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    error: [EventNotFound, SignInRequired, SignupRejected, TooManyAttempts],
  }),
  HttpApiEndpoint.delete("leaveAsGuest", "/api/events/:id/attendance/:token", {
    params: { id: DocumentId, token: Schema.String },
    // A query rather than a body, so a cancel sent without one still decodes.
    query: { honeypot: Schema.optionalKey(Schema.String) },
    error: [SignupNotFound, SignupRejected, TooManyAttempts],
  }),
  /** A guest's own signup, with the token they were given. */
  HttpApiEndpoint.get("guestSignup", "/api/events/:id/attendance/:token", {
    params: { id: DocumentId, token: Schema.String },
    success: StoredGuestSignup,
    error: SignupNotFound,
  }),
  /**
   * Changes the signed-in user's answers, until the sign-up deadline.
   */
  HttpApiEndpoint.patch("change", "/api/events/:id/attendance", {
    params: { id: DocumentId },
    payload: SignupChange,
    error: [EventNotFound, SignInRequired, SignupNotFound, SignupRejected],
  }),
  /** The same for a guest, with the token they were given. */
  HttpApiEndpoint.patch("changeAsGuest", "/api/events/:id/attendance/:token", {
    params: { id: DocumentId, token: Schema.String },
    payload: SignupChange,
    error: [EventNotFound, SignupNotFound, SignupRejected],
  }),
) {}

/** Someone noted as invited to an event. */
export const Invitation = Schema.Struct({
  id: Schema.String,
  /** Their full name, when given. */
  name: Schema.NullOr(Schema.String),
  email: Schema.String,
  invitedAt: Schema.Date,
});
export type Invitation = typeof Invitation.Type;

/** For organizers in the studio: signed-in users. */
export class AttendeesApi extends HttpApiGroup.make("attendees")
  .add(
    /** Takes someone off an event, whenever. */
    HttpApiEndpoint.delete("remove", "/api/attendees/:id", {
      params: { id: Schema.String.check(Schema.isUUID()) },
      error: SignupNotFound,
    }),
    /** What people can't eat, for an event: the texts, sorted, without names. */
    HttpApiEndpoint.get(
      "dietaryPreferences",
      "/api/events/:id/dietary-preferences",
      {
        params: { id: DocumentId },
        success: Schema.Array(Schema.String),
      },
    ),
    /** Those noted as invited to an event, in the order they were added. */
    HttpApiEndpoint.get("invitations", "/api/events/:id/invitations", {
      params: { id: DocumentId },
      success: Schema.Array(Invitation),
    }),
    /** Notes someone as invited to an event. Nothing is sent to them. */
    HttpApiEndpoint.post("invite", "/api/events/:id/invitations", {
      params: { id: DocumentId },
      // The email is checked by the service, so a refusal says why by its field.
      payload: Schema.Struct({
        name: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
        email: Schema.String,
      }),
      success: Invitation,
      error: [DocumentNotFound, InvitationRejected],
    }),
  )
  .middleware(Authentication) {}

/** For clients of the public API; servers add `EventsApi` to their own `HttpApi`. */
export class PublicApi extends HttpApi.make("public").add(EventsApi) {}
