// A test server for this checkout: the built app and server on PORT, with a
// database of its own, at the address in SKJERA_TEST_SERVER_URL. Run with
// `pnpm test-server`, which builds first; the development services
// (`pnpm dev`) must be running.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";
import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import { SqlClient } from "effect/sql";

type Env = Readonly<Record<string, string | undefined>>;

const required = (env: Env, name: string): string => {
  const value = env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is not set; run this with mise's environment.`);
  return value;
};

/** The address test servers are reached at, without the port. */
const testServerUrl = (value: string | undefined): string => {
  if (value === undefined || value === "") return "http://localhost";
  // Exactly scheme and host: Dex's config (dev/dex/config.yaml) appends
  // ports to it as written.
  if (!/^https?:\/\/[A-Za-z0-9.-]+$/.test(value))
    throw new Error(
      `SKJERA_TEST_SERVER_URL must be http://<host> or https://<host>, without a port or path: ${value}`,
    );
  return value;
};

/** What a test server on `port` runs with, over the development settings. */
export const testServerEnv = (
  env: Env,
  options: {
    readonly port: number;
    readonly databaseUrl: string;
    readonly staticDir: string;
  },
) => {
  const site = new URL(
    `${testServerUrl(env.SKJERA_TEST_SERVER_URL)}:${options.port}`,
  );
  // The browser goes to Dex at this address; the server keeps talking to it
  // at OAUTH_ISSUER, on this machine.
  const dex = new URL(required(env, "OAUTH_ISSUER"));
  dex.protocol = site.protocol;
  dex.hostname = site.hostname;
  return {
    PORT: String(options.port),
    DATABASE_URL: options.databaseUrl,
    SITE_URL: site.origin,
    OAUTH_REDIRECT_URI: `${site.origin}/auth/callback`,
    OAUTH_AUTHORIZATION_ENDPOINT: `${dex.href.replace(/\/$/, "")}/auth`,
    STATIC_DIR: options.staticDir,
    NODE_ENV: "production",
    // Behind a TLS proxy, which holds the port on the machine's other
    // addresses: listening on all of them would find it taken.
    ...(site.protocol === "https:" ? { HOST: "127.0.0.1" } : {}),
  };
};

/** A new, empty database on the server of `serverUrl`; its URL. Never dropped. */
export const createDatabase = async (
  serverUrl: string,
  port: number,
): Promise<string> => {
  const name = `skjera_testserver_${port}_${randomBytes(4).toString("hex")}`;
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql.unsafe(`CREATE DATABASE ${name}`);
    }).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(serverUrl) })),
      Effect.mapError(
        (error) =>
          new Error(
            `Could not create a database on ${new URL(serverUrl).host}: start the development services (pnpm dev). ${error.message}`,
          ),
      ),
    ),
  );
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.href;
};

/**
 * Drops the databases earlier test servers on `port` left, but not one a
 * running server is connected to.
 */
export const dropUnusedDatabases = async (
  serverUrl: string,
  port: number,
): Promise<void> => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const left = yield* sql<{ datname: string }>`
        SELECT datname FROM pg_database d
        WHERE datname LIKE ${`skjera\\_testserver\\_${port}\\_%`}
          AND NOT EXISTS (
            SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname
          )`;
      for (const { datname } of left) {
        yield* sql.unsafe(`DROP DATABASE ${datname}`).pipe(Effect.ignore);
      }
    }).pipe(
      Effect.provide(PgClient.layer({ url: Redacted.make(serverUrl) })),
      Effect.orDie,
    ),
  );
};

if (import.meta.main) {
  try {
    const port = Number(required(process.env, "PORT"));
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(`PORT must be a port number: ${process.env.PORT}`);
    // Before anything is created: refuse a malformed address.
    testServerUrl(process.env.SKJERA_TEST_SERVER_URL);

    const serverUrl = required(process.env, "DATABASE_URL");
    await dropUnusedDatabases(serverUrl, port);
    const databaseUrl = await createDatabase(serverUrl, port);
    const env = testServerEnv(process.env, {
      port,
      databaseUrl,
      staticDir: fileURLToPath(new URL("../app/dist", import.meta.url)),
    });
    console.log(
      `Test server at ${env.SITE_URL}, database ${new URL(databaseUrl).pathname.slice(1)}`,
    );

    const server = spawn(
      process.execPath,
      ["--enable-source-maps", "dist/main.js"],
      {
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        env: { ...process.env, ...env },
        stdio: "inherit",
      },
    );
    // A stop sent to this process alone must reach the server too.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.on(signal, () => server.kill(signal));
    server.on("exit", (code, signal) =>
      process.exit(code ?? 128 + (signal ? constants.signals[signal] : 1)),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
