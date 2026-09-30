import { PgClient } from "@effect/sql-pg";
import { Effect, PubSub, Queue, Schedule, type Scope, Stream } from "effect";
import type { SqlError } from "effect/sql";

export interface Channel<A> {
  /**
   * Subscribes right away and returns the events from then on. Use it to
   * start listening before fetching state, so nothing falls in between.
   */
  readonly subscribe: Effect.Effect<Stream.Stream<A>, never, Scope.Scope>;
}

/**
 * Listens to a Postgres NOTIFY channel on one connection and fans the
 * notifications out to subscribers, decoded with `decode` (unreadable ones
 * are logged and skipped). When the connection drops it listens again and
 * sends `reconnected`, since notifications sent in between are lost.
 *
 * Listening has started when this returns, so nothing is missed from then on.
 */
export const listenTo = <A>(
  channel: string,
  decode: (payload: unknown) => Effect.Effect<A, unknown>,
  reconnected: A,
): Effect.Effect<
  Channel<A>,
  SqlError.SqlError,
  PgClient.PgClient | Scope.Scope
> =>
  Effect.gen(function* () {
    const pg = yield* PgClient.PgClient;
    const pubsub = yield* PubSub.unbounded<A>();

    const publish = (payload: string) =>
      Effect.try(() => JSON.parse(payload) as unknown).pipe(
        Effect.flatMap(decode),
        Effect.flatMap((event) => PubSub.publish(pubsub, event)),
        Effect.catch((error) =>
          Effect.logWarning(
            `Ignoring unreadable ${channel} notification`,
            error,
          ),
        ),
      );

    // Runs until the listening connection fails.
    const forward = (
      queue: Queue.Dequeue<{ readonly payload: string }, unknown>,
    ) =>
      Queue.take(queue).pipe(
        Effect.flatMap((notification) => publish(notification.payload)),
        Effect.forever,
      );

    const lost = (error: unknown) =>
      Effect.logWarning(`Lost the ${channel} listener`, error);

    const relisten = Effect.scoped(
      pg.listen(channel).pipe(
        Effect.tap(() => PubSub.publish(pubsub, reconnected)),
        Effect.flatMap(forward),
      ),
    ).pipe(Effect.tapError(lost), Effect.retry(Schedule.spaced("1 second")));

    const first = yield* pg.listen(channel);
    yield* forward(first).pipe(
      Effect.tapError(lost),
      Effect.ignore,
      Effect.andThen(relisten),
      Effect.forkScoped,
    );

    return {
      // Not Stream.fromSubscription: interrupting that fails with an internal
      // "done" signal as well as the interruption.
      subscribe: Effect.map(PubSub.subscribe(pubsub), (subscription) =>
        Stream.fromEffectRepeat(PubSub.take(subscription)),
      ),
    };
  });
