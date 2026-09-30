import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { InvalidTeamName, TeamNotEmpty, TeamNotFound } from "./errors.ts";
import { Team, type TeamId } from "./Model.ts";

type Row = { id: TeamId; name: string; created_at: Date };

const toTeam = (row: Row) =>
  new Team({ id: row.id, name: row.name, createdAt: row.created_at });

const pgCode = (error: SqlError.SqlError) =>
  (error.reason as { cause?: { code?: string } }).cause?.code;

/** Teams own documents. Every signed-in user sees all of them. */
export class Teams extends Context.Service<
  Teams,
  {
    /** Alphabetical. */
    readonly list: Effect.Effect<ReadonlyArray<Team>>;
    readonly get: (id: TeamId) => Effect.Effect<Team, TeamNotFound>;
    readonly create: (
      name: string,
      creator: Identity,
    ) => Effect.Effect<Team, InvalidTeamName>;
    /** Deletes a team that has no documents. */
    readonly delete: (
      id: TeamId,
    ) => Effect.Effect<void, TeamNotFound | TeamNotEmpty>;
  }
>()("@skjera/documents/Teams") {
  static readonly layer = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const list = sql<Row>`
        SELECT id, name, created_at FROM teams ORDER BY lower(name)
      `.pipe(
        Effect.map((rows) => rows.map(toTeam)),
        Effect.orDie,
        Effect.withSpan("Teams.list"),
      );

      const get = Effect.fn("Teams.get")(function* (id: TeamId) {
        const [row] = yield* sql<Row>`
          SELECT id, name, created_at FROM teams WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new TeamNotFound({ id });
        }
        return toTeam(row);
      });

      const create = Effect.fn("Teams.create")(function* (
        name: string,
        creator: Identity,
      ) {
        const trimmed = name.trim();
        if (trimmed === "" || trimmed.length > 100) {
          return yield* new InvalidTeamName({
            message: "A team name needs 1 to 100 characters",
          });
        }
        const [row] = yield* sql<Row>`
          INSERT INTO teams (name, created_by_issuer, created_by_subject)
          VALUES (${trimmed}, ${creator.issuer}, ${creator.subject})
          RETURNING id, name, created_at
        `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23505"
              ? Effect.fail(
                  new InvalidTeamName({
                    message: `There is already a team called ${trimmed}`,
                  }),
                )
              : Effect.die(error),
          ),
        );
        if (row === undefined) {
          return yield* Effect.die("INSERT returned no row");
        }
        return toTeam(row);
      });

      const deleteTeam = Effect.fn("Teams.delete")(function* (id: TeamId) {
        const deleted = yield* sql`
          DELETE FROM teams WHERE id = ${id} RETURNING id
        `.pipe(
          // Documents still reference the team (restrict_violation, or
          // foreign_key_violation for a NO ACTION reference).
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23001" || pgCode(error) === "23503"
              ? Effect.fail(new TeamNotEmpty({ id }))
              : Effect.die(error),
          ),
        );
        if (deleted.length === 0) {
          return yield* new TeamNotFound({ id });
        }
      });

      return Teams.of({ list, get, create, delete: deleteTeam });
    }),
  );
}
