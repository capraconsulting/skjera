import * as A from "@automerge/automerge";
import { Clock, Cron, Effect, Schema } from "effect";
import { ClusterCron } from "effect/cluster";
import { SqlClient } from "effect/sql";
import { Temporal } from "temporal-polyfill";
import type { DocumentId, Heads, ZonedDateTime } from "../Model.ts";
import { Announcements } from "../notices/Announcements.ts";
import { SalesEvents } from "../notices/SalesEvents.ts";
import { EventContent, type RepeatUnit } from "./ContentTypes.ts";

// A recurring event moves on to its next date when it has ended: a daily job
// moves its times in its draft and in the published copy, publishes it
// again, removes those signed up (nobody is emailed) and tells the Slack
// channel. The move is a change made on the published version, so what an
// organiser has written and not published stays unpublished.

/** How far apart a recurring event's dates are. */
export interface Repeat {
  readonly every: number;
  readonly unit: RepeatUnit;
}

/** An event's times, as its draft has them. */
export interface Times {
  readonly start: ZonedDateTime;
  readonly end: ZonedDateTime;
  readonly deadline: ZonedDateTime | null;
  readonly foodDeadline: ZonedDateTime | null;
}

const plural = {
  day: "days",
  week: "weeks",
  month: "months",
  year: "years",
} as const;

/**
 * The first date in the series whose end is after `now`. The start moves a
 * whole number of intervals in its time zone, keeping its time of day;
 * Temporal takes the month's last day when the month is shorter. Each other
 * time keeps its distance from the start as the clock in the zone shows it,
 * in days, hours and minutes, so the times stay in order and keep their time
 * of day across a change between summer and winter time.
 */
export const nextDate = (times: Times, repeat: Repeat, now: Date): Times => {
  const start = Temporal.ZonedDateTime.from(times.start);
  const zone = start.timeZoneId;
  // On the clock, not in elapsed time: 20:00 stays 20:00 after a change.
  const offset = (time: ZonedDateTime) =>
    start
      .toPlainDateTime()
      .until(Temporal.ZonedDateTime.from(time).toPlainDateTime(), {
        largestUnit: "days",
      });
  const at = (moved: Temporal.ZonedDateTime, time: ZonedDateTime) =>
    moved.toPlainDateTime().add(offset(time)).toZonedDateTime(zone);
  const write = (time: Temporal.ZonedDateTime) =>
    time.toString({ smallestUnit: "minute" }) as ZonedDateTime;
  for (let n = 1; ; n++) {
    // From the start given, so one move that skips a short month is not
    // shortened by it. The next move starts from the date this one gives.
    const moved = start.add({ [plural[repeat.unit]]: n * repeat.every });
    const end = at(moved, times.end);
    if (end.epochMilliseconds > now.getTime()) {
      return {
        start: write(moved),
        end: write(end),
        deadline:
          times.deadline === null ? null : write(at(moved, times.deadline)),
        foodDeadline:
          times.foodDeadline === null
            ? null
            : write(at(moved, times.foodDeadline)),
      };
    }
  }
};

/** Every day at 06:30 UTC; the zone is given, else `Cron` reads the process's. */
export const schedule = Cron.parseUnsafe("30 6 * * *", "UTC");

interface EventRow {
  readonly repeat_every: number;
  readonly repeat_unit: RepeatUnit;
  readonly published_heads: Heads;
  readonly published_by_issuer: string;
  readonly published_by_subject: string;
  readonly content: unknown;
}

/**
 * Moves one event on, in a transaction. Nothing is done when another run
 * moved it first, or it was deleted meanwhile.
 */
