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

/** The signed-in user, or null when nobody is. */
export const fetchMe = async (): Promise<Identity | null> => {
  const response = await fetch("/api/me");
  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Could not load the session (${response.status})`);
  }
  return (await response.json()) as Identity;
};

export const loginUrl = (returnTo: string) =>
  `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
