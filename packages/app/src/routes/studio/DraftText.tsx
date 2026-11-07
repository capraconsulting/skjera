import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EmailField, EventContent } from "@skjera/documents/api";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { EmptyTextEditor, TextEditor } from "../../editor/text/TextEditor.tsx";
import type { DraftPresence } from "../../presence/presence.ts";

/** The collaborative texts kept in a draft under a key of their own. */
export const textPaths = {
  summary: ["summary"],
  place: ["place"],
  streamLink: ["streamLink"],
  salesEventType: ["salesEventType"],
} as const;

type DraftTextField = keyof typeof textPaths | EmailField;

/**
 * Collaborative text kept under `field`, which a draft from before it
 * existed gets to write in.
 */
export function DraftText(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
  readonly field: DraftTextField;
  readonly label: string;
  /** Rich text, as the body, rather than one line. */
  readonly rich?: boolean;
  /**
   * Show the field before its key exists, as an empty one, and create the
   * key when the organizer goes into it. Without it the key is created as
   * soon as the field is drawn.
   */
  readonly createOnFocus?: boolean;
}) {
  const { handle, field } = props;
  const createOnFocus = props.createOnFocus === true;
  // Set once the organizer's focus created the key, so the editor made then
  // takes the focus over.
  const [focusing, setFocusing] = useState(false);
  const create = useCallback(() => {
    if (handle.doc()[field] === undefined) {
      handle.change((doc) => {
        (doc as Partial<Record<typeof field, string>>)[field] = "";
      });
    }
  }, [handle, field]);
  useEffect(() => {
    if (!createOnFocus) create();
  }, [create, createOnFocus]);
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
  if (text === null) {
    return createOnFocus ? (
      <EmptyTextEditor
        label={props.label}
        rich={props.rich === true}
        onFocus={() => {
          setFocusing(true);
          create();
        }}
      />
    ) : null;
  }
  return (
    <TextEditor
      key={text}
      handle={handle}
      path={
        field in textPaths
          ? textPaths[field as keyof typeof textPaths]
          : [field]
      }
      label={props.label}
      {...(props.rich === true ? { rich: true } : {})}
      presence={props.presence}
      autoFocus={focusing}
    />
  );
}
