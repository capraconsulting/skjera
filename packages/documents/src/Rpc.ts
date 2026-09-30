import { type CurrentUser, Unauthorized } from "@skjera/oauth/api";
import { Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";
import { ContentTypeName } from "./ContentTypes.ts";
import {
  ActorNotAllowed,
  DocumentNotFound,
  InvalidChanges,
  InvalidContent,
  PublishRejected,
} from "./errors.ts";
import { DocumentId, DocumentSummary, Heads, Publication } from "./Model.ts";

// The editor's API, served over a WebSocket. Safe to import in the browser.

/**
 * Every call requires a session: the browser sends the session cookie with
 * the WebSocket handshake, so there is nothing for the client to add.
 */
export class DocumentsAuth extends RpcMiddleware.Service<
  DocumentsAuth,
  { provides: CurrentUser }
>()("@skjera/documents/DocumentsAuth", { error: Unauthorized }) {}

export class OpenedDocument extends Schema.Class<OpenedDocument>(
  "@skjera/documents/OpenedDocument",
)({
  type: ContentTypeName,
  /** An Automerge save; load it with the actor id sent to OpenDocument. */
  draft: Schema.Uint8Array,
  publication: Schema.NullOr(Publication),
}) {}

/** Something changed; fetch what's missing unless you already have `heads`. */
export class DraftChanged extends Schema.TaggedClass<DraftChanged>()(
  "DraftChanged",
  { heads: Schema.optional(Heads) },
) {}

/** Changes may have been missed: fetch what's missing. Always sent first. */
export class CatchUp extends Schema.TaggedClass<CatchUp>()("CatchUp", {}) {}

/** The document was deleted; the stream ends. */
export class DocumentDeleted extends Schema.TaggedClass<DocumentDeleted>()(
  "DocumentDeleted",
  {},
) {}

export class DocumentsRpc extends RpcGroup.make(
  Rpc.make("ListDocuments", {
    payload: { type: ContentTypeName },
    success: Schema.Array(DocumentSummary),
  }),
  Rpc.make("CreateDocument", {
    payload: { type: ContentTypeName },
    success: DocumentId,
  }),
  /**
   * Starts an editor session: registers `actor`, the actor id the client
   * will make its changes under, and returns the draft.
   */
  Rpc.make("OpenDocument", {
    payload: { id: DocumentId, actor: Schema.String },
    success: OpenedDocument,
    error: Schema.Union([DocumentNotFound, ActorNotAllowed]),
  }),
  /** Sends local changes. After an error the replica must be reloaded. */
  Rpc.make("SendChanges", {
    payload: { id: DocumentId, changes: Schema.Array(Schema.Uint8Array) },
    success: Heads,
    error: Schema.Union([
      DocumentNotFound,
      InvalidChanges,
      ActorNotAllowed,
      InvalidContent,
    ]),
  }),
  /** The changes a replica at `heads` is missing, for `Automerge.loadIncremental`. */
  Rpc.make("ChangesSince", {
    payload: { id: DocumentId, heads: Heads },
    success: Schema.Uint8Array,
    error: DocumentNotFound,
  }),
  Rpc.make("WatchDocument", {
    payload: { id: DocumentId },
    success: Schema.Union([DraftChanged, CatchUp, DocumentDeleted]),
    stream: true,
  }),
  /** Deletes the document, taking its published version off the site. */
  Rpc.make("DeleteDocument", {
    payload: { id: DocumentId },
    error: DocumentNotFound,
  }),
  /** Publishes the draft as of `heads`, which the server must already have. */
  Rpc.make("Publish", {
    payload: { id: DocumentId, heads: Heads },
    success: Publication,
    error: Schema.Union([DocumentNotFound, PublishRejected]),
  }),
).middleware(DocumentsAuth) {}
