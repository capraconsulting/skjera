import * as A from "@automerge/automerge/slim";
import type {
  DocumentId,
  EventContent,
  Publication,
  Team,
} from "@skjera/documents/api";
import { Deferred, Effect, Fiber, Schedule, Semaphore, Stream } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { LocalDocHandle } from "../editor/LocalDocHandle.ts";
import { DocumentsClient, runtime } from "./client.ts";

export interface SessionState {
  /** The replica being edited; replaced when the session has to reload. */
  readonly handle: LocalDocHandle<EventContent> | null;
  /** The team the document belongs to, once it is open. */
  readonly team: Team | null;
  /** Local changes the server doesn't have yet. */
  readonly saving: boolean;
  readonly publication: Publication | null;
  readonly publishing: boolean;
  readonly error: string | null;
  /** Someone deleted the document; the session has stopped. */
  readonly deleted: boolean;
  readonly publish: () => void;
  /** Deletes the document. Resolves when it's gone. */
  readonly remove: () => Promise<void>;
}

class SessionStore {
  #state: SessionState = {
    handle: null,
    team: null,
    saving: false,
    publication: null,
    publishing: false,
    error: null,
    deleted: false,
    publish: () => {},
    remove: () => Promise.resolve(),
  };
  readonly #listeners = new Set<() => void>();

  get = (): SessionState => this.#state;

  set(patch: Partial<SessionState>): void {
    const keys = Object.keys(patch) as Array<keyof SessionState>;
    if (keys.every((key) => patch[key] === this.#state[key])) return;
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
}

const randomActorId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const sendEvery = "250 millis";

const toLogin = () =>
  Effect.sync(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.assign(
      `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }).pipe(Effect.andThen(Effect.never));

/**
 * One replica of a document, with a fresh actor id, kept in sync with the
 * server until it has to be thrown away: after the server rejects one of its
 * changes, every later change builds on it and would be rejected too.
 * Completes with "reload" in that case, or "deleted" when the document is.
 */
const replica = (id: DocumentId, store: SessionStore) =>
  Effect.gen(function* () {
    const client = yield* DocumentsClient;
    const services = yield* Effect.context<DocumentsClient>();
    const actor = randomActorId();
    const opened = yield* client.OpenDocument({ id, actor });

    const pending: Array<A.Change> = [];
    const handle = new LocalDocHandle<EventContent>(
      A.load<EventContent>(opened.draft, actor),
      {
        onLocalChange: (change) => {
          pending.push(change);
          store.set({ saving: true });
        },
      },
    );
    const done = yield* Deferred.make<"reload" | "deleted">();
    const sending = yield* Semaphore.make(1);

    // Sends everything pending, including changes made while sending. Run
    // with the `sending` permit, so batches go out one at a time.
    const sendPending = Effect.gen(function* () {
      while (pending.length > 0) {
        const batch = pending.slice();
        yield* client.SendChanges({ id, changes: batch });
        pending.splice(0, batch.length);
      }
      store.set({ saving: false });
    });
    const flush = Semaphore.withPermits(sending, 1)(sendPending);

    const rejected = (message: string) =>
      Effect.sync(() => store.set({ error: message })).pipe(
        Effect.andThen(Deferred.succeed(done, "reload")),
      );

    const sendLoop = flush.pipe(
      Effect.catchTags({
        Unauthorized: toLogin,
        InvalidContent: (error) => rejected(error.message),
        InvalidChanges: (error) => rejected(error.message),
        ActorNotAllowed: () => rejected("Changes were refused"),
        DocumentNotFound: () => rejected("The document was deleted"),
        // Offline: keep the changes and try again.
        RpcClientError: () => Effect.void,
      }),
      Effect.andThen(Effect.sleep(sendEvery)),
      Effect.forever,
    );

    const catchUp = client
      .ChangesSince({ id, heads: A.getHeads(handle.doc()) })
      .pipe(Effect.map((changes) => handle.applyIncremental(changes)));

    const watchLoop = client.WatchDocument({ id }).pipe(
      // Handling an event can wait on another call over the same socket,
      // which must not wait for this stream in turn: the client reads the
      // socket into a small buffer per stream, and stops reading, replies
      // included, while one is full. So always read the stream right away.
      Stream.buffer({ capacity: "unbounded" }),
      Stream.runForEach((event) => {
        switch (event._tag) {
          case "DocumentDeleted":
            return Deferred.succeed(done, "deleted");
          case "DraftChanged":
            return event.heads !== undefined &&
              A.hasHeads(handle.doc(), [...event.heads])
              ? Effect.void
              : catchUp;
          case "CatchUp":
            return catchUp;
        }
      }),
      Effect.catchTag("Unauthorized", toLogin),
      // The stream ends or fails when the connection drops; watching again
      // starts with a catch-up.
      Effect.ignore,
      Effect.andThen(Effect.sleep("1 second")),
      Effect.forever,
    );

    // Publishes exactly what this replica shows, after the server has it all.
    const publish = Semaphore.withPermits(
      sending,
      1,
    )(
      sendPending.pipe(
        // Read synchronously after the last send: the server has every head.
        Effect.andThen(() =>
          client.Publish({ id, heads: A.getHeads(handle.doc()) }),
        ),
      ),
    ).pipe(
      Effect.tap((publication) =>
        Effect.sync(() => store.set({ publication, error: null })),
      ),
      Effect.catch((error) =>
        Effect.sync(() =>
          store.set({
            error:
              "message" in error && typeof error.message === "string"
                ? error.message
                : "Publishing failed",
          }),
        ),
      ),
      Effect.ensuring(Effect.sync(() => store.set({ publishing: false }))),
    );

    store.set({
      handle,
      team: opened.team,
      saving: false,
      publication: opened.publication,
      publishing: false,
      publish: () => {
        store.set({ publishing: true });
        void Effect.runPromiseWith(services)(publish);
      },
      remove: () =>
        Effect.runPromiseWith(services)(client.DeleteDocument({ id })),
    });

    return yield* Effect.raceFirst(
      Deferred.await(done),
      Effect.all([sendLoop, watchLoop], {
        concurrency: "unbounded",
        discard: true,
      }),
    );
  });

const runSession = (id: DocumentId, store: SessionStore) =>
  replica(id, store).pipe(
    Effect.repeat({ while: (outcome) => outcome === "reload" }),
    Effect.tap(() =>
      Effect.sync(() =>
        store.set({ deleted: true, error: "This event was deleted" }),
      ),
    ),
    Effect.catchTags({
      Unauthorized: toLogin,
      DocumentNotFound: () =>
        Effect.sync(() => store.set({ error: "Document not found" })),
      ActorNotAllowed: () =>
        Effect.sync(() => store.set({ error: "Could not open the document" })),
    }),
    // Couldn't reach the server to open the document: try again.
    Effect.retry(Schedule.spaced("1 second")),
  );

/**
 * Edits a document together with everyone else who has it open. Mount the
 * component using it with `key={id}`, so another document gets a new session.
 */
export function useDocumentSession(id: DocumentId): SessionState {
  const [store] = useState(() => new SessionStore());
  useEffect(() => {
    const fiber = runtime.runFork(runSession(id, store));
    return () => {
      runtime.runFork(Fiber.interrupt(fiber));
    };
  }, [id, store]);
  return useSyncExternalStore(store.subscribe, store.get);
}
