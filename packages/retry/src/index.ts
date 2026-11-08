import { type Duration, Effect } from "effect";

export const retryTransient = <Retryable>(options: {
  readonly times?: number;
  readonly retryable: (error: unknown) => error is Retryable;
  readonly delay: (error: Retryable, attempt: number) => Duration.Input;
  readonly sleep?: (delay: Duration.Input) => Effect.Effect<void>;
}) => {
  const times = options.times ?? 5;
  const sleep = options.sleep ?? Effect.sleep;
  return <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const attempt = (n: number): Effect.Effect<A, E, R> =>
      self.pipe(
        Effect.catchIf(
          (error): error is E & Retryable =>
            n < times && options.retryable(error),
          (error) =>
            sleep(options.delay(error, n)).pipe(
              Effect.andThen(Effect.suspend(() => attempt(n + 1))),
            ),
        ),
      );
    return attempt(0);
  };
};
