import {
  type AttendeeRow,
  type DocumentRow,
  type EventRow,
  PublicSyncApi,
  type Snapshot,
  SyncApi,
  type TeamRow,
} from "@skjera/documents/api";
import { BasicIndex, createCollection } from "@tanstack/react-db";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApi, HttpApiClient } from "effect/http-api";

class Api extends HttpApi.make("sync").add(SyncApi).add(PublicSyncApi) {}

const makeClient = HttpApiClient.make(Api, {
  baseUrl: window.location.origin,
});

const request = <A, E>(
  f: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>,
) =>
  Effect.runPromise(
    makeClient.pipe(Effect.flatMap(f), Effect.provide(FetchHttpClient.layer)),
  );

interface Pulled<Row> {
  readonly rows: ReadonlyArray<Row>;
  readonly deleted: ReadonlyArray<string>;
  readonly complete: boolean;
  readonly snapshot: Snapshot;
}

/** How often to pull what changed, while the page is visible. */
const pollEveryMs = 5_000;

/**
 * A collection holding a copy of a server table. It pulls every row once,
 * then what changed since the previous pull (see Sync.ts on the server):
 * every few seconds while the page is visible, as soon as it's visible or
 * online again, and on `refresh`. Pulls run one at a time, each from where
 * the last ended.
 */
const serverTable = <Row extends object>(options: {
  readonly id: string;
  readonly getKey: (row: Row) => string;
  readonly pull: (since: Snapshot | undefined) => Promise<Pulled<Row>>;
}) => {
  let refresh = () => Promise.resolve();

  const collection = createCollection<Row, string>({
    id: options.id,
    getKey: options.getKey,
    // Joins and filters look rows up by their fields.
    autoIndex: "eager",
    defaultIndexType: BasicIndex,
    sync: {
      sync: ({ begin, write, commit, markReady, markError, truncate }) => {
        let since: Snapshot | undefined;
        let stopped = false;
        const known = new Set<string>();

        const pull = async () => {
          const pulled = await options.pull(since);
          if (stopped) return;
          begin();
          if (pulled.complete) {
            truncate();
            known.clear();
          }
          for (const row of pulled.rows) {
            const key = options.getKey(row);
            write({ type: known.has(key) ? "update" : "insert", value: row });
            known.add(key);
          }
          for (const key of pulled.deleted) {
            if (known.delete(key)) write({ type: "delete", key });
          }
          commit();
          since = pulled.snapshot;
        };

        let inFlight = 1;
        let pulls = pull().finally(() => inFlight--);
        pulls.then(markReady, markError);
        refresh = () => {
          inFlight++;
          pulls = pulls
            .catch(() => undefined)
            .then(pull)
            .finally(() => inFlight--);
          return pulls.catch((error: unknown) => {
            console.warn(`Couldn't refresh ${options.id}`, error);
          });
        };

        // A poll skips while a pull is running rather than queue up.
        const poll = () => {
          if (inFlight === 0 && document.visibilityState === "visible") {
            void refresh();
          }
        };
        const timer = setInterval(poll, pollEveryMs);
        document.addEventListener("visibilitychange", poll);
        window.addEventListener("online", poll);
        return () => {
          stopped = true;
          clearInterval(timer);
          document.removeEventListener("visibilitychange", poll);
          window.removeEventListener("online", poll);
          refresh = () => Promise.resolve();
        };
      },
    },
  });

  return {
    collection,
    /** Pulls what changed, e.g. after a write. */
    refresh: () => refresh(),
  };
};

export const teams = serverTable({
  id: "teams",
  getKey: (team: TeamRow) => team.id,
  pull: (since) =>
    request((client) =>
      client.sync.teams({ query: since === undefined ? {} : { since } }),
    ),
});

export const documents = serverTable({
  id: "documents",
  getKey: (document: DocumentRow) => document.id,
  pull: (since) =>
    request((client) =>
      client.sync.documents({ query: since === undefined ? {} : { since } }),
    ),
});

/** Published events: every one for members, the public ones for anyone. */
export const events = serverTable({
  id: "events",
  getKey: (event: EventRow) => event.id,
  pull: (since) =>
    request((client) =>
      client.publicSync.events({ query: since === undefined ? {} : { since } }),
    ),
});

/**
 * Signups: for signed-in users all of them, with who signed up; for anyone
 * else those of public events, to count.
 */
export const attendees = serverTable({
  id: "attendees",
  getKey: (attendee: AttendeeRow) => attendee.id,
  pull: (since) =>
    request((client) =>
      client.publicSync.attendees({
        query: since === undefined ? {} : { since },
      }),
    ),
});
