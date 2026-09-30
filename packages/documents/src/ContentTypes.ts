import { Schema } from "effect";
import { IsoDate } from "./Model.ts";

// Content types are safe to share with the editor. A draft must always match
// its type's schema exactly: changes that would add unknown fields or change
// a field's type are rejected before they are stored.

export const EventContent = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
  /**
   * Stored as an Automerge ImmutableString, replaced as a whole rather than
   * merged character by character. Null until picked.
   */
  date: Schema.NullOr(IsoDate),
});
export type EventContent = typeof EventContent.Type;

/** What a draft needs before it can be published, named for messages. */
export interface Requirement<Content> {
  readonly label: string;
  readonly met: (content: Content) => boolean;
}

export const contentTypes = {
  event: {
    schema: EventContent,
    initial: { title: "", body: "", date: null } satisfies EventContent,
    toPublish: [
      { label: "a title", met: (event) => event.title.trim() !== "" },
      { label: "a date", met: (event) => event.date !== null },
    ] satisfies ReadonlyArray<Requirement<EventContent>>,
  },
};

/** "Add a title and a date before publishing", or null when nothing is missing. */
export const missingToPublish = <Content>(
  requirements: ReadonlyArray<Requirement<Content>>,
  content: Content,
): string | null => {
  const missing = requirements
    .filter((requirement) => !requirement.met(content))
    .map((requirement) => requirement.label);
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
  return `Add ${list} before publishing`;
};

export type ContentTypeName = keyof typeof contentTypes;
export const ContentTypeName = Schema.Literals(
  Object.keys(contentTypes) as Array<ContentTypeName>,
);
