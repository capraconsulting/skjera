// Drafts sync between the editor's automerge-repo and the server over
// automerge-repo's own WebSocket protocol (see DraftSync.ts). These are the
// parts of it both sides need to agree on.

/** Where the server listens for automerge-repo WebSocket connections. */
export const draftSyncPath = "/automerge";

/**
 * The storage id the server gives itself. automerge-repo tracks the heads
 * each storage id has, so the editor can tell when the server has its edits.
 */
export const serverStorageId = "skjera-server";

/**
 * Sent as an ephemeral message when the server refuses changes to a draft.
 * They stay in the editor's copy, and nothing more of the draft syncs on
 * that connection.
 */
export interface SyncRefused {
  readonly type: "refused";
  readonly message: string;
}

export const isSyncRefused = (message: unknown): message is SyncRefused =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "refused" &&
  "message" in message &&
  typeof message.message === "string";
