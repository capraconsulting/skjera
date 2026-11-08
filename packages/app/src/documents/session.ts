import * as A from "@automerge/automerge/slim";
import {
  type DocHandle,
  decodeHeads,
  type StorageId,
} from "@automerge/automerge-repo/slim";
import {
  type CancellingNotice,
  type DocumentId,
  type EventContent,
  isSyncRefused,
  type PublishingNotice,
  serverStorageId,
  type TeamId,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { eq } from "@tanstack/react-db";
import { Effect, Fiber } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DraftPresence } from "../presence/presence.ts";
import { sayWhy } from "../problems.ts";
import { confirmNotice } from "../routes/studio/attendeeNotices.ts";
import {
  cancellingNotice,
  copyDocument,
  discardChanges,
  documents,
  events,
  moveDocument,
  publishDraft,
  publishingNotice,
  restoreVersion,
  unpublishDocument,
} from "../sync/tables.ts";
import { forgetLocal, openDraft } from "./repo.ts";
import { savedVersion as versionOnceSaved } from "./savedVersion.ts";

export interface SessionState {
  /** The local copy being edited, once it's open. */
  readonly handle: DocHandle<EventContent> | null;
  /** Who else has it open. */
  readonly presence: DraftPresence | null;
  /** The team the document belongs to, once it is open. */
  readonly teamId: TeamId | null;
  /** When the event was first published, if it has been; kept once unpublished. */
  readonly firstPublishedAt: Date | null;
  /** Local changes the server doesn't have yet. */
  readonly saving: boolean;
  readonly publishing: boolean;
  readonly unpublishing: boolean;
  readonly discarding: boolean;
  readonly restoring: boolean;
  readonly copying: boolean;
  readonly moving: boolean;
  readonly error: string | null;
  /** Someone deleted the document; the session has stopped. */
  readonly deleted: boolean;
  readonly publish: (confirm: (notice: PublishingNotice) => boolean) => void;
  readonly unpublish: (confirm: (notice: CancellingNotice) => boolean) => void;
  readonly discard: () => void;
  /** Makes the draft the version at `heads`, without publishing. */
  readonly restore: (heads: ReadonlyArray<string>) => void;
  /** Makes a copy of the event and calls `opened` with the copy's id. */
  readonly copy: (opened: (copy: DocumentId) => void) => void;
  /** Moves the event to another team; the editor follows once the row does. */
  readonly move: (team: TeamId) => void;
}

class SessionStore {
  #state: SessionState = {
    handle: null,
    presence: null,
    teamId: null,
    firstPublishedAt: null,
    saving: false,
    publishing: false,
    unpublishing: false,
    discarding: false,
    restoring: false,
    copying: false,
    moving: false,
    error: null,
    deleted: false,
    publish: () => {},
    unpublish: () => {},
    discard: () => {},
    restore: () => {},
    copy: () => {},
    move: () => {},
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

class DocumentNotFound {
  readonly _tag = "DocumentNotFound";
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
      versionOnceSaved(
        { saved, version: () => A.getHeads(handle.doc()) },
        unsaved,
      );

    // Publishes what this copy shows, once the server has all of it.
    const publish = (confirm: (notice: PublishingNotice) => boolean) =>
      savedVersion(() => m.studio_publish_unsaved()).pipe(
        Effect.flatMap((heads) =>
          Effect.tryPromise({
            try: async () => {
              const first = await Effect.runPromise(
                publishingNotice(id, heads),
              );
              let current = first;
              await confirmNotice(
                first,
                (notice) => {
                  current = notice;
                  return "publish";
                },
                () => confirm(current),
                async (confirmed) => {
                  const result = await Effect.runPromise(
                    publishDraft(id, heads, confirmed),
                  );
                  return "_tag" in result
                    ? {
                        _tag: "NoticeChanged" as const,
                        notice: result.notice as PublishingNotice,
                      }
                    : undefined;
                },
              );
            },
            catch: (error) => error,
          }),
        ),
        // The published version reaches the page as a row of `events`; the
        // document's row says it was published, which locks the organizer.
        Effect.tap(() =>
          Effect.promise(() =>
            Promise.all([events.refresh(), documents.refresh()]),
          ).pipe(Effect.andThen(Effect.sync(() => store.set({ error: null })))),
        ),
        Effect.catch((error) =>
          Effect.sync(() =>
            store.set({ error: sayWhy(error, m.studio_publish_failed()) }),
          ),
        ),
        Effect.ensuring(Effect.sync(() => store.set({ publishing: false }))),
      );

