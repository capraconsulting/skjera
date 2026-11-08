import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent } from "@skjera/documents/api";
import { useSyncExternalStore } from "react";
import { versionOf } from "../routes/studio/publishing/publishState.ts";

/** The draft's version, as a string that changes whenever the draft does. */
export const useVersion = (handle: DocHandle<EventContent>) =>
  useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => versionOf(A.getHeads(handle.doc())),
  );
