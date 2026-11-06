// Fills the local database with the teams and events docs/acceptance describes,
// or empties it of them. Run with `mise run testdata` and
// `mise run testdata:clear`, which set DATABASE_URL and the rest of the
// development settings.
import {
  Announcements,
  Attendance,
  Database,
  Documents,
  Images,
  Notifications,
  SalesEvents,
  Teams,
} from "@skjera/documents";
import { Identity } from "@skjera/oauth/api";
import { Effect, Layer } from "effect";
import type { SqlClient } from "effect/sql";
import { Temporal } from "temporal-polyfill";
import {
  acceptanceDirectory,
  readFeatures,
  withSteps,
} from "./testdata/acceptance.ts";
import { catalogue } from "./testdata/catalogue.ts";
import { clear, fill, type People, type Report } from "./testdata/fill.ts";

type Env = Readonly<Record<string, string | undefined>>;

/** `url`, if it is a database on localhost or 127.0.0.1; else why not. */
export const localDatabase = (url: string | undefined): string => {
  if (url === undefined || url === "")
    throw new Error(
      "DATABASE_URL is not set; run this with mise's environment.",
    );
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a URL. Nothing was changed.");
  }
  if (host !== "localhost" && host !== "127.0.0.1")
    throw new Error(
      `DATABASE_URL points at ${host}, and testdata only runs on a database on localhost or 127.0.0.1. Nothing was changed.`,
    );
  return url;
};

/**
 * A local user of Dex as the server sees them after login: the `sub` claim is
 * the base64 of a protobuf message holding the user id (field 1) and the
 * connector id "local" (field 2); ids are in dev/dex/config.yaml.
 */
const dexUser = (issuer: string, userId: string, name: string, email: string) =>
  new Identity({
    issuer,
    subject: Buffer.concat([
      Buffer.from([0x0a, userId.length]),
      Buffer.from(userId),
      Buffer.from([0x12, 5]),
      Buffer.from("local"),
    ]).toString("base64url"),
    email,
    name,
  });

/** alice, who organises, and bob, who signs up. */
export const people = (issuer: string): People => ({
  alice: dexUser(
    issuer,
    "00000000-0000-4000-8000-000000000001",
    "alice",
    "alice@example.com",
  ),
  bob: dexUser(
    issuer,
    "00000000-0000-4000-8000-000000000002",
    "bob",
    "bob@example.com",
  ),
});

/**
 * What the command runs on: teams, documents, signups and images, on
 * `database`. Notices stay in memory, and there is no cluster to queue emails
 * and Slack posts in, so nothing is sent.
 */
export const layerOn = <E>(database: Layer.Layer<SqlClient.SqlClient, E>) =>
  Layer.mergeAll(
    Teams.layer,
    Documents.layer,
    Attendance.layer,
    Images.Images.layer,
  ).pipe(
    Layer.provideMerge(Announcements.layerTest),
    Layer.provideMerge(SalesEvents.layerTest),
    Layer.provideMerge(Notifications.layerTest),
    Layer.provideMerge(database),
  );

/**
 * The catalogue as the command fills it: each event with the text that lists
 * the criteria using it and their manual test steps, read from
 * docs/acceptance now.
 */
export const teamsAt = (now: Temporal.ZonedDateTime) =>
  withSteps(catalogue(now), readFeatures(acceptanceDirectory));

const say = (report: Report) => {
  for (const team of report.removed) console.log(`Removed «${team}»`);
  for (const team of report.made)
    console.log(`Made «${team.team}» with ${team.events} events`);
  for (const event of report.deleted)
    console.log(`Deleted «${event.event}» in «${event.team}»: ${event.id}`);
};

/** Runs `fill` or `clear` on the database in `env`, if it is a local one. */
export const run = async (command: string, env: Env): Promise<void> => {
  if (command !== "fill" && command !== "clear")
    throw new Error("Usage: testdata.ts fill | clear");
  // Before anything connects.
  localDatabase(env.DATABASE_URL);
  const issuer = env.OAUTH_ISSUER;
  if (issuer === undefined || issuer === "")
    throw new Error(
      "OAUTH_ISSUER is not set; run this with mise's environment.",
    );
  const teams = teamsAt(Temporal.Now.zonedDateTimeISO("Europe/Oslo"));
  const command$ =
    command === "fill"
      ? fill(teams, people(issuer)).pipe(Effect.map(say))
      : clear(teams).pipe(
          Effect.map((removed) => say({ removed, made: [], deleted: [] })),
        );
  await Effect.runPromise(
    command$.pipe(Effect.provide(layerOn(Database.layer))),
  );
};

if (import.meta.main) {
  try {
    await run(process.argv[2] ?? "", process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
