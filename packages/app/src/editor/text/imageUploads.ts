import { m } from "@skjera/i18n/messages";
import { Fragment, type Node, type Schema, Slice } from "prosemirror-model";
import { NodeSelection, Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import { imageFiles, uploadImage } from "../uploadImage.ts";
import { imageChoices, newImage } from "./richText.ts";

// Images pasted or dropped into rich text are uploaded, with a placeholder
// where they go until then, as in ProseMirror's upload example. The
// placeholder moves with the edits around it, so the image lands where it
// was put even if others type meanwhile.

type Action =
  | { readonly add: { readonly id: object; readonly pos: number } }
  | { readonly remove: { readonly id: object } };

const key = new PluginKey<DecorationSet>("imageUploads");

const placeholder = (className: string) => {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = m.editor_uploading_image();
  element.setAttribute("role", "status");
  return element;
};

const findPlaceholder = (view: EditorView, id: object) =>
  key
    .getState(view.state)
    ?.find(undefined, undefined, (spec) => spec["id"] === id)[0]?.from ?? null;

const upload = async (
  view: EditorView,
  files: ReadonlyArray<File>,
  pos: number,
  onError: (message: string | null) => void,
) => {
  onError(null);
  const schema: Schema = view.state.schema;
  if (schema.nodes["image"] === undefined) return;
  await Promise.all(
    files.map(async (file) => {
      const id = {};
      view.dispatch(view.state.tr.setMeta(key, { add: { id, pos } }));
      try {
        const src = await uploadImage(file);
        // The editor closed, or the placeholder went with the text around it.
        if (view.isDestroyed) return;
        const at = findPlaceholder(view, id);
        if (at === null) return;
        const tr = view.state.tr
          .replaceWith(at, at, newImage(schema, src, ""))
          .setMeta(key, { remove: { id } });
        // Selected, so the toolbar offers to describe it.
        view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)));
      } catch (error) {
        if (view.isDestroyed) return;
        view.dispatch(view.state.tr.setMeta(key, { remove: { id } }));
        onError(error instanceof Error ? error.message : String(error));
      }
    }),
  );
};

/** Images without choices, e.g. from pasted HTML, get the defaults of a new one. */
export const withDefaults = (fragment: Fragment): Fragment => {
  const nodes: Array<Node> = [];
  fragment.forEach((node) => {
    if (node.type.name === "image") {
      nodes.push(
        imageChoices(node.attrs) === null
          ? newImage(
              node.type.schema,
              String(node.attrs["src"]),
              String(node.attrs["alt"] ?? ""),
            )
          : node,
      );
    } else {
      nodes.push(node.copy(withDefaults(node.content)));
    }
  });
  return Fragment.from(nodes);
};

/** Uploads images pasted or dropped into the editor. */
export const imageUploads = (options: {
  readonly placeholderClass: string;
  /** Why an upload failed; null when trying again. */
  readonly onError: (message: string | null) => void;
}) =>
  new Plugin<DecorationSet>({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        let next = set.map(tr.mapping, tr.doc);
        const action = tr.getMeta(key) as Action | undefined;
        if (action !== undefined && "add" in action) {
          const widget = Decoration.widget(
            action.add.pos,
            () => placeholder(options.placeholderClass),
            { id: action.add.id },
          );
          next = next.add(tr.doc, [widget]);
        } else if (action !== undefined && "remove" in action) {
          next = next.remove(
            next.find(
              undefined,
              undefined,
              (spec) => spec["id"] === action.remove.id,
            ),
          );
        }
        return next;
      },
    },
    props: {
      decorations: (state) => key.getState(state),
      transformPasted: (slice) =>
        new Slice(withDefaults(slice.content), slice.openStart, slice.openEnd),
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData);
        if (files.length === 0) return false;
        const tr = view.state.tr.deleteSelection();
        view.dispatch(tr);
        void upload(view, files, tr.selection.from, options.onError);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        // Moving content within the editor is ProseMirror's.
        if (moved) return false;
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        void upload(view, files, pos, options.onError);
        return true;
      },
    },
  });
