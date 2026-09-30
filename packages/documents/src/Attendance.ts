import { createHash, randomBytes } from "node:crypto";
import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer, Option } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { EventNotFound, SignupNotFound, SignupRejected } from "./errors.ts";
import {
  Attendee,
  type DocumentId,
  EventAttendance,
  type GuestDetails,
} from "./Model.ts";
import type { Audience } from "./PublishedEvents.ts";

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
    /** How many are coming, and whether `user` is. */
    readonly summary: (
      event: DocumentId,
      user: Option.Option<Identity>,
    ) => Effect.Effect<EventAttendance, EventNotFound>;
    /** Signs a member up. Signing up twice is fine. */
    /**
     * Signs a member up. Signing up twice is fine. `dietary` is required
     * when the event asks for it, and ignored otherwise.
     */
    readonly attend: (
      event: DocumentId,
      user: Identity,
      dietary?: string,
    ) => Effect.Effect<void, EventNotFound | SignupRejected>;
    readonly leave: (
      event: DocumentId,
      user: Identity,
    ) => Effect.Effect<void, EventNotFound>;
    /** Signs a guest up, returning the token that cancels the signup. */
    readonly attendAsGuest: (
      event: DocumentId,
      guest: GuestDetails,
      dietary?: string,
    ) => Effect.Effect<string, EventNotFound | SignupRejected>;
    readonly leaveAsGuest: (
      event: DocumentId,
      cancelToken: string,
    ) => Effect.Effect<void, SignupNotFound>;
    /** Everyone coming, earliest signup first; for organizers. */
    readonly list: (
      event: DocumentId,
    ) => Effect.Effect<ReadonlyArray<Attendee>>;
  }
>()("@skjera/documents/Attendance") {
  static readonly layer = Layer.effect(
    Attendance,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      /** The event's signup rules, if the audience may see it. */
      const rules = Effect.fn(function* (
        event: DocumentId,
        audience: Audience,
      ) {
        const [row] = yield* sql<{
          allow_guests: boolean;
          ask_dietary: boolean;
        }>`
          SELECT allow_guests, ask_dietary FROM events
          WHERE id = ${event} AND (is_public OR ${audience === "members"})
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new EventNotFound({ id: event });
        }
        return {
          allowGuests: row.allow_guests,
          askDietary: row.ask_dietary,
        };
      });

      const summary = Effect.fn("Attendance.summary")(function* (
        event: DocumentId,
        user: Option.Option<Identity>,
      ) {
        yield* rules(event, Option.isSome(user) ? "members" : "anyone");
        const issuer = Option.match(user, {
          onNone: () => null,
          onSome: (identity) => identity.issuer,
        });
        const subject = Option.match(user, {
          onNone: () => null,
          onSome: (identity) => identity.subject,
        });
        const [row] = yield* sql<{ count: number; attending: boolean }>`
          SELECT count(*)::int AS count,
            coalesce(bool_or(user_issuer = ${issuer} AND user_subject = ${subject}), false)
              AS attending
          FROM attendees WHERE event_id = ${event}
        `.pipe(Effect.orDie);
        return new EventAttendance({
          count: row?.count ?? 0,
          attending: row?.attending ?? false,
        });
      });

      /** What to store for dietary preferences, given the event's rules. */
      const dietaryFor = (askDietary: boolean, value: string | undefined) => {
        if (!askDietary) return Effect.succeed(null);
        const dietary = (value ?? "").trim();
        return dietary === "" || dietary.length > 500
          ? Effect.fail(
              new SignupRejected({
                message: 'Tell us your dietary preferences, or write "none"',
              }),
            )
          : Effect.succeed(dietary);
      };

      const attend = Effect.fn("Attendance.attend")(function* (
        event: DocumentId,
        user: Identity,
        dietaryValue?: string,
      ) {
        const { askDietary } = yield* rules(event, "members");
        const dietary = yield* dietaryFor(askDietary, dietaryValue);
        yield* sql`
          INSERT INTO attendees (event_id, user_issuer, user_subject, name, email, dietary)
          VALUES (${event}, ${user.issuer}, ${user.subject},
            ${user.name ?? user.email ?? user.subject}, ${user.email ?? null}, ${dietary})
          ON CONFLICT (event_id, user_issuer, user_subject)
            WHERE user_issuer IS NOT NULL DO NOTHING
        `.pipe(Effect.orDie);
      });

      const leave = Effect.fn("Attendance.leave")(function* (
        event: DocumentId,
        user: Identity,
      ) {
        yield* rules(event, "members");
        yield* sql`
          DELETE FROM attendees
          WHERE event_id = ${event}
            AND user_issuer = ${user.issuer} AND user_subject = ${user.subject}
        `.pipe(Effect.orDie);
      });

      const attendAsGuest = Effect.fn("Attendance.attendAsGuest")(function* (
        event: DocumentId,
        guest: GuestDetails,
        dietaryValue?: string,
      ) {
        const { allowGuests, askDietary } = yield* rules(event, "anyone");
        if (!allowGuests) {
          return yield* new SignupRejected({
            message: "Log in to sign up for this event",
          });
        }
        const dietary = yield* dietaryFor(askDietary, dietaryValue);
        const token = randomBytes(32).toString("base64url");
        yield* sql`
          INSERT INTO attendees (event_id, name, email, dietary, cancel_token_hash)
          VALUES (${event}, ${guest.name.trim()}, ${guest.email.trim()}, ${dietary},
            ${hash(token)})
        `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23505"
              ? Effect.fail(
                  new SignupRejected({
                    message: "That email is already signed up for this event",
                  }),
                )
              : Effect.die(error),
          ),
        );
        return token;
      });

      const leaveAsGuest = Effect.fn("Attendance.leaveAsGuest")(function* (
        event: DocumentId,
        cancelToken: string,
      ) {
        const deleted = yield* sql`
          DELETE FROM attendees
          WHERE event_id = ${event} AND cancel_token_hash = ${hash(cancelToken)}
          RETURNING id
        `.pipe(Effect.orDie);
        if (deleted.length === 0) {
          return yield* new SignupNotFound({});
        }
      });

      const list = Effect.fn("Attendance.list")(function* (event: DocumentId) {
        const rows = yield* sql<{
          name: string;
          email: string | null;
          dietary: string | null;
          guest: boolean;
          created_at: Date;
        }>`
          SELECT name, email, dietary, user_issuer IS NULL AS guest, created_at
          FROM attendees WHERE event_id = ${event}
          ORDER BY created_at
        `.pipe(Effect.orDie);
        return rows.map(
          (row) =>
            new Attendee({
              name: row.name,
              email: row.email,
              dietary: row.dietary,
              guest: row.guest,
              signedUpAt: row.created_at,
            }),
        );
      });

      return Attendance.of({
        summary,
        attend,
        leave,
        attendAsGuest,
        leaveAsGuest,
        list,
      });
    }),
  );
}
