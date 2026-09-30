import { Schema } from "effect";

// Document identity and publish state, shared by the server and the editor.

export const DocumentId = Schema.String.pipe(Schema.brand("DocumentId"));
export type DocumentId = typeof DocumentId.Type;

/** Hex change hashes identifying a version of a document. */
export const Heads = Schema.Array(Schema.String);
export type Heads = typeof Heads.Type;

export class Publication extends Schema.Class<Publication>(
  "@skjera/documents/Publication",
)({
  /** The version of the draft that was published. */
  heads: Heads,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
}) {}

export class DocumentSummary extends Schema.Class<DocumentSummary>(
  "@skjera/documents/DocumentSummary",
)({
  id: DocumentId,
  title: Schema.String,
  updatedAt: Schema.Date,
  publishedAt: Schema.NullOr(Schema.Date),
  /** The draft differs from the published version, or was never published. */
  hasUnpublishedChanges: Schema.Boolean,
}) {}

/** A post as the public site shows it: only ever the published version. */
export class PublishedPost extends Schema.Class<PublishedPost>(
  "@skjera/documents/PublishedPost",
)({
  id: DocumentId,
  title: Schema.String,
  body: Schema.String,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
}) {}
