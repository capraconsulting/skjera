import { ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import {
  type AttemptKind,
  SignupLimits,
  visitorAddress,
} from "../src/signupLimits.ts";

/** Who is attempting: the socket's address, what the proxy appended, the browser. */
interface Visitor {
  readonly socket?: string;
  readonly forwardedFor?: string;
  readonly browser?: string;
}

const requestOf = ({
  socket = "10.0.0.2",
  forwardedFor,
  browser = "Firefox",
}: Visitor) =>
  HttpServerRequest.fromWeb(
    new Request("http://localhost/api/events/e/attendance", {
      headers: {
        "user-agent": browser,
        ...(forwardedFor === undefined
          ? {}
          : { "x-forwarded-for": forwardedFor }),
      },
    }),
  ).modify({ remoteAddress: Option.some(socket) });

/** Runs `program` with limits read from `settings`, on a clock that only moves when told. */
const run = <A, E>(
  settings: Record<string, string>,
  program: Effect.Effect<
    A,
    E,
    SignupLimits | HttpServerRequest.HttpServerRequest
  >,
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(
        SignupLimits.layer.pipe(
          Layer.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown(settings)),
          ),
        ),
      ),
      Effect.provide(TestClock.layer()),
    ) as Effect.Effect<A, E>,
  );

/** One attempt by `visitor`: whether `effect` ran or the attempt was refused. */
const attempt = (
  kind: AttemptKind,
  visitor: Visitor,
  effect: Effect.Effect<void> = Effect.void,
) =>
  Effect.gen(function* () {
    const limits = yield* SignupLimits;
    return yield* effect.pipe(
      limits.attempt(kind),
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        requestOf(visitor),
      ),
      Effect.as("ran" as const),
      Effect.catchTag("TooManyAttempts", () =>
        Effect.succeed("refused" as const),
      ),
    );
  });

/** The outcomes of `visitors`' attempts, one after the other, at one instant. */
const attempts = (kind: AttemptKind, visitors: ReadonlyArray<Visitor>) =>
  Effect.forEach(visitors, (visitor) => attempt(kind, visitor));

const times = <A>(count: number, make: (index: number) => A) =>
  Array.from({ length: count }, (_, index) => make(index));

describe("visitorAddress", () => {
  const forwarded = "203.0.113.9, 198.51.100.7";

  it("is the entry the last proxy appended, behind one proxy (AC-6)", () => {
    expect(visitorAddress(forwarded, "10.0.0.2", 1)).toBe("198.51.100.7");
  });

  it("is the entry two places from the right, behind two proxies (AC-6)", () => {
    expect(visitorAddress(forwarded, "10.0.0.2", 2)).toBe("203.0.113.9");
  });

  it("is the socket's address without a header, or behind no proxy (AC-6)", () => {
    expect(visitorAddress(undefined, "10.0.0.2", 1)).toBe("10.0.0.2");
    expect(visitorAddress(forwarded, "10.0.0.2", 0)).toBe("10.0.0.2");
  });

  it("is the socket's address when there are fewer entries than proxies (AC-6)", () => {
    expect(visitorAddress("198.51.100.7", "10.0.0.2", 2)).toBe("10.0.0.2");
  });

  it("never reads entries further left, which the visitor writes (AC-6)", () => {
    expect(
      visitorAddress("1.1.1.1, 2.2.2.2, 198.51.100.7", "10.0.0.2", 1),
    ).toBe("198.51.100.7");
  });
});

