import { Authentication } from "@skjera/oauth/api";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { ContentTypeName } from "../events/ContentTypes.ts";
import {
  CancellingNotice,
  DocumentId,
  Heads,
  HistoryEntry,
  NoticeChanged,
  Publication,
  PublishingNotice,
  TeamId,
} from "../Model.ts";
import {
  DocumentNotFound,
  MoveRejected,
  PublishRejected,
  RestoreRejected,
  TeamNotFound,
} from "./errors.ts";

const documentApiPath = {
  item: "/api/documents/:id",
  publication: "/api/documents/:id/publication",
  changes: "/api/documents/:id/changes",
  restorations: "/api/documents/:id/restorations",
} as const;

export const documentPath = {
  item: (id: string) => `/api/documents/${id}`,
  publication: (id: string) => `/api/documents/${id}/publication`,
  changes: (id: string) => `/api/documents/${id}/changes`,
  restorations: (id: string) => `/api/documents/${id}/restorations`,
  itemPattern: /^\/api\/documents\/[0-9a-f-]+$/,
  publicationPattern: /^\/api\/documents\/[0-9a-f-]+\/publication$/,
  changesPattern: /^\/api\/documents\/[0-9a-f-]+\/changes$/,
  restorationsPattern: /^\/api\/documents\/[0-9a-f-]+\/restorations$/,
} as const;

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
     * Moves the event to another team. Refused with `OrganizerLocked` once
     * the event has been published, also after it is unpublished.
     */
    HttpApiEndpoint.put("move", "/api/documents/:id/team", {
      params: { id: DocumentId },
      payload: Schema.Struct({ teamId: TeamId }),
      error: [DocumentNotFound, TeamNotFound, MoveRejected],
    }),
    /**
     * Publishes the draft as of `heads`: the version the user saw, which
     * the server must already have. The published version syncs as a row
     * of `events`.
     */
    HttpApiEndpoint.patch("update", documentApiPath.item, {
      params: { id: DocumentId },
      payload: Schema.Struct({
        published: Schema.Literal(true),
        heads: Heads,
        confirmed: Schema.optionalKey(PublishingNotice),
      }),
      success: Schema.Union([Publication, NoticeChanged]),
      error: [DocumentNotFound, PublishRejected],
    }),
    HttpApiEndpoint.post(
      "publishingNotice",
      "/api/documents/:id/publishing-notice",
      {
        params: { id: DocumentId },
        payload: Schema.Struct({ heads: Heads }),
        success: PublishingNotice,
        error: [DocumentNotFound, PublishRejected],
      },
    ),
    HttpApiEndpoint.get(
      "cancellingNotice",
      "/api/documents/:id/cancellation-notice",
      {
        params: { id: DocumentId },
        success: CancellingNotice,
        error: DocumentNotFound,
      },
    ),
    /**
     * Takes the published version off the site, keeping the draft. Not
     * published is as good as unpublished.
     */
    HttpApiEndpoint.delete("unpublish", documentApiPath.publication, {
      params: { id: DocumentId },
      payload: Schema.Struct({
        confirmed: Schema.optionalKey(CancellingNotice),
      }),
      success: Schema.Union([Schema.Void, NoticeChanged]),
      error: DocumentNotFound,
    }),
    /**
     * Discards the draft's changes since it was last published: the draft
     * becomes the published version again. Not published: nothing to discard.
     */
    HttpApiEndpoint.delete("discardChanges", documentApiPath.changes, {
      params: { id: DocumentId },
      error: DocumentNotFound,
    }),
    /**
     * The document's versions, newest first: who changed it and when, with
     * each publishing an entry of its own.
     */
    HttpApiEndpoint.get("history", "/api/documents/:id/history", {
      params: { id: DocumentId },
      success: Schema.Array(HistoryEntry),
      error: DocumentNotFound,
    }),
    /**
     * Makes the draft equal to its version at `heads`, in every field,
     * without publishing. Heads the draft doesn't have are refused.
     */
    HttpApiEndpoint.post("restore", documentApiPath.restorations, {
      params: { id: DocumentId },
      payload: Schema.Struct({ heads: Heads }),
      error: [DocumentNotFound, RestoreRejected],
    }),
    /** Deletes the document, taking its published version off the site. */
    HttpApiEndpoint.delete("delete", documentApiPath.item, {
      params: { id: DocumentId },
      payload: Schema.Struct({
        confirmed: Schema.optionalKey(CancellingNotice),
      }),
      success: Schema.Union([Schema.Void, NoticeChanged]),
      error: DocumentNotFound,
    }),
  )
  .middleware(Authentication) {}
