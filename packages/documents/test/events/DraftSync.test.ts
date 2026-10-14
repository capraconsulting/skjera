import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { decode, encode } from "cbor-x";
import { Effect, Fiber, Layer, Option, Queue } from "effect";
import { Socket } from "effect/socket";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { DocumentEvents } from "../../src/events/DocumentEvents.ts";
import { Documents } from "../../src/events/Documents.ts";
import { repoIdOf, serve } from "../../src/events/DraftSync.ts";
import { isSyncRefused } from "../../src/events/DraftSyncProtocol.ts";
import { Presence } from "../../src/events/Presence.ts";
import type { DocumentId } from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { Teams } from "../../src/Teams.ts";
import { TestDatabase } from "../TestDatabase.ts";

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });

const TestLayer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  Presence.layer,
  Teams.layer,
).pipe(
  Layer.provideMerge(Announcements.layerTest),
  Layer.provideMerge(Notifications.layerTest),
  Layer.provideMerge(TestDatabase),
);

type Message = {
  readonly type: string;
  readonly senderId?: string;
  readonly documentId?: string;
  readonly data?: Uint8Array;
};

/**
 * An editor on the other end of a connection: speaks automerge-repo's
 * WebSocket protocol, and syncs drafts with Automerge's sync functions, as
 * automerge-repo does.
 */
let editorCount = 0;
const connect = Effect.gen(function* () {
  const documents = yield* Documents;
  const events = yield* DocumentEvents;
  const presence = yield* Presence;
  const peerId = `editor-${++editorCount}`;
  const incoming = yield* Queue.unbounded<Uint8Array>();
  const outgoing = yield* Queue.unbounded<Uint8Array>();
  const socket = Socket.make({
    reader: Effect.succeed({
      pull: Effect.map(Queue.take(incoming), (frame) => [frame] as const),
      upgrade: () => Effect.void,
    }),
    writer: Effect.succeed({
      write: (chunk) =>
        chunk instanceof Uint8Array
          ? Effect.asVoid(Queue.offer(outgoing, chunk))
          : Effect.void,
      writeAll: (chunks) =>
        Effect.forEach(chunks, (chunk) =>
          chunk instanceof Uint8Array
            ? Queue.offer(outgoing, chunk)
            : Effect.void,
        ).pipe(Effect.asVoid),
    }),
  });
  const connection = yield* Effect.forkChild(
    serve(socket, alice, documents, events, presence),
  );

  const send = (message: object) => Queue.offer(incoming, encode(message));
  /** The server's next message, if one comes soon. */
  const next = Queue.take(outgoing).pipe(
    Effect.map((frame) => decode(frame) as Message),
    Effect.timeoutOption("1 second"),
  );

  yield* send({
    type: "join",
    senderId: peerId,
    supportedProtocolVersions: ["1"],
  });
  const peer = yield* next;
  assert.strictEqual(Option.getOrUndefined(peer)?.type, "peer");
  const server = Option.getOrUndefined(peer)?.senderId;
  /** Everything the server sent after the handshake. */
  const received: Array<Message> = [];

  /** A draft this editor syncs on the connection. */
  const draft = (id: DocumentId, initial: A.Doc<EventContent>) => {
    let doc = initial;
    let state = A.initSyncState();
    const take = (message: Message) => {
      received.push(message);
      if (
        message.type === "sync" &&
        message.documentId === repoIdOf(id) &&
        message.data
      ) {
        [doc, state] = A.receiveSyncMessage(doc, state, message.data);
      }
    };
    return {
      doc: () => doc,
      change: (fn: (event: EventContent) => void) => {
        doc = A.change(doc, fn);
      },
      /** Forgets what the server has, as after reconnecting. */
      startOver: () => {
        state = A.initSyncState();
      },
      /** Takes in what the server sends until it goes quiet. */
      listen: Effect.gen(function* () {
        for (;;) {
          const message = yield* next;
          if (Option.isNone(message)) return;
          take(message.value);
        }
      }),
      /** Sends what the server is missing, and takes in its answers. */
      sync: Effect.gen(function* () {
        for (let round = 0; round < 10; round++) {
          const [nextState, message] = A.generateSyncMessage(doc, state);
          state = nextState;
          if (message === null) return;
          yield* send({
            type: "sync",
            senderId: peerId,
            targetId: server,
            documentId: repoIdOf(id),
            data: message,
          });
          const answer = yield* next;
          if (Option.isNone(answer)) return;
          take(answer.value);
        }
      }),
    };
  };

  let ephemeralCount = 0;
  return {
    peerId,
    draft,
    received,
    /** Takes in what the server sends until it goes quiet. */
    listen: Effect.gen(function* () {
      for (;;) {
        const message = yield* next;
        if (Option.isNone(message)) return;
        received.push(message.value);
      }
    }),
    /** Sends an ephemeral message about a draft, as automerge-repo does. */
    sendEphemeral: (id: DocumentId, message: object) =>
      send({
        type: "ephemeral",
        senderId: peerId,
        targetId: server,
        count: ++ephemeralCount,
        sessionId: `${peerId}-session`,
        documentId: repoIdOf(id),
        data: encode(message),
      }),
    /** Passes on another editor's message unchanged, as automerge-repo does. */
    forward: (message: object) => send({ ...message, targetId: server }),
    close: Fiber.interrupt(connection),
  };
});

let teamCount = 0;
const newDraft = Effect.gen(function* () {
  const documents = yield* Documents;
  const teams = yield* Teams;
  const team = yield* teams.create(`Sync team ${++teamCount}`, alice);
  const id = yield* documents.create("event", team.id, alice);
  const draft = A.load<EventContent>((yield* documents.get(id)).draft);
  return { id, draft };
});

