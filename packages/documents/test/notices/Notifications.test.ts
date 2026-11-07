import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { signupColumns } from "../../src/notices/Notifications.ts";
import { TestDatabase } from "../TestDatabase.ts";

layer(TestDatabase, { excludeTestServices: true })("signupColumns", (it) => {
  it.effect("selects the sign-up fields without an alias (AC-3)", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        SELECT ${signupColumns(sql)}
        FROM (VALUES ('id', 'Gina', 'gina@example.org', NULL, 'nb'))
          AS attendees(id, name, email, user_issuer, locale)
      `;
      assert.deepStrictEqual(rows, [
        {
          id: "id",
          name: "Gina",
          email: "gina@example.org",
          guest: true,
          locale: "nb",
        },
      ]);
    }),
  );

  it.effect("selects the sign-up fields with an alias (AC-3)", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        SELECT ${signupColumns(sql, "a")}
        FROM (VALUES ('id', 'Gina', 'gina@example.org', NULL, 'nb'))
          AS a(id, name, email, user_issuer, locale)
      `;
      assert.deepStrictEqual(rows, [
        {
          id: "id",
          name: "Gina",
          email: "gina@example.org",
          guest: true,
          locale: "nb",
        },
      ]);
    }),
  );
});
