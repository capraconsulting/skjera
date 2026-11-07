import { emailDomain, isDomainAllowed } from "@skjera/oauth";
import { type Identity, nameOf } from "@skjera/oauth/api";
import { Clock, Context, Effect, Layer } from "effect";
import { SqlClient, SqlError, type Statement } from "effect/sql";
import {
  EventNotFound,
  SignupNotFound,
  SignupRejected,
} from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import type { StoredGuestSignup } from "../api/PublicApi.ts";
import { dietaryClosesAt, signupClosesAt } from "../events/ContentTypes.ts";
import {
  type AdSource,
  type AdSourceKey,
  type Answer,
  type Answers,
  type Audience,
  adSourceKeys,
  type DocumentId,
  dietaryPreferenceLength,
  type GuestDetails,
  guestProblems,
  type Locale,
  type Question,
  SiteSettings,
} from "../Model.ts";
import {
  Notifications,
  type Signup,
  signupColumns,
  tell,
} from "../notices/Notifications.ts";
import { SalesEvents } from "../notices/SalesEvents.ts";
import { answersFor } from "./answers.ts";
import {
  cancelLinkLife,
  cancelLinkToken,
  guestToken,
  readCancelLink,
  signingSecret,
  tokenHash,
} from "./tokens.ts";

/** What someone signing up tells, besides who they are. */
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
const notByBot = (honeypot: string | undefined) =>
  (honeypot ?? "").trim() === ""
    ? Effect.void
    : Effect.fail(new SignupRejected(refused({ _tag: "FormNotValid" })));

/** What a typed optional text is kept as: trimmed, and nothing when blank. */
const storedText = (text: string | undefined) => text?.trim() || null;

/**
 * An ad source as it is kept: each value trimmed, a blank one left out, as
 * JSON text for a `jsonb` column; null, SQL null, when no value is left.
 */
const storedAdSource = (source: AdSource | undefined) => {
  const kept: Partial<Record<AdSourceKey, string>> = {};
  for (const key of adSourceKeys) {
    const value = storedText(source?.[key]);
    if (value !== null) kept[key] = value;
  }
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
};

const pgCode = (error: SqlError.SqlError) =>
  (error.reason as { cause?: { code?: string } }).cause?.code;

/**
 * Signups for published events, in a plain table. Members sign up with their
 * account; guests with a name and email, on public events that allow them.
 */
export class Attendance extends Context.Service<
  Attendance,
  {
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
  }
