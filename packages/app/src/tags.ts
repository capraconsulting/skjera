/** Tags without repeats, ignoring case: each as first written. */
export const uniqueTags = (
  tags: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const sameTag = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