describe("SignupLimits", () => {
  it("lets guests attempt 20 times an hour from one address, the 21st refused (AC-3)", async () => {
    const outcomes = await run(
      {},
      Effect.gen(function* () {
        const fromA = attempts(
          "guest",
          times(21, (index) => ({
            socket: "10.0.0.2",
            forwardedFor: "198.51.100.7",
            browser: `Browser ${index}`,
          })),
        );
        const first = yield* fromA;
        const other = yield* attempt("guest", {
          forwardedFor: "198.51.100.8",
        });
        return { first, other };
      }),
    );
    expect(outcomes.first.slice(0, 20)).toEqual(times(20, () => "ran"));
    expect(outcomes.first[20]).toBe("refused");
    expect(outcomes.other).toBe("ran");
  });

  it("lets guests attempt 10 times a minute from one address and browser, the 11th refused (AC-3)", async () => {
    const outcomes = await run(
      {},
      Effect.gen(function* () {
        const same = { forwardedFor: "198.51.100.7", browser: "Firefox" };
        const first = yield* attempts(
          "guest",
          times(11, () => same),
        );
        const otherAddress = yield* attempt("guest", {
          forwardedFor: "198.51.100.9",
          browser: "Firefox",
        });
        yield* TestClock.adjust("1 minute");
        const later = yield* attempt("guest", same);
        return { first, otherAddress, later };
      }),
    );
    expect(outcomes.first.slice(0, 10)).toEqual(times(10, () => "ran"));
    expect(outcomes.first[10]).toBe("refused");
    expect(outcomes.otherAddress).toBe("ran");
    expect(outcomes.later).toBe("ran");
  });

  it("counts a minute from the first attempt, however the attempts are spread (AC-3)", async () => {
    const outcomes = await run(
      {},
      Effect.gen(function* () {
        const same = { forwardedFor: "198.51.100.7", browser: "Firefox" };
        yield* attempt("guest", same);
        yield* TestClock.adjust("7 seconds");
        const burst = yield* attempts(
          "guest",
          times(10, () => same),
        );
        yield* TestClock.adjust("1 minute");
        const later = yield* attempt("guest", same);
        return { burst, later };
      }),
    );
    expect(outcomes.burst.slice(0, 9)).toEqual(times(9, () => "ran"));
    expect(outcomes.burst[9]).toBe("refused");
    expect(outcomes.later).toBe("ran");
  });

  it("lets members attempt 40 times an hour, and 20 a minute with one browser (AC-4)", async () => {
    const outcomes = await run(
      {},
      Effect.gen(function* () {
        const hour = yield* attempts(
          "member",
          times(41, (index) => ({
            forwardedFor: "198.51.100.7",
            browser: `Browser ${index}`,
          })),
        );
        const minute = yield* attempts(
          "member",
          times(21, () => ({ forwardedFor: "198.51.100.9" })),
        );
        return { hour, minute };
      }),
    );
    expect(outcomes.hour.filter((each) => each === "ran")).toHaveLength(40);
    expect(outcomes.hour[40]).toBe("refused");
    expect(outcomes.minute.filter((each) => each === "ran")).toHaveLength(20);
    expect(outcomes.minute[20]).toBe("refused");
  });

  it("counts guests' and members' attempts apart (AC-4)", async () => {
    const member = await run(
      {},
      Effect.gen(function* () {
        const visitor = { forwardedFor: "198.51.100.7" };
        yield* attempts(
          "guest",
          times(20, (index) => ({ ...visitor, browser: `Browser ${index}` })),
        );
        return yield* attempt("member", visitor);
      }),
    );
    expect(member).toBe("ran");
  });

  it("runs nothing for an attempt over a limit (AC-5)", async () => {
    const ran: Array<number> = [];
    const outcomes = await run(
      {},
      Effect.gen(function* () {
        const visitor = { forwardedFor: "198.51.100.7" };
        return yield* Effect.forEach(
          times(11, (index) => index),
          (index) =>
            attempt(
              "guest",
              visitor,
              Effect.sync(() => {
                ran.push(index);
              }),
            ),
        );
      }),
    );
    expect(outcomes[10]).toBe("refused");
    expect(ran).toEqual(times(10, (index) => index));
  });

  it("is on, behind one proxy, when no settings are given (AC-3, AC-6)", async () => {
    const outcomes = await run(
      {},
      Effect.gen(function* () {
        // Everything but the right-most entry is the visitor's own writing.
        return yield* attempts(
          "guest",
          times(11, (index) => ({
            forwardedFor: `203.0.113.${index}, 198.51.100.7`,
          })),
        );
      }),
    );
    expect(outcomes[10]).toBe("refused");
  });

  it("reads blank settings as not given (AC-3, AC-6)", async () => {
    const outcomes = await run(
      { PROXY_COUNT: " ", SIGNUP_LIMITS: "" },
      Effect.gen(function* () {
        return yield* attempts(
          "guest",
          times(11, () => ({ forwardedFor: "198.51.100.7" })),
        );
      }),
    );
    expect(outcomes[10]).toBe("refused");
  });

  it("refuses settings that are not understood, and stops the server (AC-3, AC-4)", async () => {
    for (const settings of [
      { PROXY_COUNT: "-1" },
      { PROXY_COUNT: "two" },
      { SIGNUP_LIMITS: "maybe" },
    ]) {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          yield* SignupLimits;
        }).pipe(
          Effect.provide(
            SignupLimits.layer.pipe(
              Layer.provide(
                ConfigProvider.layer(ConfigProvider.fromUnknown(settings)),
              ),
            ),
          ),
        ),
      );
      expect(Exit.isFailure(exit), JSON.stringify(settings)).toBe(true);
    }
  });

  it("runs every attempt when switched off (AC-3, AC-4)", async () => {
    const outcomes = await run(
      { SIGNUP_LIMITS: "off" },
      Effect.gen(function* () {
        return yield* attempts(
          "guest",
          times(30, () => ({ forwardedFor: "198.51.100.7" })),
        );
      }),
    );
    expect(outcomes).toEqual(times(30, () => "ran"));
  });

  it("counts the address behind the proxy, not the proxy's (AC-6)", async () => {
    const outcomes = await run(
      { PROXY_COUNT: "1" },
      Effect.gen(function* () {
        const through = (forwardedFor: string) => ({
          socket: "10.0.0.2",
          forwardedFor,
        });
        yield* attempts(
          "guest",
          times(10, () => through("203.0.113.1, 198.51.100.7")),
        );
        const other = yield* attempt("guest", through("198.51.100.8"));
        // Whatever is written to the left, it is the same visitor.
        const same = yield* attempt(
          "guest",
          through("203.0.113.99, 198.51.100.7"),
        );
        return { other, same };
      }),
    );
    expect(outcomes.other).toBe("ran");
    expect(outcomes.same).toBe("refused");
  });
});
