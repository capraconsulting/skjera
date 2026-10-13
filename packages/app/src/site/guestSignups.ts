import type { Answers } from "@skjera/documents/api";

// A guest's signup stays in their browser: only they can change or cancel
// it, with the token they were given.

export interface GuestSignup {
  /** The attendee row. */
  readonly id: string;
  readonly cancelToken: string;
  /** What they told, to start from when changing it. */
  readonly given?: {
    readonly answers?: Answers;
    readonly phone?: string;
    readonly company?: string;
  };
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
    return {
      id: signup.id,
      cancelToken: signup.cancelToken,
      ...(typeof signup.given === "object" && signup.given !== null
        ? { given: signup.given }
        : {}),
    };
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
