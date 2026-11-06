import { Context, Effect, Layer, Ref } from "effect";
import type { DocumentId } from "../Model.ts";

// What HubSpot is told of (see HubSpotSync.ts): a sales event published,
// moved on or cancelled, and a signup to one made or cancelled, in their
// transactions. It is told of every event; only a sales event is sent.

/** Someone who cancelled or was taken off: who they were, for HubSpot. */
export interface Departed {
  /** Their signup. */
  readonly id: string;
  /** Null: signed up without an email; nothing is sent. */
  readonly email: string | null;
}

/** What `SalesEvents.layerTest` was told, oldest first. */
export type SalesEventsTold =
  | {
      readonly kind: "published";
      readonly event: DocumentId;
      readonly wasSalesEvent: boolean;
    }
  | { readonly kind: "cancelled"; readonly event: DocumentId }
  | {
      readonly kind: "signedUp";
      readonly event: DocumentId;
      readonly signup: string;
    }
  | {
      readonly kind: "signupCancelled";
      readonly event: DocumentId;
      readonly signup: Departed;
    };

export class SalesEventsKept extends Context.Service<
  SalesEventsKept,
  Ref.Ref<ReadonlyArray<SalesEventsTold>>
>()("@skjera/documents/SalesEventsKept") {
  static readonly layer = Layer.effect(
    SalesEventsKept,
    Ref.make<ReadonlyArray<SalesEventsTold>>([]),
  );
}

/** What HubSpot is told of. Runs in the change's transaction. */
export class SalesEvents extends Context.Service<
  SalesEvents,
  {
    /**
     * The event was published, or moved on to its next date.
     * `wasSalesEvent`: it was published before as a sales event and not
     * unpublished since, so those signed up are in HubSpot already.
     */
    readonly published: (
      event: DocumentId,
      options: { readonly wasSalesEvent: boolean },
    ) => Effect.Effect<void>;
    /** Unpublished or deleted before it was over: it won't happen. */
    readonly cancelled: (event: DocumentId) => Effect.Effect<void>;
    /** Someone signed up: their signup's id. */
    readonly signedUp: (
      event: DocumentId,
      signup: string,
    ) => Effect.Effect<void>;
    /** Someone cancelled, or an organizer took them off. */
    readonly signupCancelled: (
      event: DocumentId,
      signup: Departed,
    ) => Effect.Effect<void>;
  }
>()("@skjera/documents/SalesEvents") {
  /** Keeps what it's told, for tests: `SalesEventsKept` has it. */
  static readonly layerTest = Layer.effect(
    SalesEvents,
    Effect.gen(function* () {
      const kept = yield* SalesEventsKept;
      const keep = (told: SalesEventsTold) =>
        Ref.update(kept, (all) => [...all, told]);
      return {
        published: (event, { wasSalesEvent }) =>
          keep({ kind: "published", event, wasSalesEvent }),
        cancelled: (event) => keep({ kind: "cancelled", event }),
        signedUp: (event, signup) => keep({ kind: "signedUp", event, signup }),
        signupCancelled: (event, signup) =>
          keep({ kind: "signupCancelled", event, signup }),
      };
    }),
  ).pipe(Layer.provideMerge(SalesEventsKept.layer));
}
