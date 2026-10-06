import {
  type Answers,
  type AttendeeRow,
  AttendeesApi,
  type DocumentId,
  type DocumentRow,
  DocumentsApi,
  type EventRow,
  type GuestDetails,
  PublicSyncApi,
  type Snapshot,
  SyncApi,
  type TagRow,
  type TeamRow,
  TeamsApi,
} from "@skjera/documents/api";
import { BasicIndex, createCollection } from "@tanstack/react-db";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApi, HttpApiClient } from "effect/http-api";
import { type PublicClient, runPublic } from "../site/client.ts";
import { guestSignup, rememberGuestSignup } from "../site/guestSignups.ts";

class Api extends HttpApi.make("studio")
  .add(SyncApi)
  .add(PublicSyncApi)
  .add(TeamsApi)
  .add(DocumentsApi)
  .add(AttendeesApi) {}

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
 * Sends a change to a row to the server; rejects if it's refused.
 * `metadata` is what the change was made with, for what isn't in the row.
 */
type Write<Row> = (row: Row, metadata: unknown) => Promise<void>;

/**
 * A collection holding a copy of a server table. It pulls every row once,
 * then what changed since the previous pull (see Sync.ts on the server):
 * every few seconds while the page is visible, as soon as it's visible or
 * online again, and on `refresh`. Pulls run one at a time, each from where
 * the last ended.
 *
 * Changes made to the collection show at once. `write` sends them to the
 * server, then a pull brings them back, so the rows pulled already have the
 * change when it stops being shown on its own. A refused change is undone.
 */
