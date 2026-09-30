import { type DocHandle, Presence } from "@automerge/automerge-repo/slim";
import type {
  DraftPresenceState,
  PresenceSelection,
  PresenceUser,
} from "@skjera/documents/api";
import { useSyncExternalStore } from "react";

/** Someone else's editor on the same draft, as last heard from. */
export interface PresenceEntry {
  /** Unique per editor, i.e. per tab. */
  readonly key: string;
  /** Unique per user; the same across their tabs. */
  readonly userKey: string;
  readonly user: PresenceUser;
  readonly color: string;
  readonly selection: PresenceSelection | null;
}

const selectionThrottleMs = 100;

// Readable with white text, in both themes.
const colors = [
  "#d6336c",
  "#c2410c",
  "#a16207",
  "#15803d",
  "#0e7490",
  "#1d4ed8",
  "#7e22ce",
  "#be185d",
];

const colorFor = (userKey: string) => {
  let hash = 0;
  for (const char of userKey) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length] ?? "#1d4ed8";
};

/**
 * Who else has a draft open, and their selections, with automerge-repo
 * presence: ephemeral messages on the draft's handle, relayed by the server,
 * which also sets who sent them. Peers that stop being heard from go.
 */
export class DraftPresence {
  readonly #presence: Presence<DraftPresenceState>;
  #snapshot: ReadonlyArray<PresenceEntry> = [];
  readonly #listeners = new Set<() => void>();
  #selectionTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingSelection: PresenceSelection | null = null;

  constructor(handle: DocHandle<unknown>) {
    this.#presence = new Presence<DraftPresenceState>({ handle });
    for (const event of ["snapshot", "update", "goodbye", "pruning"] as const) {
      this.#presence.on(event, this.#changed);
    }
    this.#presence.start({
      initialState: { user: null, selection: null },
      heartbeatMs: 10_000,
      peerTtlMs: 30_000,
    });
  }

  get = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** This editor's own selection, as last set. */
  get selection() {
    return this.#pendingSelection;
  }

  /** Throttled: selections change with every keystroke. */
  setSelection(selection: PresenceSelection | null) {
    this.#pendingSelection = selection;
    if (this.#selectionTimer !== undefined) return;
    this.#selectionTimer = setTimeout(() => {
      this.#selectionTimer = undefined;
      this.#presence.broadcast("selection", this.#pendingSelection);
    }, selectionThrottleMs);
  }

  /** Says goodbye to the others. */
  stop() {
    clearTimeout(this.#selectionTimer);
    this.#presence.stop();
    this.#presence.removeAllListeners();
  }

  #changed = () => {
    this.#snapshot = Object.values(this.#presence.getPeerStates().value)
      .filter((peer) => peer.value.user != null)
      .map((peer) => {
        const user = peer.value.user as PresenceUser;
        const userKey = `${user.issuer}|${user.subject}`;
        return {
          key: peer.peerId,
          userKey,
          user,
          color: colorFor(userKey),
          selection: peer.value.selection ?? null,
        };
      });
    for (const listener of this.#listeners) listener();
  };
}

const nobody: ReadonlyArray<PresenceEntry> = [];

/** Everyone else with the draft open, one entry per tab. */
export const useDraftPresence = (presence: DraftPresence | null) =>
  useSyncExternalStore(
    (listener) => presence?.subscribe(listener) ?? (() => {}),
    () => presence?.get() ?? nobody,
  );