const saved = (id: DocumentId) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    return A.load<EventContent>((yield* documents.get(id)).draft);
  });

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("DraftSync", (it) => {
  it.effect("saves an editor's changes in Postgres", () =>
    Effect.gen(function* () {
      const { id, draft } = yield* newDraft;
      const connection = yield* connect;
      const client = connection.draft(id, draft);
      client.change((event) => A.updateText(event, ["title"], "Synced"));
      yield* client.sync;
      assert.strictEqual((yield* saved(id)).title, "Synced");
      yield* connection.close;
    }).pipe(Effect.timeout("20 seconds")),
  );

  it.effect("sends an editor what others save", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const { id, draft } = yield* newDraft;
      const connection = yield* connect;
      const client = connection.draft(id, draft);
      yield* client.sync;

      // Someone else saves a change, from another replica.
      let other = A.load<EventContent>((yield* documents.get(id)).draft);
      other = A.change(other, (event) =>
        A.updateText(event, ["body"], "From elsewhere"),
      );
      const change = A.getLastLocalChange(other);
      if (change === undefined) throw new Error("no change");
      yield* documents.applyChanges(id, [change], alice);

      yield* client.listen;
      yield* client.sync;
      assert.strictEqual(client.doc().body, "From elsewhere");
      yield* connection.close;
    }).pipe(Effect.timeout("20 seconds")),
  );

  it.effect("relays presence to others on the draft, as its sender", () =>
    Effect.gen(function* () {
      const { id, draft } = yield* newDraft;
      const first = yield* connect;
      const second = yield* connect;
      yield* first.draft(id, draft).sync;
      // A copy of its own: Automerge builds on a version only once.
      yield* second.draft(id, A.clone(draft)).sync;
      const before = second.received.length;

      // Whoever it claims to be, it's who signed in.
      yield* first.sendEphemeral(id, {
        __presence: {
          type: "snapshot",
          state: {
            user: { issuer: "x", subject: "mallory", name: "Mallory" },
            selection: null,
          },
        },
      });
      yield* second.listen;
      const relayed = second.received
        .slice(before)
        .filter((message) => message.type === "ephemeral");
      assert.strictEqual(relayed.length, 1);
      assert.strictEqual(relayed[0]?.senderId, first.peerId);
      const data = relayed[0]?.data;
      const state = (data === undefined ? {} : decode(data)).__presence?.state;
      assert.strictEqual(state?.user?.subject, "alice");
      assert.strictEqual(state?.user?.name, "alice");

      // Not sent back to its sender.
      yield* first.listen;
      assert.isFalse(
        first.received.some((message) => message.type === "ephemeral"),
      );

      // Once it's gone, the others hear goodbye.
      const beforeGoodbye = second.received.length;
      yield* first.close;
      yield* second.listen;
      const goodbye = second.received
        .slice(beforeGoodbye)
        .find((message) => message.type === "ephemeral");
      assert.strictEqual(goodbye?.senderId, first.peerId);
      assert.strictEqual(
        goodbye?.data === undefined
          ? undefined
          : decode(goodbye.data).__presence?.type,
        "goodbye",
      );
      yield* second.close;
    }).pipe(Effect.timeout("20 seconds")),
  );

  it.effect("relays nothing an editor passes on from someone else", () =>
    Effect.gen(function* () {
      const { id, draft } = yield* newDraft;
      const first = yield* connect;
      const second = yield* connect;
      yield* first.draft(id, draft).sync;
      yield* second.draft(id, A.clone(draft)).sync;
      const before = first.received.length;

      // The second hands the first's message back to the server, as
      // automerge-repo passes on what it hears to its other peers. Relayed
      // as the second's, it would put the first's caret under its name.
      yield* second.forward({
        type: "ephemeral",
        senderId: first.peerId,
        sessionId: `${first.peerId}-session`,
        count: 1,
        documentId: repoIdOf(id),
        data: encode({
          __presence: {
            type: "update",
            channel: "selection",
            value: { field: "title", anchor: "a", head: "a" },
          },
        }),
      });
      yield* first.listen;
      assert.isFalse(
        first.received
          .slice(before)
          .some((message) => message.type === "ephemeral"),
      );
      yield* first.close;
      yield* second.close;
    }).pipe(Effect.timeout("20 seconds")),
  );

  it.effect("refuses invalid changes, says why, and stops syncing", () =>
    Effect.gen(function* () {
      const { id, draft } = yield* newDraft;
      const connection = yield* connect;
      const client = connection.draft(id, draft);
      yield* client.sync;
      const before = connection.received.length;

      // A field events don't have.
      client.change((event) => {
        (event as unknown as Record<string, unknown>)["extra"] = "nope";
      });
      yield* client.sync;
      const answers = connection.received.slice(before);
      const refusals = answers.filter(
        (message) =>
          message.type === "ephemeral" &&
          message.data !== undefined &&
          isSyncRefused(decode(message.data)),
      );
      assert.strictEqual(refusals.length, 1);
      assert.notProperty(yield* saved(id), "extra");

      // No more syncing for it: even starting over gets no answer.
      const after = connection.received.length;
      client.change((event) => A.updateText(event, ["title"], "Also not"));
      client.startOver();
      yield* client.sync;
      assert.strictEqual(connection.received.length, after);
      assert.strictEqual((yield* saved(id)).title, "");

      // The connection carries on with other drafts.
      const other = yield* newDraft;
      const next = connection.draft(other.id, other.draft);
      next.change((event) => A.updateText(event, ["title"], "Still fine"));
      yield* next.sync;
      assert.strictEqual((yield* saved(other.id)).title, "Still fine");
      yield* connection.close;
    }).pipe(Effect.timeout("20 seconds")),
  );
});
