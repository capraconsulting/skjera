import { ImmutableString } from "@automerge/automerge/slim";
import { basicSchemaAdapter } from "@automerge/prosemirror";
import { m } from "@skjera/i18n/messages";
import { setBlockType, toggleMark } from "prosemirror-commands";
import {
  type InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Attrs, MarkType, NodeType, Schema } from "prosemirror-model";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from "prosemirror-schema-list";
import {
  type Command,
  type EditorState,
  NodeSelection,
  type Plugin,
} from "prosemirror-state";

// Rich text with @automerge/prosemirror's basic schema: paragraphs,
// headings, lists, links, bold and italics, and images. The editor offers
// those; other blocks of the schema (quotes, code) can still come in with
// pasted HTML.

/** How rich text is stored in Automerge, and shown in ProseMirror. */
export const richTextAdapter = basicSchemaAdapter;

const nodes = (schema: Schema) => {
  const { paragraph, heading, bullet_list, ordered_list, list_item, image } =
    schema.nodes;
  if (
    !paragraph ||
    !heading ||
    !bullet_list ||
    !ordered_list ||
    !list_item ||
    !image
  ) {
    throw new Error("Not the basic rich text schema");
  }
  return { paragraph, heading, bullet_list, ordered_list, list_item, image };
};

const marks = (schema: Schema) => {
  const { strong, em, link } = schema.marks;
  if (!strong || !em || !link)
    throw new Error("Not the basic rich text schema");
  return { strong, em, link };
};

/**
 * Keyboard shortcuts, and Markdown-like typing: "## ", "- ", "1. ". Goes
 * before ProseMirror's base keymap, so Enter in a list makes a new item.
 */
export const richTextPlugins = (schema: Schema): Array<Plugin> => {
  const { heading, bullet_list, ordered_list, list_item } = nodes(schema);
  const { strong, em } = marks(schema);
  return [
    inputRules({
      rules: [
        textblockTypeInputRule(/^##\s$/, heading, { level: 2 }),
        textblockTypeInputRule(/^###\s$/, heading, { level: 3 }),
        wrappingInputRule(/^\s*[-*]\s$/, bullet_list),
        wrappingInputRule(
          /^(\d+)\.\s$/,
          ordered_list,
          (match) => ({ order: Number(match[1]) }),
          (match, node) =>
            node.childCount + node.attrs["order"] === Number(match[1]),
        ),
      ] satisfies Array<InputRule>,
    }),
    keymap({
      "Mod-b": toggleMark(strong),
      "Mod-i": toggleMark(em),
      Enter: splitListItem(list_item),
      Tab: sinkListItem(list_item),
      "Shift-Tab": liftListItem(list_item),
    }),
  ];
};

const markActive = (state: EditorState, type: MarkType) => {
  const { from, $from, to, empty } = state.selection;
  return empty
    ? type.isInSet(state.storedMarks ?? $from.marks()) !== undefined
    : state.doc.rangeHasMark(from, to, type);
};

/** The innermost list around the selection, if any. */
const listAround = (state: EditorState): NodeType | null => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const type = $from.node(depth).type;
    if (type.name === "bullet_list" || type.name === "ordered_list") {
      return type;
    }
  }
  return null;
};

/** The image selected, if one is. */
const selectedImage = (state: EditorState) => {
  const { selection } = state;
  return selection instanceof NodeSelection &&
    selection.node.type === nodes(state.schema).image
    ? selection.node
    : null;
};

export const imagePlacements = ["full", "left", "right", "center"] as const;
export const imageSizes = ["small", "medium", "large"] as const;

/** How an image in the text is placed, how big it is, and what it says. */
export interface ImageChoices {
  readonly placement: (typeof imagePlacements)[number];
  readonly size: (typeof imageSizes)[number];
  /** Empty when there is none. */
  readonly caption: string;
}

export const defaultChoices: ImageChoices = {
  placement: "full",
  size: "medium",
  caption: "",
};

/**
 * The choices are block attributes the schema doesn't declare, which
 * @automerge/prosemirror keeps in the node's `unknownAttrs` and writes back.
 */
const storedAttrs = (attrs: Attrs): Record<string, unknown> => {
  const stored: unknown = attrs["unknownAttrs"];
  return typeof stored === "object" && stored !== null
    ? (stored as Record<string, unknown>)
    : {};
};

const oneOf = <T extends string>(
  list: ReadonlyArray<T>,
  value: unknown,
  fallback: T,
): T => list.find((item) => item === String(value)) ?? fallback;

/**
 * The choices stored on an image, or null for one placed before there were
 * any. A value that isn't a known one reads as the default. Values are
 * strings in the editor's document and in the published body alike, or
 * immutable strings read from Automerge.
 */
export const imageChoices = (attrs: Attrs): ImageChoices | null => {
  const stored = storedAttrs(attrs);
  if (stored["placement"] === undefined && stored["size"] === undefined) {
    return null;
  }
  return {
    placement: oneOf(imagePlacements, stored["placement"], "full"),
    size: oneOf(imageSizes, stored["size"], "medium"),
    caption: String(stored["caption"] ?? "").trim(),
  };
};

