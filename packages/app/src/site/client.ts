import {
  AttendeesApi,
  DocumentsApi,
  EventsApi,
  ImagesApi,
  type Problem,
  PublicImagesApi,
  PublicSyncApi,
  SessionApi,
  SiteApi,
  SyncApi,
  TeamsApi,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import type { Identity } from "@skjera/oauth/api";
import { appPaths } from "@skjera/paths";
import { Effect } from "effect";
import { FetchHttpClient, type HttpClient } from "effect/http";
import { HttpApi, HttpApiClient } from "effect/http-api";
import { sayWhy } from "../problems.ts";

class AppApi extends HttpApi.make("app")
  .add(SessionApi)
  .add(SiteApi)
  .add(ImagesApi)
  .add(PublicImagesApi)
  .add(EventsApi)
  .add(AttendeesApi)
  .add(SyncApi)
  .add(PublicSyncApi)
  .add(TeamsApi)
  .add(DocumentsApi) {}

const makeClient = HttpApiClient.make(AppApi, {
  baseUrl:
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
});

export type AppClient = Effect.Success<typeof makeClient>;
export type PublicClient = AppClient;

export class AppError extends Error {
  readonly problem: Problem | undefined;

  constructor(message: string, problem?: Problem) {
    super(message);
    this.name = "AppError";
    this.problem = problem;
  }
}

const problemOf = (failure: unknown): Problem | undefined =>
  typeof failure === "object" && failure !== null && "problem" in failure
    ? (failure.problem as Problem)
    : undefined;

const appError = (failure: unknown) =>
  new AppError(sayWhy(failure, m.common_something_wrong()), problemOf(failure));

// What a proxy answers while the server starts: after a deploy, or in
// development when a change restarts it.
const starting = new Set([502, 503, 504]);

/**
 * `fetch`, waiting up to ten seconds for a server that is starting. A
 * streamed body can only be sent once, so such a request is not repeated.
 */
export const fetchWhileStarting: typeof fetch = async (input, init) => {
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

/** A typed request whose refusals become the one error app callers handle. */
export const requestEffect = <A, E>(
  f: (client: AppClient) => Effect.Effect<A, E>,
) => provideHttp(makeClient.pipe(Effect.flatMap(f), Effect.mapError(appError)));

/** Runs a typed request and returns its success as a promise. */
export const runRequest = <A, E>(
  f: (client: AppClient) => Effect.Effect<A, E>,
) => Effect.runPromise(requestEffect(f));

/** Runs a request against the public endpoints. */
export const runPublic = runRequest;

/** The signed-in user, or null when nobody is. */
export const fetchMe = (): Promise<Identity | null> =>
  Effect.runPromise(
    provideHttp(
      makeClient.pipe(
        Effect.flatMap((client) => client.session.me()),
        Effect.map((identity): Identity | null => identity),
        Effect.catchTag("Unauthorized", () => Effect.succeed(null)),
        Effect.mapError(appError),
      ),
    ),
  );

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
