import { isDeepStrictEqual } from "node:util";
import * as A from "@automerge/automerge";
import { basicSchemaAdapter } from "@automerge/prosemirror";

// Going back to what was published, as a change on top of the draft. A CRDT
// draft cannot be wound back: every editor holds a copy that would sync the
// removed changes in again.

type Plain = Record<string, unknown>;
type Path = ReadonlyArray<string>;

const isMap = (value: unknown): value is Plain =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof A.ImmutableString);

/**
 * The draft as it was at `heads`, as a document of its own. Text read through
 * a view looks its path up in the current document, so a text object deleted
 * or replaced since would read wrong; a copy forked at the heads reads right.
 */
const forkAt = <T>(doc: A.Doc<T>, heads: A.Heads) =>
  A.clone(A.view(doc, heads));

/** The paths of the text in nested maps: the fields rich text can sit in. */
const textPaths = (value: Plain, path: Path = []): Array<Path> =>
  Object.entries(value).flatMap(([key, child]): Array<Path> => {
    if (typeof child === "string") return [[...path, key]];
    if (isMap(child)) return textPaths(child, [...path, key]);
    return [];
  });

/** Whether two documents have the same content, text spans included. */
export const sameContentAs = (
  doc: A.Doc<unknown>,
  other: A.Doc<unknown>,
): boolean => {
  const content = A.toJS(other) as Plain;
  // Structural: JSON would hide text versus an ImmutableString, and the
  // blocks in spans do not keep their key order.
  if (!isDeepStrictEqual(A.toJS(doc), content)) return false;
  return textPaths(content).every((path) =>
    isDeepStrictEqual(A.spans(doc, [...path]), A.spans(other, [...path])),
  );
};

/** Whether `doc` has the same content as itself at `heads`, text spans included. */
export const sameContent = <T>(doc: A.Doc<T>, heads: A.Heads): boolean =>
  sameContentAs(doc, forkAt(doc, heads));

/** The blocks of `spans`, in order. */
const blocksOf = (spans: ReadonlyArray<A.Span>) =>
  spans.filter((span) => span.type === "block");

/**
 * Sets the text at `path` to the published spans. A block that differs from
 * the published one at its place is removed first and inserted anew, as the
 * editor does to change an image: removing characters from a block attribute
 * that is text throws in the editors' sync.
 */
const restoreText = (
  root: A.Doc<unknown>,
  path: Path,
  current: ReadonlyArray<A.Span>,
  wanted: ReadonlyArray<A.Span>,
) => {
  const config = basicSchemaAdapter.updateSpansConfig();
  const wantedBlocks = blocksOf(wanted);
  let place = 0;
  let removed = false;
  const kept = current.filter((span) => {
    if (span.type !== "block") return true;
    const same = isDeepStrictEqual(span, wantedBlocks[place]);
    place += 1;
    if (!same) removed = true;
    return same;
  });
  if (removed) A.updateSpans(root, [...path], [...kept], config);
  A.updateSpans(root, [...path], [...wanted], config);
};

const restoreMap = (
  root: A.Doc<unknown>,
  before: A.Doc<unknown>,
  target: Plain,
  path: Path,
  published: A.Doc<unknown>,
  wanted: Plain,
  current: Plain,
) => {
  for (const key of Object.keys(current)) {
    if (!(key in wanted)) delete target[key];
  }
  for (const [key, want] of Object.entries(wanted)) {
    const have = current[key];
    const here = [...path, key];
    if (typeof want === "string") {
      const isText = typeof have === "string";
      if (!isText) target[key] = "";
      restoreText(
        root,
        here,
        isText ? A.spans(before, [...here]) : [],
        A.spans(published, [...here]),
      );
    } else if (isMap(want)) {
      const isMapHere = isMap(have);
      if (!isMapHere) target[key] = {};
      restoreMap(
        root,
        before,
        target[key] as Plain,
        here,
        published,
        want,
        isMapHere ? have : {},
      );
    } else if (!isDeepStrictEqual(want, have)) {
      // Lists are replaced as a whole. A value of the published copy keeps
      // each ImmutableString an ImmutableString and each text a string.
      target[key] = want;
    }
  }
};

/**
 * Makes `doc` equal to `other` in every field, by one change on top of its
 * current heads. A field `other` lacks is deleted; text is set by its spans,
 * so marks and images come too.
 */
export const copyContent = <T>(
  doc: A.Doc<T>,
  other: A.Doc<unknown>,
): A.Doc<T> => {
  const wanted = A.toJS(other) as Plain;
  const current = A.toJS(doc) as Plain;
  return A.change(doc, (draft) => {
    restoreMap(
      draft as A.Doc<unknown>,
      doc as A.Doc<unknown>,
      draft as Plain,
      [],
      other,
      wanted,
      current,
    );
  });
};

/**
 * Makes `doc` equal to itself as of `heads`, in every field, by one change
 * on top of its current heads.
 */
export const restorePublished = <T>(doc: A.Doc<T>, heads: A.Heads): A.Doc<T> =>
  copyContent(doc, forkAt(doc, heads));
