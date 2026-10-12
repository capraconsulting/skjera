import { createHash, createHmac, randomBytes } from "node:crypto";
import type { Identity } from "@skjera/oauth/api";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import { SqlClient, SqlError, type Statement } from "effect/sql";
import { EventNotFound, SignupNotFound, SignupRejected } from "./errors.ts";
import type {
  Answer,
  Answers,
  Audience,
  DocumentId,
  GuestDetails,
  Locale,
  Question,
} from "./Model.ts";
import { Notifications, type Signup, tell } from "./Notifications.ts";
import { type Problem, refused } from "./Problems.ts";

/** What someone signing up tells, besides who they are. */
export interface SignupDetails {
  /** Required while the event asks for it (until its food deadline). */
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
}

/**
 * Answers checked against the questions, in the words asked and picked:
 * what is stored with the signup. Answers to other questions are ignored.
 */
export const answersFor = (
  questions: ReadonlyArray<Question>,
  answers: Answers = {},
): Effect.Effect<ReadonlyArray<Answer>, SignupRejected> => {
  const stored: Array<Answer> = [];
  for (const question of questions) {
    const value = answers[question.id];
    const reject = (problem: Problem) =>
      Effect.fail(new SignupRejected(refused(problem)));
    switch (question.type) {
      case "text": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text.length > 1000) {
          return reject({ _tag: "AnswerTooLong", question: question.text });
        }
        if (text === "" && question.required) {
          return reject({ _tag: "AnswerMissing", question: question.text });
        }
        if (text !== "") {
          stored.push({
            id: question.id,
            question: question.text,
            answer: text,
            value: text,
          });
        }
        break;
      }
      case "checkbox": {
        const ticked = value === true;
        if (!ticked && question.required) {
          return reject({ _tag: "TickMissing", question: question.text });
        }
        stored.push({
          id: question.id,
          question: question.text,
          answer: ticked ? "Yes" : "No",
          value: ticked,
        });
        break;
      }
      case "choice": {
        const option = question.options.find((each) => each.id === value);
        if (option === undefined && value !== undefined && value !== "") {
          return reject({ _tag: "AnswerUnknown", question: question.text });
        }
        if (option === undefined && question.required) {
          return reject({ _tag: "AnswerMissing", question: question.text });
        }
        if (option !== undefined) {
          stored.push({
            id: question.id,
            question: question.text,
            answer: option.text,
            value: option.id,
          });
        }
        break;
      }
    }
  }
  return Effect.succeed(stored);
};

/** What a typed optional text is kept as: trimmed, and nothing when blank. */
const storedText = (text: string | undefined) => text?.trim() || null;

const hash = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

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
     * Signs a member up. Signing up twice is fine. `dietary` is required
     * when the event asks for it, and ignored otherwise.
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
    readonly leaveAsGuest: (
      event: DocumentId,
      cancelToken: string,
    ) => Effect.Effect<void, SignupNotFound | SignupRejected>;
    /**
     * Changes a signup's answers, and its dietary preferences while the
     * event still asks for them, until the sign-up deadline. A member's
     * signup is theirs; a guest's goes with its cancel token.
     */
    readonly change: (
      event: DocumentId,
      who: { readonly user: Identity } | { readonly cancelToken: string },
      details: SignupDetails,
    ) => Effect.Effect<void, EventNotFound | SignupNotFound | SignupRejected>;
    /** Takes someone off an event, as its organizers: any time. */
    readonly remove: (attendee: string) => Effect.Effect<void, SignupNotFound>;
    /**
     * The token a guest changes and cancels their signup with: derived from
     * it, so it can be put in emails sent later, though only its hash is
     * stored.
     */
    readonly guestToken: (attendee: string) => string;
  }
