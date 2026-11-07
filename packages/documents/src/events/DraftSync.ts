import { randomUUID } from "node:crypto";
import * as A from "@automerge/automerge";
import { Authenticator } from "@skjera/oauth";
import { type Identity, nameOf } from "@skjera/oauth/api";
import bs58check from "bs58check";
import { decode, encode } from "cbor-x";
import { Effect, Layer, Option, Queue, Result, Stream } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import type { DocumentId, PresenceUser } from "../Model.ts";
import { type DocumentEvent, DocumentEvents } from "./DocumentEvents.ts";
import { Documents } from "./Documents.ts";
import { type SyncRefused, serverStorageId } from "./DraftSyncProtocol.ts";
import { Presence, Relayed, type RelayReconnected } from "./Presence.ts";

// The server end of automerge-repo's WebSocket protocol, for the editor's
// drafts: https://github.com/automerge/automerge-repo, packages/
// automerge-repo-network-websocket. It is a peer like any other automerge-
// repo, except that Postgres is its only storage and it refuses changes
// that fail the checks of `Documents.applyChanges`.
//
// Each connection keeps, for each draft it syncs, a copy in memory and
// Automerge's sync state with the editor: Automerge's sync functions work on
// a document. Both go when the connection does; Postgres is what the
// connections share. Changes from the editor are saved there, and changes
// saved by others are merged in from there, as its notifications announce.
//
// Ephemeral messages carry automerge-repo presence: who has a draft open,
// and their selection. They're relayed to every connection with the draft
// open, on any backend, with the sender's identity set by the server.

/** A draft being synced on a connection. */
interface Synced {
  /** automerge-repo's id for it. */
  readonly repoId: string;
  readonly id: DocumentId;
  doc: A.Doc<unknown>;
  state: A.SyncState;
  /** Changes were refused: the editor's copy can't be synced anymore. */
  refused: boolean;
}

/** automerge-repo's document ids are our UUIDs' bytes, in base58check. */
export const repoIdOf = (id: DocumentId) =>
  bs58check.encode(
    Uint8Array.from(id.replaceAll("-", "").match(/../g) ?? [], (byte) =>
      Number.parseInt(byte, 16),
    ),
  );

const idOf = (repoId: string): DocumentId | undefined => {
  try {
    const bytes = bs58check.decode(repoId);
    if (bytes.length !== 16) return undefined;
    const hex = Buffer.from(bytes).toString("hex");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-") as DocumentId;
  } catch {
    return undefined;
  }
};

type Message = {
  readonly type?: unknown;
  readonly senderId?: unknown;
  readonly sessionId?: unknown;
  readonly count?: unknown;
  readonly supportedProtocolVersions?: unknown;
  readonly documentId?: unknown;
  readonly data?: unknown;
};

type Input =
  | { readonly _tag: "Frame"; readonly frame: Uint8Array }
  | { readonly _tag: "Event"; readonly event: DocumentEvent }
  | { readonly _tag: "Relay"; readonly message: Relayed | RelayReconnected };

/** automerge-repo presence wraps its messages in this key. */
const presenceMarker = "__presence";

/**
 * A presence message with the sender's identity set, whatever they sent;
 * undefined for anything else.
 */
const stamped = (data: Uint8Array, user: PresenceUser) => {
  const envelope = decode(data) as {
    readonly [presenceMarker]?: {
      readonly type?: unknown;
      readonly state?: unknown;
      readonly channel?: unknown;
    };
  } | null;
  const message = envelope?.[presenceMarker];
  if (typeof message !== "object" || message === null) return undefined;
  switch (message.type) {
    case "snapshot":
      return encode({
        [presenceMarker]: {
          ...message,
          state: {
            ...(typeof message.state === "object" ? message.state : {}),
            user,
          },
        },
      });
    case "update":
      return encode({
        [presenceMarker]:
          message.channel === "user" ? { ...message, value: user } : message,
      });
    case "heartbeat":
    case "goodbye":
      return encode({ [presenceMarker]: { type: message.type } });
    default:
      return undefined;
  }
};

