import { Context, Effect, Layer, Schema } from "effect";
import { DocumentId, Heads } from "../Model.ts";
import { type Channel, listenTo } from "../server/channel.ts";

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
  Channel<DocumentEvent>
>()("@skjera/documents/DocumentEvents") {
  static readonly layer = Layer.effect(
    DocumentEvents,
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(Payload);
      const events = yield* listenTo<DocumentEvent>(
        channel,
        (payload) =>
          Effect.map(
            decode(payload),
            (notification) =>
              new DocumentChanged({
                id: notification.key.id,
                op: notification.op,
                heads: notification.columns.draft?.heads ?? undefined,
              }),
          ),
        new ListenerReconnected({}),
      );
      return DocumentEvents.of(events);
    }),
  );
}