/** What the site shows for an image: its alt text, or the fallback, and its choices. */
export const shownImage = (attrs: Attrs) => ({
  alt: String(attrs["alt"] ?? "").trim() || m.site_image_alt(),
  choices: imageChoices(attrs),
});

const sameChoices = (a: ImageChoices, b: ImageChoices) =>
  a.placement === b.placement && a.size === b.size && a.caption === b.caption;

/**
 * What to store when an image's dialog is saved: nothing for an image
 * without choices whose dialog was left at the defaults, so it keeps its
 * look; otherwise all three.
 */
export const choicesToStore = (
  stored: ImageChoices | null,
  chosen: ImageChoices,
) => (stored === null && sameChoices(chosen, defaultChoices) ? null : chosen);

const choiceKeys = ["placement", "size", "caption"];

/**
 * The choices as block attributes: immutable strings, as the library stores
 * `src`, because a plain string is Automerge text and a change that removes
 * characters from it throws in the sync. No caption when it is empty.
 */
const toAttrs = (choices: ImageChoices) => {
  const caption = choices.caption.trim();
  return {
    placement: new ImmutableString(choices.placement),
    size: new ImmutableString(choices.size),
    ...(caption === "" ? {} : { caption: new ImmutableString(caption) }),
  };
};

/** A new image, with the default choices unless others are given. */
export const newImage = (
  schema: Schema,
  src: string,
  alt: string,
  choices: ImageChoices = defaultChoices,
) => nodes(schema).image.create({ src, alt, unknownAttrs: toAttrs(choices) });

/** What the toolbar can do, and what's on where the selection is. */
export const toolbarState = (state: EditorState) => {
  const schema = state.schema;
  const { paragraph, heading, bullet_list, ordered_list, list_item } =
    nodes(schema);
  const { strong, em, link } = marks(schema);
  const list = listAround(state);
  const inHeading = state.selection.$from.parent.type === heading;

  const toggleList =
    (type: NodeType): Command =>
    (state, dispatch) =>
      listAround(state) === type
        ? liftListItem(list_item)(state, dispatch)
        : wrapInList(type)(state, dispatch);

  const image = selectedImage(state);
  return {
    /**
     * The selected image's description and choices, if an image is selected.
     * `choices` are the defaults for one without any, and `stored` says
     * whether it has any.
     */
    image:
      image === null
        ? null
        : {
            alt: String(image.attrs["alt"] ?? ""),
            choices: imageChoices(image.attrs) ?? defaultChoices,
            stored: imageChoices(image.attrs) !== null,
          },
    bold: { active: markActive(state, strong), run: toggleMark(strong) },
    italic: { active: markActive(state, em), run: toggleMark(em) },
    heading: {
      active: inHeading,
      run: inHeading
        ? setBlockType(paragraph)
        : setBlockType(heading, { level: 2 }),
    },
    bulletList: {
      active: list === bullet_list,
      run: toggleList(bullet_list),
    },
    orderedList: {
      active: list === ordered_list,
      run: toggleList(ordered_list),
    },
    link: {
      active: markActive(state, link),
      /** Links need text to link. */
      available: !state.selection.empty,
      href: (() => {
        const { from, to } = state.selection;
        let href: string | null = null;
        state.doc.nodesBetween(from, to, (node) => {
          const found = link.isInSet(node.marks);
          if (found) href = String(found.attrs["href"] ?? "");
        });
        return href;
      })(),
    },
  };
};

/** Links the selected text to `href`, or unlinks it when `href` is null. */
export const setLink =
  (href: string | null): Command =>
  (state, dispatch) => {
    const { link } = marks(state.schema);
    const { from, to, empty } = state.selection;
    if (empty) return false;
    if (dispatch) {
      const tr = state.tr.removeMark(from, to, link);
      dispatch(
        href === null ? tr : tr.addMark(from, to, link.create({ href })),
      );
    }
    return true;
  };

/** Puts an image where the selection is. */
export const insertImage =
  (src: string, alt: string, choices?: ImageChoices): Command =>
  (state, dispatch) => {
    if (dispatch) {
      dispatch(
        state.tr.replaceSelectionWith(
          newImage(state.schema, src, alt, choices),
        ),
      );
    }
    return true;
  };

/**
 * Sets the selected image's description and choices, keeping anything else
 * stored on it. No choices (null) leaves the stored ones as they are. The
 * image is replaced rather than changed, as that is what syncs.
 */
export const setImage =
  (alt: string, choices: ImageChoices | null): Command =>
  (state, dispatch) => {
    const image = selectedImage(state);
    if (image === null) return false;
    if (dispatch) {
      const { from, to } = state.selection;
      const kept = Object.entries(storedAttrs(image.attrs)).filter(
        ([key]) => choices === null || !choiceKeys.includes(key),
      );
      const unknownAttrs =
        choices === null
          ? kept
          : [...kept, ...Object.entries(toAttrs(choices))];
      const tr = state.tr.replaceWith(
        from,
        to,
        image.type.create({
          ...image.attrs,
          alt,
          unknownAttrs:
            unknownAttrs.length === 0 ? null : Object.fromEntries(unknownAttrs),
        }),
      );
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, from)));
    }
    return true;
  };

/** Only web and mail links. */
export const safeHref = (href: string) => {
  try {
    const url = new URL(href, window.location.href);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
};
