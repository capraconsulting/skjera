import { randomBytes } from "node:crypto";
import { PgClient } from "@effect/sql-pg";
import { assert, layer } from "@effect/vitest";
import { Effect, Redacted } from "effect";
import { Migrator, SqlClient } from "effect/sql";
import { migrations } from "../../src/server/migrations.ts";
import { UnmigratedTestDatabase } from "../TestDatabase.ts";

// Reproduce CNPG: an administrator installs the extension, then an ordinary
// application connection migrates its own tables without owning the extension.
layer(UnmigratedTestDatabase, { excludeTestServices: true })(
  "Managed extension migrations",
  (it) => {
    it.effect(
      "skips a redundant extension upgrade without requiring extension ownership",
      () =>
        Effect.gen(function* () {
          const admin = yield* SqlClient.SqlClient;
          const role = `skjera_migration_${randomBytes(8).toString("hex")}`;
          const password = randomBytes(24).toString("hex");
          yield* admin`CREATE EXTENSION IF NOT EXISTS pg_automerge`;
          const [before] = yield* admin<{ owner: string; database: string }>`
        SELECT pg_get_userbyid(extowner) AS owner, current_database() AS database
        FROM pg_extension WHERE extname = 'pg_automerge'
      `;
          assert.isDefined(before);
          if (!before) return;
          const url = new URL(
            process.env.DATABASE_URL ??
              "postgres://skjera:skjera@localhost:5433/skjera",
          );
          url.username = role;
          url.password = password;
          url.pathname = `/${before.database}`;
          yield* Effect.acquireUseRelease(
            admin.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`),
            () =>
              Effect.gen(function* () {
                yield* admin.unsafe(
                  `GRANT USAGE, CREATE ON SCHEMA public TO ${role}`,
                );
                yield* Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient;
                  const [current] = yield* sql<{
                    rolsuper: boolean;
                  }>`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`;
                  assert.strictEqual(current?.rolsuper, false);
                  yield* Migrator.make({})({
                    loader: Effect.map(migrations, (all) =>
                      all.filter(([id]) => id <= 8),
                    ),
                  });
                  const [after] = yield* sql<{ owner: string }>`
              SELECT pg_get_userbyid(extowner) AS owner FROM pg_extension WHERE extname = 'pg_automerge'
            `;
                  assert.strictEqual(after?.owner, before.owner);
                }).pipe(
                  Effect.provide(
                    PgClient.layer({ url: Redacted.make(url.href) }),
                  ),
                );
              }),
            () =>
              Effect.gen(function* () {
                yield* admin.unsafe(`DROP OWNED BY ${role} CASCADE`);
                yield* admin.unsafe(`DROP ROLE ${role}`);
              }).pipe(Effect.orDie),
          );
        }),
    );
  },
);
