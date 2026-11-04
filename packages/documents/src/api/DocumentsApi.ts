import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ContentTypeName } from "../events/ContentTypes.ts";
import { DocumentId, Heads, Publication, TeamId } from "../Model.ts";
import { DocumentNotFound, PublishRejected, TeamNotFound } from "./errors.ts";

/**
 * Creating, publishing, unpublishing and deleting documents, for signed-in users.
 * Documents are synced as rows; their drafts sync over automerge-repo's
 * WebSocket (see DraftSync.ts).
 */
export class DocumentsApi extends HttpApiGroup.make("documents")
  .add(
    /**
     * Creates an empty document with the id the client picked for it.
     * Creating it again with the same id does nothing, so a client can
     * safely retry.
     */
    HttpApiEndpoint.post("create", "/api/documents", {
      payload: Schema.Struct({
        id: DocumentId,
        type: ContentTypeName,
        teamId: TeamId,
      }),
      success: DocumentId,
      error: TeamNotFound,
    }),
    /**
     * Makes a new, never-published event in the same team with the content of
     * the event's draft, under the id the client picked for it. Copying again
     * with the same id does nothing, so a client can safely retry.
     */
    HttpApiEndpoint.post("copy", "/api/documents/:id/copies", {
      params: { id: DocumentId },
      payload: Schema.Struct({ id: DocumentId }),
      success: DocumentId,
      error: DocumentNotFound,
    }),
    /**
     * Publishes the draft as of `heads`: the version the user saw, which
     * the server must already have. The published version syncs as a row
     * of `events`.
     */
    HttpApiEndpoint.patch("update", "/api/documents/:id", {
      params: { id: DocumentId },
      payload: Schema.Struct({ published: Schema.Literal(true), heads: Heads }),
      success: Publication,
      error: [DocumentNotFound, PublishRejected],
    }),
    /**
     * Takes the published version off the site, keeping the draft. Not
     * published is as good as unpublished.
     */
    HttpApiEndpoint.delete("unpublish", "/api/documents/:id/publication", {
      params: { id: DocumentId },
      error: DocumentNotFound,
    }),
    /**
     * Discards the draft's changes since it was last published: the draft
     * becomes the published version again. Not published: nothing to discard.
     */
    HttpApiEndpoint.delete("discardChanges", "/api/documents/:id/changes", {
      params: { id: DocumentId },
      error: DocumentNotFound,
    }),
    /** Deletes the document, taking its published version off the site. */
    HttpApiEndpoint.delete("delete", "/api/documents/:id", {
      params: { id: DocumentId },
      error: DocumentNotFound,
    }),
  )
  .middleware(Authentication) {}
