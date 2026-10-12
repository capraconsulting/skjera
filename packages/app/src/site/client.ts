import { PublicApi } from "@skjera/documents/api";
import type { Identity } from "@skjera/oauth/api";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

const makeClient = HttpApiClient.make(PublicApi, {
  baseUrl: window.location.origin,
});

export type PublicClient = Effect.Success<typeof makeClient>;

/** Runs a request against the public API: published content, no login. */
export const runPublic = <A, E>(
  f: (client: PublicClient) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    makeClient.pipe(Effect.flatMap(f), Effect.provide(FetchHttpClient.layer)),
  );

// What a proxy answers while the server starts: after a deploy, or in
// development when a change restarts it.
const starting = new Set([502, 503, 504]);

/**
 * The signed-in user, or null when nobody is. Waits up to ten seconds for a
 * server that is starting.
 */
export const fetchMe = async (): Promise<Identity | null> => {
  const giveUp = Date.now() + 10_000;
  for (;;) {
    const response = await fetch("/api/me");
    if (response.status === 401) return null;
    if (response.ok) return (await response.json()) as Identity;
    if (!starting.has(response.status) || Date.now() >= giveUp) {
      throw new Error(`Could not load the session (${response.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

export const loginUrl = (returnTo: string) =>
  `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

/**
 * The signed-in user, for pages that need one: with nobody signed in, the
 * browser goes to log in, and back here after.
 */
export const requireMe = async (request: Request): Promise<Identity> => {
  const me = await fetchMe();
  if (me !== null) return me;
  const url = new URL(request.url);
  window.location.assign(loginUrl(url.pathname + url.search));
  return new Promise<never>(() => {});
};