>()("@skjera/documents/Attendance") {
  /**
   * Guests' tokens are signed with `SIGNING_SECRET`. Without it, with a
   * secret made up at start, and a warning: links sent before a restart
   * stop working (tokens guests' browsers keep don't).
   */
  static readonly layer = Layer.effect(
    Attendance,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const secret = yield* Config.Redacted("SIGNING_SECRET").pipe(
        Config.option,
        Effect.flatMap(
          Option.match({
            onSome: Effect.succeed,
            onNone: () =>
              Effect.as(
                Effect.logWarning(
                  "SIGNING_SECRET not set: guests' links in emails stop working on restart",
                ),
                Redacted.make(randomBytes(32).toString("base64url")),
              ),
          }),
        ),
      );
      const guestToken = (attendee: string) =>
        createHmac("sha256", Redacted.value(secret))
          .update(`guest-signup/${attendee}`)
          .digest("base64url");

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
          questions: ReadonlyArray<Question>;
          streamed: boolean;
          open: boolean;
        }>`
          SELECT allow_guests, questions, is_streamed AS streamed,
            -- After the food deadline, people can still come; not eat.
            ask_dietary AND coalesce(food_deadline > now(), true) AS ask_dietary,
            coalesce(signup_deadline, starts_at) > now() AS open
          FROM events
          WHERE id = ${event} AND (is_public OR ${audience === "members"})
            AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new EventNotFound({ id: event });
        }
        if (!row.open) return yield* closed;
        return {
          allowGuests: row.allow_guests,
          askDietary: row.ask_dietary,
          questions: row.questions,
          streamed: row.streamed,
        };
      });

      /** What to store for dietary preferences, given the event's rules. */
      const dietaryFor = (askDietary: boolean, value: string | undefined) => {
        if (!askDietary) return Effect.succeed(null);
        const dietary = (value ?? "").trim();
        return dietary === "" || dietary.length > 500
          ? Effect.fail(new SignupRejected(refused({ _tag: "DietaryMissing" })))
          : Effect.succeed(dietary);
      };

      /** Whether they follow online: asked only while the event is streamed. */
      const onlineFor = (streamed: boolean, value: boolean | undefined) =>
        !streamed
          ? Effect.succeed(false)
          : value === undefined
            ? Effect.fail(
                new SignupRejected(refused({ _tag: "AttendanceMissing" })),
              )
            : Effect.succeed(value);

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
          // Already signed up, or a retry: nothing to do, or tell.
          const inserted = yield* sql<Signup>`
            INSERT INTO attendees (id, event_id, user_issuer, user_subject, name, email, dietary, answers, online, locale)
            VALUES (coalesce(${id ?? null}::uuid, uuidv7()), ${event}, ${user.issuer},
              ${user.subject}, ${user.name ?? user.email ?? user.subject},
              ${user.email ?? null}, ${dietary}, ${JSON.stringify(answers)}::jsonb,
              ${online}, ${details.locale ?? null})
            ON CONFLICT DO NOTHING
            RETURNING id, name, email, false AS guest, locale
          `;
          yield* tell(inserted, (attendee) =>
            notifications.signedUp({ event, attendee }),
          );
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, Effect.die),
        );
      });

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
            RETURNING id, name, email, false AS guest, locale
          `;
          yield* tell(deleted, (attendee) =>
            notifications.signupCancelled({ event, attendee }),
          );
        }).pipe(sql.withTransaction, Effect.orDie);
      });

      const attendAsGuest = Effect.fn("Attendance.attendAsGuest")(function* (
        event: DocumentId,
        guest: GuestDetails,
        details: SignupDetails = {},
      ) {
        const { allowGuests, askDietary, questions, streamed } = yield* rules(
          event,
          "anyone",
        );
        if (!allowGuests) {
          return yield* new SignupRejected(
            refused({ _tag: "GuestsNotAllowed" }),
          );
        }
        const dietary = yield* dietaryFor(askDietary, details.dietary);
        const answers = yield* answersFor(questions, details.answers);
        const online = yield* onlineFor(streamed, details.online);
        const id = details.id;
        const attendee = id ?? crypto.randomUUID();
        const token = guestToken(attendee);
        yield* Effect.gen(function* () {
          yield* room(event, online, sql`false`);
          const inserted = yield* sql<Signup>`
            INSERT INTO attendees (id, event_id, name, email, phone, company, dietary, answers, cancel_token_hash, online, locale)
            VALUES (${attendee}::uuid, ${event}, ${guest.name.trim()},
              ${guest.email.trim()}, ${storedText(guest.phone)}, ${storedText(guest.company)},
              ${dietary}, ${JSON.stringify(answers)}::jsonb, ${hash(token)},
              ${online}, ${details.locale ?? null})
            RETURNING id, name, email, true AS guest, locale
          `;
          yield* tell(inserted, (attendee) =>
            notifications.signedUp({ event, attendee }),
          );
        }).pipe(
          sql.withTransaction,
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23505"
              ? Effect.fail(new SignupRejected(refused({ _tag: "EmailTaken" })))
              : Effect.die(error),
          ),
        );
        return token;
      });

      const leaveAsGuest = Effect.fn("Attendance.leaveAsGuest")(function* (
        event: DocumentId,
        cancelToken: string,
      ) {
        const [found] = yield* sql<{ open: boolean }>`
          SELECT coalesce(e.signup_deadline, e.starts_at) > now() AS open
          FROM attendees a JOIN events e ON e.id = a.event_id
          WHERE a.event_id = ${event} AND a.cancel_token_hash = ${hash(cancelToken)}
            AND e.deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (found === undefined) return yield* new SignupNotFound({});
        if (!found.open) return yield* closed;
        yield* Effect.gen(function* () {
          const deleted = yield* sql<Signup>`
            DELETE FROM attendees
            WHERE event_id = ${event} AND cancel_token_hash = ${hash(cancelToken)}
            RETURNING id, name, email, true AS guest, locale
          `;
          yield* tell(deleted, (attendee) =>
            notifications.signupCancelled({ event, attendee }),
          );
        }).pipe(sql.withTransaction, Effect.orDie);
      });

      const change = Effect.fn("Attendance.change")(function* (
        event: DocumentId,
        who: { readonly user: Identity } | { readonly cancelToken: string },
        details: SignupDetails,
      ) {
        const { askDietary, questions, streamed } = yield* rules(
          event,
          "user" in who ? "members" : "anyone",
        );
        const dietary = yield* dietaryFor(askDietary, details.dietary);
        const answers = yield* answersFor(questions, details.answers);
        const own =
          "user" in who
            ? sql`user_issuer = ${who.user.issuer} AND user_subject = ${who.user.subject}`
            : sql`cancel_token_hash = ${hash(who.cancelToken)}`;
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
        yield* Effect.gen(function* () {
          // A place in person is taken: the event's row is locked first.
          if (online === false) yield* room(event, false, own);
          const changed = yield* sql`
            UPDATE attendees SET
              answers = ${JSON.stringify(answers)}::jsonb,
              changed_at = now(),
              -- Kept as given once the event stops asking.
              dietary = CASE WHEN ${askDietary}::boolean THEN ${dietary}::text ELSE dietary END,
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
      });

      const remove = Effect.fn("Attendance.remove")(function* (
        attendee: string,
      ) {
        const removed = yield* sql`
          DELETE FROM attendees WHERE id = ${attendee} RETURNING id
        `.pipe(Effect.orDie);
        if (removed.length === 0) return yield* new SignupNotFound({});
      });

      return Attendance.of({
        attend,
        leave,
        attendAsGuest,
        leaveAsGuest,
        change,
        remove,
        guestToken,
      });
    }),
  );
}
