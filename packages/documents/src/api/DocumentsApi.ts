import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ContentTypeName } from "../events/ContentTypes.ts";
import { DocumentId, Heads, Publication, TeamId } from "../Model.ts";
import { DocumentNotFound, PublishRejected, TeamNotFound } from "./errors.ts";

/**
 * Creating, publishing and deleting documents, for signed-in users.
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
    /** Deletes the document, taking its published version off the site. */
    HttpApiEndpoint.delete("delete", "/api/documents/:id", {
      params: { id: DocumentId },
      error: DocumentNotFound,
    }),
  )
  .middleware(Authentication) {}
