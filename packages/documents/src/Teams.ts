import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import { InvalidTeamName, TeamNotEmpty, TeamNotFound } from "./errors.ts";
import { Team, type TeamId, type TeamLogosChange } from "./Model.ts";
import { refused } from "./Problems.ts";

type Row = {
  id: TeamId;
  name: string;
  logo: string | null;
  logo_dark: string | null;
  created_at: Date;
  document_count: number;
};

const toTeam = (row: Row) =>
  new Team({
    id: row.id,
    name: row.name,
    logo: row.logo,
    logoDark: row.logo_dark,
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
    /**
     * Creates a team, with `id` if given. Creating it again with the same
     * id returns it, so a client can safely retry.
     */
    readonly create: (
      name: string,
      creator: Identity,
      id?: TeamId,
    ) => Effect.Effect<Team, InvalidTeamName>;
    readonly rename: (
      id: TeamId,
      name: string,
    ) => Effect.Effect<Team, InvalidTeamName | TeamNotFound>;
    /** Sets the logos given, or removes them with null; leaves the others. */
    readonly setLogos: (
      id: TeamId,
      change: TeamLogosChange,
    ) => Effect.Effect<Team, TeamNotFound>;
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
          SELECT id, name, logo, logo_dark, created_at,
          (SELECT count(*)::int FROM documents
            WHERE team_id = teams.id AND deleted_at IS NULL) AS document_count
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
              new InvalidTeamName(refused({ _tag: "TeamNameLength" })),
            )
          : Effect.succeed(trimmed);
      };

      const nameTaken = (name: string) => (error: SqlError.SqlError) =>
        pgCode(error) === "23505"
          ? Effect.fail(
              new InvalidTeamName(refused({ _tag: "TeamNameTaken", name })),
            )
          : Effect.die(error);

      // Writes run to their end, even if the client that asked goes away.
      const create = Effect.fn("Teams.create")(function* (
        name: string,
        creator: Identity,
        id?: TeamId,
      ) {
        const trimmed = yield* validName(name);
        const [row] = yield* sql<Row>`
          INSERT INTO teams (id, name, created_by_issuer, created_by_subject)
          VALUES (coalesce(${id ?? null}::uuid, uuidv7()), ${trimmed},
            ${creator.issuer}, ${creator.subject})
          ON CONFLICT (id) DO NOTHING
          RETURNING id, name, logo, logo_dark, created_at,
          (SELECT count(*)::int FROM documents
            WHERE team_id = teams.id AND deleted_at IS NULL) AS document_count
        `.pipe(Effect.catchIf(SqlError.isSqlError, nameTaken(trimmed)));
        if (row !== undefined) return toTeam(row);
        // Created before, by an earlier try.
        if (id !== undefined) return yield* Effect.orDie(get(id));
        return yield* Effect.die("INSERT returned no row");
      }, Effect.uninterruptible);

      const rename = Effect.fn("Teams.rename")(function* (
        id: TeamId,
        name: string,
      ) {
        const trimmed = yield* validName(name);
        const [row] = yield* sql<Row>`
          UPDATE teams SET name = ${trimmed} WHERE id = ${id}
          RETURNING id, name, logo, logo_dark, created_at,
          (SELECT count(*)::int FROM documents
            WHERE team_id = teams.id AND deleted_at IS NULL) AS document_count
        `.pipe(Effect.catchIf(SqlError.isSqlError, nameTaken(trimmed)));
        if (row === undefined) {
          return yield* new TeamNotFound({ id });
        }
        return toTeam(row);
      }, Effect.uninterruptible);

      const setLogos = Effect.fn("Teams.setLogos")(function* (
        id: TeamId,
        change: TeamLogosChange,
      ) {
        const [row] = yield* sql<Row>`
          UPDATE teams SET
            logo = CASE WHEN ${"logo" in change} THEN ${change.logo ?? null} ELSE logo END,
            logo_dark = CASE WHEN ${"logoDark" in change} THEN ${change.logoDark ?? null} ELSE logo_dark END
          WHERE id = ${id}
          RETURNING id, name, logo, logo_dark, created_at,
          (SELECT count(*)::int FROM documents
            WHERE team_id = teams.id AND deleted_at IS NULL) AS document_count
        `.pipe(Effect.orDie);
        if (row === undefined) {
          return yield* new TeamNotFound({ id });
        }
        return toTeam(row);
      }, Effect.uninterruptible);

      const deleteTeam = Effect.fn("Teams.delete")(function* (id: TeamId) {
        const deleted = yield* Effect.gen(function* () {
          // Its deleted documents go with it; others keep it.
          yield* sql`
            DELETE FROM documents WHERE team_id = ${id} AND deleted_at IS NOT NULL
          `;
          return yield* sql`DELETE FROM teams WHERE id = ${id} RETURNING id`;
        }).pipe(
          sql.withTransaction,
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
      }, Effect.uninterruptible);

      return Teams.of({ get, create, rename, setLogos, delete: deleteTeam });
    }),
  );
}
