import type { Identity } from "@skjera/oauth/api";
import type { Pulled, Token } from "@skjera/snapsync/schema";
import * as Snapsync from "@skjera/snapsync/server";
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
  TagRow,
  TeamRow,
} from "./SyncApi.ts";

export type Pull<Row> = Pulled<Row>;

/**
 * Pulls for clients keeping copies of tables, with snapsync: every synced
 * row records the transaction that last wrote it, and deleted rows leave
 * tombstones (see the 0015_snapsync migration). A pull returns what the
 * previous one hadn't seen, however transactions interleaved or in which
 * order they committed, so repeating pulls never misses or loses a change.
 *
 * Some tables only show some rows to some people. A row that changed and
 * isn't theirs to see anymore is pulled as deleted, so it leaves their copy.
 */
export class Sync extends Context.Service<
  Sync,
  {
    readonly teams: (since: Token | undefined) => Effect.Effect<Pull<TeamRow>>;
    readonly documents: (
      since: Token | undefined,
    ) => Effect.Effect<Pull<DocumentRow>>;
    /** Tags published events have had, to suggest. */
    readonly tags: (since: Token | undefined) => Effect.Effect<Pull<TagRow>>;
    /** Published events: all of them for members, public ones for anyone. */
    readonly events: (
      since: Token | undefined,
      audience: Audience,
    ) => Effect.Effect<Pull<EventRow>>;
    /**
     * Signups: all of them with who they are for signed-in users; for
     * anyone else, those of public events, without who they are.
     */
    readonly attendees: (
      since: Token | undefined,
      viewer: Option.Option<Identity>,
    ) => Effect.Effect<Pull<AttendeeRow>>;
  }
>()("@skjera/documents/Sync") {
  static readonly layer = Layer.effect(
    Sync,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      /**
       * Pulls a page of `table`'s changes since a token (see
       * @skjera/snapsync). `load` gives the changed rows the reader may
       * see; those it leaves out leave the reader's copy.
       */
      const pull = <Row extends { readonly id: string }>(
        table: string,
        since: Token | undefined,
        load: (
          keys: ReadonlyArray<string>,
        ) => Effect.Effect<ReadonlyArray<Row>, unknown>,
      ) =>
        Snapsync.pull({ table, since, load, getKey: (row) => row.id }).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.orDie,
        );

      const teams = Effect.fn("Sync.teams")(function* (
        since: Token | undefined,
      ) {
        return yield* pull("teams", since, (keys) =>
          sql<{ id: TeamId; name: string; created_at: Date }>`
            SELECT id, name, created_at FROM teams WHERE id = ANY(${keys}::uuid[])
          `.pipe(
            Effect.map((rows) =>
              rows.map((row) =>
                TeamRow.make({
                  id: row.id,
                  name: row.name,
                  createdAt: row.created_at,
                }),
              ),
            ),
          ),
        );
      });

      const tags = Effect.fn("Sync.tags")(function* (since: Token | undefined) {
        return yield* pull("tags", since, (keys) =>
          sql<{ id: string; name: string }>`
            SELECT id, name FROM tags WHERE id = ANY(${keys}::uuid[])
          `.pipe(Effect.map((rows) => rows.map((row) => TagRow.make(row)))),
        );
      });

      const documents = Effect.fn("Sync.documents")(function* (
        since: Token | undefined,
      ) {
        return yield* pull("documents", since, (keys) =>
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
            FROM documents
            WHERE id = ANY(${keys}::uuid[]) AND deleted_at IS NULL
          `.pipe(
            Effect.map((rows) =>
              rows.map((row) =>
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
            ),
          ),
        );
      });

      const events = Effect.fn("Sync.events")(function* (
        since: Token | undefined,
        audience: Audience,
      ) {
        return yield* pull("events", since, (keys) =>
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
            tags: ReadonlyArray<string>;
            place: string | null;
            max_attendees: number | null;
            hide_places_left: boolean;
            is_streamed: boolean;
            stream_link: string | null;
            published_heads: Heads;
            published_at: Date;
            first_published_at: Date;
            visible: boolean;
          }>`
            SELECT id, title, starts_at, ends_at, signup_deadline, time_zone, body, cover, is_public,
              allow_guests, ask_dietary, food, food_deadline, questions, tags,
              place, max_attendees, hide_places_left, is_streamed, stream_link,
              published_heads, published_at,
              first_published_at,
              (is_public OR ${audience === "members"}) AND deleted_at IS NULL AS visible
            FROM events WHERE id = ANY(${keys}::uuid[])
          `.pipe(
            Effect.map((rows) =>
              rows
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
                    tags: row.tags,
                    place: row.place,
                    maxAttendees: row.max_attendees,
                    hidePlacesLeft: row.hide_places_left,
                    isStreamed: row.is_streamed,
                    streamLink: row.stream_link,
                    publishedHeads: row.published_heads,
                    publishedAt: row.published_at,
                    firstPublishedAt: row.first_published_at,
                  }),
                ),
            ),
          ),
        );
      });

      const attendees = Effect.fn("Sync.attendees")(function* (
        since: Token | undefined,
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
        return yield* pull("attendees", since, (keys) =>
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
            online: boolean;
            visible: boolean;
          }>`
            SELECT a.id, a.event_id, a.created_at, a.changed_at, a.name, a.email, a.dietary, a.answers,
              a.user_issuer IS NULL AS guest, a.online,
              coalesce(a.user_issuer = ${issuer} AND a.user_subject = ${subject}, false)
                AS mine,
              (e.is_public OR ${member}) AND e.deleted_at IS NULL AS visible
            FROM attendees a JOIN events e ON e.id = a.event_id
            WHERE a.id = ANY(${keys}::uuid[])
          `.pipe(
            Effect.map((rows) =>
              rows
                .filter((row) => row.visible)
                .map((row) =>
                  AttendeeRow.make({
                    id: row.id,
                    eventId: row.event_id,
                    signedUpAt: row.created_at,
                    changedAt: row.changed_at,
                    mine: row.mine,
                    online: row.online,
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
            ),
          ),
        );
      });

      return Sync.of({ teams, documents, tags, events, attendees });
    }),
  );
}
