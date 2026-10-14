import { PgClient } from "@effect/sql-pg";
import {
  Context,
  Effect,
  Layer,
  Schema,
  type Scope,
  type Stream,
} from "effect";
import { listenTo } from "../server/channel.ts";

const channel = "draft_ephemeral";

/**
 * An automerge-repo ephemeral message about a draft, e.g. an editor's
 * presence, on its way to the other connections that have the draft open.
 */
export class Relayed extends Schema.TaggedClass<Relayed>()("Relayed", {
  /** automerge-repo's id for the draft. */
  documentId: Schema.String,
  senderId: Schema.String,
  sessionId: Schema.String,
  count: Schema.Int,
  /** The message's CBOR bytes, in base64. */
  data: Schema.String,
}) {}

/** Messages may have been missed; they are only ever short-lived anyway. */
export class RelayReconnected extends Schema.TaggedClass<RelayReconnected>()(
  "RelayReconnected",
  {},
) {}

/**
 * Relays ephemeral messages between backends through Postgres NOTIFY, so
 * editors of a draft reach each other whichever backend they're on. Nothing
 * is kept.
 */
export class Presence extends Context.Service<
  Presence,
  {
    readonly publish: (message: Relayed) => Effect.Effect<void>;
    readonly subscribe: Effect.Effect<
      Stream.Stream<Relayed | RelayReconnected>,
      never,
      Scope.Scope
    >;
  }
>()("@skjera/documents/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const pg = yield* PgClient.PgClient;
      const encode = Schema.encodeEffect(Relayed);
      const events = yield* listenTo<Relayed | RelayReconnected>(
        channel,
        Schema.decodeUnknownEffect(Relayed),
        new RelayReconnected({}),
      );

      const publish = Effect.fn("Presence.publish")(function* (
        message: Relayed,
      ) {
        yield* pg.notify(channel, JSON.stringify(yield* encode(message)));
      }, Effect.orDie);

      return Presence.of({ publish, subscribe: events.subscribe });
    }),
  );
}
