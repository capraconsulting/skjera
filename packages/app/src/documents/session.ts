import * as A from "@automerge/automerge/slim";
import {
  type DocHandle,
  decodeHeads,
  type StorageId,
} from "@automerge/automerge-repo/slim";
import {
  type DocumentId,
  type EventContent,
  isSyncRefused,
  serverStorageId,
  type TeamId,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { eq } from "@tanstack/react-db";
import { Effect, Fiber, Schedule } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DraftPresence } from "../presence/presence.ts";
import { sayWhy } from "../problems.ts";
import {
  discardChanges,
  documents,
  events,
  publishDraft,
  unpublishDocument,
} from "../sync/tables.ts";
import { forgetLocal, openDraft } from "./repo.ts";

export interface SessionState {
  /** The local copy being edited, once it's open. */
  readonly handle: DocHandle<EventContent> | null;
  /** Who else has it open. */
  readonly presence: DraftPresence | null;
  /** The team the document belongs to, once it is open. */
  readonly teamId: TeamId | null;
  /** Local changes the server doesn't have yet. */
  readonly saving: boolean;
  readonly publishing: boolean;
  readonly unpublishing: boolean;
  readonly discarding: boolean;
  readonly error: string | null;
  /** Someone deleted the document; the session has stopped. */
  readonly deleted: boolean;
  readonly publish: () => void;
  readonly unpublish: () => void;
  readonly discard: () => void;
}

