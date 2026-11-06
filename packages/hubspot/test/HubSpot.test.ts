import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, Redacted } from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import {
  HubSpot,
  HubSpotApiError,
  HubSpotRateLimited,
  HubSpotUnavailable,
  retryTransient,
} from "../src/HubSpot.ts";

// HubSpot's service on a stubbed HttpClient: the request each call makes
// (method, path, body, token), and how HubSpot's answers and failures come back.

interface Received {
  readonly method: string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

interface Reply {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: unknown;
  /** The connection fails: no answer. */
  readonly noAnswer?: boolean;
}

const bodyOf = (request: HttpClientRequest.HttpClientRequest): unknown => {
  const body = request.body;
  return body._tag === "Uint8Array"
    ? JSON.parse(new TextDecoder().decode(body.body))
    : undefined;
};

/** HubSpot as a stub answering `replies` in turn, the last one for the rest. */
const stub = (replies: ReadonlyArray<Reply> = [{ body: {} }]) => {
  const received: Array<Received> = [];
  const layer = Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request, url) => {
      received.push({
        method: request.method,
        path: url.pathname,
        params: Object.fromEntries(url.searchParams),
        authorization: request.headers.authorization,
        body: bodyOf(request),
      });
      const reply =
        replies[Math.min(received.length - 1, replies.length - 1)] ?? {};
      if (reply.noAnswer === true) {
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        );
      }
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(reply.body ?? {}), {
            status: reply.status ?? 200,
            headers: { "content-type": "application/json", ...reply.headers },
          }),
        ),
      );
    }),
  );
  return {
    received,
    hubspot: HubSpot.layer({ token: Redacted.make("pat-test") }).pipe(
      Layer.provide(layer),
    ),
  };
};

const marketingEvent = {
  externalEventId: "0190a000-0000-7000-8000-000000000001",
  eventName: "Frokostseminar om sky",
  eventOrganizer: "Capra Gruppen",
  eventDescription: "Frokost og faglig påfyll",
  startDateTime: "2036-10-15T06:00:00.000Z",
  endDateTime: "2036-10-15T08:00:00.000Z",
  eventUrl:
    "https://skjera.example/events/0190a000-0000-7000-8000-000000000001",
  eventType: "Frokostseminar",
  eventCancelled: false,
} as const;

describe("The requests", () => {
  it.effect(
    "creates or updates a Marketing Event under Skjera's account (AC-2)",
    () =>
      Effect.gen(function* () {
        const { received, hubspot } = stub();
        yield* Effect.gen(function* () {
          yield* (yield* HubSpot).upsertMarketingEvent(marketingEvent);
        }).pipe(Effect.provide(hubspot));
        const { externalEventId, ...fields } = marketingEvent;
        assert.deepStrictEqual(received, [
          {
            method: "PUT",
            path: `/marketing/v3/marketing-events/events/${externalEventId}`,
            params: { externalAccountId: "skjera" },
            authorization: "Bearer pat-test",
            body: fields,
          },
        ]);
      }),
  );

  it.effect(
    "creates the Marketing Event when HubSpot does not have it yet (AC-2)",
    () =>
      Effect.gen(function* () {
        const { received, hubspot } = stub([{ status: 404 }, { status: 200 }]);
        yield* Effect.gen(function* () {
          yield* (yield* HubSpot).upsertMarketingEvent(marketingEvent);
        }).pipe(Effect.provide(hubspot));
        const { externalEventId, ...fields } = marketingEvent;
        assert.deepStrictEqual(
          received.map(({ method, path, body }) => ({ method, path, body })),
          [
            {
              method: "PUT",
              path: `/marketing/v3/marketing-events/events/${externalEventId}`,
              body: fields,
            },
            {
              method: "POST",
              path: "/marketing/v3/marketing-events/events",
              body: { ...marketingEvent, externalAccountId: "skjera" },
            },
          ],
        );
      }),
  );

  it.effect("leaves out a description the event lacks (AC-2)", () =>
    Effect.gen(function* () {
      const { received, hubspot } = stub();
      const { eventDescription: _, ...bare } = marketingEvent;
      yield* Effect.gen(function* () {
        yield* (yield* HubSpot).upsertMarketingEvent(bare);
      }).pipe(Effect.provide(hubspot));
      assert.notProperty(received[0]?.body as object, "eventDescription");
    }),
  );

  it.effect("cancels a Marketing Event by its external id (AC-4)", () =>
    Effect.gen(function* () {
      const { received, hubspot } = stub();
      yield* Effect.gen(function* () {
        yield* (yield* HubSpot).cancelMarketingEvent(
          marketingEvent.externalEventId,
        );
      }).pipe(Effect.provide(hubspot));
      assert.strictEqual(received.length, 1);
      assert.strictEqual(received[0]?.method, "POST");
      assert.strictEqual(
        received[0]?.path,
        `/marketing/v3/marketing-events/events/${marketingEvent.externalEventId}/cancel`,
      );
      assert.deepStrictEqual(received[0]?.params, {
        externalAccountId: "skjera",
      });
    }),
  );

  it.effect(
    "upserts a contact by email, sending only the properties given (AC-5)",
    () =>
      Effect.gen(function* () {
        const { received, hubspot } = stub();
        yield* Effect.gen(function* () {
          const service = yield* HubSpot;
          yield* service.upsertContact({
            email: "kari@example.com",
            firstname: "Kari Anne",
            lastname: "Nordmann",
            company: "Acme",
            jobtitle: "CTO",
          });
          yield* service.upsertContact({
            email: "ola@example.com",
            firstname: "Ola",
          });
        }).pipe(Effect.provide(hubspot));
        assert.deepStrictEqual(
          received.map(({ method, path, body }) => ({ method, path, body })),
          [
            {
              method: "POST",
              path: "/crm/v3/objects/contacts/batch/upsert",
              body: {
                inputs: [
                  {
                    id: "kari@example.com",
                    idProperty: "email",
                    properties: {
                      email: "kari@example.com",
                      firstname: "Kari Anne",
                      lastname: "Nordmann",
                      company: "Acme",
                      jobtitle: "CTO",
                    },
                  },
                ],
              },
            },
            {
              method: "POST",
              path: "/crm/v3/objects/contacts/batch/upsert",
              body: {
                inputs: [
                  {
                    id: "ola@example.com",
                    idProperty: "email",
                    properties: { email: "ola@example.com", firstname: "Ola" },
                  },
                ],
              },
            },
          ],
        );
      }),
  );

  it.effect(
    "records a sign-up as REGISTERED and a cancellation as CANCELLED, at the time given (AC-5, AC-6)",
    () =>
      Effect.gen(function* () {
        const { received, hubspot } = stub();
        yield* Effect.gen(function* () {
          const service = yield* HubSpot;
          const at = new Date("2036-10-01T09:30:00Z");
          yield* service.recordParticipation({
            externalEventId: marketingEvent.externalEventId,
            state: "REGISTERED",
            email: "kari@example.com",
            at,
          });
          yield* service.recordParticipation({
            externalEventId: marketingEvent.externalEventId,
            state: "CANCELLED",
            email: "kari@example.com",
            at,
          });
        }).pipe(Effect.provide(hubspot));
        assert.deepStrictEqual(
          received.map(({ method, path, params, body }) => ({
            method,
            path,
            params,
            body,
          })),
          ["REGISTERED", "CANCELLED"].map((state) => ({
            method: "POST",
            path: `/marketing/v3/marketing-events/attendance/${marketingEvent.externalEventId}/${state}/email-create`,
            params: { externalAccountId: "skjera" },
            body: {
              inputs: [
                {
                  email: "kari@example.com",
                  interactionDateTime: new Date(
                    "2036-10-01T09:30:00Z",
                  ).getTime(),
                },
              ],
            },
          })),
        );
      }),
  );
});

