import { Effect, Layer } from "effect";
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
    return HttpServerResponse.text("ok");
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.catch(() =>
      Effect.succeed(HttpServerResponse.text("unavailable", { status: 503 })),
    ),
  ),
);

/** The health checks Kubernetes probes. */
export const Health = Layer.mergeAll(alive, ready);
