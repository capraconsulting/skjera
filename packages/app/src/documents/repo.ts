import {
  type BinaryDocumentId,
  type DocHandle,
  interpretAsDocumentId,
  Repo,
} from "@automerge/automerge-repo/slim";
import { IndexedDBStorageAdapter } from "@automerge/automerge-repo-storage-indexeddb";
import type { DocumentId } from "@skjera/documents/api";
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

/**
 * The studio's local copies of the documents it opens, kept in IndexedDB so
 * no edit depends on reaching the server. It has no network: each open
 * document syncs with the server on its own (see session.ts).
 */
const theRepo = () => {
  if (repo === undefined) {
    if (user === undefined) throw new Error("Nobody is signed in");
    repo = new Repo({ storage: storageFor(user) });
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
 * The local copy of a document, with `draft` (the server's copy) merged in.
 * Starts from `draft` the first time a document is opened here.
 */
export const openLocal = async <T>(
  id: DocumentId,
  draft: Uint8Array,
): Promise<DocHandle<T>> => {
  const repoId = repoIdFor(id);
  // Loads the stored copy, if any, so the import below merges into it.
  await theRepo()
    .find(repoId)
    .catch(() => undefined);
  return theRepo().import<T>(draft, { docId: repoId });
};

/** Forgets the local copy of a document, e.g. once it's deleted. */
export const forgetLocal = (id: DocumentId) => theRepo().delete(repoIdFor(id));
