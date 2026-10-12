import { PgClient } from "@effect/sql-pg";
import { Effect, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase, testServerEnv } from "../test-server.ts";

const serverUrl =
  process.env.DATABASE_URL ?? "postgres://skjera:skjera@localhost:5433/skjera";

const development = {
  OAUTH_ISSUER: "http://localhost:5556/dex",
  DATABASE_URL: serverUrl,
};

const settings = (
  address: string | undefined,
  port = 8801,
  databaseUrl = "postgres://skjera:skjera@localhost:5433/skjera_testserver_8801_ab",
) =>
  testServerEnv(
    { ...development, SKJERA_TEST_SERVER_URL: address },
    { port, databaseUrl, staticDir: "/work/app/dist" },
  );

const onServer = <A, E>(
  query: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* query(yield* SqlClient.SqlClient);
    }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(serverUrl) }))),
  );

describe("testServerEnv", () => {
  it("runs on the given port and serves the built app", () => {
    const env = settings(undefined, 8803);
    expect(env.PORT).toBe("8803");
    expect(env.STATIC_DIR).toBe("/work/app/dist");
    expect(env.NODE_ENV).toBe("production");
  });

  it("uses the database it is given (AC-2)", () => {
    const url =
      "postgres://skjera:skjera@localhost:5433/skjera_testserver_8801_cd";
    expect(settings(undefined, 8801, url).DATABASE_URL).toBe(url);
  });

  it("is at http://localhost when no address is set (AC-3)", () => {
    expect(settings(undefined).SITE_URL).toBe("http://localhost:8801");
    expect(settings("").SITE_URL).toBe("http://localhost:8801");
  });

  it("is at the address that is set, with the port (AC-3)", () => {
    expect(settings("https://box.example.ts.net").SITE_URL).toBe(
      "https://box.example.ts.net:8801",
    );
    expect(settings("http://box.lan", 8804).SITE_URL).toBe(
      "http://box.lan:8804",
    );
  });

  it.each([
    "box.lan",
    "https://box.lan:8443",
    "https://box.lan/",
    "https://box.lan/path",
    "ftp://box.lan",
  ])("refuses the address %s and names the setting (AC-3)", (address) => {
    expect(() => settings(address)).toThrow(/SKJERA_TEST_SERVER_URL/);
  });

  it("sends the browser to Dex at the address that is set, and keeps the issuer (AC-4)", () => {
    const env = settings("https://box.example.ts.net");
    expect(env.OAUTH_REDIRECT_URI).toBe(
      "https://box.example.ts.net:8801/auth/callback",
    );
    expect(env.OAUTH_AUTHORIZATION_ENDPOINT).toBe(
      "https://box.example.ts.net:5556/dex/auth",
    );
    expect(Object.keys(env)).not.toContain("OAUTH_ISSUER");
  });

  it("logs in at localhost when no address is set (AC-4)", () => {
    const env = settings(undefined);
    expect(env.OAUTH_REDIRECT_URI).toBe("http://localhost:8801/auth/callback");
    expect(env.OAUTH_AUTHORIZATION_ENDPOINT).toBe(
      "http://localhost:5556/dex/auth",
    );
  });

  it("refuses to start without the development login settings (AC-4)", () => {
    expect(() =>
      testServerEnv(
        {},
        { port: 8801, databaseUrl: serverUrl, staticDir: "/work/app/dist" },
      ),
    ).toThrow(/OAUTH_ISSUER/);
  });
});

describe("createDatabase", () => {
  const made: string[] = [];

  afterEach(async () => {
    for (const name of made.splice(0)) {
      await onServer((sql) => sql.unsafe(`DROP DATABASE ${name} WITH (FORCE)`));
    }
  });

  it("makes a new database each time, never the development one (AC-2)", async () => {
    const first = await createDatabase(serverUrl, 8801);
    const second = await createDatabase(serverUrl, 8801);
    const names = [first, second].map((url) => new URL(url).pathname.slice(1));
    made.push(...names);

    expect(names[0]).not.toBe(names[1]);
    for (const name of names) {
      expect(name).toMatch(/^skjera_testserver_8801_[0-9a-f]+$/);
      expect(name).not.toBe("skjera");
    }

    const list = await onServer(
      (sql) => sql<{ datname: string }>`SELECT datname FROM pg_database`,
    );
    for (const name of names) {
      expect(list.map((row) => row.datname)).toContain(name);
    }

    const expected = new URL(serverUrl);
    for (const url of [first, second]) {
      const actual = new URL(url);
      expect(actual.host).toBe(expected.host);
      expect(actual.username).toBe(expected.username);
      expect(actual.password).toBe(expected.password);
    }
  });
});
