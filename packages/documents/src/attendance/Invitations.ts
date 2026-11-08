import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { DocumentNotFound, InvitationRejected } from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import type { Invitation } from "../api/PublicApi.ts";
import { type DocumentId, isEmailAddress } from "../Model.ts";
import { pgCode } from "../server/PostgresError.ts";

/** Who organizers have noted as invited to an event. Nothing is sent to them. */
export class Invitations extends Context.Service<
  Invitations,
  {
    /** Notes someone as invited to an event, for its organizers: nothing is sent to anyone. */
    readonly invite: (
      event: DocumentId,
      person: { readonly name?: string; readonly email: string },
    ) => Effect.Effect<Invitation, DocumentNotFound | InvitationRejected>;
    /** Those noted as invited to an event, in the order they were added. */
    readonly invitations: (
      event: DocumentId,
    ) => Effect.Effect<ReadonlyArray<Invitation>>;
  }
>()("@skjera/documents/Invitations") {
  static readonly layer = Layer.effect(
    Invitations,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const invite = Effect.fn("Invitations.invite")(function* (
        event: DocumentId,
        person: { readonly name?: string; readonly email: string },
      ) {
        const email = person.email.trim();
        if (!isEmailAddress(email)) {
          return yield* new InvitationRejected(
            refused({ _tag: "InvitedEmailInvalid" }),
          );
        }
        const name = (person.name ?? "").trim();
        // For any event in the studio, published or not.
        const [row] = yield* sql<Invitation>`
            INSERT INTO invitations (event_id, name, email)
            SELECT id, ${name === "" ? null : name}, ${email}
            FROM documents
            WHERE id = ${event} AND type = 'event' AND deleted_at IS NULL
            RETURNING id, name, email, invited_at AS "invitedAt"
          `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23505"
              ? Effect.fail(
                  new InvitationRejected(
                    refused({ _tag: "AlreadyInvited", email }),
                  ),
                )
              : Effect.die(error),
          ),
        );
        if (row === undefined) {
          return yield* new DocumentNotFound({ id: event });
        }
        return row;
      }, Effect.uninterruptible);

      const invitations = Effect.fn("Invitations.invitations")(function* (
        event: DocumentId,
      ) {
        return yield* sql<Invitation>`
          SELECT id, name, email, invited_at AS "invitedAt" FROM invitations
          WHERE event_id = ${event}
          ORDER BY invited_at, id
        `.pipe(Effect.orDie);
      });

      return Invitations.of({ invite, invitations });
    }),
  );
}
