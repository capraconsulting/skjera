import { type CurrentUser, Unauthorized } from "@skjera/oauth/api";
import { Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";
import { ContentTypeName } from "./ContentTypes.ts";
import {
  ActorNotAllowed,
  DocumentNotFound,
  InvalidChanges,
  InvalidContent,
  InvalidTeamName,
  PublishRejected,
  TeamNotEmpty,
  TeamNotFound,
} from "./errors.ts";
import {
  DocumentId,
  DocumentSummary,
  Heads,
  PresenceMessage,
  PresenceResync,
  PresenceUpdate,
  Publication,
  Team,
  TeamId,
} from "./Model.ts";

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
  team: Team,
  /** An Automerge save, to merge into the local copy. */
  draft: Schema.Uint8Array,
  /** The draft's heads: the server has everything up to these. */
  heads: Heads,
}) {}

/** What a replica is missing, and the draft's heads with those changes. */
export class DraftChanges extends Schema.Class<DraftChanges>(
  "@skjera/documents/DraftChanges",
)({
  /** Change chunks, for `Automerge.loadIncremental`. */
  changes: Schema.Uint8Array,
  heads: Heads,
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
  /** Tells the rest of the studio where this tab is, and its selection. */
  Rpc.make("PublishPresence", { payload: { update: PresenceUpdate } }),
  /** Presence updates from every studio tab, this one's included. */
  Rpc.make("WatchPresence", {
    success: Schema.Union([PresenceMessage, PresenceResync]),
    stream: true,
  }),
  Rpc.make("CreateTeam", {
    payload: { name: Schema.String },
    success: Team,
    error: InvalidTeamName,
  }),
  Rpc.make("RenameTeam", {
    payload: { id: TeamId, name: Schema.String },
    success: Team,
    error: Schema.Union([InvalidTeamName, TeamNotFound]),
  }),
  /** Only teams without documents can be deleted. */
  Rpc.make("DeleteTeam", {
    payload: { id: TeamId },
    error: Schema.Union([TeamNotFound, TeamNotEmpty]),
  }),
  /** Who is signed up for an event, for its organizers. */
  Rpc.make("ListDocuments", {
    payload: { type: ContentTypeName, teamId: TeamId },
    success: Schema.Array(DocumentSummary),
  }),
  Rpc.make("CreateDocument", {
    payload: { type: ContentTypeName, teamId: TeamId },
    success: DocumentId,
    error: TeamNotFound,
  }),
  /** Starts an editor session with the draft and what to show around it. */
  Rpc.make("OpenDocument", {
    payload: { id: DocumentId },
    success: OpenedDocument,
    error: DocumentNotFound,
  }),
  /**
   * Merges changes the server doesn't have into the draft, all or none.
   * Returns the draft's heads, which may include others' changes too.
   */
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
  /**
   * The changes a replica is missing, given `heads` the server has (a
   * replica's own heads may include changes it hasn't sent yet).
   */
  Rpc.make("ChangesSince", {
    payload: { id: DocumentId, heads: Heads },
    success: DraftChanges,
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
