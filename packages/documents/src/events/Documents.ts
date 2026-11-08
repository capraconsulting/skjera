import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import {
  type ActorNotAllowed,
  DocumentNotFound,
  type InvalidChanges,
  type InvalidContent,
  MoveRejected,
  type PublishRejected,
  type RestoreRejected,
  TeamNotFound,
} from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import {
  type CancellingNotice,
  type DocumentId,
  type Heads,
  type HistoryEntry,
  type NoticeChanged,
  Publication,
  type PublishingNotice,
  type TeamId,
} from "../Model.ts";
import { Announcements } from "../notices/Announcements.ts";
import { Notifications } from "../notices/Notifications.ts";
import { SalesEvents } from "../notices/SalesEvents.ts";
import { pgCode } from "../server/PostgresError.ts";
import type { ContentTypeName } from "./ContentTypes.ts";
import { type DocumentSnapshot, documentCreation } from "./DocumentCreation.ts";

export type { DocumentSnapshot } from "./DocumentCreation.ts";

import { documentChanges } from "./DocumentChanges.ts";
import { documentDeletion } from "./DocumentDeletion.ts";
import { documentHistory } from "./DocumentHistory.ts";
import { documentPublishing } from "./DocumentPublishing.ts";

export class Documents extends Context.Service<
  Documents,
  {
    /**
     * Creates an empty document, with `id` if given. Creating it again with
     * the same id does nothing, so a client can safely retry.
     */
    readonly create: (
      type: ContentTypeName,
      team: TeamId,
      author: Identity,
      id?: DocumentId,
    ) => Effect.Effect<DocumentId, TeamNotFound>;
    /**
     * Makes a new, never-published document in the source's team with the
     * content of its draft, and none of its history, attendees or
     * invitations. Copying again with the same `id` does nothing, so a client
     * can safely retry.
     */
    readonly copy: (
      source: DocumentId,
      id: DocumentId,
      author: Identity,
    ) => Effect.Effect<DocumentId, DocumentNotFound>;
    /**
     * Moves a document to another team, while it has never been published:
     * refused once it has, also after it is unpublished.
     */
    readonly move: (
      id: DocumentId,
      team: TeamId,
    ) => Effect.Effect<void, DocumentNotFound | TeamNotFound | MoveRejected>;
    readonly get: (
      id: DocumentId,
    ) => Effect.Effect<DocumentSnapshot, DocumentNotFound>;
    /**
     * What a replica at `heads` is missing, as change chunks for
     * `Automerge.loadIncremental`, and the draft's heads they lead up to.
     */
    readonly changesSince: (
      id: DocumentId,
      heads: Heads,
    ) => Effect.Effect<
      { readonly changes: Uint8Array; readonly heads: Heads },
      DocumentNotFound
    >;
    /**
     * Merges changes into the draft, after checking they come from the
     * sender's own actor ids and leave the draft valid for its content type.
     * An actor id belongs to the first user to send changes with it: every
     * editor session makes changes under a fresh, random one. Returns the new
     * heads.
     */
    readonly applyChanges: (
      id: DocumentId,
      changes: ReadonlyArray<Uint8Array>,
      user: Identity,
    ) => Effect.Effect<
      Heads,
      DocumentNotFound | InvalidChanges | ActorNotAllowed | InvalidContent
    >;
    /** Publishes the draft as it was at `heads`, the version the user saw. */
    readonly publish: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
    ) => Effect.Effect<Publication, DocumentNotFound | PublishRejected>;
    readonly publishConfirmed: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
      confirmed: PublishingNotice,
    ) => Effect.Effect<
      Publication | NoticeChanged,
      DocumentNotFound | PublishRejected
    >;
    readonly publishingNotice: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
    ) => Effect.Effect<PublishingNotice, DocumentNotFound | PublishRejected>;
    readonly cancellingNotice: (
      id: DocumentId,
    ) => Effect.Effect<CancellingNotice, DocumentNotFound>;
    /**
     * Takes the published version off the site and keeps the draft. When the
     * event hasn't ended, its signups are removed and told it's cancelled.
     * Not published, or unpublished already: nothing to do.
     */
    readonly unpublish: (
      id: DocumentId,
      confirmed?: CancellingNotice,
    ) => Effect.Effect<undefined | NoticeChanged, DocumentNotFound>;
    /**
     * Makes the draft the published version again, in every field, and
     * publishes it at its new heads in the name of whoever published last.
     * Nobody is emailed. Not published: nothing to discard. The change is
     * the user's in the history.
     */
    readonly discardChanges: (
      id: DocumentId,
      user: Identity,
    ) => Effect.Effect<void, DocumentNotFound>;
    /**
     * The document's versions, newest first: who changed it and when, with
     * each publishing an entry of its own. Changes one person made within
     * ten minutes of each other are one entry.
     */
    readonly history: (
      id: DocumentId,
    ) => Effect.Effect<ReadonlyArray<HistoryEntry>, DocumentNotFound>;
    /**
     * Makes the draft equal to its version at `heads` in every field, by one
     * change on top of the draft as it is, which the history shows as the
     * user's restoring. Publishes nothing and tells nobody.
     */
    readonly restore: (
      id: DocumentId,
      heads: Heads,
      user: Identity,
    ) => Effect.Effect<void, DocumentNotFound | RestoreRejected>;
    /**
     * Deletes the document, taking its published version off the site. It's
     * kept, marked deleted. An event's attendees are told it's cancelled,
     * unless it's over.
     */
    readonly delete: (
      id: DocumentId,
      user: Identity,
      confirmed?: CancellingNotice,
    ) => Effect.Effect<undefined | NoticeChanged, DocumentNotFound>;
  }
