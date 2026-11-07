import { PublicApi } from "@skjera/documents/api";
import type { Identity } from "@skjera/oauth/api";
import { appPaths } from "@skjera/paths";
import { Effect } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

const makeClient = HttpApiClient.make(PublicApi, {
  baseUrl: window.location.origin,
});

export type PublicClient = Effect.Success<typeof makeClient>;

// What a proxy answers while the server starts: after a deploy, or in
// development when a change restarts it.
const starting = new Set([502, 503, 504]);

/**
 * `fetch`, waiting up to ten seconds for a server that is starting. A
 * streamed body can only be sent once, so such a request is not repeated.
 */
const fetchWhileStarting: typeof fetch = async (input, init) => {
  const giveUp = Date.now() + 10_000;
  for (;;) {
    const response = await fetch(input, init);
    if (
      !starting.has(response.status) ||
      init?.body instanceof ReadableStream ||
      Date.now() >= giveUp
    ) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

/** Sends an API client's requests with `fetchWhileStarting`. */
export const provideHttp = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
) =>
  effect.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetchWhileStarting),
  );

/** Runs a request against the public API: published content, no login. */
export const runPublic = <A, E>(
  f: (client: PublicClient) => Effect.Effect<A, E>,
) => Effect.runPromise(provideHttp(makeClient.pipe(Effect.flatMap(f))));

/** The signed-in user, or null when nobody is. */
export const fetchMe = async (): Promise<Identity | null> => {
  const response = await fetchWhileStarting("/api/me");
  if (response.status === 401) return null;
  if (response.ok) return (await response.json()) as Identity;
  throw new Error(`Could not load the session (${response.status})`);
};

export const loginUrl = appPaths.loginUrl;

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
