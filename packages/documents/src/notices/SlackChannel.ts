import { m } from "@skjera/i18n/messages";
import {
  type Blocks,
  retryTransient,
  Slack,
  SlackApiError,
  type SlackError,
} from "@skjera/slack";
import { Clock, Config, Cron, Effect, Layer, Option, Schema } from "effect";
import { ClusterCron, ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { SqlClient } from "effect/sql";
import { type Cover, type Locale, SiteLocale } from "../Model.ts";
import { Announcements } from "./Announcements.ts";
import { formatAt } from "./emails/format.ts";

// What the organisation's Slack channel is told of: an event published for
// the first time, a recurring event moved on to its next date, and the
// sign-up deadlines that run out within a day. A first publish and a move
// tell `Announcements`, in their transactions; on the server,
// that leaves a message for the channel (a cluster entity, one for all, so
// messages are posted one at a time, in order), kept in the database and
// deduplicated, so each is posted once it's committed, and once only. The
// deadlines are sent the same way, by a daily job.

/** Every time in a message is written in this zone, whatever the event's. */
export const channelTimeZone = "Europe/Oslo";

const Deadline = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** An ISO instant. */
  deadline: Schema.String,
});

const Post = Rpc.make("Post", {
  payload: {
    /** Each message once: what it's about, e.g. "eventPublished/<event>". */
    key: Schema.String,
    kind: Schema.Literals(["eventPublished", "eventRepeated", "deadlines"]),
    /** For the event kinds: the event, read when the message is posted. */
    event: Schema.optionalKey(Schema.String),
    /** For `deadlines`: the events, soonest first. */
    deadlines: Schema.optionalKey(Schema.Array(Deadline)),
  },
  primaryKey: ({ key }) => key,
}).annotate(ClusterSchema.Persisted, true);

/** The channel: every message goes to the one entity, `"channel"`. */
export const SlackChannel = Entity.make("SlackChannel", [Post]);

const channelId = "channel";

/** Where the site is, and the language the messages are in. */
export interface Site {
  readonly url: string;
  readonly locale: Locale;
}

/** A message for Slack: its text, where blocks can't be shown, and blocks. */
export interface Message {
  readonly text: string;
  readonly blocks: Blocks;
}

/** Text as Slack's mrkdwn has it: nothing in it mentions or links. */
const escapeSlack = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Block = Blocks[number];

const section = (text: string): Block => ({
  type: "section",
  text: { type: "mrkdwn", text },
});

const fields = (...texts: ReadonlyArray<string>): Block => ({
  type: "section",
  fields: texts.map((text) => ({ type: "mrkdwn" as const, text })),
});

/** An event as its announcement shows it. */
export interface Announced {
  readonly id: string;
  readonly title: string;
  /** Null: none. */
  readonly summary: string | null;
  /** Null: none. */
  readonly cover: Cover | null;
  readonly startsAt: Date;
  /** Null: published before events had a place. */
  readonly place: string | null;
}

/**
 * The message for an event published: its title with `@here`, cover, summary,
 * a link to sign up, when it starts and where. Each is left out when the
 * event has none. `repeated`: moved on to its next date, marked :repeat:
 * instead.
 */
