import { createServer, type Socket } from "node:net";
import { PgClient } from "@effect/sql-pg";
import { Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { describe, expect, it } from "vitest";
import { Health } from "../src/health.ts";

const serverUrl =
  process.env.DATABASE_URL ?? "postgres://skjera:skjera@localhost:5433/skjera";

/** Asks the health routes for `path`, with a database at `url` behind them. */
const ask = async (url: string, path: string) => {
  // `ready` reads the client for each request, so it goes in the context the
  // handler runs requests with: provideMerge, not provide.
  const { handler, dispose } = HttpRouter.toWebHandler(
    Health.pipe(
      Layer.provideMerge(PgClient.layer({ url: Redacted.make(url) })),
    ),
    { disableLogger: true },
  );
  try {
    const started = Date.now();
    const response = await handler(new Request(`http://localhost${path}`));
    return {
      status: response.status,
      body: await response.text(),
      seconds: (Date.now() - started) / 1000,
    };
  } finally {
    await dispose();
  }
};

/**
 * A database that accepts connections and never answers: a local server that
 * reads and says nothing. `use` gets its address.
 */
const withSilentDatabase = async <A>(use: (url: string) => Promise<A>) => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The silent database has no port");
  }
  try {
    return await use(
      `postgres://skjera:skjera@127.0.0.1:${address.port}/skjera`,
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
};

describe("health checks", () => {
  it("answers 200 ok on /health while the server runs (AC-1)", async () => {
    const answer = await ask(serverUrl, "/health");
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("ok");
  });

  it("answers 200 ok on /health/ready while the database answers (AC-2)", async () => {
    const answer = await ask(serverUrl, "/health/ready");
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("ok");
  });

  it("answers 503 unavailable on /health/ready when the database does not answer, and ok on /health (AC-3)", async () => {
    await withSilentDatabase(async (url) => {
      const ready = await ask(url, "/health/ready");
      expect(ready.status).toBe(503);
      expect(ready.body).toBe("unavailable");
      // Gives up after two seconds, not at once and not at the pool's own limit.
      expect(ready.seconds).toBeGreaterThanOrEqual(1.9);
      expect(ready.seconds).toBeLessThan(3);

      const alive = await ask(url, "/health");
      expect(alive.status).toBe(200);
      expect(alive.body).toBe("ok");
    });
  });
});
