import {
  type BinaryDocumentId,
  type DocHandle,
  interpretAsDocumentId,
  Repo,
} from "@automerge/automerge-repo/slim";
import { WebSocketClientAdapter } from "@automerge/automerge-repo-network-websocket";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import { type DocumentId, draftSyncPath } from "@skjera/documents/api";
import type { Identity } from "@skjera/oauth/api";

/**
 * Where a user's local copies are kept: a database of their own, so nobody
 * else signing in on the same browser picks up their unsynced edits.
 */
const storageFor = (user: Identity) =>
  new IndexedDBStorageAdapter(`skjera ${user.issuer} ${user.subject}`);

let user: Identity | undefined;
let repo: Repo | undefined;

/** Whose local copies to use. Set once it's known who is signed in. */
export const setLocalUser = (me: Identity) => {
  user = me;
};

const syncUrl = () => {
  const url = new URL(draftSyncPath, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

/**
 * The studio's local copies of the documents it opens, kept in IndexedDB so
 * no edit depends on reaching the server, and synced with the server over
 * automerge-repo's own protocol (see DraftSync.ts on the server).
 */
const theRepo = () => {
  if (repo === undefined) {
    if (user === undefined) throw new Error("Nobody is signed in");
    repo = new Repo({
      storage: storageFor(user),
      network: [new WebSocketClientAdapter(syncUrl())],
    });
    // It stores changes shortly after they're made; don't wait on leaving.
    window.addEventListener("pagehide", () => void repo?.flush());
  }
  return repo;
};

/** Deletes a user's local copies, e.g. when they log out. */
export const forgetLocalCopies = (me: Identity) =>
  storageFor(me).removeRange([]);

/** Our document ids are UUIDs: 16 bytes, like automerge-repo's. */
const repoIdFor = (id: DocumentId) =>
  interpretAsDocumentId(
    Uint8Array.from(id.replaceAll("-", "").match(/../g) ?? [], (byte) =>
      Number.parseInt(byte, 16),
    ) as BinaryDocumentId,
  );

/**
 * A document's local copy, from IndexedDB or, the first time it's opened
 * here, from the server. Rejects if neither has it. It keeps syncing with
 * the server while open.
 */
export const openDraft = <T>(id: DocumentId): Promise<DocHandle<T>> =>
  theRepo().find<T>(repoIdFor(id));

/** Forgets the local copy of a document, e.g. once it's deleted. */
export const forgetLocal = (id: DocumentId) => theRepo().delete(repoIdFor(id));
