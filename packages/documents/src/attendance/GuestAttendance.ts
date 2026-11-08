import type { Identity } from "@skjera/oauth/api";
import { Effect } from "effect";
import {
  type EventNotFound,
  SignupNotFound,
  SignupRejected,
} from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import type { StoredGuestSignup } from "../api/PublicApi.ts";
import {
  type AdSource,
  type AdSourceKey,
  type Answer,
  type Answers,
  adSourceKeys,
  type DocumentId,
  type GuestDetails,
  type Locale,
} from "../Model.ts";
import { tokenHash } from "./tokens.ts";

export interface SignupDetails {
  /**
   * What they can't eat: optional, and kept for the event apart from the
   * signup while the event asks for it (until its food deadline). Ignored on
   * change.
   */
  readonly dietary?: string;
  /** Answers to the event's questions, by question id. */
  readonly answers?: Answers;
  /** Follows online rather than in person; required while the event is streamed. */
  readonly online?: boolean;
  /** A guest's own, on change; kept as given when left out, never a member's. */
  readonly phone?: string;
  readonly company?: string;
  /** The signup's id, picked by the client. */
  readonly id?: string;
  /** The language they signed up in, for emails to them. */
  readonly locale?: Locale;
  /** A guest form's hidden field: only a bot fills it in, and a filled one is refused. */
  readonly honeypot?: string;
  /** The ad they came from, from the address of the event's page. */
  readonly source?: AdSource;
  /** Asked for invitations and the newsletter. */
  readonly consent?: boolean;
}

/** A guest form's hidden field: only a bot fills it in, and a filled one is refused. */
export const notByBot = (honeypot: string | undefined) =>
  (honeypot ?? "").trim() === ""
    ? Effect.void
    : Effect.fail(new SignupRejected(refused({ _tag: "FormNotValid" })));

/** What a typed optional text is kept as: trimmed, and nothing when blank. */
export const storedText = (text: string | undefined) => text?.trim() || null;

/**
 * An ad source as it is kept: each value trimmed, a blank one left out, as
 * JSON text for a `jsonb` column; null, SQL null, when no value is left.
 */
export const storedAdSource = (source: AdSource | undefined) => {
  const kept: Partial<Record<AdSourceKey, string>> = {};
  for (const key of adSourceKeys) {
    const value = storedText(source?.[key]);
    if (value !== null) kept[key] = value;
  }
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
};

export type AttendanceService = {
  /**
   * Signs a member up. Signing up twice is fine. `dietary` is kept for the
   * event when it asks for it and one is given, and ignored otherwise.
   */
  readonly attend: (
    event: DocumentId,
    user: Identity,
    details?: SignupDetails,
  ) => Effect.Effect<void, EventNotFound | SignupRejected>;
  /** Cancels a member's signup, until the sign-up deadline. */
  readonly leave: (
    event: DocumentId,
    user: Identity,
  ) => Effect.Effect<void, EventNotFound | SignupRejected>;
  /** Signs a guest up, returning the token that cancels the signup. */
  readonly attendAsGuest: (
    event: DocumentId,
    guest: GuestDetails,
    details?: SignupDetails,
  ) => Effect.Effect<string, EventNotFound | SignupRejected>;
  /** `honeypot` is the cancel form's hidden field: a filled one is refused. */
  readonly leaveAsGuest: (
    event: DocumentId,
    cancelToken: string,
    honeypot?: string,
  ) => Effect.Effect<void, SignupNotFound | SignupRejected>;
  /**
   * Emails the guest signed up with `email` a link that cancels, valid for
   * 2 hours. `honeypot` is the form's hidden field: a filled one is refused.
   */
  readonly requestCancel: (
    event: DocumentId,
    email: string,
    honeypot?: string,
  ) => Effect.Effect<void, EventNotFound | SignupRejected>;
  /** What the link's page shows: the event's title. Cancels nothing. */
  readonly cancelLink: (
    event: DocumentId,
    token: string,
  ) => Effect.Effect<{ readonly title: string }, SignupRejected>;
  /** Cancels the signup the link names, and tells them as any cancel does. */
  readonly confirmCancel: (
    event: DocumentId,
    token: string,
  ) => Effect.Effect<void, SignupRejected>;
  /**
   * The token in a link that cancels, for the mailer and tests: signed,
   * never stored. A string, not a `DocumentId`: the mailer has the event's
   * id as its entity id.
   */
  readonly cancelLinkToken: (
    event: string,
    attendee: string,
    expiresAt: number,
  ) => string;
  /**
   * A guest's own signup, for the token they were given: what they told,
   * to change it from any browser. None for another token, a cancelled or
   * removed signup, or a deleted event.
   */
  readonly guestSignup: (
    event: DocumentId,
    cancelToken: string,
  ) => Effect.Effect<StoredGuestSignup, SignupNotFound>;
  /**
   * Changes a signup's answers until the sign-up deadline. A member's
   * signup is theirs; a guest's goes with its cancel token.
   */
  readonly change: (
    event: DocumentId,
    who: { readonly user: Identity } | { readonly cancelToken: string },
    details: SignupDetails,
  ) => Effect.Effect<void, EventNotFound | SignupNotFound | SignupRejected>;
  /**
   * Takes someone off an event, as its organizers: any time. Tells them,
   * unless the event has ended.
   */
  readonly remove: (attendee: string) => Effect.Effect<void, SignupNotFound>;
  /** What people can't eat, for an event's organizers: the texts alone. */
  readonly dietaryPreferences: (
    event: DocumentId,
  ) => Effect.Effect<ReadonlyArray<string>>;
  /**
   * The token a guest changes and cancels their signup with: derived from
   * it, so it can be put in emails sent later, though only its hash is
   * stored.
   */
  readonly guestToken: (attendee: string) => string;
};

export const guestSignupFor = (
  sql: import("effect/sql").SqlClient.SqlClient,
) => {
  const guestSignup = Effect.fn("Attendance.guestSignup")(function* (
    event: DocumentId,
    cancelToken: string,
  ) {
    const [found] = yield* sql<{
      id: string;
      phone: string | null;
      company: string | null;
      answers: ReadonlyArray<Answer>;
    }>`
      SELECT a.id, a.phone, a.company, a.answers
      FROM attendees a JOIN events e ON e.id = a.event_id
      WHERE a.event_id = ${event} AND a.cancel_token_hash = ${tokenHash(cancelToken)}
        AND e.deleted_at IS NULL
    `.pipe(Effect.orDie);
    if (found === undefined) return yield* new SignupNotFound({});
    return {
      id: found.id,
      phone: found.phone,
      company: found.company,
      // As the form gives them, by question id: sent back unchanged, they stay.
      answers: Object.fromEntries(
        found.answers.map((answer) => [answer.id, answer.value]),
      ),
    };
  });

  return guestSignup;
};