/** One editor's connection: the handshake, then syncing its drafts. */
export const serve = (
  socket: Socket.Socket,
  user: Identity,
  documents: Documents["Service"],
  events: DocumentEvents["Service"],
  presence: Presence["Service"],
) =>
  Effect.gen(function* () {
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;
    const send = (message: object) => writer.write(encode(message));

    const peerId = `skjera-server-${randomUUID()}`;
    const sessionId = randomUUID();
    let ephemeralCount = 0;
    let editor: string | undefined;
    const byRepoId = new Map<string, Synced>();
    const byId = new Map<DocumentId, Synced>();
    const who: PresenceUser = {
      issuer: user.issuer,
      subject: user.subject,
      name: nameOf(user),
    };

    const drop = (synced: Synced) => {
      byRepoId.delete(synced.repoId);
      byId.delete(synced.id);
    };

    const unavailable = (repoId: string) =>
      send({
        type: "doc-unavailable",
        senderId: peerId,
        targetId: editor,
        documentId: repoId,
      });

    /** Tells the editor what it's missing, if anything. */
    const sync = (synced: Synced) =>
      Effect.suspend(() => {
        const [state, message] = A.generateSyncMessage(
          synced.doc,
          synced.state,
        );
        synced.state = state;
        return message === null
          ? Effect.void
          : send({
              type: "sync",
              senderId: peerId,
              targetId: editor,
              documentId: synced.repoId,
              data: message,
            });
      });

    const refuse = (synced: Synced, message: string) => {
      synced.refused = true;
      const refused: SyncRefused = { type: "refused", message };
      return send({
        type: "ephemeral",
        senderId: peerId,
        targetId: editor,
        count: ++ephemeralCount,
        sessionId,
        documentId: synced.repoId,
        data: encode(refused),
      });
    };

    /** Starts syncing a draft the editor asked about, from Postgres. */
    const open = (repoId: string) =>
      Effect.gen(function* () {
        const known = byRepoId.get(repoId);
        if (known !== undefined) return Option.some(known);
        const id = idOf(repoId);
        if (id === undefined) return Option.none<Synced>();
        const snapshot = yield* Effect.option(documents.get(id));
        if (Option.isNone(snapshot)) return Option.none<Synced>();
        const synced: Synced = {
          repoId,
          id,
          doc: A.load(snapshot.value.draft),
          state: A.initSyncState(),
          refused: false,
        };
        byRepoId.set(repoId, synced);
        byId.set(id, synced);
        return Option.some(synced);
      });

    /** A sync message from the editor: save what it brings, then answer. */
    const receive = (repoId: string, data: Uint8Array) =>
      Effect.gen(function* () {
        const opened = yield* open(repoId);
        if (Option.isNone(opened)) return yield* unavailable(repoId);
        const synced = opened.value;
        // Its copy is stale: Automerge won't build on a version it has
        // already built on, and the refused one was.
        if (synced.refused) return;
        const [doc, state] = A.receiveSyncMessage(
          synced.doc,
          synced.state,
          data,
        );
        const changes = A.getChanges(synced.doc, doc);
        if (changes.length > 0) {
          const saved = yield* Effect.result(
            documents.applyChanges(synced.id, changes, user),
          );
          if (Result.isFailure(saved)) {
            const failure = saved.failure;
            if (failure._tag === "DocumentNotFound") {
              drop(synced);
              return yield* unavailable(repoId);
            }
            return yield* refuse(
              synced,
              failure._tag === "ActorNotAllowed"
                ? "Changes were refused"
                : failure.message,
            );
          }
        }
        synced.doc = doc;
        synced.state = state;
        yield* sync(synced);
      });

    /** Brings a draft's copy up to date with Postgres, and tells the editor. */
    const catchUp = (synced: Synced) =>
      Effect.gen(function* () {
        if (synced.refused) return;
        const since = yield* Effect.option(
          documents.changesSince(synced.id, A.getHeads(synced.doc)),
        );
        if (Option.isNone(since)) return drop(synced);
        if (since.value.changes.length === 0) return;
        synced.doc = A.loadIncremental(synced.doc, since.value.changes);
        yield* sync(synced);
      });

    const onEvent = (event: DocumentEvent) =>
      Effect.gen(function* () {
        if (event._tag === "ListenerReconnected") {
          // Changes may have been missed while it was away.
          for (const synced of [...byId.values()]) yield* catchUp(synced);
          return;
        }
        const synced = byId.get(event.id);
        if (synced === undefined) return;
        // The editor learns of deletions from the synced documents.
        if (event.op === "DELETE") return drop(synced);
        yield* catchUp(synced);
      });

    const onFrame = (frame: Uint8Array) =>
      Effect.gen(function* () {
        const message = decode(frame) as Message;
        if (editor === undefined) {
          const versions = message.supportedProtocolVersions;
          if (
            message.type !== "join" ||
            typeof message.senderId !== "string" ||
            !Array.isArray(versions) ||
            !versions.includes("1")
          ) {
            yield* send({ type: "error", message: "Expected a join" });
            return yield* writer.write(new Socket.CloseEvent(1002));
          }
          editor = message.senderId;
          return yield* send({
            type: "peer",
            senderId: peerId,
            targetId: editor,
            selectedProtocolVersion: "1",
            // Not ephemeral in name only: its storage id lets the editor
            // track what the server has. Its sync states aren't kept.
            // Named `metadata` in the protocol's README; the code uses this.
            peerMetadata: { storageId: serverStorageId, isEphemeral: true },
          });
        }
        if (
          (message.type === "request" || message.type === "sync") &&
          typeof message.documentId === "string" &&
          message.data instanceof Uint8Array
        ) {
          return yield* receive(message.documentId, message.data);
        }
        // Only what the editor says itself: automerge-repo also passes on
        // what it hears from others, which the server has relayed already.
        if (
          message.type === "ephemeral" &&
          message.senderId === editor &&
          typeof message.documentId === "string" &&
          byRepoId.has(message.documentId) &&
          typeof message.sessionId === "string" &&
          typeof message.count === "number" &&
          message.data instanceof Uint8Array
        ) {
          const data = stamped(message.data, who);
          if (data === undefined) return;
          return yield* presence.publish(
            new Relayed({
              documentId: message.documentId,
              senderId: editor,
              sessionId: message.sessionId,
              count: message.count,
              data: Buffer.from(data).toString("base64"),
            }),
          );
        }
        if (message.type === "leave") {
          return yield* writer.write(new Socket.CloseEvent(1000));
        }
        // Remote heads gossip isn't used.
      });

    /** Another editor's ephemeral message, for a draft this one has open. */
    const onRelayed = (message: Relayed | RelayReconnected) =>
      message._tag === "Relayed" &&
      editor !== undefined &&
      message.senderId !== editor &&
      byRepoId.has(message.documentId)
        ? send({
            type: "ephemeral",
            senderId: message.senderId,
            targetId: editor,
            count: message.count,
            sessionId: message.sessionId,
            documentId: message.documentId,
            data: Buffer.from(message.data, "base64"),
          })
        : Effect.void;

    // Once gone, the editor says goodbye to the others on its drafts.
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        editor === undefined ? [] : [...byRepoId.keys()],
        (documentId) =>
          presence.publish(
            new Relayed({
              documentId,
              senderId: editor ?? "",
              sessionId: randomUUID(),
              count: 1,
              data: Buffer.from(
                encode({ [presenceMarker]: { type: "goodbye" } }),
              ).toString("base64"),
            }),
          ),
        { discard: true },
      ),
    );

    // Frames and notifications are handled one at a time, in order.
    const inbox = yield* Queue.unbounded<Input>();
    const relayed = yield* presence.subscribe;
    yield* relayed.pipe(
      Stream.runForEach((message) =>
        Queue.offer(inbox, { _tag: "Relay", message }),
      ),
      Effect.forkScoped,
    );
    const notifications = yield* events.subscribe;
    yield* notifications.pipe(
      Stream.runForEach((event) =>
        Queue.offer(inbox, { _tag: "Event", event }),
      ),
      Effect.forkScoped,
    );
    const read = reader.pull.pipe(
      Effect.flatMap((frames) =>
        Queue.offerAll(
          inbox,
          frames.flatMap((frame) =>
            frame instanceof Uint8Array
              ? [{ _tag: "Frame" as const, frame }]
              : [],
          ),
        ),
      ),
      Effect.forever,
    );
    const handle = Queue.take(inbox).pipe(
      Effect.flatMap((input) =>
        input._tag === "Frame"
          ? onFrame(input.frame)
          : input._tag === "Event"
            ? onEvent(input.event)
            : onRelayed(input.message),
      ),
      Effect.forever,
    );
    // Until the editor goes away.
    yield* Effect.raceFirst(read, handle);
  }).pipe(
    Effect.scoped,
    Effect.catchCause((cause) =>
      Effect.logWarning("Draft sync session failed", cause),
    ),
  );

/**
 * automerge-repo's WebSocket endpoint for the editor's drafts. Like the
 * documents RPC socket, the handshake must come from the app's own origin
 * with a session.
 */
export const layerHttp = (options: { readonly path: `/${string}` }) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const documents = yield* Documents;
      const events = yield* DocumentEvents;
      const presence = yield* Presence;
      const authenticator = yield* Authenticator;
      return HttpRouter.add(
        "GET",
        options.path,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.headers.origin !== authenticator.origin) {
            return HttpServerResponse.empty({ status: 403 });
          }
          const user = yield* authenticator.fromCookieHeader(
            request.headers.cookie,
          );
          if (Option.isNone(user)) {
            return HttpServerResponse.empty({ status: 401 });
          }
          const socket = yield* request.upgrade;
          yield* serve(socket, user.value, documents, events, presence);
          return HttpServerResponse.empty();
        }),
      );
    }),
  );
