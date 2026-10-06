import { Context, Effect, Layer, Ref, Schema } from "effect";
import type { DocumentId } from "./Model.ts";

// What happens to signups that people are told of, by email (see Mail.tsx):
// signing up and cancelling tell it, in their transaction.

/** Who an email is to. */
export const Recipient = Schema.Struct({
  /** Their signup. */
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  /** Signed up without an account: emails carry their link. */
  guest: Schema.Boolean,
});
export type Recipient = typeof Recipient.Type;

export interface Notice {
  readonly event: DocumentId;
  readonly attendee: Recipient;
}

export type Kind = "signedUp" | "signupCancelled";

/** The notices `Notifications.layerTest` kept. */
export class NoticesKept extends Context.Service<
  NoticesKept,
  Ref.Ref<ReadonlyArray<Notice & { readonly kind: Kind }>>
>()("@skjera/documents/NoticesKept") {
  static readonly layer = Layer.effect(
    NoticesKept,
    Ref.make<ReadonlyArray<Notice & { readonly kind: Kind }>>([]),
  );
}

/** What happened to signups, for emails about it. Runs in the change's transaction. */
export class Notifications extends Context.Service<
  Notifications,
  {
    readonly signedUp: (notice: Notice) => Effect.Effect<void>;
    readonly signupCancelled: (notice: Notice) => Effect.Effect<void>;
  }
>()("@skjera/documents/Notifications") {
  /** Notices kept, for tests: `notices` has them, oldest first. */
  static readonly layerTest = Layer.effect(
    Notifications,
    Effect.gen(function* () {
      const kept = yield* NoticesKept;
      const keep = (kind: Kind) => (notice: Notice) =>
        Ref.update(kept, (all) => [...all, { kind, ...notice }]);
      return {
        signedUp: keep("signedUp"),
        signupCancelled: keep("signupCancelled"),
      };
    }),
  ).pipe(Layer.provideMerge(NoticesKept.layer));
}
