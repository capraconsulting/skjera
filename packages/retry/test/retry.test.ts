import { assert, it } from "@effect/vitest";
import { Effect, Exit, Ref } from "effect";
import { retryTransient } from "../src/index.ts";

class Transient {
  readonly _tag = "Transient";
}

class Permanent {
  readonly _tag = "Permanent";
}

it.effect("retries transient failures with calculated delays (AC-3)", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const delays = yield* Ref.make<ReadonlyArray<number>>([]);
    const value = yield* Effect.gen(function* () {
      const attempt = yield* Ref.getAndUpdate(attempts, (n) => n + 1);
      if (attempt < 2) return yield* Effect.fail(new Transient());
      return "done";
    }).pipe(
      retryTransient({
        times: 2,
        retryable: (error): error is Transient => error instanceof Transient,
        delay: (_error, attempt) => attempt + 1,
        sleep: (delay) =>
          Ref.update(delays, (all) => [...all, delay as number]),
      }),
    );

    assert.strictEqual(value, "done");
    assert.strictEqual(yield* Ref.get(attempts), 3);
    assert.deepStrictEqual(yield* Ref.get(delays), [1, 2]);
  }),
);

it.effect("does not retry permanent failures (AC-3)", () =>
  Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const result = yield* Effect.gen(function* () {
      yield* Ref.update(attempts, (n) => n + 1);
      return yield* Effect.fail(new Permanent());
    }).pipe(
      retryTransient({
        retryable: (error): error is Transient => error instanceof Transient,
        delay: () => 0,
      }),
      Effect.exit,
    );

    assert.isTrue(Exit.isFailure(result));
    assert.strictEqual(yield* Ref.get(attempts), 1);
  }),
);