    // Takes the published version off the site; the draft stays.
    const unpublish = (confirm: (notice: CancellingNotice) => boolean) =>
      Effect.tryPromise({
        try: async () => {
          const first = await Effect.runPromise(cancellingNotice(id));
          let current = first;
          await confirmNotice(
            first,
            (notice) => {
              current = notice;
              return "unpublish";
            },
            () => confirm(current),
            async (confirmed) => {
              const result = await Effect.runPromise(
                unpublishDocument(id, confirmed),
              );
              return result === undefined
                ? undefined
                : {
                    _tag: "NoticeChanged" as const,
                    notice: result.notice as CancellingNotice,
                  };
            },
          );
        },
        catch: (error) => error,
      }).pipe(
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

    // Makes the draft a version from its history, once the server has every
    // edit this copy has, so the restoring comes after them. The change
    // reaches the copy through the sync.
    const restore = (heads: ReadonlyArray<string>) =>
      savedVersion(() => m.studio_restore_unsaved()).pipe(
        Effect.andThen(restoreVersion(id, heads)),
        Effect.tap(() => Effect.sync(() => store.set({ error: null }))),
        Effect.catch((error) =>
          Effect.sync(() =>
            store.set({ error: sayWhy(error, m.studio_restore_failed()) }),
          ),
        ),
        Effect.ensuring(Effect.sync(() => store.set({ restoring: false }))),
      );

    // Copies the server's draft, once it has every edit this copy has, so the
    // last words typed are in the copy. The copy's row is pulled before it is
    // opened, as the editor needs it.
    const copy = (opened: (copy: DocumentId) => void) =>
      savedVersion(() => m.studio_copy_unsaved()).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            const copyId = crypto.randomUUID() as DocumentId;
            return copyDocument(id, copyId).pipe(Effect.as(copyId));
          }),
        ),
        Effect.tap(() => Effect.promise(() => documents.refresh())),
        Effect.tap((copyId) =>
          Effect.sync(() => {
            store.set({ error: null });
            opened(copyId);
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() =>
            store.set({ error: sayWhy(error, m.studio_copy_failed()) }),
          ),
        ),
        Effect.ensuring(Effect.sync(() => store.set({ copying: false }))),
      );

    // Moves the event to another team. The row is pulled again, and the
    // session follows its team from there.
    const move = (team: TeamId) =>
      moveDocument(id, team).pipe(
        Effect.tap(() => Effect.promise(() => documents.refresh())),
        Effect.tap(() => Effect.sync(() => store.set({ error: null }))),
        Effect.catch((error) =>
          Effect.sync(() =>
            store.set({ error: sayWhy(error, m.common_something_wrong()) }),
          ),
        ),
        Effect.ensuring(Effect.sync(() => store.set({ moving: false }))),
      );

    const presence = yield* Effect.acquireRelease(
      Effect.sync(() => new DraftPresence(handle as DocHandle<unknown>)),
      (presence) => Effect.sync(() => presence.stop()),
    );

    store.set({
      handle,
      presence,
      teamId: row.teamId,
      firstPublishedAt: row.firstPublishedAt,
      publishing: false,
      unpublishing: false,
      discarding: false,
      restoring: false,
      copying: false,
      moving: false,
      publish: (confirm) => {
        store.set({ publishing: true });
        void Effect.runPromise(publish(confirm));
      },
      unpublish: (confirm) => {
        store.set({ unpublishing: true });
        void Effect.runPromise(unpublish(confirm));
      },
      discard: () => {
        store.set({ discarding: true });
        void Effect.runPromise(discard);
      },
      restore: (heads) => {
        store.set({ restoring: true });
        void Effect.runPromise(restore(heads));
      },
      copy: (opened) => {
        store.set({ copying: true });
        void Effect.runPromise(copy(opened));
      },
      move: (team) => {
        store.set({ moving: true });
        void Effect.runPromise(move(team));
      },
    });
    showSaving();

    // Until its row goes: someone deleted it.
    yield* Effect.callback<void>((resume) => {
      // It only reports deleting rows it has reported, so start with it.
      const subscription = documents.collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === "delete") resume(Effect.void);
            else {
              store.set({
                teamId: change.value.teamId,
                firstPublishedAt: change.value.firstPublishedAt,
              });
            }
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
