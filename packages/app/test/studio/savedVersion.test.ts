import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { savedVersion } from "../../src/documents/savedVersion.ts";

/** `effect` on a clock the test moves, so the seconds don't take real time. */
const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(TestClock.layer())) as Effect.Effect<A, E>,
  );

/** A local copy the server has all of once `arrive` is called. */
const copy = () => {
  let saved = false;
  return {
    arrive: () => {
      saved = true;
    },
    saved: () => saved,
    version: () => ["head"] as never,
  };
};

describe("savedVersion", () => {
  it("has not failed at 9.9 seconds, and at 10 seconds fails with the message given (STU-17 AC-6)", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(
          Effect.flip(savedVersion(copy(), () => "not saved yet")),
        );
        yield* TestClock.adjust("9900 millis");
        const early = waiting.pollUnsafe();
        yield* TestClock.adjust("100 millis");
        return { early, error: yield* Fiber.join(waiting) };
      }),
    );
    expect(outcome.early).toBeUndefined();
    expect(outcome.error).toEqual(new Error("not saved yet"));
  });

  it("succeeds with the version then saved when the edits arrive within 10 seconds (STU-17 AC-6)", async () => {
    const arriving = copy();
    const version = await run(
      Effect.gen(function* () {
        const waiting = yield* Effect.forkChild(
          savedVersion(arriving, () => "not saved yet"),
        );
        yield* TestClock.adjust("4 seconds");
        arriving.arrive();
        yield* TestClock.adjust("1 second");
        return yield* Fiber.join(waiting);
      }),
    );
    expect(version).toEqual(["head"]);
  });
});
