import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/prosemirror";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { DraftPresence, PresenceEntry } from "../presence/presence.ts";

// The fields are one paragraph of plain text, so a ProseMirror position is
// the Automerge text index plus one (for the paragraph's opening).

/**
 * Shares this editor's selection with the others on the draft, and shows
 * theirs in it, as Automerge cursors that stay on the same characters while
 * the text changes.
 */
export const presencePlugin = (options: {
  readonly handle: DocHandle<unknown>;
  readonly path: ReadonlyArray<A.Prop>;
  readonly presence: DraftPresence;
  readonly caretClass: string;
}) => {
  const { handle, presence, caretClass } = options;
  const path = [...options.path];
  const field = String(path[0]);
  const key = new PluginKey(`presence-${field}`);

  const textLength = () => {
    let value: unknown = handle.doc();
    for (const segment of path) {
      value = (value as Record<string | number, unknown>)?.[segment];
    }
    return String(value ?? "").length;
  };

  const toCursor = (position: number) =>
    A.getCursor(
      handle.doc() as A.Doc<unknown>,
      path,
      Math.min(Math.max(position - 1, 0), textLength()),
    );

  // A cursor from a change this replica hasn't received yet can't be placed.
  const toPosition = (cursor: string) => {
    try {
      return (
        A.getCursorPosition(handle.doc() as A.Doc<unknown>, path, cursor) + 1
      );
    } catch {
      return null;
    }
  };

  const share = (view: EditorView) => {
    const { anchor, head } = view.state.selection;
    presence.setSelection({
      field,
      anchor: toCursor(anchor),
      head: toCursor(head),
    });
  };

  const caret = (entry: PresenceEntry) => () => {
    const element = document.createElement("span");
    element.className = caretClass;
    element.style.setProperty("--presence-color", entry.color);
    // Shown by CSS, so the name isn't part of the editor's text.
    element.dataset.name = entry.user.name;
    return element;
  };

  return new Plugin({
    key,
    view(view) {
      let destroyed = false;
      // Redraw when someone else moves.
      const unsubscribe = presence.subscribe(() => {
        if (!destroyed) view.dispatch(view.state.tr.setMeta(key, true));
      });
      return {
        update(view, previous) {
          if (!view.hasFocus()) return;
          const moved = !previous.selection.eq(view.state.selection);
          if (moved || !previous.doc.eq(view.state.doc)) share(view);
        },
        destroy() {
          destroyed = true;
          unsubscribe();
        },
      };
    },
    props: {
      handleDOMEvents: {
        focus: (view) => {
          share(view);
          return false;
        },
        // Moving on to something else on the page removes the caret, but
        // switching to another window or app keeps it: people keep their
        // place while they look something up. Focus has settled by the next
        // tick; `document.hasFocus()` is false while the window is inactive.
        blur: () => {
          setTimeout(() => {
            if (!document.hasFocus()) return;
            if (presence.selection?.field === field) {
              presence.setSelection(null);
            }
          });
          return false;
        },
      },
      decorations(state) {
        const last = state.doc.content.size - 1;
        const clamp = (position: number) =>
          Math.min(Math.max(position, 1), last);
        const decorations: Array<Decoration> = [];
        for (const entry of presence.get()) {
          const selection = entry.selection;
          if (selection?.field !== field) continue;
          const head = toPosition(selection.head);
          if (head === null) continue;
          const anchor = toPosition(selection.anchor) ?? head;
          decorations.push(
            Decoration.widget(clamp(head), caret(entry), {
              key: `${entry.key}-${entry.color}-${entry.user.name}`,
              side: -1,
            }),
          );
          if (anchor !== head) {
            decorations.push(
              Decoration.inline(
                clamp(Math.min(anchor, head)),
                clamp(Math.max(anchor, head)),
                {
                  style: `background: color-mix(in srgb, ${entry.color} 25%, transparent)`,
                },
              ),
            );
          }
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
};
