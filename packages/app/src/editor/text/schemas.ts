import { SchemaAdapter } from "@automerge/prosemirror";

// Plain text fields, stored as Automerge text without block markers so the
// value is a clean string in Postgres' jsonb. @automerge/prosemirror shows
// text before the first block marker in a render-only node named
// "paragraph", so the schemas have one of those and nothing that would create
// blocks. The adapter also needs a node for blocks it doesn't know; that is
// the paragraph too, and pasting is plain text only (see TextEditor), so no
// blocks get created.

/** A single line: Enter is disabled in the editor. */
export const singleLineAdapter = new SchemaAdapter({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      automerge: { unknownBlock: true },
      content: "inline*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

/** Multi-line plain text: Enter inserts "\n" (`code` makes it a newline in the text). */
export const multiLineAdapter = new SchemaAdapter({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      automerge: { unknownBlock: true },
      content: "inline*",
      code: true,
      parseDOM: [{ tag: "p", preserveWhitespace: "full" }],
      toDOM: () => ["p", { style: "white-space: pre-wrap" }, 0],
    },
    text: { group: "inline" },
  },
});
