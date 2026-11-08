import { assert, describe, it } from "@effect/vitest";
import type { SqlError } from "effect/sql";
import { pgCode, pgMessage } from "../../src/server/PostgresError.ts";

const error = (cause: unknown, message = "query failed") =>
  ({ reason: { cause }, message }) as SqlError.SqlError;

describe("Postgres errors", () => {
  it("reads SQLSTATE from the driver cause (AC-5)", () => {
    assert.strictEqual(pgCode(error({ code: "23505" })), "23505");
    assert.isUndefined(pgCode(error({})));
  });

  it("reads the driver message and falls back to the SQL error message (AC-5)", () => {
    assert.strictEqual(
      pgMessage(error({ message: "duplicate key" })),
      "duplicate key",
    );
    assert.strictEqual(pgMessage(error({}, "query failed")), "query failed");
  });
});
