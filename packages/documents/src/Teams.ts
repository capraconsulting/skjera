import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { InvalidTeamName, TeamNotEmpty, TeamNotFound } from "./errors.ts";
import { Team, type TeamId } from "./Model.ts";

type Row = {
  id: TeamId;
  name: string;
  created_at: Date;
  document_count: number;
};

const toTeam = (row: Row) =>
  new Team({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    documentCount: row.document_count,
  });

const pgCode = (error: SqlError.SqlError) =>
  (error.reason as { cause?: { code?: string } }).cause?.code;

/** Teams own documents. Every signed-in user sees all of them. */
export class Teams extends Context.Service<
  Teams,
  {
    readonly get: (id: TeamId) => Effect.Effect<Team, TeamNotFound>;
    readonly create: (
      name: string,
      creator: Identity,
    ) => Effect.Effect<Team, InvalidTeamName>;
    readonly rename: (
      id: TeamId,
      name: string,
    ) => Effect.Effect<Team, InvalidTeamName | TeamNotFound>;
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

      const get = Effect.fn("Teams.get")(function* (id: TeamId) {
        const [row] = yield* sql<Row>`
          SELECT id, name, created_at,
          (SELECT count(*)::int FROM documents WHERE team_id = teams.id) AS document_count
          FROM teams WHERE id = ${id}
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new TeamNotFound({ id });
        }
        return toTeam(row);
      });

      const validName = (name: string) => {
        const trimmed = name.trim();
        return trimmed === "" || trimmed.length > 100
          ? Effect.fail(
              new InvalidTeamName({
                message: "A team name needs 1 to 100 characters",
              }),
            )
          : Effect.succeed(trimmed);
      };

      const nameTaken = (name: string) => (error: SqlError.SqlError) =>
        pgCode(error) === "23505"
          ? Effect.fail(
              new InvalidTeamName({
                message: `There is already a team called ${name}`,
              }),
            )
          : Effect.die(error);

      const create = Effect.fn("Teams.create")(function* (
        name: string,
        creator: Identity,
      ) {
        const trimmed = yield* validName(name);
        const [row] = yield* sql<Row>`
          INSERT INTO teams (name, created_by_issuer, created_by_subject)
          VALUES (${trimmed}, ${creator.issuer}, ${creator.subject})
          RETURNING id, name, created_at,
          (SELECT count(*)::int FROM documents WHERE team_id = teams.id) AS document_count
        `.pipe(Effect.catchIf(SqlError.isSqlError, nameTaken(trimmed)));
        if (row === undefined) {
          return yield* Effect.die("INSERT returned no row");
        }
        return toTeam(row);
      });

      const rename = Effect.fn("Teams.rename")(function* (
        id: TeamId,
        name: string,
      ) {
        const trimmed = yield* validName(name);
        const [row] = yield* sql<Row>`
          UPDATE teams SET name = ${trimmed} WHERE id = ${id}
          RETURNING id, name, created_at,
          (SELECT count(*)::int FROM documents WHERE team_id = teams.id) AS document_count
        `.pipe(Effect.catchIf(SqlError.isSqlError, nameTaken(trimmed)));
        if (row === undefined) {
          return yield* new TeamNotFound({ id });
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

      return Teams.of({ get, create, rename, delete: deleteTeam });
    }),
  );
}
