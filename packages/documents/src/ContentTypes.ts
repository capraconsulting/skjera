import { Schema } from "effect";

// Content types are safe to share with the editor. A draft must always match
// its type's schema exactly: changes that would add unknown fields or change
// a field's type are rejected before they are stored.

export const Post = Schema.Struct({
  title: Schema.String,
  body: Schema.String,
});
export type Post = typeof Post.Type;

export const contentTypes = {
  post: { schema: Post, initial: { title: "", body: "" } satisfies Post },
};

export type ContentTypeName = keyof typeof contentTypes;
export const ContentTypeName = Schema.Literals(
  Object.keys(contentTypes) as Array<ContentTypeName>,
);
