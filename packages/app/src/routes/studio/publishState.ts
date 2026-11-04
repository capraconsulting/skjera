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
    publishedHeads !== undefined &&
    !saving &&
    [...publishedHeads].sort().join(",") === version;
  return { upToDate, changed: publishedHeads !== undefined && !upToDate };
};
