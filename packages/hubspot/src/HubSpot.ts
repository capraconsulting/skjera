import { retryTransient as retry } from "@skjera/retry";
import {
  Context,
  Duration,
  Effect,
  Layer,
  type Redacted,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
  type HttpClientResponse,
  HttpClientRequest as Request,
} from "effect/http";

// The parts of HubSpot's API we use, as an Effect service, on Effect's
// HttpClient: Marketing Events (an event, and who registered for or
// cancelled it) and Contacts (created or updated by email). Callers decide
// what to try again, with `retryTransient`.

/** The account the Marketing Events are kept under: Skjera's own. */
export const externalAccountId = "skjera";

/**
 * HubSpot said no to what was sent (a 4xx other than 429): an invalid
 * value, an unknown event, a token it does not accept (401, 403). Sending
 * the same again won't help, unless it is the token.
 */
export class HubSpotApiError extends Schema.TaggedError<HubSpotApiError>()(
  "HubSpotApiError",
  { call: Schema.String, status: Schema.Number, message: Schema.String },
) {}

/** Too many calls: try again after `retryAfter` seconds. */
export class HubSpotRateLimited extends Schema.TaggedError<HubSpotRateLimited>()(
  "HubSpotRateLimited",
  { call: Schema.String, retryAfter: Schema.Number },
) {}

/** HubSpot couldn't be reached, or failed (a 5xx): try again. */
export class HubSpotUnavailable extends Schema.TaggedError<HubSpotUnavailable>()(
  "HubSpotUnavailable",
  {
    call: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
  },
) {}

export type HubSpotError =
  | HubSpotApiError
  | HubSpotRateLimited
  | HubSpotUnavailable;

/** A Marketing Event, as Skjera sends it. */
export interface MarketingEvent {
  /** Skjera's id for the event. */
  readonly externalEventId: string;
  readonly eventName: string;
  readonly eventOrganizer: string;
  readonly eventDescription?: string;
  /** ISO instants. */
  readonly startDateTime: string;
  readonly endDateTime: string;
  readonly eventUrl: string;
  readonly eventType: string;
  readonly eventCancelled: boolean;
}

/**
 * A contact, by email. A property left out is left as HubSpot has it. Any
 * other property is given by its HubSpot name, and must exist in the account:
 * HubSpot refuses the call when it does not.
 */
export interface Contact {
  readonly email: string;
  readonly firstname?: string;
  readonly lastname?: string;
  readonly company?: string;
  readonly jobtitle?: string;
  readonly [property: string]: string | undefined;
}

/** Whether someone is registered for an event, or cancelled their registration. */
export type ParticipationState = "REGISTERED" | "CANCELLED";

export interface Participation {
  readonly externalEventId: string;
  readonly state: ParticipationState;
  readonly email: string;
  /** When it happened. */
  readonly at: Date;
}

export class HubSpot extends Context.Service<
  HubSpot,
  {
    /** Creates the Marketing Event, or updates it when it is there. */
    readonly upsertMarketingEvent: (
      event: MarketingEvent,
    ) => Effect.Effect<void, HubSpotError>;
    readonly cancelMarketingEvent: (
      externalEventId: string,
    ) => Effect.Effect<void, HubSpotError>;
    /** Creates the contact, or updates the one with the email. */
    readonly upsertContact: (
      contact: Contact,
    ) => Effect.Effect<void, HubSpotError>;
    /** Records who registered for or cancelled an event, by email. */
    readonly recordParticipation: (
      participation: Participation,
    ) => Effect.Effect<void, HubSpotError>;
  }
>()("@skjera/hubspot/HubSpot") {
  /** On HubSpot's API with a private app's token, through the `HttpClient` given. */
  static readonly layer = (options: {
    readonly token: Redacted.Redacted<string>;
    /** HubSpot's API, unless told otherwise ("https://api.hubapi.com"). */
    readonly apiUrl?: string;
    readonly timeout?: Duration.Input;
  }) =>
    Layer.effect(
      HubSpot,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        return HubSpot.of(fromClient(client, options));
      }),
    );

  /** The same, over `fetch`. */
  static readonly layerFetch = (options: Parameters<typeof HubSpot.layer>[0]) =>
    HubSpot.layer(options).pipe(Layer.provide(FetchHttpClient.layer));
}

const defaultApiUrl = "https://api.hubapi.com";

/** Without a `Retry-After`, a rate limit is waited out for this long. */
const defaultRetryAfter = 10;

const describe = (body: unknown, fallback: string): string => {
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === "string" && message !== "" ? message : fallback;
};

