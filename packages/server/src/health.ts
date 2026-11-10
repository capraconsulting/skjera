import { Config, Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { SqlClient } from "effect/sql";

/** Alive: the process runs. */
const alive = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"));

/** Ready to serve: the database answers within two seconds. */
const ready = HttpRouter.add(
  "GET",
  "/health/ready",
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`SELECT 1`;
    const image = yield* Config.String("APP_IMAGE").pipe(
      Config.withDefault(""),
    );
    return HttpServerResponse.text("ok", {
      headers: {
        "Cache-Control": "no-store",
        ...(image ? { "X-Skjera-Image": image } : {}),
      },
    });
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.catchCause((cause) =>
      Effect.logWarning("Readiness check failed", cause).pipe(
        Effect.as(HttpServerResponse.text("unavailable", { status: 503 })),
      ),
    ),
  ),
);

/** The health checks Kubernetes probes. */
export const Health = Layer.mergeAll(alive, ready);