export const announcement = (
  event: Announced,
  site: Site,
  options: { readonly repeated?: boolean } = {},
): Message => {
  const { locale } = site;
  const mark = options.repeated === true ? ":repeat:" : ":loudspeaker:";
  const heading = `*${escapeSlack(event.title)} | <!here> ${mark}*`;
  const page = new URL(`/events/${event.id}`, site.url).href;
  const when = `*${m.slack_when({}, { locale })}:*\n${formatAt(locale, event.startsAt, channelTimeZone)}`;
  const where =
    event.place === null
      ? []
      : [`*${m.slack_where({}, { locale })}:*\n${escapeSlack(event.place)}`];
  const blocks: Array<Block> = [section(heading)];
  if (event.cover !== null) {
    blocks.push({
      type: "image",
      image_url: new URL(event.cover.src, site.url).href,
      alt_text: event.cover.alt.trim() === "" ? event.title : event.cover.alt,
    });
  }
  if (event.summary !== null) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_${escapeSlack(event.summary)}_` }],
    });
  }
  blocks.push(
    fields(
      `*${m.slack_signup({}, { locale })}:*\n<${page}|${m.slack_signup_link({}, { locale })}>`,
    ),
    fields(when, ...where),
  );
  return { text: heading, blocks };
};

/** An event whose sign-up deadline is near. */
export interface DueDeadline {
  readonly id: string;
  readonly title: string;
  readonly deadline: Date;
}

/**
 * The message for the deadlines due, with `@channel`: a line for each event,
 * in the order given, linking to it with its deadline.
 */
export const deadlineMessage = (
  deadlines: ReadonlyArray<DueDeadline>,
  site: Site,
): Message => {
  const { locale } = site;
  const heading = `*${m.slack_deadlines_heading({}, { locale })} | <!channel> :alarm_clock:*`;
  return {
    text: heading,
    blocks: [
      section(heading),
      ...deadlines.map(({ id, title, deadline }) =>
        section(
          `<${new URL(`/events/${id}`, site.url).href}|${escapeSlack(title)}> – ${formatAt(locale, deadline, channelTimeZone)}`,
        ),
      ),
    ],
  };
};

/** Every day at 07:00 UTC; the zone is given, else `Cron` reads the process's. */
export const deadlineSchedule = Cron.parseUnsafe("0 7 * * *", "UTC");

/**
 * The events with a sign-up deadline the organiser set that runs out within
 * a day of `now`, soonest first: every published event, those shown only to
 * members too. An event whose sign-up closes at the start because no
 * deadline was set is left out.
 */
export const dueDeadlines = (now: Date) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{
      readonly id: string;
      readonly title: string;
      readonly signup_deadline: Date;
    }>`
      SELECT id, title, signup_deadline FROM events
      WHERE deleted_at IS NULL AND signup_deadline IS NOT NULL
        AND signup_deadline > ${now}::timestamptz
        AND signup_deadline <= ${now}::timestamptz + interval '1 day'
        AND starts_at > ${now}::timestamptz
      ORDER BY signup_deadline, id
    `;
    return rows.map(
      ({ id, title, signup_deadline }): DueDeadline => ({
        id,
        title,
        deadline: signup_deadline,
      }),
    );
  }).pipe(Effect.orDie);

/**
 * Sends the deadlines due at `now` to the channel, as one message, none when
 * there are none. The message is keyed by the day, so however many servers
 * send it, it is posted once.
 */
export const postDeadlines = (now: Date) =>
  Effect.gen(function* () {
    const due = yield* dueDeadlines(now);
    if (due.length === 0) return;
    const channel = yield* SlackChannel.client;
    yield* channel(channelId)
      .Post(
        {
          key: `deadlines/${now.toISOString().slice(0, 10)}`,
          kind: "deadlines",
          deadlines: due.map(({ id, title, deadline }) => ({
            id,
            title,
            deadline: deadline.toISOString(),
          })),
        },
        { discard: true },
      )
      .pipe(Effect.orDie);
  });

/** `postDeadlines`, daily, in one instance. */
export const deadlines = ClusterCron.make({
  name: "slack-deadlines",
  cron: deadlineSchedule,
  execute: Effect.flatMap(Clock.currentTimeMillis, (millis) =>
    postDeadlines(new Date(millis)),
  ),
});

/** An event told to the channel as announcements are told: through its entity. */
export const layerAnnouncements = Layer.effect(
  Announcements,
  Effect.gen(function* () {
    const channel = yield* SlackChannel.client;
    return Announcements.of({
      eventPublished: (event) =>
        channel(channelId)
          .Post(
            {
              key: `eventPublished/${event}`,
              kind: "eventPublished",
              event,
            },
            { discard: true },
          )
          .pipe(Effect.orDie),
      eventRepeated: (event, startsAt) =>
        channel(channelId)
          .Post(
            {
              key: `eventRepeated/${event}/${startsAt.toISOString()}`,
              kind: "eventRepeated",
              event,
            },
            { discard: true },
          )
          .pipe(Effect.orDie),
    });
  }),
);

interface EventRow {
  readonly title: string;
  readonly summary: string | null;
  readonly cover: Cover | null;
  readonly starts_at: Date;
  readonly place: string | null;
  readonly deleted: boolean;
}

/**
 * Posts the channel's messages to `channel`, in the site's language. What
 * may work later (a rate limit, Slack unavailable) is tried again; any
 * other failure is logged, and the message is done.
 */
export const poster = (options: {
  readonly channel: string;
  readonly site: Site;
}) =>
  SlackChannel.toLayer(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const slack = yield* Slack;
      const { channel, site } = options;

      const post = (message: Message) =>
        slack
          .postMessage({
            channel,
            text: message.text,
            blocks: message.blocks,
          })
          .pipe(retryTransient());

      // What to post for `payload`: none, when the event was deleted meanwhile.
      const messages = Effect.fn(function* (
        payload: typeof Post.payloadSchema.Type,
      ) {
        if (payload.kind === "deadlines") {
          return Option.some({
            message: deadlineMessage(
              (payload.deadlines ?? []).map(({ id, title, deadline }) => ({
                id,
                title,
                deadline: new Date(deadline),
              })),
              site,
            ),
            withoutCover: undefined,
          });
        }
        const [event] = yield* sql<EventRow>`
          SELECT title, summary, cover, starts_at, place,
            deleted_at IS NOT NULL AS deleted
          FROM events WHERE id = ${payload.event ?? null}
        `.pipe(Effect.orDie);
        if (event === undefined || event.deleted) return Option.none();
        const announced = {
          id: payload.event ?? "",
          title: event.title,
          summary: event.summary,
          cover: event.cover,
          startsAt: event.starts_at,
          place: event.place,
        };
        const options = { repeated: payload.kind === "eventRepeated" };
        return Option.some({
          message: announcement(announced, site, options),
          // For when Slack can't use the cover.
          withoutCover:
            event.cover === null
              ? undefined
              : announcement({ ...announced, cover: null }, site, options),
        });
      });

      const failure = (error: SlackError) => ({
        error: error._tag,
        ...(error instanceof SlackApiError ? { code: error.code } : {}),
      });

      return SlackChannel.of({
        Post: ({ payload }) =>
          Effect.gen(function* () {
            const found = yield* messages(payload);
            if (Option.isNone(found)) return;
            const { message, withoutCover } = found.value;
            yield* post(message).pipe(
              // Slack can't fetch or read the cover: post it without.
              Effect.catchIf(
                (error): error is SlackApiError =>
                  withoutCover !== undefined &&
                  error instanceof SlackApiError &&
                  error.code === "invalid_blocks",
                (error) =>
                  Effect.logWarning(
                    "Slack refused the message's blocks: posting it without the cover",
                    { key: payload.key, ...failure(error) },
                  ).pipe(Effect.andThen(post(withoutCover ?? message))),
              ),
            );
          }).pipe(
            Effect.asVoid,
            Effect.catch((error: SlackError) =>
              Effect.logWarning("Slack message not posted", {
                key: payload.key,
                ...failure(error),
              }),
            ),
          ),
      });
    }),
  );

/**
 * Where the site is, the channel and the bot's token: the settings that
 * make posting possible. The language is `SITE_LOCALE`, as emails have it.
 */
const SlackConfig = Config.all({
  token: Config.Redacted("SLACK_BOT_TOKEN"),
  channel: Config.String("SLACK_CHANNEL"),
  url: Config.String("SITE_URL"),
  locale: SiteLocale,
});

/**
 * Posts the channel's messages to the channel in `SLACK_CHANNEL`, with the bot
 * `SLACK_BOT_TOKEN`. Without it, `SLACK_CHANNEL` or `SITE_URL`, with a
 * warning, it drops each message: the server starts all the same.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const settings = yield* Config.option(SlackConfig);
    if (Option.isSome(settings)) {
      const { token, channel, url, locale } = settings.value;
      return poster({ channel, site: { url, locale } }).pipe(
        Layer.provide(Slack.layer({ token })),
      );
    }
    yield* Effect.logWarning(
      "SLACK_BOT_TOKEN, SLACK_CHANNEL or SITE_URL not set: nothing is posted to Slack",
    );
    return SlackChannel.toLayer(
      SlackChannel.of({
        Post: ({ payload }) =>
          Effect.logInfo("Slack message not posted (not configured)", {
            key: payload.key,
          }),
      }),
    );
  }),
);
