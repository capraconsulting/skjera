import type * as A from "@automerge/automerge/slim";
import { type DocHandle, init } from "@automerge/prosemirror";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { useEffect, useRef } from "react";
import { multiLineAdapter, singleLineAdapter } from "./schemas.ts";
import styles from "./TextEditor.module.css";

export interface TextEditorProps {
  readonly handle: DocHandle<unknown>;
  /** Path to an Automerge text field. Keep it referentially stable. */
  readonly path: ReadonlyArray<A.Prop>;
  readonly multiline?: boolean;
  /** Bigger text, e.g. for a title. */
  readonly large?: boolean;
  readonly label: string;
}

/**
 * A collaborative plain-text field. ProseMirror owns the DOM: the view is
 * created once, and remote changes arrive as ProseMirror transactions, so
 * React never re-renders the content and local cursors stay put.
 */
export function TextEditor({
  handle,
  path,
  multiline = false,
  large = false,
  label,
}: TextEditorProps) {
  const mount = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = mount.current;
    if (element === null) return;
    const { schema, pmDoc, plugin } = init(handle, [...path], {
      schemaAdapter: multiline ? multiLineAdapter : singleLineAdapter,
    });
    const view = new EditorView(element, {
      state: EditorState.create({
        schema,
        doc: pmDoc,
        plugins: [
          keymap(multiline ? {} : { Enter: () => true }),
          keymap(baseKeymap),
          plugin,
        ],
      }),
      // Paste as plain text so no blocks or formatting enter the document.
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        view.dispatch(
          view.state.tr.insertText(
            multiline
              ? text.replace(/\r\n?/g, "\n")
              : text.replace(/\s*[\r\n]+\s*/g, " "),
          ),
        );
        return true;
      },
      attributes: {
        "aria-label": label,
        ...(multiline ? { "aria-multiline": "true" } : {}),
        role: "textbox",
      },
    });
    return () => view.destroy();
  }, [handle, path, multiline, label]);

  return (
    <div
      ref={mount}
      className={[
        styles.editor,
        multiline ? styles.multiline : undefined,
        large ? styles.large : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