class SessionStore {
  #state: SessionState = {
    handle: null,
    presence: null,
    teamId: null,
    saving: false,
    publishing: false,
    unpublishing: false,
    discarding: false,
    error: null,
    deleted: false,
    publish: () => {},
    unpublish: () => {},
    discard: () => {},
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

/** How long publishing and discarding wait for the server to have every edit. */
const saveTimeout = "10 seconds";

class DocumentNotFound {
  readonly _tag = "DocumentNotFound";
}

class NotSavedYet {
  readonly _tag = "NotSavedYet";
}

/**
 * Edits happen on the local copy of the document, which automerge-repo
 * keeps in sync with the server (see repo.ts); this follows along for the
 * editor: whether the server has every edit, whether it refused some, and
 * publishing. It ends when the document is deleted.
 */
const session = (id: DocumentId, store: SessionStore) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => documents.collection.preload());
    const row = documents.collection.get(id);
    if (row === undefined) return yield* Effect.fail(new DocumentNotFound());
    const handle = yield* Effect.tryPromise({
      try: () => openDraft<EventContent>(id),
      catch: () => new DocumentNotFound(),
    });

    /** Whether the server has every edit in the local copy. */
    const saved = () => {
      const known = handle.getSyncInfo(serverStorageId as StorageId);
      if (known === undefined) return false;
      const heads = decodeHeads(known.lastHeads);
      const doc = handle.doc();
      return (
        A.hasHeads(doc, heads) && A.getChangesSince(doc, heads).length === 0
      );
    };

    // The title and date in lists come from the synced document row, which
    // the server updates as it saves: pull it once typing pauses.
    let listTimer: ReturnType<typeof setTimeout> | undefined;
    const showSaving = () => {
      const isSaved = saved();
      store.set({ saving: !isSaved });
      if (isSaved) {
        clearTimeout(listTimer);
        listTimer = setTimeout(() => void documents.refresh(), 1000);
      }
    };
    const onRefused = ({ message }: { readonly message: unknown }) => {
      if (isSyncRefused(message)) {
        store.set({
          error: m.studio_save_refused({ reason: message.message }),
        });
      }
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        handle.on("change", showSaving);
        handle.on("remote-heads", showSaving);
        handle.on("ephemeral-message", onRefused);
      }),
      () =>
        Effect.sync(() => {
          handle.off("change", showSaving);
          handle.off("remote-heads", showSaving);
          handle.off("ephemeral-message", onRefused);
          clearTimeout(listTimer);
        }),
    );

    /**
     * The copy's version, once the server has all of it. It fails with
     * `unsaved`'s message if that takes too long.
     */
    const savedVersion = (unsaved: () => string) =>
      Effect.suspend(() =>
        saved()
          ? Effect.succeed(A.getHeads(handle.doc()))
          : Effect.fail(new NotSavedYet()),
      ).pipe(
        Effect.retry({ schedule: Schedule.spaced("100 millis") }),
        Effect.timeoutOrElse({
          duration: saveTimeout,
          orElse: () => Effect.fail(new Error(unsaved())),
        }),
      );

    // Publishes what this copy shows, once the server has all of it.
    const publish = savedVersion(() => m.studio_publish_unsaved()).pipe(
      Effect.flatMap((heads) => publishDraft(id, heads)),
      // The published version reaches the page as a row of `events`.
      Effect.tap(() =>
        Effect.promise(() => events.refresh()).pipe(
          Effect.andThen(Effect.sync(() => store.set({ error: null }))),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() =>
          store.set({ error: sayWhy(error, m.studio_publish_failed()) }),
        ),
      ),
      Effect.ensuring(Effect.sync(() => store.set({ publishing: false }))),
    );

    // Takes the published version off the site; the draft stays.
    const unpublish = unpublishDocument(id).pipe(
      // Its row leaves `events` at once, as a sync would take it.
      Effect.tap(() =>
        Effect.promise(() => events.refresh()).pipe(
          Effect.andThen(Effect.sync(() => store.set({ error: null }))),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() =>
          store.set({ error: sayWhy(error, m.studio_unpublish_failed()) }),
        ),
      ),
      Effect.ensuring(Effect.sync(() => store.set({ unpublishing: false }))),
    );

    // Goes back to the published version, once the server has every edit
    // this copy has, so they are discarded too. The change reaches the copy
    // through the sync, and the published row through the refresh.
    const discard = savedVersion(() => m.studio_discard_unsaved()).pipe(
      Effect.andThen(discardChanges(id)),
      Effect.tap(() =>
        Effect.promise(() => events.refresh()).pipe(
          Effect.andThen(Effect.sync(() => store.set({ error: null }))),
        ),
      ),
      Effect.catch((error) =>
        Effect.sync(() =>
          store.set({ error: sayWhy(error, m.studio_discard_failed()) }),
        ),
      ),
      Effect.ensuring(Effect.sync(() => store.set({ discarding: false }))),
    );

    const presence = yield* Effect.acquireRelease(
      Effect.sync(() => new DraftPresence(handle as DocHandle<unknown>)),
      (presence) => Effect.sync(() => presence.stop()),
    );

    store.set({
      handle,
      presence,
      teamId: row.teamId,
      publishing: false,
      unpublishing: false,
      discarding: false,
      publish: () => {
        store.set({ publishing: true });
        void Effect.runPromise(publish);
      },
      unpublish: () => {
        store.set({ unpublishing: true });
        void Effect.runPromise(unpublish);
      },
      discard: () => {
        store.set({ discarding: true });
        void Effect.runPromise(discard);
      },
    });
    showSaving();

    // Until its row goes: someone deleted it.
    yield* Effect.callback<void>((resume) => {
      // It only reports deleting rows it has reported, so start with it.
      const subscription = documents.collection.subscribeChanges(
        (changes) => {
          if (changes.some((change) => change.type === "delete")) {
            resume(Effect.void);
          }
        },
        {
          includeInitialState: true,
          where: (document) => eq(document.id, id),
        },
      );
      return Effect.sync(() => subscription.unsubscribe());
    });
    forgetLocal(id);
  }).pipe(Effect.scoped);

const runSession = (id: DocumentId, store: SessionStore) =>
  session(id, store).pipe(
    Effect.tap(() =>
      Effect.sync(() =>
        store.set({ deleted: true, error: m.studio_event_deleted() }),
      ),
    ),
    Effect.catchTag("DocumentNotFound", () =>
      Effect.sync(() => store.set({ error: m.studio_document_missing() })),
    ),
  );

/**
 * Edits a document together with everyone else who has it open. Mount the
 * component using it with `key={id}`, so another document gets a new session.
 */
export function useDocumentSession(id: DocumentId): SessionState {
  const [store] = useState(() => new SessionStore());
  useEffect(() => {
    const fiber = Effect.runFork(runSession(id, store));
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [id, store]);
  return useSyncExternalStore(store.subscribe, store.get);
}
