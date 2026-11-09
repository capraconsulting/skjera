import * as A from "@automerge/automerge";
import type { Identity } from "@skjera/oauth/api";
import { Effect, Schema } from "effect";
import { type SqlClient, SqlError } from "effect/sql";
import { DocumentNotFound, RestoreRejected } from "../../api/errors.ts";
import { refused } from "../../api/Problems.ts";
import { type DocumentId, type Heads, isVersion } from "../../Model.ts";
import { EventContent } from "../ContentTypes.ts";
import {
  discardedMessage,
  restoredMessage,
  restorePublished,
  sameContent,
} from "./DiscardChanges.ts";
import { applyServerChange } from "./DocumentChange.ts";
import { publishEvent } from "./EventPublishing.ts";
import { readHistory } from "./History.ts";

type Dependencies = {
  readonly sql: SqlClient.SqlClient;
  readonly claimActor: (
    id: DocumentId,
    actor: string,
    user: Identity,
  ) => Effect.Effect<unknown, SqlError.SqlError>;
  readonly rememberName: (
    user: Identity,
  ) => Effect.Effect<void, SqlError.SqlError>;
};

export const documentHistory = ({
  sql,
  claimActor,
  rememberName,
}: Dependencies) => {
  const discardChanges = Effect.fn("Documents.discardChanges")(function* (
    id: DocumentId,
    user: Identity,
  ) {
    const found = yield* Effect.gen(function* () {
      // The document first, then the event: the order `delete` locks them in.
      const [document] = yield* sql<{ draft: Uint8Array }>`
        SELECT draft::bytea AS draft FROM documents
        WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
      `;
      if (document === undefined) return false;
      const [event] = yield* sql<{
        published_heads: Heads;
        published_by_issuer: string;
        published_by_subject: string;
      }>`
        SELECT published_heads, published_by_issuer, published_by_subject
        FROM events WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
      `;
      // Never published, or unpublished: nothing to go back to.
      if (event === undefined) return true;

      const published = [...event.published_heads];
      const restored = restorePublished(
        A.load<EventContent>(document.draft),
        published,
        { message: discardedMessage },
      );
      // A version other than the published one is never published by a
      // discard.
      if (!sameContent(restored, published)) {
        return yield* Effect.die(
          `Discarding the changes of ${id} did not give the published version back`,
        );
      }
      const change = A.getLastLocalChange(restored);
      if (change !== undefined) {
        // The server's change must fit the draft's schema, as an editor's must.
        yield* claimActor(id, A.getActorId(restored), user);
        yield* rememberName(user);
        yield* applyServerChange(sql, id, change, (content) =>
          Schema.decodeUnknownEffect(EventContent)(content, {
            onExcessProperty: "error",
          }),
        );
      }

      // Published again at the draft's heads, which differ from the
      // published ones even when the content is the same (an edit typed
      // and undone). No notices and no announcement: nothing published
      // changed, and the signups stay.
      const heads = [...A.getHeads(restored)].sort();
      if (heads.join() !== [...published].sort().join()) {
        const [row] = yield* publishEvent(
          sql,
          id,
          heads,
          {
            issuer: event.published_by_issuer,
            subject: event.published_by_subject,
          },
          {
            issuer: event.published_by_issuer,
            subject: event.published_by_subject,
          },
        );
        if (row === undefined) {
          return yield* Effect.die(`Event ${id} was not published again`);
        }
      }
      return true;
    }).pipe(sql.withTransaction, Effect.orDie);
    if (!found) {
      return yield* new DocumentNotFound({ id });
    }
  }, Effect.uninterruptible);

  const history = Effect.fn("Documents.history")(function* (id: DocumentId) {
    const entries = yield* readHistory(sql, id).pipe(Effect.orDie);
    if (entries === undefined) {
      return yield* new DocumentNotFound({ id });
    }
    return entries;
  });

  const restore = Effect.fn("Documents.restore")(function* (
    id: DocumentId,
    heads: Heads,
    user: Identity,
  ) {
    // Checked before the transaction: a string that is not a change hash
    // never reaches `A.hasHeads`, which looks each one up.
    if (!isVersion(heads)) {
      return yield* new RestoreRejected(refused({ _tag: "UnknownVersion" }));
    }
    yield* Effect.gen(function* () {
      const [document] = yield* sql<{ draft: Uint8Array }>`
        SELECT draft::bytea AS draft FROM documents
        WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
      `;
      if (document === undefined) {
        return yield* new DocumentNotFound({ id });
      }
      const doc = A.load<EventContent>(document.draft);
      if (!A.hasHeads(doc, [...heads])) {
        return yield* new RestoreRejected(refused({ _tag: "UnknownVersion" }));
      }
      let restored = restorePublished(doc, [...heads], {
        message: restoredMessage,
      });
      // Already that version: the restoring is still an entry.
      if (A.getLastLocalChange(restored) === undefined) {
        restored = A.emptyChange(doc, { message: restoredMessage });
      }
      if (!sameContent(restored, [...heads])) {
        return yield* Effect.die(
          `Restoring ${id} did not give the version back`,
        );
      }
      const change = A.getLastLocalChange(restored);
      if (change === undefined) {
        return yield* Effect.die(`Restoring ${id} made no change`);
      }
      // The server's change must fit the draft's schema, as an editor's must.
      const [merged] = yield* sql<{ content: unknown }>`
        SELECT merge(draft, ${change}::bytea)::jsonb AS content
        FROM documents WHERE id = ${id}
      `;
      yield* Schema.decodeUnknownEffect(EventContent)(merged?.content, {
        onExcessProperty: "error",
      }).pipe(Effect.orDie);
      yield* claimActor(id, A.getActorId(restored), user);
      yield* rememberName(user);
      // The draft only: the published version, the signups and the site
      // are as they were.
      yield* sql`
        UPDATE documents SET draft = merge(draft, ${change}::bytea), updated_at = now()
        WHERE id = ${id}
      `;
    }).pipe(
      sql.withTransaction,
      Effect.catchIf(SqlError.isSqlError, Effect.die),
    );
  }, Effect.uninterruptible);

  return { discardChanges, history, restore };
};
