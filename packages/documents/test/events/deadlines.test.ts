import { assert, describe, it, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import {
  dietaryClosesAt,
  signupClosesAt,
} from "../../src/events/ContentTypes.ts";
import { dueDeadlines } from "../../src/notices/SlackChannel.ts";
import { publishedEvent, TestLayer } from "../helpers.ts";

describe("event deadlines", () => {
  it("uses the explicit sign-up deadline, or otherwise the start (AC-2)", () => {
    const start = { name: "start" };
    const deadline = { name: "deadline" };

    assert.strictEqual(signupClosesAt(deadline, start), deadline);
    assert.strictEqual(signupClosesAt(null, start), start);
    assert.isNull(signupClosesAt(null, null));
  });

  it("uses the food deadline, sign-up deadline, and start in order (AC-3, AC-4)", () => {
    const start = { name: "start" };
    const deadline = { name: "deadline" };
    const foodDeadline = { name: "food" };

    assert.strictEqual(
      dietaryClosesAt(foodDeadline, deadline, start),
      foodDeadline,
    );
    assert.strictEqual(dietaryClosesAt(null, deadline, start), deadline);
    assert.strictEqual(dietaryClosesAt(null, null, start), start);
    assert.isNull(dietaryClosesAt(null, null, null));
  });
});

layer(TestLayer, { excludeTestServices: true })(
  "database deadline copies",
  (it) => {
    it.effect(
      "uses the shared fallback in the reminder query and food constraint (AC-4)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const now = new Date("2036-10-14T17:00:00Z");
          const id = yield* publishedEvent({ public: true, guests: true });
          const [row] = yield* sql<{ starts_at: Date }>`
          SELECT starts_at FROM events WHERE id = ${id}
        `;
          assert.isDefined(row);
          const startsAt = row.starts_at;
          const due = (yield* dueDeadlines(now)).find(
            (event) => event.id === id,
          );

          assert.strictEqual(
            due?.deadline.getTime(),
            signupClosesAt(null, startsAt).getTime(),
          );

          const tooLate = new Date(startsAt.getTime() + 1);
          const rejected = yield* Effect.flip(
            sql`UPDATE events SET food_deadline = ${tooLate} WHERE id = ${id}`,
          );
          assert.isDefined(rejected);
        }),
    );
  },
);
