import type * as A from "@automerge/automerge/slim";
import { type DocHandle, init } from "@automerge/prosemirror";
import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { useEffect, useRef, useState } from "react";
import richText from "../../components/RichText.module.css";
import type { DraftPresence } from "../../presence/presence.ts";
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
  /** With `rich`: whether an image has a caption, placement and size. */
  readonly imageChoices?: boolean;
  /** Bigger text, e.g. for a title. */
  readonly large?: boolean;
  readonly label: string;
  /** Share selections with, and show, others in this document. */
  readonly presence?: DraftPresence | null;
  /** Put the caret in the field as soon as it is made. */
  readonly autoFocus?: boolean;
}

/** The wrapper's classes, which the field's look hangs on. */
const editorClasses = (options: {
  readonly multiline?: boolean;
  readonly rich?: boolean;
  readonly large?: boolean;
}) =>
  [
    styles.editor,
    options.multiline || options.rich ? styles.multiline : undefined,
    options.rich ? styles.rich : undefined,
    options.large ? styles.large : undefined,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * An empty field drawn before there is a text behind it, which looks like
 * one and creates the text through `onFocus`. The editor itself can only
 * start on a text that exists.
 */
export function EmptyTextEditor(props: {
  readonly label: string;
  readonly rich?: boolean;
  readonly onFocus: () => void;
}) {
  const rich = props.rich === true;
  return (
    <div className={editorClasses({ rich })}>
      <div className={rich ? richText.content : undefined}>
        {/* biome-ignore lint/a11y/useSemanticElements: it stands in for the editor's own textbox, which is a div, until the editor can start. */}
        <div
          className="ProseMirror"
          role="textbox"
          aria-label={props.label}
          aria-multiline={rich ? "true" : undefined}
          tabIndex={0}
          onFocus={props.onFocus}
        >
          <p>
            <br />
          </p>
        </div>
      </div>
    </div>
  );
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
  imageChoices = false,
  large = false,
  label,
  presence,
  autoFocus = false,
}: TextEditorProps) {
  const mount = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<EditorView | null>(null);
  // Changes whenever the editor's state does, for the toolbar.
  const [, setVersion] = useState(0);
  // Why the last pasted or dropped image didn't upload.
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Whether a view was made for this mount yet, and whether the one a new
  // view replaces had the focus. The first view is focused; a remade one
  // keeps the focus it had. Effects run twice under `<StrictMode>`, so the
  // first view alone is not the one that stays.
  const madeView = useRef(false);
  const hadFocus = useRef(false);

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
    if (autoFocus && (!madeView.current || hadFocus.current)) view.focus();
    madeView.current = true;
    setView(view);
    return () => {
      hadFocus.current = view.hasFocus();
      setView(null);
      view.destroy();
    };
  }, [handle, path, multiline, rich, label, presence, autoFocus]);

  return (
    <div className={editorClasses({ multiline, rich, large })}>
      {rich && view !== null ? (
        <RichTextToolbar
          view={view}
          label={label}
          imageChoices={imageChoices}
        />
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
