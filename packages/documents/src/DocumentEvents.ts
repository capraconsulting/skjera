import { PgClient } from "@effect/sql-pg";
import {
  Context,
  Effect,
  Layer,
  PubSub,
  Queue,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { DocumentId, Heads } from "./Model.ts";

export const channel = "documents_changed";

/** A draft changed. `heads` is missing when the notification was too large to carry them. */
export class DocumentChanged extends Schema.TaggedClass<DocumentChanged>()(
  "DocumentChanged",
  {
    id: DocumentId,
    op: Schema.Literals(["INSERT", "UPDATE", "DELETE"]),
    heads: Schema.optional(Heads),
  },
) {}

/**
 * The listener lost its connection and reconnected. Notifications sent in
 * between are gone, so replicas should fetch what they are missing.
 */
export class ListenerReconnected extends Schema.TaggedClass<ListenerReconnected>()(
  "ListenerReconnected",
  {},
) {}

export type DocumentEvent = DocumentChanged | ListenerReconnected;

// The payload of pg_automerge's automerge_notify() trigger.
const Payload = Schema.Struct({
  op: Schema.Literals(["INSERT", "UPDATE", "DELETE"]),
  key: Schema.Struct({ id: DocumentId }),
  columns: Schema.Struct({
    draft: Schema.optional(
      Schema.Struct({
        heads: Schema.optional(Schema.NullOr(Heads)),
      }),
    ),
  }),
});

/**
 * Draft changes committed by any backend, from Postgres LISTEN/NOTIFY. One
 * connection listens per process and fans the events out to subscribers.
 */
export class DocumentEvents extends Context.Service<
  DocumentEvents,
  {
    readonly events: Stream.Stream<DocumentEvent>;
    /**
     * Subscribes right away and returns the events from then on. Use it to
     * start listening before fetching state, so nothing falls in between.
     */
    readonly subscribe: Effect.Effect<
      Stream.Stream<DocumentEvent>,
      never,
      Scope.Scope
    >;
  }
>()("@skjera/documents/DocumentEvents") {
  static readonly layer = Layer.effect(
    DocumentEvents,
    Effect.gen(function* () {
      const pg = yield* PgClient.PgClient;
      const pubsub = yield* PubSub.unbounded<DocumentEvent>();
      const decode = Schema.decodeUnknownEffect(Payload);

      const publishNotification = (payload: string) =>
        Effect.try(() => JSON.parse(payload) as unknown).pipe(
          Effect.flatMap(decode),
          Effect.flatMap((notification) =>
            PubSub.publish(
              pubsub,
              new DocumentChanged({
                id: notification.key.id,
                op: notification.op,
                heads: notification.columns.draft?.heads ?? undefined,
              }),
            ),
          ),
          Effect.catch((error) =>
            Effect.logWarning("Ignoring unreadable notification", error),
          ),
        );

      // Runs until the listening connection fails.
      const forward = (
        queue: Queue.Dequeue<{ readonly payload: string }, unknown>,
      ) =>
        Queue.take(queue).pipe(
          Effect.flatMap((notification) =>
            publishNotification(notification.payload),
          ),
          Effect.forever,
        );

      // Notifications sent while reconnecting are lost, so tell subscribers.
      const relisten = Effect.scoped(
        pg.listen(channel).pipe(
          Effect.tap(() => PubSub.publish(pubsub, new ListenerReconnected({}))),
          Effect.flatMap(forward),
        ),
      ).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Lost the notification listener", error),
        ),
        Effect.retry(Schedule.spaced("1 second")),
      );

      // Listen before the layer is ready, so no change is missed from then on.
      const first = yield* pg.listen(channel);
      yield* forward(first).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Lost the notification listener", error),
        ),
        Effect.ignore,
        Effect.andThen(relisten),
        Effect.forkScoped,
      );

      return DocumentEvents.of({
        events: Stream.fromPubSub(pubsub),
        subscribe: Effect.map(
          PubSub.subscribe(pubsub),
          Stream.fromSubscription,
        ),
      });
    }),
  );
}
