import { Context, Effect, Layer, Ref, Schema } from "effect";
import type { SqlClient } from "effect/sql";
import { type DocumentId, Locale } from "../Model.ts";

// What attendees are told of, by email (see Mail.tsx): signing up and
// cancelling tell it, and so do an organizer taking someone off an event,
// republishing an event at a new time or place and deleting it, in their
// transaction.

/** Who an email is to. */
export const Recipient = Schema.Struct({
  /** Their signup. */
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  /** Signed up without an account: emails carry their link. */
  guest: Schema.Boolean,
  /** The language they signed up in; else the site's. */
  locale: Schema.optionalKey(Locale),
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
  /** When it was, if it moved. */
  readonly previously?: Times;
  /** Where it was, if the place changed: "" when it had none. */
  readonly previousPlace?: string;
}

export interface CancelNotice extends Notice {
  /** When the link to confirm cancelling stops working: milliseconds since the epoch. */
  readonly expiresAt: number;
}

export type Kept =
  | (Notice & {
      readonly kind:
        | "signedUp"
        | "signupCancelled"
        | "signupRemoved"
        | "eventCancelled";
    })
  | (ChangeNotice & { readonly kind: "eventChanged" })
  | (CancelNotice & { readonly kind: "cancelRequested" });

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
    /** An organizer took them off an event that has not ended. */
    readonly signupRemoved: (notice: Notice) => Effect.Effect<void>;
    /** A guest asked to cancel by their email address: they confirm from a link. */
    readonly cancelRequested: (notice: CancelNotice) => Effect.Effect<void>;
    /** The event moved, or is at another place. */
    readonly eventChanged: (notice: ChangeNotice) => Effect.Effect<void>;
    /** The event was deleted before it was over: it won't happen. */
    readonly eventCancelled: (notice: Notice) => Effect.Effect<void>;
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
        signupRemoved: (notice) => keep({ kind: "signupRemoved", ...notice }),
        cancelRequested: (notice) =>
          keep({ kind: "cancelRequested", ...notice }),
        eventChanged: (notice) => keep({ kind: "eventChanged", ...notice }),
        eventCancelled: (notice) => keep({ kind: "eventCancelled", ...notice }),
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
  readonly locale: Locale | null;
}

/** The columns every notice needs from an attendee. */
export const signupColumns = (sql: SqlClient.SqlClient, alias?: string) => {
  const column = (name: string) =>
    alias === undefined ? sql(name) : sql`${sql(alias)}.${sql(name)}`;
  return sql`${column("id")}, ${column("name")}, ${column("email")},
    ${column("user_issuer")} IS NULL AS guest, ${column("locale")}`;
};

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
            ...(signup.locale === null ? {} : { locale: signup.locale }),
          }),
    { discard: true },
  );
