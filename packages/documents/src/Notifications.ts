import { Context, Effect, Layer, Ref, Schema } from "effect";
import type { DocumentId } from "./Model.ts";

// What attendees are told of, by email (see Mail.tsx): signing up and
// cancelling tell it, and so does republishing an event at a new time, in
// their transaction.

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

/** When an event was, before it moved: ISO instants. */
export const Times = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String,
});
export type Times = typeof Times.Type;

export interface Notice {
  readonly event: DocumentId;
  readonly attendee: Recipient;
}

export interface ChangeNotice extends Notice {
  /** The publication that moved it: each is told of once. */
  readonly version: string;
  readonly previously: Times;
}

export type Kind = "signedUp" | "signupCancelled" | "eventChanged";

export type Kept =
  | (Notice & { readonly kind: "signedUp" | "signupCancelled" })
  | (ChangeNotice & { readonly kind: "eventChanged" });

/** The notices `Notifications.layerTest` kept. */
export class NoticesKept extends Context.Service<
  NoticesKept,
  Ref.Ref<ReadonlyArray<Kept>>
>()("@skjera/documents/NoticesKept") {
  static readonly layer = Layer.effect(
    NoticesKept,
    Ref.make<ReadonlyArray<Kept>>([]),
  );
}

/** What attendees are told of. Runs in the change's transaction. */
export class Notifications extends Context.Service<
  Notifications,
  {
    readonly signedUp: (notice: Notice) => Effect.Effect<void>;
    readonly signupCancelled: (notice: Notice) => Effect.Effect<void>;
    /** The event moved: it starts or ends at another time. */
    readonly eventChanged: (notice: ChangeNotice) => Effect.Effect<void>;
  }
>()("@skjera/documents/Notifications") {
  /** Notices kept, for tests: `NoticesKept` has them, oldest first. */
  static readonly layerTest = Layer.effect(
    Notifications,
    Effect.gen(function* () {
      const kept = yield* NoticesKept;
      const keep = (notice: Kept) =>
        Ref.update(kept, (all) => [...all, notice]);
      return {
        signedUp: (notice) => keep({ kind: "signedUp", ...notice }),
        signupCancelled: (notice) =>
          keep({ kind: "signupCancelled", ...notice }),
        eventChanged: (notice) => keep({ kind: "eventChanged", ...notice }),
      };
    }),
  ).pipe(Layer.provideMerge(NoticesKept.layer));
}

/** A signup, as notices tell of it: `SELECT id, name, email, … AS guest`. */
export interface Signup {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly guest: boolean;
}

/** Tells `notice` of each signup that has an email address to tell. */
export const tell = (
  signups: ReadonlyArray<Signup>,
  notice: (attendee: Recipient) => Effect.Effect<void>,
) =>
  Effect.forEach(
    signups,
    (signup) =>
      signup.email === null
        ? Effect.void
        : notice({
            id: signup.id,
            name: signup.name,
            email: signup.email,
            guest: signup.guest,
          }),
    { discard: true },
  );
