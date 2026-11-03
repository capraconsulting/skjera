import * as Documents from "@skjera/documents";
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect";
import { HttpServerRequest } from "effect/http";

// How often signing up and cancelling can be tried, per visitor: guests and
// members each have a limit per address over an hour, and a stricter one per
// address and browser over a minute. The counts are kept in this process.

/**
 * The visitor, behind `proxies` proxies that each appended the address they
 * got the request from to `X-Forwarded-For`: the entry that many places from
 * the right. Entries further left are the visitor's own writing, and are
 * never read. Without enough entries, the socket's address.
 */
export const visitorAddress = (
  forwardedFor: string | undefined,
  socketAddress: string | undefined,
  proxies: number,
): string => {
  const entries = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return (
    (proxies > 0 ? entries.at(-proxies) : undefined) ??
    socketAddress ??
    "unknown"
  );
};

/** Whose attempt it is: a member's (logged in) or a guest's. */
export type AttemptKind = "guest" | "member";

const limits = {
  guest: { perAddress: 20, perBrowser: 10 },
  member: { perAddress: 40, perBrowser: 20 },
} as const;

const ProxyCount = (name: string) =>
  Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), name);

const SwitchedOn = (name: string) => Config.Literals(["on", "off"], name);

/** Signing up and cancelling, counted per visitor. */
export class SignupLimits extends Context.Service<
  SignupLimits,
  {
    /**
     * Runs `effect` as an attempt by the current request's visitor; over a
     * limit it fails with `TooManyAttempts`, and `effect` never runs.
     */
    readonly attempt: (
      kind: AttemptKind,
    ) => <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<
      A,
      E | Documents.TooManyAttempts,
      R | HttpServerRequest.HttpServerRequest
    >;
  }
>()("@skjera/server/SignupLimits") {
  /**
   * `PROXY_COUNT`: how many proxies stand in front of the server (1 when
   * unset: the ingress). `SIGNUP_LIMITS`: `on` (when unset) or `off`, for
   * the browser tests, which sign up far more often than the limits allow.
   * Another value stops the server at start.
   */
  static readonly layer = Layer.effect(
    SignupLimits,
    Effect.gen(function* () {
      const proxies =
        (yield* Documents.optionalSetting("PROXY_COUNT", ProxyCount)) ?? 1;
      const switchedOn =
        (yield* Documents.optionalSetting("SIGNUP_LIMITS", SwitchedOn)) ?? "on";
      // Each key's count starts at its first attempt and ends a whole
      // window later; a refused attempt adds nothing.
      const counts = new Map<string, { count: number; resetsAt: number }>();
      const windows = { "1 hour": 3_600_000, "1 minute": 60_000 } as const;

      /** Counts one attempt under `key`; over `limit` in `window`, it is refused. */
      const consume = (
        key: string,
        limit: number,
        window: keyof typeof windows,
      ) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          for (const [other, entry] of counts) {
            if (entry.resetsAt <= now) counts.delete(other);
          }
          const entry = counts.get(key) ?? {
            count: 0,
            resetsAt: now + windows[window],
          };
          if (entry.count >= limit) {
            return Effect.fail(
              new Documents.TooManyAttempts(
                Documents.refused({ _tag: "TooManyAttempts" }),
              ),
            );
          }
          counts.set(key, { ...entry, count: entry.count + 1 });
          return Effect.void;
        });

      return {
        attempt: (kind) => (effect) =>
          switchedOn === "off"
            ? effect
            : Effect.gen(function* () {
                const request = yield* HttpServerRequest.HttpServerRequest;
                const address = visitorAddress(
                  request.headers["x-forwarded-for"],
                  Option.getOrUndefined(request.remoteAddress),
                  proxies,
                );
                const browser = request.headers["user-agent"] ?? "";
                const { perAddress, perBrowser } = limits[kind];
                // The address first: an attempt it refuses adds nothing to
                // the address and browser's count.
                yield* consume(`${kind}:${address}`, perAddress, "1 hour");
                yield* consume(
                  `${kind}:${address}:${browser}`,
                  perBrowser,
                  "1 minute",
                );
                return yield* effect;
              }),
      };
    }),
  );
}
