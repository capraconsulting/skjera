import type { Identity } from "@skjera/oauth/api";
import { Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import type { ContentTypeName } from "./ContentTypes.ts";
import type {
  Answer,
  Audience,
  Cover,
  DocumentId,
  Heads,
  Question,
  RichText,
  TeamId,
} from "./Model.ts";
import {
  AttendeeDetails,
  AttendeeRow,
  DocumentRow,
  EventRow,
  type Snapshot,
  TeamRow,
} from "./SyncApi.ts";

export interface Pull<Row> {
  readonly rows: ReadonlyArray<Row>;
  readonly deleted: ReadonlyArray<string>;
  readonly complete: boolean;
  readonly snapshot: Snapshot;
}

/**
 * Pulls for clients keeping copies of tables. Every synced row records the
 * transaction that last wrote it, and deleted rows leave tombstones (see the
 * 0004_sync migration). A pull returns what the snapshot of the previous one
 * hadn't seen, however transactions interleaved or in which order they
 * committed, so repeating pulls never misses or loses a change.
 *
 * Some tables only show some rows to some people. A row that changed and
 * isn't theirs to see anymore is pulled as deleted, so it leaves their copy.
 */
export class Sync extends Context.Service<
  Sync,
  {
    readonly teams: (
      since: Snapshot | undefined,
    ) => Effect.Effect<Pull<TeamRow>>;
    readonly documents: (
      since: Snapshot | undefined,
    ) => Effect.Effect<Pull<DocumentRow>>;
    /** Published events: all of them for members, public ones for anyone. */
    readonly events: (
      since: Snapshot | undefined,
      audience: Audience,
    ) => Effect.Effect<Pull<EventRow>>;
    /**
     * Signups: all of them with who they are for signed-in users; for
     * anyone else, those of public events, without who they are.
     */
    readonly attendees: (
      since: Snapshot | undefined,
      viewer: Option.Option<Identity>,
    ) => Effect.Effect<Pull<AttendeeRow>>;
  }
>()("@skjera/documents/Sync") {
  static readonly layer = Layer.effect(
    Sync,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      /**
       * Rows written by transactions `since` hadn't seen; all without it.
       * `xid` names the column holding the writing transaction.
       */
      const unseen = (since: Snapshot | undefined, xid = "xid") =>
        since === undefined
          ? sql`true`
          : sql`${sql.literal(xid)} >= pg_snapshot_xmin(${since}::pg_snapshot)
              AND NOT pg_visible_in_snapshot(${sql.literal(xid)}, ${since}::pg_snapshot)`;

      /**
       * `rows` are the changed rows the reader may see, `hidden` the ids of
       * those they may not.
       */
      const pull = <Row>(
        table: string,
        since: Snapshot | undefined,
        rows: Effect.Effect<
          {
            readonly rows: ReadonlyArray<Row>;
            readonly hidden: ReadonlyArray<string>;
          },
          unknown
        >,
      ) =>
        Effect.gen(function* () {
          // One snapshot for the whole pull: the rows, the tombstones and
          // the snapshot returned all see the same transactions.
          yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`;
          const changed = yield* rows;
          const deleted =
            since === undefined
              ? []
              : yield* sql<{ id: string }>`
                  SELECT id FROM sync_deletes
                  WHERE table_name = ${table} AND ${unseen(since)}
                `;
          const [current] = yield* sql<{ snapshot: Snapshot }>`
            SELECT pg_current_snapshot()::text AS snapshot
          `;
          if (current === undefined) {
            return yield* Effect.die("No snapshot");
          }
          return {
            rows: changed.rows,
            deleted: [
              ...deleted.map((row) => row.id),
              // A first pull has nothing to remove them from.
              ...(since === undefined ? [] : changed.hidden),
            ],
            complete: since === undefined,
            snapshot: current.snapshot,
          };
        }).pipe(sql.withTransaction, Effect.orDie);

      const teams = Effect.fn("Sync.teams")(function* (
        since: Snapshot | undefined,
      ) {
        return yield* pull(
          "teams",
          since,
          sql<{ id: TeamId; name: string; created_at: Date }>`
            SELECT id, name, created_at FROM teams WHERE ${unseen(since)}
          `.pipe(
            Effect.map((rows) => ({
              rows: rows.map((row) =>
                TeamRow.make({
                  id: row.id,
                  name: row.name,
                  createdAt: row.created_at,
                }),
              ),
              hidden: [],
            })),
          ),
        );
      });

      const documents = Effect.fn("Sync.documents")(function* (
        since: Snapshot | undefined,
      ) {
        return yield* pull(
          "documents",
          since,
          sql<{
            id: DocumentId;
            type: ContentTypeName;
            team_id: TeamId;
            title: string;
            starts_at: Date | null;
            time_zone: string | null;
            draft_heads: Heads;
            created_at: Date;
            updated_at: Date;
          }>`
            SELECT id, type, team_id, title, starts_at, time_zone,
              draft_heads, created_at, updated_at
            FROM documents WHERE ${unseen(since)}
          `.pipe(
            Effect.map((rows) => ({
              rows: rows.map((row) =>
                DocumentRow.make({
                  id: row.id,
                  type: row.type,
                  teamId: row.team_id,
                  title: row.title,
                  startsAt: row.starts_at,
                  timeZone: row.time_zone,
                  draftHeads: row.draft_heads,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                }),
              ),
              hidden: [],
            })),
          ),
        );
      });

      const events = Effect.fn("Sync.events")(function* (
        since: Snapshot | undefined,
        audience: Audience,
      ) {
        return yield* pull(
          "events",
          since,
          sql<{
            id: DocumentId;
            title: string;
            starts_at: Date;
            ends_at: Date;
            signup_deadline: Date | null;
            time_zone: string;
            body: RichText;
            cover: Cover | null;
            is_public: boolean;
            allow_guests: boolean;
            ask_dietary: boolean;
            food: string;
            food_deadline: Date | null;
            questions: ReadonlyArray<Question>;
            published_heads: Heads;
            published_at: Date;
            first_published_at: Date;
            visible: boolean;
          }>`
            SELECT id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover, is_public,
              allow_guests, ask_dietary, food, food_deadline, questions,
              published_heads, published_at,
              first_published_at, is_public OR ${audience === "members"} AS visible
            FROM events WHERE ${unseen(since)}
          `.pipe(
            Effect.map((rows) => ({
              rows: rows
                .filter((row) => row.visible)
                .map((row) =>
                  EventRow.make({
                    id: row.id,
                    title: row.title,
                    startsAt: row.starts_at,
                    endsAt: row.ends_at,
                    signupDeadline: row.signup_deadline,
                    timeZone: row.time_zone,
                    body: row.body,
                    cover: row.cover,
                    isPublic: row.is_public,
                    allowGuests: row.allow_guests,
                    askDietary: row.ask_dietary,
                    food: row.food,
                    foodDeadline: row.food_deadline,
                    questions: row.questions,
                    publishedHeads: row.published_heads,
                    publishedAt: row.published_at,
                    firstPublishedAt: row.first_published_at,
                  }),
                ),
              hidden: rows.filter((row) => !row.visible).map((row) => row.id),
            })),
          ),
        );
      });

      const attendees = Effect.fn("Sync.attendees")(function* (
        since: Snapshot | undefined,
        viewer: Option.Option<Identity>,
      ) {
        const member = Option.isSome(viewer);
        const issuer = Option.match(viewer, {
          onNone: () => null,
          onSome: (user) => user.issuer,
        });
        const subject = Option.match(viewer, {
          onNone: () => null,
          onSome: (user) => user.subject,
        });
        return yield* pull(
          "attendees",
          since,
          sql<{
            id: string;
            event_id: DocumentId;
            created_at: Date;
            changed_at: Date;
            name: string;
            email: string | null;
            dietary: string | null;
            answers: ReadonlyArray<Answer>;
            guest: boolean;
            mine: boolean;
            visible: boolean;
          }>`
            SELECT a.id, a.event_id, a.created_at, a.changed_at, a.name, a.email, a.dietary, a.answers,
              a.user_issuer IS NULL AS guest,
              coalesce(a.user_issuer = ${issuer} AND a.user_subject = ${subject}, false)
                AS mine,
              e.is_public OR ${member} AS visible
            FROM attendees a JOIN events e ON e.id = a.event_id
            WHERE ${unseen(since, "a.xid")}
              -- Whether anyone else may see them follows their event.
              OR (NOT ${member} AND ${unseen(since, "e.xid")})
          `.pipe(
            Effect.map((rows) => ({
              rows: rows
                .filter((row) => row.visible)
                .map((row) =>
                  AttendeeRow.make({
                    id: row.id,
                    eventId: row.event_id,
                    signedUpAt: row.created_at,
                    changedAt: row.changed_at,
                    mine: row.mine,
                    details: member
                      ? AttendeeDetails.make({
                          name: row.name,
                          email: row.email,
                          dietary: row.dietary,
                          answers: row.answers,
                          guest: row.guest,
                        })
                      : null,
                  }),
                ),
              hidden: rows.filter((row) => !row.visible).map((row) => row.id),
            })),
          ),
        );
      });

      return Sync.of({ teams, documents, events, attendees });
    }),
  );
}
