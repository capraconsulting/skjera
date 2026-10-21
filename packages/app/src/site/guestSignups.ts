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
