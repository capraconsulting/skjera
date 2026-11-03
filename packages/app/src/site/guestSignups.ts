import type { DocumentId } from "@skjera/documents/api";
import { Effect } from "effect";
import { runPublic } from "./client.ts";

// A guest's signup stays in their browser: only they can change or cancel
// it, with the token they were given.

export interface GuestSignup {
  /** The attendee row. */
  readonly id: string;
  readonly cancelToken: string;
}

const key = (eventId: string) => `skjera-signup-${eventId}`;

/** The guest signup this browser made for an event, if any. */
export const guestSignup = (eventId: string): GuestSignup | null => {
  try {
    const stored = localStorage.getItem(key(eventId));
    if (stored === null) return null;
    const signup = JSON.parse(stored) as Partial<GuestSignup>;
    if (
      typeof signup.id !== "string" ||
      typeof signup.cancelToken !== "string"
    ) {
      return null;
    }
    return { id: signup.id, cancelToken: signup.cancelToken };
  } catch {
    return null;
  }
};

export const rememberGuestSignup = (
  eventId: string,
  signup: GuestSignup | null,
) => {
  try {
    if (signup === null) localStorage.removeItem(key(eventId));
    else localStorage.setItem(key(eventId), JSON.stringify(signup));
  } catch {
    // Private browsing: the signup stands, cancelling needs the organizers.
  }
};

/**
 * What the server has stored for the guest with `cancelToken`: null when it
 * leads to no signup. Other failures reject.
 */
export const storedGuestSignup = (eventId: DocumentId, cancelToken: string) =>
  runPublic((client) =>
    client.events
      .guestSignup({ params: { id: eventId, token: cancelToken } })
      .pipe(Effect.catchTag("SignupNotFound", () => Effect.succeed(null))),
  );

/** The server said no. `why` is what it sent, for `sayWhy`. */
export interface Refused {
  readonly why: unknown;
}

const refused = (why: unknown) => Effect.succeed<Refused>({ why });

/**
 * Asks for a link that cancels, emailed to the guest who signed up with
 * `email`: null once it is sent, else why not. Other failures reject.
 */
export const requestCancelByEmail = (
  eventId: DocumentId,
  email: string,
  honeypot: string,
) =>
  runPublic((client) =>
    client.events
      .requestCancel({
        params: { id: eventId },
        payload: { email, honeypot },
      })
      .pipe(
        Effect.as(null),
        Effect.catchTags({
          EventNotFound: refused,
          SignupRejected: refused,
          TooManyAttempts: refused,
        }),
      ),
  );

/**
 * What a cancel link's page shows: the event's title, or why the link does
 * not work. Cancels nothing. Other failures reject.
 */
export const cancelLinkFor = (eventId: DocumentId, token: string) =>
  runPublic((client) =>
    client.events.cancelLink({ params: { id: eventId, token } }).pipe(
      Effect.map(({ title }) => ({ title })),
      Effect.catchTag("SignupRejected", refused),
    ),
  );

/** Cancels the signup a link names: null once done, else why not. */
export const confirmCancelByLink = (eventId: DocumentId, token: string) =>
  runPublic((client) =>
    client.events
      .confirmCancel({ params: { id: eventId, token } })
      .pipe(
        Effect.as(null),
        Effect.catchTags({ SignupRejected: refused, TooManyAttempts: refused }),
      ),
  );
