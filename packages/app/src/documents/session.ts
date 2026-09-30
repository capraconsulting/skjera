import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type {
  DocumentId,
  EventContent,
  Publication,
  Team,
} from "@skjera/documents/api";
import {
  Deferred,
  Effect,
  Fiber,
  Queue,
  Schedule,
  Semaphore,
  Stream,
} from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DocumentsClient, runtime } from "./client.ts";
import { forgetLocal, openLocal } from "./repo.ts";

export interface SessionState {
  /** The local copy being edited, once it's open. */
  readonly handle: DocHandle<EventContent> | null;
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

/** Syncs at least this often, in case a notification was missed. */
const syncEvery = "5 seconds";
/** Waits this long after an edit, so a burst of keystrokes syncs at once. */
const settle = "100 millis";

const sameHeads = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((head) => b.includes(head));

const toLogin = () =>
  Effect.sync(() => {
    const returnTo = window.location.pathname + window.location.search;
    window.location.assign(
      `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }).pipe(Effect.andThen(Effect.never));

/**
 * Edits happen on the local copy of the document (see repo.ts); this keeps
 * it in sync with the server until the document is deleted. Each sync round
 * pulls what the server has that the local copy doesn't and merges it in,
 * then pushes what the server doesn't have. Nothing is ever replaced: if the
 * server refuses changes, they stay in the local copy.
 */
const session = (id: DocumentId, store: SessionStore) =>
  Effect.gen(function* () {
    const client = yield* DocumentsClient;
    const services = yield* Effect.context<DocumentsClient>();
    const opened = yield* client.OpenDocument({ id });
    const handle = yield* Effect.promise(() =>
      openLocal<EventContent>(id, opened.draft),
    );

    /** Heads the server has, all of them in the local copy too. */
    let synced: ReadonlyArray<string> = opened.heads;
    const showSaving = () =>
      store.set({ saving: !sameHeads(A.getHeads(handle.doc()), synced) });

    // Wakes the sync loop up early: after edits and news from the server.
    const wake = yield* Queue.sliding<void>(1);
    const nudge = () => void Queue.offerUnsafe(wake, undefined);
    const onChange = () => {
      showSaving();
      nudge();
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => handle.on("change", onChange)),
      () => Effect.sync(() => handle.off("change", onChange)),
    );

    const pull = client.ChangesSince({ id, heads: [...synced] }).pipe(
      Effect.tap(({ changes, heads }) =>
        Effect.sync(() => {
          if (changes.length > 0) {
            handle.update((doc) => A.loadIncremental(doc, changes));
          }
          if (A.hasHeads(handle.doc(), [...heads])) synced = heads;
        }),
      ),
    );
    const push = Effect.suspend(() => {
      const doc = handle.doc();
      const changes = A.getChangesSince(doc, [...synced]);
      if (changes.length === 0) return Effect.void;
      const heads = A.getHeads(doc);
      return client.SendChanges({ id, changes }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            synced = heads;
          }),
        ),
      );
    });

    const done = yield* Deferred.make<void>();
    // Rounds and publishing take turns, so each sees what the other did.
    const syncing = yield* Semaphore.make(1);
    let refused = false;
    const round = Semaphore.withPermits(
      syncing,
      1,
    )(pull.pipe(Effect.andThen(push))).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          if (refused) store.set({ error: null });
          refused = false;
        }),
      ),
      Effect.catchTags({
        Unauthorized: toLogin,
        InvalidContent: (error) => refuse(error.message),
        InvalidChanges: (error) => refuse(error.message),
        ActorNotAllowed: () => refuse("Changes were refused"),
        DocumentNotFound: () => Deferred.succeed(done, undefined),
        // Offline: the changes are kept; the next round tries again.
        RpcClientError: () => Effect.void,
      }),
      Effect.andThen(Effect.sync(showSaving)),
    );
    const refuse = (message: string) =>
      Effect.sync(() => {
        refused = true;
        store.set({ error: `Couldn't save your changes: ${message}` });
      });

    const syncLoop = round.pipe(
      Effect.andThen(
        Queue.take(wake).pipe(Effect.timeout(syncEvery), Effect.ignore),
      ),
      Effect.andThen(Effect.sleep(settle)),
      Effect.forever,
    );

    const watchLoop = client.WatchDocument({ id }).pipe(
      // Handling an event can wait on another call over the same socket,
      // which must not wait for this stream in turn: the client reads the
      // socket into a small buffer per stream, and stops reading, replies
      // included, while one is full. So always read the stream right away.
      Stream.buffer({ capacity: "unbounded" }),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          switch (event._tag) {
            case "DocumentDeleted":
              Deferred.doneUnsafe(done, Effect.void);
              return;
            case "DraftChanged":
              if (
                event.heads === undefined ||
                !A.hasHeads(handle.doc(), [...event.heads])
              ) {
                nudge();
              }
              return;
            case "CatchUp":
              nudge();
              return;
          }
        }),
      ),
      Effect.catchTag("Unauthorized", toLogin),
      // The stream ends or fails when the connection drops; watching again
      // starts with a catch-up.
      Effect.ignore,
      Effect.andThen(Effect.sleep("1 second")),
      Effect.forever,
    );

    // Publishes what this copy shows, once the server has all of it.
    const publish = Semaphore.withPermits(
      syncing,
      1,
    )(
      push.pipe(
        Effect.andThen(() => client.Publish({ id, heads: [...synced] })),
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
      publication: opened.publication,
      publishing: false,
      publish: () => {
        store.set({ publishing: true });
        void Effect.runPromiseWith(services)(publish);
      },
      remove: () =>
        Effect.runPromiseWith(services)(client.DeleteDocument({ id })),
    });
    showSaving();

    yield* Effect.raceFirst(
      Deferred.await(done),
      Effect.all([syncLoop, watchLoop], {
        concurrency: "unbounded",
        discard: true,
      }),
    );
    forgetLocal(id);
  }).pipe(Effect.scoped);

const runSession = (id: DocumentId, store: SessionStore) =>
  session(id, store).pipe(
    Effect.tap(() =>
      Effect.sync(() =>
        store.set({ deleted: true, error: "This event was deleted" }),
      ),
    ),
    Effect.catchTags({
      Unauthorized: toLogin,
      DocumentNotFound: () =>
        Effect.sync(() => store.set({ error: "Document not found" })),
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