const serverTable = <Row extends object>(options: {
  readonly id: string;
  readonly getKey: (row: Row) => string;
  readonly pull: (since: Snapshot | undefined) => Promise<Pulled<Row>>;
  readonly write?: {
    readonly insert?: Write<Row>;
    readonly update?: Write<Row>;
    readonly delete?: Write<Row>;
  };
}) => {
  let refresh = () => Promise.resolve();

  /** Writes each change in a transaction, in order, then pulls. */
  const persist =
    (send: Write<Row>) =>
    async ({
      transaction,
    }: {
      readonly transaction: {
        readonly mutations: ReadonlyArray<{
          readonly modified: Row;
          readonly metadata: unknown;
        }>;
      };
    }) => {
      for (const mutation of transaction.mutations) {
        await send(mutation.modified, mutation.metadata);
      }
      await refresh();
    };
  const { insert, update, delete: remove } = options.write ?? {};

  const collection = createCollection<Row, string>({
    id: options.id,
    getKey: options.getKey,
    ...(insert === undefined ? {} : { onInsert: persist(insert) }),
    ...(update === undefined ? {} : { onUpdate: persist(update) }),
    ...(remove === undefined ? {} : { onDelete: persist(remove) }),
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

/** Runs a write over the studio's API, failing with a message for people. */
const sendRequest = <E extends { readonly _tag: string }>(
  f: (client: Effect.Success<typeof makeClient>) => Effect.Effect<unknown, E>,
) =>
  request((client) =>
    f(client).pipe(
      Effect.asVoid,
      Effect.mapError((error) => new Error(failureMessage(error))),
    ),
  );

/** Runs a write over the site's API, failing with a message for people. */
const sendPublic = <E extends { readonly _tag: string }>(
  f: (client: PublicClient) => Effect.Effect<unknown, E>,
) =>
  runPublic((client) =>
    f(client).pipe(
      Effect.asVoid,
      Effect.mapError((error) => new Error(failureMessage(error))),
    ),
  );

const failureMessage = (failure: { readonly _tag: string }) =>
  failure._tag === "TeamNotEmpty"
    ? "Only teams without events can be deleted."
    : "message" in failure && typeof failure.message === "string"
      ? failure.message
      : "Something went wrong";

/** Tags published events have had: suggestions when tagging. */
export const tags = serverTable({
  id: "tags",
  getKey: (tag: TagRow) => tag.id,
  pull: (since) =>
    request((client) =>
      client.sync.tags({ query: since === undefined ? {} : { since } }),
    ),
});

export const teams = serverTable({
  id: "teams",
  getKey: (team: TeamRow) => team.id,
  pull: (since) =>
    request((client) =>
      client.sync.teams({ query: since === undefined ? {} : { since } }),
    ),
  write: {
    insert: (team) =>
      sendRequest((client) =>
        client.teams.create({ payload: { id: team.id, name: team.name } }),
      ),
    update: (team) =>
      sendRequest((client) =>
        client.teams.rename({
          params: { id: team.id },
          payload: { name: team.name },
        }),
      ),
    delete: (team) =>
      sendRequest((client) => client.teams.delete({ params: { id: team.id } })),
  },
});

export const documents = serverTable({
  id: "documents",
  getKey: (document: DocumentRow) => document.id,
  pull: (since) =>
    request((client) =>
      client.sync.documents({ query: since === undefined ? {} : { since } }),
    ),
  write: {
    insert: (document) =>
      sendRequest((client) =>
        client.documents.create({
          payload: {
            id: document.id,
            type: document.type,
            teamId: document.teamId,
          },
        }),
      ),
    // Gone already is as good as deleted.
    delete: (document) =>
      sendRequest((client) =>
        client.documents
          .delete({ params: { id: document.id } })
          .pipe(Effect.catchTag("DocumentNotFound", () => Effect.void)),
      ),
  },
});

/**
 * Publishes a draft as of `heads`, the version the user saw. The server
 * must have all of it. The published version arrives as a row of `events`.
 */
export const publishDraft = (id: DocumentId, heads: ReadonlyArray<string>) =>
  makeClient.pipe(
    Effect.flatMap((client) =>
      client.documents.update({
        params: { id },
        payload: { published: true, heads: [...heads] },
      }),
    ),
    Effect.provide(FetchHttpClient.layer),
  );

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
  write: {
    // Signing up, as the signed-in user or as a guest (see `Signup`).
    insert: (attendee, metadata) => {
      const { guest, dietary, answers } = metadata as Signup;
      return sendPublic((client) =>
        client.events
          .attend({
            params: { id: attendee.eventId },
            payload: {
              id: attendee.id,
              ...(guest === undefined ? {} : { guest }),
              ...(dietary === undefined ? {} : { dietary }),
              ...(answers === undefined ? {} : { answers }),
            },
          })
          .pipe(
            Effect.tap((signup) =>
              Effect.sync(() => {
                if (signup === null) return;
                rememberGuestSignup(attendee.eventId, {
                  id: attendee.id,
                  cancelToken: signup.cancelToken,
                  given: {
                    ...(dietary === undefined ? {} : { dietary }),
                    ...(answers === undefined ? {} : { answers }),
                  },
                });
              }),
            ),
          ),
      );
    },
    // Changing one's own answers; a guest's with the token they were given.
    update: (attendee, metadata) => {
      const change = metadata as SignupChange;
      const guest = guestSignup(attendee.eventId);
      if (guest?.id === attendee.id) {
        return sendPublic((client) =>
          client.events
            .changeAsGuest({
              params: { id: attendee.eventId, token: guest.cancelToken },
              payload: change,
            })
            .pipe(
              Effect.tap(() =>
                Effect.sync(() =>
                  rememberGuestSignup(attendee.eventId, {
                    ...guest,
                    given: change,
                  }),
                ),
              ),
            ),
        );
      }
      return sendPublic((client) =>
        client.events.change({
          params: { id: attendee.eventId },
          payload: change,
        }),
      );
    },
    // Cancelling one's own signup, a guest's with the token they were
    // given, or taking someone off as an organizer (see `Removal`).
    delete: (attendee, metadata) => {
      if ((metadata as Removal | undefined)?.asOrganizer === true) {
        return sendRequest((client) =>
          client.attendees.remove({ params: { id: attendee.id } }),
        );
      }
      const guest = guestSignup(attendee.eventId);
      if (guest?.id === attendee.id) {
        return sendPublic((client) =>
          client.events
            .leaveAsGuest({
              params: { id: attendee.eventId, token: guest.cancelToken },
            })
            // Gone either way: cancelled now, or already before.
            .pipe(
              Effect.catchTag("SignupNotFound", () => Effect.void),
              Effect.tap(() =>
                Effect.sync(() => rememberGuestSignup(attendee.eventId, null)),
              ),
            ),
        );
      }
      return sendPublic((client) =>
        client.events.leave({ params: { id: attendee.eventId } }),
      );
    },
  },
});

/**
 * What changing a signup sends: pass it as the update's metadata, and set
 * the row's `changedAt`, so the update has a change to send.
 */
export type SignupChange = {
  readonly dietary?: string;
  readonly answers?: Answers;
};

/** Pass as a delete's metadata to take someone off as an organizer. */
export type Removal = { readonly asOrganizer: true };

/** What signing up sends besides the row: pass it as the insert's metadata. */
export type Signup = {
  /** Signing up as a guest, without an account. */
  readonly guest?: GuestDetails;
  readonly dietary?: string;
  /** Answers to the event's questions, by question id. */
  readonly answers?: Answers;
};