const fromClient = (
  client: HttpClient.HttpClient,
  options: Parameters<typeof HubSpot.layer>[0],
): HubSpot["Service"] => {
  const apiUrl = (options.apiUrl ?? defaultApiUrl).replace(/\/+$/, "");
  const timeout = Duration.fromInputUnsafe(options.timeout ?? "10 seconds");

  const send = (
    call: string,
    path: string,
    body: unknown,
    params: Record<string, string> = {},
    method: "POST" | "PUT" = "POST",
  ): Effect.Effect<void, HubSpotError> => {
    let request: HttpClientRequest.HttpClientRequest = (
      method === "PUT" ? Request.put : Request.post
    )(`${apiUrl}${path}`).pipe(
      Request.bearerToken(options.token),
      Request.acceptJson,
    );
    for (const [key, value] of Object.entries(params)) {
      request = Request.setUrlParam(request, key, value);
    }
    if (body !== undefined) request = Request.bodyJsonUnsafe(request, body);
    return client.execute(request).pipe(
      Effect.timeout(timeout),
      Effect.catch((error) =>
        Effect.fail(
          new HubSpotUnavailable({
            call,
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      ),
      Effect.flatMap((response) => answer(call, response)),
    );
  };

  return {
    // An event already there is replaced by its external id, so a new
    // title, summary or times, and "not cancelled", take effect; one that is
    // not there (404) is created.
    upsertMarketingEvent: ({ externalEventId, ...fields }) =>
      send(
        "upsertMarketingEvent",
        `/marketing/v3/marketing-events/events/${encodeURIComponent(externalEventId)}`,
        fields,
        { externalAccountId },
        "PUT",
      ).pipe(
        Effect.catchIf(
          (error): error is HubSpotApiError =>
            error instanceof HubSpotApiError && error.status === 404,
          () =>
            send(
              "upsertMarketingEvent",
              "/marketing/v3/marketing-events/events",
              {
                ...fields,
                externalEventId,
                externalAccountId,
              },
            ),
        ),
      ),
    cancelMarketingEvent: (externalEventId) =>
      send(
        "cancelMarketingEvent",
        `/marketing/v3/marketing-events/events/${encodeURIComponent(externalEventId)}/cancel`,
        undefined,
        { externalAccountId },
      ),
    upsertContact: (contact) =>
      send("upsertContact", "/crm/v3/objects/contacts/batch/upsert", {
        inputs: [
          {
            id: contact.email,
            idProperty: "email",
            properties: Object.fromEntries(
              Object.entries(contact).filter(
                ([, value]) => value !== undefined,
              ),
            ),
          },
        ],
      }),
    recordParticipation: ({ externalEventId, state, email, at }) =>
      send(
        "recordParticipation",
        `/marketing/v3/marketing-events/attendance/${encodeURIComponent(externalEventId)}/${state}/email-create`,
        { inputs: [{ email, interactionDateTime: at.getTime() }] },
        { externalAccountId },
      ),
  };
};

/** HubSpot's answer as a result: a 2xx is done, the rest are our errors. */
const answer = (
  call: string,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<void, HubSpotError> => {
  const { status } = response;
  if (status >= 200 && status < 300) return Effect.void;
  if (status === 429) {
    const header = Number(response.headers["retry-after"]);
    return Effect.fail(
      new HubSpotRateLimited({
        call,
        retryAfter:
          Number.isFinite(header) && header >= 0 ? header : defaultRetryAfter,
      }),
    );
  }
  return response.json.pipe(
    Effect.orElseSucceed(() => undefined),
    Effect.flatMap((body) => {
      const message = describe(body, `HTTP ${status}`);
      const error: HubSpotError =
        status >= 500
          ? new HubSpotUnavailable({ call, message, status })
          : new HubSpotApiError({ call, status, message });
      return Effect.fail(error);
    }),
  );
};

/**
 * Tries again what may work later: after a rate limit, when HubSpot says
 * to; when it's unavailable, after 1, 2, 4, … seconds (from `base`, at most
 * a minute). At most `times` more tries; HubSpot saying no isn't retried.
 */
export const retryTransient =
  (options: { readonly times?: number; readonly base?: Duration.Input } = {}) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const base = Duration.fromInputUnsafe(options.base ?? "1 second");
    return self.pipe(
      retry<HubSpotRateLimited | HubSpotUnavailable>({
        ...(options.times === undefined ? {} : { times: options.times }),
        retryable: (error): error is HubSpotRateLimited | HubSpotUnavailable =>
          error instanceof HubSpotRateLimited ||
          error instanceof HubSpotUnavailable,
        delay: (error, n) =>
          error._tag === "HubSpotRateLimited"
            ? Duration.seconds(error.retryAfter)
            : Duration.min(Duration.times(base, 2 ** n), Duration.minutes(1)),
      }),
    );
  };