>()("@skjera/documents/Attendance") {
  static readonly layer = Layer.effect(
    Attendance,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const salesEvents = yield* SalesEvents;
      const secret = yield* signingSecret;
      // The domains members log in with: an email on one is a member's.
      const { memberDomains } = yield* SiteSettings;
      const isMemberEmail = (email: string) =>
        isDomainAllowed(memberDomains, emailDomain(email));
      const guestTokenFor = (attendee: string) => guestToken(secret, attendee);
      const cancelLinkTokenFor = (
        event: string,
        attendee: string,
        expiresAt: number,
      ) => cancelLinkToken(secret, event, attendee, expiresAt);

      /** Signing up and cancelling close at the deadline, or else when the event starts. On `events e`. */
      const signupOpen = sql`coalesce(e.signup_deadline, e.starts_at) > now()`;
      /** HubSpot is told of the signups just made. */
      const tellSignedUp = (
        event: DocumentId,
        signups: ReadonlyArray<Signup>,
      ) =>
        Effect.forEach(
          signups,
          (signup) => salesEvents.signedUp(event, signup.id),
          {
            discard: true,
          },
        );

      /** HubSpot is told of the signups just deleted. */
      const tellCancelled = (
        event: DocumentId,
        signups: ReadonlyArray<Signup>,
      ) =>
        Effect.forEach(
          signups,
          ({ id, email }) => salesEvents.signupCancelled(event, { id, email }),
          { discard: true },
        );

      const closed = new SignupRejected(refused({ _tag: "SignupClosed" }));
      const full = new SignupRejected(refused({ _tag: "EventFull" }));

      /**
       * Refuses a signup that would take a place when none is left. Those
       * following a streamed event online take none. The event is locked
       * first, so signups for its last place take turns: the count, in a
       * statement of its own, sees those that committed while this one
       * waited. Someone with a place already (their own row, counted in
       * person) isn't new.
       */
      const room = Effect.fn(function* (
        event: DocumentId,
        online: boolean,
        own: Statement.Fragment,
      ) {
        const [limit] = yield* sql<{
          max_attendees: number | null;
          is_streamed: boolean;
        }>`
          SELECT max_attendees, is_streamed FROM events WHERE id = ${event} FOR UPDATE
        `;
        if (limit === undefined || limit.max_attendees === null) return;
        if (limit.is_streamed && online) return;
        const [taken] = yield* sql<{ count: number; mine: boolean }>`
          SELECT count(*)::int AS count, coalesce(bool_or(${own}), false) AS mine
          FROM attendees
          WHERE event_id = ${event} AND NOT (${limit.is_streamed}::boolean AND online)
        `;
        if (
          taken !== undefined &&
          !taken.mine &&
          taken.count >= limit.max_attendees
        ) {
          return yield* full;
        }
      });

      /**
       * The event's signup rules, if the audience may see it. Signing up
       * and cancelling close at the deadline, or else when it starts.
       */
      const rules = Effect.fn(function* (
        event: DocumentId,
        audience: Audience,
      ) {
        const [row] = yield* sql<{
          allow_guests: boolean;
          ask_dietary: boolean;
          food_deadline: Date | null;
          questions: ReadonlyArray<Question>;
          signup_deadline: Date | null;
          starts_at: Date;
          streamed: boolean;
          now: Date;
        }>`
          SELECT allow_guests, ask_dietary, food_deadline, questions,
            signup_deadline, starts_at, is_streamed AS streamed, now() AS now
          FROM events e
          WHERE id = ${event} AND (is_public OR ${audience === "members"})
            AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new EventNotFound({ id: event });
        }
        if (signupClosesAt(row.signup_deadline, row.starts_at) <= row.now) {
          return yield* closed;
        }
        return {
          allowGuests: row.allow_guests,
          askDietary:
            row.ask_dietary &&
            dietaryClosesAt(
              row.food_deadline,
              row.signup_deadline,
              row.starts_at,
            ) > row.now,
          questions: row.questions,
          streamed: row.streamed,
        };
      });

      /** What to keep of dietary preferences: nothing unless asked and given. */
      const dietaryFor = (askDietary: boolean, value: string | undefined) => {
        const dietary = askDietary ? storedText(value) : null;
        return dietary !== null && dietary.length > dietaryPreferenceLength
          ? Effect.fail(new SignupRejected(refused({ _tag: "DietaryTooLong" })))
          : Effect.succeed(dietary);
      };

      /** Keeps a dietary preference for the event, apart from who gave it. */
      const keepDietary = (event: DocumentId, dietary: string | null) =>
        dietary === null
          ? Effect.void
          : sql`INSERT INTO dietary_preferences (event_id, text) VALUES (${event}, ${dietary})`;

      /** Whether they follow online: asked only while the event is streamed. */
      const onlineFor = (streamed: boolean, value: boolean | undefined) =>
        !streamed
          ? Effect.succeed(false)
          : value === undefined
            ? Effect.fail(
                new SignupRejected(refused({ _tag: "AttendanceMissing" })),
              )
            : Effect.succeed(value);

      // Writes run to their end, even if the client that asked goes away.
      const attend = Effect.fn("Attendance.attend")(function* (
        event: DocumentId,
        user: Identity,
        details: SignupDetails = {},
      ) {
        const { askDietary, questions, streamed } = yield* rules(
          event,
          "members",
        );
        const dietary = yield* dietaryFor(askDietary, details.dietary);
        const answers = yield* answersFor(questions, details.answers);
        const online = yield* onlineFor(streamed, details.online);
        const id = details.id;
        yield* Effect.gen(function* () {
          yield* room(
            event,
            online,
            sql`user_issuer = ${user.issuer} AND user_subject = ${user.subject}`,
          );
          yield* sql`
            UPDATE attendees SET name = ${nameOf(user)}
            WHERE event_id = ${event}
              AND user_issuer = ${user.issuer}
              AND user_subject = ${user.subject}
              AND name IS DISTINCT FROM ${nameOf(user)}
          `;
          // Already signed up, or a retry: nothing to do, or tell.
          const inserted = yield* sql<Signup>`
            INSERT INTO attendees (id, event_id, user_issuer, user_subject, name, email, answers, online, locale, ad_source, marketing_consent)
            VALUES (coalesce(${id ?? null}::uuid, uuidv7()), ${event}, ${user.issuer},
              ${user.subject}, ${nameOf(user)},
              ${user.email ?? null}, ${JSON.stringify(answers)}::jsonb,
              ${online}, ${details.locale ?? null}, ${storedAdSource(details.source)}::jsonb,
              ${details.consent === true})
            ON CONFLICT DO NOTHING
            RETURNING ${signupColumns(sql)}
          `;
          if (inserted.length > 0) yield* keepDietary(event, dietary);
          yield* tell(inserted, (attendee) =>
            notifications.signedUp({ event, attendee }),
          );
          yield* tellSignedUp(event, inserted);
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, Effect.die),
        );
      }, Effect.uninterruptible);

      const leave = Effect.fn("Attendance.leave")(function* (
        event: DocumentId,
        user: Identity,
      ) {
        yield* rules(event, "members");
        yield* Effect.gen(function* () {
          const deleted = yield* sql<Signup>`
            DELETE FROM attendees
            WHERE event_id = ${event}
              AND user_issuer = ${user.issuer} AND user_subject = ${user.subject}
            RETURNING ${signupColumns(sql)}
          `;
          yield* tell(deleted, (attendee) =>
            notifications.signupCancelled({ event, attendee }),
          );
          yield* tellCancelled(event, deleted);
        }).pipe(sql.withTransaction, Effect.orDie);
      }, Effect.uninterruptible);

      const attendAsGuest = Effect.fn("Attendance.attendAsGuest")(function* (
        event: DocumentId,
        guest: GuestDetails,
        details: SignupDetails = {},
      ) {
        yield* notByBot(details.honeypot);
        const { allowGuests, askDietary, questions, streamed } = yield* rules(
          event,
          "anyone",
        );
        if (!allowGuests) {
          return yield* new SignupRejected(
            refused({ _tag: "GuestsNotAllowed" }),
          );
        }
        // A member logs in to sign up; never as a guest.
        if (isMemberEmail(guest.email)) {
          return yield* new SignupRejected(refused({ _tag: "MemberEmail" }));
        }
        const [problem] = guestProblems(guest);
        if (problem !== undefined) {
          return yield* new SignupRejected(refused(problem));
        }
        const dietary = yield* dietaryFor(askDietary, details.dietary);
        const answers = yield* answersFor(questions, details.answers);
        const online = yield* onlineFor(streamed, details.online);
        const id = details.id;
        const attendee = id ?? crypto.randomUUID();
        const token = guestTokenFor(attendee);
        yield* Effect.gen(function* () {
          yield* room(event, online, sql`false`);
          const inserted = yield* sql<Signup>`
            INSERT INTO attendees (id, event_id, name, email, phone, company, job_title, answers, cancel_token_hash, online, locale, ad_source, marketing_consent)
            VALUES (${attendee}::uuid, ${event}, ${guest.name.trim()},
              ${guest.email.trim()}, ${storedText(guest.phone)}, ${storedText(guest.company)},
              ${storedText(guest.jobTitle)}, ${JSON.stringify(answers)}::jsonb, ${tokenHash(token)},
              ${online}, ${details.locale ?? null}, ${storedAdSource(details.source)}::jsonb,
              ${details.consent === true})
            RETURNING ${signupColumns(sql)}
          `;
          yield* keepDietary(event, dietary);
          yield* tell(inserted, (attendee) =>
            notifications.signedUp({ event, attendee }),
          );
          yield* tellSignedUp(event, inserted);
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23505"
              ? Effect.fail(new SignupRejected(refused({ _tag: "EmailTaken" })))
              : Effect.die(error),
          ),
        );
        return token;
      }, Effect.uninterruptible);

      const leaveAsGuest = Effect.fn("Attendance.leaveAsGuest")(function* (
        event: DocumentId,
        cancelToken: string,
        honeypot?: string,
      ) {
        yield* notByBot(honeypot);
        const [found] = yield* sql<{ open: boolean }>`
          SELECT ${signupOpen} AS open
          FROM attendees a JOIN events e ON e.id = a.event_id
          WHERE a.event_id = ${event} AND a.cancel_token_hash = ${tokenHash(cancelToken)}
            AND e.deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (found === undefined) return yield* new SignupNotFound({});
        if (!found.open) return yield* closed;
        yield* Effect.gen(function* () {
          const deleted = yield* sql<Signup>`
            DELETE FROM attendees
            WHERE event_id = ${event} AND cancel_token_hash = ${tokenHash(cancelToken)}
            RETURNING ${signupColumns(sql)}
          `;
          yield* tell(deleted, (attendee) =>
            notifications.signupCancelled({ event, attendee }),
          );
          yield* tellCancelled(event, deleted);
        }).pipe(sql.withTransaction, Effect.orDie);
      }, Effect.uninterruptible);

      const cancelRefusal = (
        problem: "CancelLinkInvalid" | "CancelLinkExpired" | "CancelLinkUsed",
      ) => new SignupRejected(refused({ _tag: problem }));

      /**
       * The signup a cancel link names, if the link is good: signed for this
       * event, not expired, and its signup still there.
       */
      const cancelTarget = Effect.fn(function* (
        event: DocumentId,
        token: string,
      ) {
        const link = readCancelLink(
          secret,
          event,
          token,
          yield* Clock.currentTimeMillis,
        );
        if ("problem" in link) return yield* cancelRefusal(link.problem);
        const { attendee } = link;
        // A deleted event has no signups to find: its link is used up.
        const [found] = yield* sql<{ title: string; open: boolean }>`
          SELECT e.title, ${signupOpen} AS open
          FROM attendees a JOIN events e ON e.id = a.event_id
          WHERE a.id = ${attendee}::uuid AND a.event_id = ${event}
            AND a.user_issuer IS NULL AND e.deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (found === undefined) return yield* cancelRefusal("CancelLinkUsed");
        if (!found.open) return yield* closed;
        return { attendee, title: found.title };
      });

      const requestCancel = Effect.fn("Attendance.requestCancel")(function* (
        event: DocumentId,
        email: string,
        honeypot?: string,
      ) {
        yield* notByBot(honeypot);
        yield* rules(event, "anyone");
        // Only a guest's signup: members log in to cancel.
        const found = yield* sql<Signup>`
          SELECT ${signupColumns(sql)}
          FROM attendees
          WHERE event_id = ${event} AND user_issuer IS NULL
            AND lower(email) = lower(${email.trim()})
        `.pipe(Effect.orDie);
        if (found.length === 0) {
          return yield* new SignupRejected(
            refused({ _tag: "NoSignupForEmail" }),
          );
        }
        const expiresAt = (yield* Clock.currentTimeMillis) + cancelLinkLife;
        yield* tell(found, (attendee) =>
          notifications.cancelRequested({ event, attendee, expiresAt }),
        );
      });

      const cancelLink = Effect.fn("Attendance.cancelLink")(function* (
        event: DocumentId,
        token: string,
      ) {
        const { title } = yield* cancelTarget(event, token);
        return { title };
      });

      const confirmCancel = Effect.fn("Attendance.confirmCancel")(function* (
        event: DocumentId,
        token: string,
      ) {
        const { attendee } = yield* cancelTarget(event, token);
        const cancelled = yield* Effect.gen(function* () {
          const deleted = yield* sql<Signup>`
            DELETE FROM attendees
            WHERE id = ${attendee}::uuid AND event_id = ${event}
              AND user_issuer IS NULL
            RETURNING ${signupColumns(sql)}
          `;
          yield* tell(deleted, (each) =>
            notifications.signupCancelled({ event, attendee: each }),
          );
          yield* tellCancelled(event, deleted);
          return deleted.length;
        }).pipe(sql.withTransaction, Effect.orDie);
        // Gone since it was checked: cancelled by another press of the button.
        if (cancelled === 0) return yield* cancelRefusal("CancelLinkUsed");
      }, Effect.uninterruptible);

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

      const change = Effect.fn("Attendance.change")(function* (
        event: DocumentId,
        who: { readonly user: Identity } | { readonly cancelToken: string },
        details: SignupDetails,
      ) {
        const { questions, streamed } = yield* rules(
          event,
          "user" in who ? "members" : "anyone",
        );
        const answers = yield* answersFor(questions, details.answers);
        const own =
          "user" in who
            ? sql`user_issuer = ${who.user.issuer} AND user_subject = ${who.user.subject}`
            : sql`cancel_token_hash = ${tokenHash(who.cancelToken)}`;
        const found = yield* sql`
          SELECT id FROM attendees WHERE event_id = ${event} AND ${own}
        `.pipe(Effect.orDie);
        if (found.length === 0) return yield* new SignupNotFound({});
        // Counts only while the event is streamed; left out, the choice stays.
        const online = streamed ? (details.online ?? null) : null;
        // Only a guest's signup has them; given, an empty one clears the value.
        const guest = !("user" in who);
        const phoneGiven = guest && details.phone !== undefined;
        const companyGiven = guest && details.company !== undefined;
        const [problem] = guest
          ? guestProblems({
              ...(details.phone === undefined ? {} : { phone: details.phone }),
              ...(details.company === undefined
                ? {}
                : { company: details.company }),
            })
          : [];
        if (problem !== undefined) {
          return yield* new SignupRejected(refused(problem));
        }
        yield* Effect.gen(function* () {
          // A place in person is taken: the event's row is locked first.
          if (online === false) yield* room(event, false, own);
          const changed = yield* sql`
            UPDATE attendees SET
              answers = ${JSON.stringify(answers)}::jsonb,
              changed_at = now(),
              online = coalesce(${online}::boolean, online),
              phone = CASE WHEN ${phoneGiven}::boolean THEN ${storedText(details.phone)}::text ELSE phone END,
              company = CASE WHEN ${companyGiven}::boolean THEN ${storedText(details.company)}::text ELSE company END
            WHERE event_id = ${event} AND ${own}
            RETURNING id
          `;
          if (changed.length === 0) return yield* new SignupNotFound({});
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, Effect.die),
        );
      }, Effect.uninterruptible);

      const remove = Effect.fn("Attendance.remove")(function* (
        attendee: string,
      ) {
        const found = yield* Effect.gen(function* () {
          const [removed] = yield* sql<
            Signup & {
              readonly event_id: DocumentId;
              readonly upcoming: boolean;
            }
          >`
            DELETE FROM attendees a USING events e
            WHERE a.id = ${attendee} AND e.id = a.event_id
            RETURNING ${signupColumns(sql, "a")}, a.event_id,
              e.ends_at > now() AS upcoming
          `;
          if (removed === undefined) return false;
          // HubSpot hears of it whenever it happens, the event over or not.
          yield* tellCancelled(removed.event_id, [removed]);
          // Taken off what's still to come: told, and out of their calendar.
          if (removed.upcoming) {
            yield* tell([removed], (recipient) =>
              notifications.signupRemoved({
                event: removed.event_id,
                attendee: recipient,
              }),
            );
          }
          return true;
        }).pipe(sql.withTransaction, Effect.orDie);
        if (!found) return yield* new SignupNotFound({});
      }, Effect.uninterruptible);

      const dietaryPreferences = Effect.fn("Attendance.dietaryPreferences")(
        function* (event: DocumentId) {
          const rows = yield* sql<{ text: string }>`
            SELECT text FROM dietary_preferences WHERE event_id = ${event}
            -- By the text, never the order given: that would match the signups'.
            ORDER BY lower(text), text
          `.pipe(Effect.orDie);
          return rows.map((row) => row.text);
        },
      );

      return Attendance.of({
        attend,
        leave,
        attendAsGuest,
        leaveAsGuest,
        requestCancel,
        cancelLink,
        confirmCancel,
        cancelLinkToken: cancelLinkTokenFor,
        guestSignup,
        change,
        remove,
        dietaryPreferences,
        guestToken: guestTokenFor,
      });
    }),
  );
}