const moveOn = (id: DocumentId, now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const announcements = yield* Announcements;
    const salesEvents = yield* SalesEvents;

    // The document first, then the event: the order `Documents.delete` locks
    // them in, so the two cannot wait for each other.
    const [document] = yield* sql<{ draft: Uint8Array }>`
      SELECT draft::bytea AS draft FROM documents
      WHERE id = ${id} AND deleted_at IS NULL FOR UPDATE
    `;
    // Checked again after the lock: a run that waited finds the new end.
    const [event] = yield* sql<EventRow>`
      SELECT e.repeat_every, e.repeat_unit, e.published_heads,
        e.published_by_issuer, e.published_by_subject,
        automerge_to_jsonb(d.draft, e.published_heads) AS content
      FROM events e JOIN documents d ON d.id = e.id
      WHERE e.id = ${id} AND e.repeat_unit IS NOT NULL AND e.deleted_at IS NULL
        AND e.ends_at <= ${now}::timestamptz
      FOR UPDATE OF e
    `;
    if (document === undefined || event === undefined) return;

    const content = yield* Schema.decodeUnknownEffect(EventContent)(
      event.content,
    );
    if (content.start === null || content.end === null) {
      return yield* Effect.die(`Event ${id} is published without times`);
    }
    const next = nextDate(
      {
        start: content.start,
        end: content.end,
        deadline: content.deadline,
        foodDeadline: content.foodDeadline,
      },
      { every: event.repeat_every, unit: event.repeat_unit },
      now,
    );

    // A change on the published version, merged into the draft as it is.
    const { newDoc, newHeads } = A.changeAt(
      A.load<EventContent>(document.draft),
      [...event.published_heads],
      (draft) => {
        const times = draft as Record<string, unknown>;
        for (const [field, value] of Object.entries(next)) {
          times[field] = value === null ? null : new A.ImmutableString(value);
        }
      },
    );
    const change = A.getLastLocalChange(newDoc);
    if (change === undefined || newHeads === null) {
      return yield* Effect.die(`Event ${id} was not moved`);
    }
    // The server's change must fit the draft's schema, as an editor's must.
    const [merged] = yield* sql<{ content: unknown }>`
      SELECT merge(draft, ${change}::bytea)::jsonb AS content
      FROM documents WHERE id = ${id}
    `;
    yield* Schema.decodeUnknownEffect(EventContent)(merged?.content, {
      onExcessProperty: "error",
    });
    yield* sql`
      UPDATE documents SET draft = merge(draft, ${change}::bytea), updated_at = now()
      WHERE id = ${id}
    `;

    yield* sql`DELETE FROM attendees WHERE event_id = ${id}`;
    yield* sql`DELETE FROM dietary_preferences WHERE event_id = ${id}`;

    // Published again in the name of whoever published last.
    const [published] = yield* sql<{ starts_at: Date }>`
      SELECT starts_at FROM publish_event(${id}, ${newHeads}::text[],
        ${event.published_by_issuer}, ${event.published_by_subject})
    `;
    if (published === undefined) {
      return yield* Effect.die(`Event ${id} was not published again`);
    }
    // Skjera's own publishing: it has no publisher.
    yield* sql`
      INSERT INTO event_publications (event_id, heads)
      VALUES (${id}, ${newHeads}::text[])
    `;
    yield* announcements.eventRepeated(id, published.starts_at);
    // Its Marketing Event takes the new times; those signed up for the
    // date before are in HubSpot already, and nobody is signed up now.
    yield* salesEvents.published(id, { wasSalesEvent: true });
  });

/**
 * Moves each published, undeleted recurring event whose end is at or before
 * `now` on to its next date, each in a transaction of its own: one that
 * fails is logged, and the others are moved.
 */
export const moveEnded = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const ended = yield* sql<{ id: DocumentId }>`
      SELECT e.id FROM events e JOIN documents d ON d.id = e.id
      WHERE e.repeat_unit IS NOT NULL AND e.deleted_at IS NULL
        AND d.deleted_at IS NULL AND e.ends_at <= ${now}::timestamptz
      ORDER BY e.ends_at, e.id
    `;
    yield* Effect.forEach(
      ended,
      ({ id }) =>
        moveOn(id, now).pipe(
          sql.withTransaction,
          Effect.catchCause((cause) =>
            Effect.logWarning("Recurring event not moved", {
              event: id,
              cause,
            }),
          ),
        ),
      { discard: true },
    );
  }).pipe(Effect.orDie);

/** `moveEnded`, daily, in one instance. */
export const job = ClusterCron.make({
  name: "recurring-events",
  cron: schedule,
  execute: Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    moveEnded(new Date(millis)),
  ),
});
