import { createHash, randomBytes } from "node:crypto";
import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { EventNotFound, SignupNotFound, SignupRejected } from "./errors.ts";
import type { Audience, DocumentId, GuestDetails } from "./Model.ts";

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
      dietary?: string,
      id?: string,
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
      dietary?: string,
      id?: string,
    ) => Effect.Effect<string, EventNotFound | SignupRejected>;
    readonly leaveAsGuest: (
      event: DocumentId,
      cancelToken: string,
    ) => Effect.Effect<void, SignupNotFound | SignupRejected>;
  }
>()("@skjera/documents/Attendance") {
  static readonly layer = Layer.effect(
    Attendance,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const closed = new SignupRejected({
        message: "Sign-up for this event has closed",
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
          open: boolean;
        }>`
          SELECT allow_guests, ask_dietary,
            coalesce(signup_deadline, starts_at) > now() AS open
          FROM events
          WHERE id = ${event} AND (is_public OR ${audience === "members"})
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new EventNotFound({ id: event });
        }
        if (!row.open) return yield* closed;
        return {
          allowGuests: row.allow_guests,
          askDietary: row.ask_dietary,
        };
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
        id?: string,
      ) {
        const { askDietary } = yield* rules(event, "members");
        const dietary = yield* dietaryFor(askDietary, dietaryValue);
        // Already signed up, or a retry: nothing to do.
        yield* sql`
          INSERT INTO attendees (id, event_id, user_issuer, user_subject, name, email, dietary)
          VALUES (coalesce(${id ?? null}::uuid, uuidv7()), ${event}, ${user.issuer},
            ${user.subject}, ${user.name ?? user.email ?? user.subject},
            ${user.email ?? null}, ${dietary})
          ON CONFLICT DO NOTHING
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
        id?: string,
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
          INSERT INTO attendees (id, event_id, name, email, dietary, cancel_token_hash)
          VALUES (coalesce(${id ?? null}::uuid, uuidv7()), ${event}, ${guest.name.trim()},
            ${guest.email.trim()}, ${dietary}, ${hash(token)})
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
        const [found] = yield* sql<{ open: boolean }>`
          SELECT coalesce(e.signup_deadline, e.starts_at) > now() AS open
          FROM attendees a JOIN events e ON e.id = a.event_id
          WHERE a.event_id = ${event} AND a.cancel_token_hash = ${hash(cancelToken)}
        `.pipe(Effect.orDie);
        if (found === undefined) return yield* new SignupNotFound({});
        if (!found.open) return yield* closed;
        yield* sql`
          DELETE FROM attendees
          WHERE event_id = ${event} AND cancel_token_hash = ${hash(cancelToken)}
        `.pipe(Effect.orDie);
      });

      return Attendance.of({
        attend,
        leave,
        attendAsGuest,
        leaveAsGuest,
      });
    }),
  );
}
