import type * as A from "@automerge/automerge/slim";
import { type DocHandle, init } from "@automerge/prosemirror";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { useEffect, useRef, useState } from "react";
import richText from "../components/RichText.module.css";
import type { DraftPresence } from "../presence/presence.ts";
import { imageUploads } from "./imageUploads.ts";
import { presencePlugin } from "./presencePlugin.ts";
import { RichTextToolbar } from "./RichTextToolbar.tsx";
import { richTextAdapter, richTextPlugins } from "./richText.ts";
import { multiLineAdapter, singleLineAdapter } from "./schemas.ts";
import styles from "./TextEditor.module.css";

export interface TextEditorProps {
  readonly handle: DocHandle<unknown>;
  /** Path to an Automerge text field. Keep it referentially stable. */
  readonly path: ReadonlyArray<A.Prop>;
  /** Plain text over several lines. */
  readonly multiline?: boolean;
  /** Rich text: headings, lists, links, bold and italics, images. */
  readonly rich?: boolean;
  /** Bigger text, e.g. for a title. */
  readonly large?: boolean;
  readonly label: string;
  /** Share selections with, and show, others in this document. */
  readonly presence?: DraftPresence | null;
}

/**
 * A collaborative text field. ProseMirror owns the DOM: the view is created
 * once, and remote changes arrive as ProseMirror transactions, so React
 * never re-renders the content and local cursors stay put.
 */
export function TextEditor({
  handle,
  path,
  multiline = false,
  rich = false,
  large = false,
  label,
  presence,
}: TextEditorProps) {
  const mount = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  // Changes whenever the editor's state does, for the toolbar.
  const [, setVersion] = useState(0);
  // Why the last pasted or dropped image didn't upload.
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const element = mount.current;
    if (element === null) return;
    const adapter = rich
      ? richTextAdapter
      : multiline
        ? multiLineAdapter
        : singleLineAdapter;
    const { schema, pmDoc, plugin } = init(handle, [...path], {
      schemaAdapter: adapter,
    });
    const view: EditorView = new EditorView(element, {
      state: EditorState.create({
        schema,
        doc: pmDoc,
        plugins: [
          ...(rich
            ? [
                ...richTextPlugins(schema),
                imageUploads({
                  placeholderClass: styles.uploading ?? "",
                  onError: setUploadError,
                }),
              ]
            : [keymap(multiline ? {} : { Enter: () => true })]),
          keymap(baseKeymap),
          plugin,
          ...(presence == null
            ? []
            : [
                presencePlugin({
                  handle,
                  path,
                  adapter,
                  presence,
                  caretClass: styles.caret ?? "",
                }),
              ]),
        ],
      }),
      dispatchTransaction: (transaction) => {
        view.updateState(view.state.apply(transaction));
        if (rich) setVersion((version) => version + 1);
      },
      // Plain text fields take pasted text only, so no blocks or formatting
      // enter them. Rich text takes what its schema has.
      ...(rich
        ? {}
        : {
            handlePaste: (view: EditorView, event: ClipboardEvent) => {
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
          }),
      attributes: {
        "aria-label": label,
        ...(multiline || rich ? { "aria-multiline": "true" } : {}),
        role: "textbox",
      },
    });
    setView(view);
    return () => {
      setView(null);
      view.destroy();
    };
  }, [handle, path, multiline, rich, label, presence]);

  return (
    <div
      className={[
        styles.editor,
        multiline || rich ? styles.multiline : undefined,
        rich ? styles.rich : undefined,
        large ? styles.large : undefined,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {rich && view !== null ? (
        <RichTextToolbar view={view} label={label} />
      ) : null}
      <div ref={mount} className={rich ? richText.content : undefined} />
      {uploadError === null ? null : (
        <p role="alert" className={styles.error}>
          {uploadError}
        </p>
      )}
    </div>
  );
}