>()("@skjera/documents/Documents") {
  static readonly layer = Layer.effect(
    Documents,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const notifications = yield* Notifications;
      const announcements = yield* Announcements;
      const salesEvents = yield* SalesEvents;

      const { create, copy, get, typeOf, rememberName, claimActor } =
        documentCreation(sql);

      // Per content type, as each has its own table of published versions.
      type PublicationRow = {
        published_heads: Heads;
        published_at: Date;
        first_published_at: Date;
      };
      const toPublication = (row: PublicationRow) =>
        new Publication({
          heads: row.published_heads,
          publishedAt: row.published_at,
          firstPublishedAt: row.first_published_at,
        });

      const { changesSince, applyChanges } = documentChanges(sql, rememberName);

      const upcoming = sql`ends_at > now()`;

      const { publish, publishConfirmed, publishingNotice } =
        documentPublishing({
          sql,
          notifications,
          announcements,
          salesEvents,
          rememberName,
          typeOf,
          toPublication,
        });

      const { cancellingNotice, unpublish, deleteDocument } = documentDeletion({
        sql,
        upcoming,
        notifications,
        salesEvents,
      });

      const { discardChanges, history, restore } = documentHistory({
        sql,
        claimActor,
        rememberName,
      });

      // `updated_at` stays as it is: moving does not edit the event.
      const move = Effect.fn("Documents.move")(function* (
        id: DocumentId,
        team: TeamId,
      ) {
        const [moved] = yield* sql<{ id: DocumentId }>`
          UPDATE documents SET team_id = ${team}
          WHERE id = ${id} AND deleted_at IS NULL AND first_published_at IS NULL
          RETURNING id
        `.pipe(
          Effect.catchIf(SqlError.isSqlError, (error) =>
            pgCode(error) === "23503"
              ? Effect.fail(new TeamNotFound({ id: team }))
              : Effect.die(error),
          ),
        );
        if (moved !== undefined) return;
        const [found] = yield* sql`
          SELECT 1 FROM documents WHERE id = ${id} AND deleted_at IS NULL
        `.pipe(Effect.orDie);
        if (found === undefined) {
          return yield* new DocumentNotFound({ id });
        }
        return yield* new MoveRejected(refused({ _tag: "OrganizerLocked" }));
      }, Effect.uninterruptible);

      return Documents.of({
        create,
        copy,
        move,
        get,
        changesSince,
        applyChanges,
        publish,
        publishConfirmed,
        publishingNotice,
        cancellingNotice,
        unpublish,
        discardChanges,
        history,
        restore,
        delete: deleteDocument,
      });
    }),
  );
}
