import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent } from "@skjera/documents/api";
import { useEffect, useSyncExternalStore } from "react";
import { TextEditor } from "../../editor/text/TextEditor.tsx";
import type { DraftPresence } from "../../presence/presence.ts";

/** The collaborative texts kept in a draft under a key of their own. */
export const textPaths = {
  summary: ["summary"],
  place: ["place"],
  streamLink: ["streamLink"],
  signedUpSubject: ["signedUpSubject"],
  signedUpText: ["signedUpText"],
  signupCancelledSubject: ["signupCancelledSubject"],
  signupCancelledText: ["signupCancelledText"],
  eventChangedSubject: ["eventChangedSubject"],
  eventChangedText: ["eventChangedText"],
  eventCancelledSubject: ["eventCancelledSubject"],
  eventCancelledText: ["eventCancelledText"],
} as const;

/**
 * Collaborative text kept under `field`, which a draft from before it
 * existed gets to write in.
 */
export function DraftText(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
  readonly field: keyof typeof textPaths;
  readonly label: string;
  /** Rich text, as the body, rather than one line. */
  readonly rich?: boolean;
}) {
  const { handle, field } = props;
  useEffect(() => {
    if (handle.doc()[field] === undefined) {
      handle.change((doc) => {
        (doc as Partial<Record<typeof field, string>>)[field] = "";
      });
    }
  }, [handle, field]);
  // The text's object, so a new editor starts if someone else's wins. A
  // text's value is a plain string: its id is asked of the draft by key.
  const text = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => {
      const doc = handle.doc();
      return doc[field] === undefined ? null : A.getObjectId(doc, field);
    },
  );
  if (text === null) return null;
  return (
    <TextEditor
      key={text}
      handle={handle}
      path={textPaths[field]}
      label={props.label}
      {...(props.rich === true ? { rich: true } : {})}
      presence={props.presence}
    />
  );
}
