export { uniqueTags } from "@skjera/documents/api";

export const sameTag = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
