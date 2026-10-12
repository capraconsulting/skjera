import { Context, Effect, Layer, Ref } from "effect";
import type { DocumentId } from "./Model.ts";

// What the organisation's Slack channel is told of (see SlackChannel.ts):
// publishing an event for the first time tells it, in the publish's
// transaction.

/** The events `Announcements.layerTest` was told of, oldest first. */
export class AnnouncementsKept extends Context.Service<
  AnnouncementsKept,
  Ref.Ref<ReadonlyArray<DocumentId>>
>()("@skjera/documents/AnnouncementsKept") {
  static readonly layer = Layer.effect(
    AnnouncementsKept,
    Ref.make<ReadonlyArray<DocumentId>>([]),
  );
}

/** What the Slack channel is told of. Runs in the change's transaction. */
export class Announcements extends Context.Service<
  Announcements,
  {
    /** Published for the first time. */
    readonly eventPublished: (event: DocumentId) => Effect.Effect<void>;
  }
>()("@skjera/documents/Announcements") {
  /** Keeps what it's told, for tests: `AnnouncementsKept` has it. */
  static readonly layerTest = Layer.effect(
    Announcements,
    Effect.gen(function* () {
      const kept = yield* AnnouncementsKept;
      return {
        eventPublished: (event) => Ref.update(kept, (all) => [...all, event]),
      };
    }),
  ).pipe(Layer.provideMerge(AnnouncementsKept.layer));
}