describe("HubSpot's answers", () => {
  const upsert = (replies: ReadonlyArray<Reply>) => {
    const { hubspot } = stub(replies);
    return Effect.gen(function* () {
      yield* (yield* HubSpot).upsertMarketingEvent(marketingEvent);
    }).pipe(Effect.provide(hubspot), Effect.flip);
  };

  it.effect(
    "says no with the status when HubSpot refuses what was sent (AC-10)",
    () =>
      Effect.gen(function* () {
        for (const status of [400, 401, 403, 404, 409]) {
          const error = yield* upsert([
            { status, body: { message: "Nope", category: "VALIDATION_ERROR" } },
          ]);
          assert.instanceOf(error, HubSpotApiError);
          assert.strictEqual((error as HubSpotApiError).status, status);
          assert.include((error as HubSpotApiError).message, "Nope");
        }
      }),
  );

  it.effect("is rate limited for as long as HubSpot says (AC-10)", () =>
    Effect.gen(function* () {
      const error = yield* upsert([
        { status: 429, headers: { "retry-after": "7" } },
      ]);
      assert.instanceOf(error, HubSpotRateLimited);
      assert.strictEqual((error as HubSpotRateLimited).retryAfter, 7);
    }),
  );

  it.effect(
    "is rate limited for a while when HubSpot does not say how long (AC-10)",
    () =>
      Effect.gen(function* () {
        const error = yield* upsert([{ status: 429 }]);
        assert.instanceOf(error, HubSpotRateLimited);
        assert.isAbove((error as HubSpotRateLimited).retryAfter, 0);
      }),
  );

  it.effect(
    "is unavailable on a server error, and when nothing answers (AC-10)",
    () =>
      Effect.gen(function* () {
        const failed = yield* upsert([{ status: 503 }]);
        assert.instanceOf(failed, HubSpotUnavailable);
        assert.strictEqual((failed as HubSpotUnavailable).status, 503);
        const silent = yield* upsert([{ noAnswer: true }]);
        assert.instanceOf(silent, HubSpotUnavailable);
      }),
  );
});

describe("retryTransient", () => {
  const attempt = (replies: ReadonlyArray<Reply>) => {
    const { received, hubspot } = stub(replies);
    const run = Effect.gen(function* () {
      yield* (yield* HubSpot).upsertMarketingEvent(marketingEvent);
    }).pipe(
      retryTransient({ times: 2, base: "1 millis" }),
      Effect.provide(hubspot),
      Effect.exit,
    );
    return { received, run };
  };

  it.live(
    "tries unavailable and rate limited again until it goes through (AC-10)",
    () =>
      Effect.gen(function* () {
        const { received, run } = attempt([
          { status: 503 },
          { status: 429, headers: { "retry-after": "0" } },
          { status: 200 },
        ]);
        assert.isTrue(Exit.isSuccess(yield* run));
        assert.strictEqual(received.length, 3);
      }),
  );

  it.live("gives up after the tries it was given (AC-10)", () =>
    Effect.gen(function* () {
      const { received, run } = attempt([{ status: 503 }]);
      assert.isTrue(Exit.isFailure(yield* run));
      assert.strictEqual(received.length, 3);
    }),
  );

  it.live("does not try again what HubSpot refused (AC-10)", () =>
    Effect.gen(function* () {
      const { received, run } = attempt([{ status: 400 }]);
      assert.isTrue(Exit.isFailure(yield* run));
      assert.strictEqual(received.length, 1);
    }),
  );
});
