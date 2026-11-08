export const versionOf = (heads: ReadonlyArray<string>): string =>
  [...heads].sort().join(",");

export const publishedState = (
  publishedHeads: ReadonlyArray<string> | undefined,
  version: string,
): "draft" | "changed" | "published" => {
  if (publishedHeads === undefined) return "draft";
  return versionOf(publishedHeads) === version ? "published" : "changed";
};

export const rowState = (row: {
  readonly publishedHeads: ReadonlyArray<string> | undefined;
  readonly draftHeads: ReadonlyArray<string>;
}) => publishedState(row.publishedHeads, versionOf(row.draftHeads));

/** Whether the published version is the draft, and whether there are changes to discard. */
export const publishState = (input: {
  /** Undefined: not published. */
  readonly publishedHeads: ReadonlyArray<string> | undefined;
  /** The draft's heads, sorted and joined by commas. */
  readonly version: string;
  /** Local changes the server doesn't have yet. */
  readonly saving: boolean;
}): { readonly upToDate: boolean; readonly changed: boolean } => {
  const { publishedHeads, version, saving } = input;
  const upToDate =
    !saving && publishedState(publishedHeads, version) === "published";
  return { upToDate, changed: publishedHeads !== undefined && !upToDate };
};

/**
 * Whether a version of the event is the draft as it is: its heads, in any
 * order, against the draft's version from `useVersion`.
 */
export const isDraft = (
  heads: ReadonlyArray<string>,
  version: string,
): boolean => versionOf(heads) === version;
