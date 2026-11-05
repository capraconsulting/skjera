import { type ChildProcess, spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../test-server.ts";

const serverUrl =
  process.env.DATABASE_URL ?? "postgres://skjera:skjera@localhost:5433/skjera";

/** A port nothing listens on. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

const sleep = (millis: number) =>
  new Promise((resolve) => setTimeout(resolve, millis));

/** Waits until `/health/ready` answers 200 (migrations take their time). */
const untilReady = async (port: number, server: ChildProcess) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(
        `The server exited with ${server.exitCode} while starting`,
      );
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`).then(
      (response) => response.status === 200,
      () => false,
    );
    if (ready) return;
    await sleep(200);
  }
  throw new Error("The server was not ready within 60 seconds");
};

/** A connection that has had its answer and is kept open, idle. */
const idleConnection = (port: number) =>
  new Promise<ReturnType<typeof connect>>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
      );
    });
    socket.once("error", reject);
    socket.once("data", () => resolve(socket));
  });

const dropDatabase = (name: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(serverUrl) }))),
  );

describe("the server process", () => {
  let server: ChildProcess | undefined;
  let database: string | undefined;
  let connection: ReturnType<typeof connect> | undefined;

  afterEach(async () => {
    connection?.destroy();
    if (server !== undefined && server.exitCode === null)
      server.kill("SIGKILL");
    if (database !== undefined) await dropDatabase(database);
    server = undefined;
    database = undefined;
    connection = undefined;
  });

  it("stops within 5 seconds of SIGTERM, with a connection open (OPS-03 AC-4)", async () => {
    const port = await freePort();
    const databaseUrl = await createDatabase(serverUrl, port);
    database = new URL(databaseUrl).pathname.slice(1);
    // Under the issuer, so the server starts without the login server.
    const endpoints = new URL(
      process.env.OAUTH_ISSUER ?? "http://localhost/dex",
    );
    const output: Array<string> = [];
    server = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        DATABASE_URL: databaseUrl,
        SITE_URL: `http://127.0.0.1:${port}`,
        OAUTH_REDIRECT_URI: `http://127.0.0.1:${port}/auth/callback`,
        OAUTH_AUTHORIZATION_ENDPOINT: `${endpoints.origin}${endpoints.pathname.replace(/\/$/, "")}/auth`,
        OAUTH_TOKEN_ENDPOINT: `${endpoints.origin}${endpoints.pathname.replace(/\/$/, "")}/token`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout, server.stderr])
      stream?.on("data", (chunk) => output.push(String(chunk)));
    const exited = new Promise<void>((resolve) =>
      server?.once("exit", () => resolve()),
    );

    try {
      await untilReady(port, server);
      connection = await idleConnection(port);

      const stopped = Date.now();
      server.kill("SIGTERM");
      const outcome = await Promise.race([
        exited.then(() => "exited" as const),
        sleep(5_000).then(() => "running" as const),
      ]);
      expect(outcome, `after ${Date.now() - stopped} ms`).toBe("exited");
    } catch (error) {
      console.error(output.join(""));
      throw error;
    }
  }, 90_000);
});
