import { Context, Effect, Layer } from "effect";
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

/** What HubSpot is told of. Runs in the change's transaction. */
export class SalesEvents extends Context.Service<
  SalesEvents,
  {
    /**
     * The event was published, or moved on to its next date.
     * `wasSalesEvent`: it was published before as a sales event and not
     * unpublished since, so those signed up are in HubSpot already.
     */
    readonly published: (event: DocumentId) => Effect.Effect<void>;
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
  static readonly layerTest = Layer.succeed(
    SalesEvents,
    SalesEvents.of({
      published: () => Effect.void,
      cancelled: () => Effect.void,
      signedUp: () => Effect.void,
      signupCancelled: () => Effect.void,
    }),
  );
}
