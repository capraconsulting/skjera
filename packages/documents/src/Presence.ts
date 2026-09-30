import { PgClient } from "@effect/sql-pg";
import type { Identity } from "@skjera/oauth/api";
import {
  Context,
  Effect,
  Layer,
  Schema,
  type Scope,
  type Stream,
} from "effect";
import { listenTo } from "./internal/channel.ts";
import {
  PresenceMessage,
  PresenceResync,
  type PresenceUpdate,
  PresenceUser,
} from "./Model.ts";

const channel = "studio_presence";

/**
 * Presence in the studio, relayed between all backends through Postgres
 * NOTIFY. Nothing is kept: each studio tab builds its own picture from the
 * messages, and the server only adds who sent them.
 */
export class Presence extends Context.Service<
  Presence,
  {
    readonly publish: (
      update: PresenceUpdate,
      sender: Identity,
    ) => Effect.Effect<void>;
    readonly subscribe: Effect.Effect<
      Stream.Stream<PresenceMessage | PresenceResync>,
      never,
      Scope.Scope
    >;
  }
>()("@skjera/documents/Presence") {
  static readonly layer = Layer.effect(
    Presence,
    Effect.gen(function* () {
      const pg = yield* PgClient.PgClient;
      const encode = Schema.encodeEffect(PresenceMessage);
      const events = yield* listenTo<PresenceMessage | PresenceResync>(
        channel,
        Schema.decodeUnknownEffect(PresenceMessage),
        new PresenceResync({}),
      );

      const publish = Effect.fn("Presence.publish")(function* (
        update: PresenceUpdate,
        sender: Identity,
      ) {
        const message = new PresenceMessage({
          ...update,
          user: new PresenceUser({
            issuer: sender.issuer,
            subject: sender.subject,
            name: sender.name ?? sender.email ?? sender.subject,
          }),
        });
        const payload = JSON.stringify(yield* encode(message));
        yield* pg.notify(channel, payload);
      }, Effect.orDie);

      return Presence.of({ publish, subscribe: events.subscribe });
    }),
  );
}
