import type {
  PresenceLocation,
  PresenceMessage,
  PresenceSelection,
  PresenceUser,
} from "@skjera/documents/api";
import { Effect, Fiber, Schedule, Semaphore, Stream } from "effect";
import { useSyncExternalStore } from "react";
import { DocumentsClient, runtime } from "../documents/client.ts";

/** Someone else's studio tab, as last heard from. */
export interface PresenceEntry {
  /** Unique per user and tab. */
  readonly key: string;
  /** Unique per user; the same across their tabs. */
  readonly userKey: string;
  readonly user: PresenceUser;
  readonly color: string;
  readonly location: PresenceLocation | null;
  readonly selection: PresenceSelection | null;
  readonly lastSeen: number;
}

const heartbeatEvery = "10 seconds";
const expireAfterMs = 30_000;
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
 * This tab's view of who else is in the studio, and where. Built only from
 * the messages every tab sends; entries expire when their heartbeats stop.
 */
class PresenceStore {
  /** New for each run, so a stopped run's goodbye can't remove a newer one. */
  clientId = "";
  #entries = new Map<string, PresenceEntry>();
  #snapshot: ReadonlyArray<PresenceEntry> = [];
  readonly #listeners = new Set<() => void>();

  location: PresenceLocation | null = null;
  selection: PresenceSelection | null = null;
  /** Sends this tab's state; set while presence is running. */
  send: (kind: "hello" | "update" | "leave") => void = () => {};
  #selectionTimer: ReturnType<typeof setTimeout> | undefined;

  get = () => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  setLocation(location: PresenceLocation | null) {
    const same =
      location?.teamId === this.location?.teamId &&
      location?.documentId === this.location?.documentId;
    if (same) return;
    this.location = location;
    this.selection = null;
    this.send("update");
  }

  /** Throttled: selections change with every keystroke. */
  setSelection(selection: PresenceSelection | null) {
    this.selection = selection;
    if (this.#selectionTimer !== undefined) return;
    this.#selectionTimer = setTimeout(() => {
      this.#selectionTimer = undefined;
      this.send("update");
    }, selectionThrottleMs);
  }

  receive(message: PresenceMessage) {
    if (message.clientId === this.clientId) return;
    const userKey = `${message.user.issuer}|${message.user.subject}`;
    // Keyed by the sender's identity too, so nobody can overwrite others.
    const key = `${userKey}|${message.clientId}`;
    if (message.kind === "leave") {
      this.#entries.delete(key);
    } else {
      this.#entries.set(key, {
        key,
        userKey,
        user: message.user,
        color: colorFor(userKey),
        location: message.location,
        selection: message.selection,
        lastSeen: Date.now(),
      });
    }
    this.#changed();
  }

  expire() {
    const cutoff = Date.now() - expireAfterMs;
    let changed = false;
    for (const [key, entry] of this.#entries) {
      if (entry.lastSeen < cutoff) {
        this.#entries.delete(key);
        changed = true;
      }
    }
    if (changed) this.#changed();
  }

  clear() {
    this.#entries.clear();
    this.#changed();
  }

  #changed() {
    this.#snapshot = [...this.#entries.values()];
    for (const listener of this.#listeners) listener();
  }
}

export const presence = new PresenceStore();

const program = Effect.gen(function* () {
  const client = yield* DocumentsClient;
  const clientId = crypto.randomUUID();
  presence.clientId = clientId;
  // One at a time, so they arrive in order; suspended, so each sends the
  // state as it is when its turn comes.
  const inOrder = yield* Semaphore.make(1);
  const publish = (kind: "hello" | "update" | "leave") =>
    Effect.suspend(() =>
      client.PublishPresence({
        update: {
          clientId,
          kind,
          location: presence.location,
          selection: presence.selection,
        },
      }),
    ).pipe(inOrder.withPermits(1), Effect.ignore);
  const services = yield* Effect.context<DocumentsClient>();
  const send = (kind: "hello" | "update" | "leave") => {
    void Effect.runPromiseWith(services)(publish(kind));
  };
  presence.send = send;

  // Answer a newcomer after a short random wait, so not everyone at once.
  let replying = false;
  const reply = Effect.gen(function* () {
    if (replying) return;
    replying = true;
    yield* Effect.sleep(`${Math.round(Math.random() * 300)} millis`);
    replying = false;
    yield* publish("update");
  });

  const watch = client.WatchPresence().pipe(
    // Replying waits on another call over the same socket; read the stream
    // right away so that can't block the socket (see the document session).
    Stream.buffer({ capacity: "unbounded" }),
    Stream.runForEach((message) => {
      if (message._tag === "PresenceResync") return reply;
      presence.receive(message);
      return message.kind === "hello" && message.clientId !== presence.clientId
        ? reply
        : Effect.void;
    }),
    Effect.ignore,
  );

  // (Re)connecting: watch, then ask everyone to announce themselves.
  const session = Effect.all(
    [watch, Effect.sleep("200 millis").pipe(Effect.andThen(publish("hello")))],
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.andThen(Effect.sleep("1 second")), Effect.forever);

  const heartbeat = publish("update").pipe(
    Effect.repeat(Schedule.spaced(heartbeatEvery)),
  );
  const expiry = Effect.sync(() => presence.expire()).pipe(
    Effect.repeat(Schedule.spaced("5 seconds")),
  );

  yield* Effect.all([session, heartbeat, expiry], {
    concurrency: "unbounded",
    discard: true,
  }).pipe(
    Effect.onInterrupt(() =>
      publish("leave").pipe(
        Effect.andThen(
          Effect.sync(() => {
            // Unless a newer run has taken over (React remounting the studio).
            if (presence.send !== send) return;
            presence.send = () => {};
            presence.clear();
          }),
        ),
      ),
    ),
  );
});

/** Runs presence while the studio is open; returns how to stop it. */
export const startPresence = () => {
  const fiber = runtime.runFork(program);
  const leave = () => presence.send("leave");
  window.addEventListener("pagehide", leave);
  return () => {
    window.removeEventListener("pagehide", leave);
    runtime.runFork(Fiber.interrupt(fiber));
  };
};

/** Everyone else in the studio, one entry per tab. */
export const usePresence = () =>
  useSyncExternalStore(presence.subscribe, presence.get);
