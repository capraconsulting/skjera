import type * as A from "@automerge/automerge/slim";
import { Effect, Schedule } from "effect";

/** How long publishing, discarding, restoring and copying wait for the server to have every edit. */
export const saveTimeout = "10 seconds";

class NotSavedYet {
  readonly _tag = "NotSavedYet";
}

/**
 * The local copy's version, once the server has all of it. It fails with
 * `unsaved`'s message if that takes longer than `saveTimeout`.
 */
export const savedVersion = (
  copy: { readonly saved: () => boolean; readonly version: () => A.Heads },
  unsaved: () => string,
) =>
  Effect.suspend(() =>
    copy.saved()
      ? Effect.succeed(copy.version())
      : Effect.fail(new NotSavedYet()),
  ).pipe(
    Effect.retry({ schedule: Schedule.spaced("100 millis") }),
    Effect.timeoutOrElse({
      duration: saveTimeout,
      orElse: () => Effect.fail(new Error(unsaved())),
    }),
  );
