import {
  HubSpot,
  HubSpotApiError,
  type HubSpotError,
  retryTransient,
} from "@skjera/hubspot";
import { Config, Effect, Layer, Option, Schema } from "effect";
import { ClusterSchema, Entity } from "effect/cluster";
import { Rpc } from "effect/rpc";
import { SqlClient } from "effect/sql";
import { type AdSource, adSourceKeys } from "../Model.ts";
import { SalesEvents } from "./SalesEvents.ts";

// What HubSpot is sent of a sales event and its sign-ups. A publish, a
// cancel, a signup and a cancelled signup tell `SalesEvents`, in their
// transactions; on the server, that leaves a message for the event's
// HubSpot sender (a cluster entity, one per event, so its messages are sent
// one at a time, in order), kept in the database and deduplicated, so each
// is sent once it's committed, and once only. A message carries what it
// sends, read in the transaction: a message sent late sends what was true
// when it happened.

/** The type of a sales event whose organiser wrote none. */
export const defaultEventType = "Frokostseminar";

const MarketingEventFields = Schema.Struct({
  eventName: Schema.String,
  eventOrganizer: Schema.String,
  eventDescription: Schema.optionalKey(Schema.String),
  /** ISO instants. */
  startDateTime: Schema.String,
  endDateTime: Schema.String,
  eventUrl: Schema.String,
  eventType: Schema.String,
});
type MarketingEventFields = typeof MarketingEventFields.Type;

const ContactFields = Schema.Struct({
  email: Schema.String,
  firstname: Schema.optionalKey(Schema.String),
  lastname: Schema.optionalKey(Schema.String),
  company: Schema.optionalKey(Schema.String),
  jobtitle: Schema.optionalKey(Schema.String),
});
type ContactFields = typeof ContactFields.Type;

const Send = Rpc.make("Send", {
  payload: {
    /** Each message once: what it's about, e.g. "registered/<signup>". */
    key: Schema.String,
    kind: Schema.Literals([
      "event",
      "cancelled",
      "registered",
      "source",
      "left",
    ]),
    /** For `event`: the Marketing Event. */
    event: Schema.optionalKey(MarketingEventFields),
    /** For `registered`: who signed up. */
    contact: Schema.optionalKey(ContactFields),
    /** For `source` and `left`: the contact, by email. */
    email: Schema.optionalKey(Schema.String),
    /** For `source`: the contact's properties to set, by HubSpot's name. */
    properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    /** For `registered` and `left`: when it happened, an ISO instant. */
    at: Schema.optionalKey(Schema.String),
  },
  primaryKey: ({ key }) => key,
}).annotate(ClusterSchema.Persisted, true);

/** An event's HubSpot sender: its id is the event's. */
export const HubSpotEvent = Entity.make("HubSpotEvent", [Send]);

/**
 * A name split at its last space: `lastname` the last word, `firstname` the
 * rest. A name of one word is a first name only.
 */
export const splitName = (
  name: string,
): { readonly firstname: string; readonly lastname?: string } => {
  const words = name.trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : undefined;
  const firstname = words.join(" ");
  return last === undefined ? { firstname } : { firstname, lastname: last };
};

/** An event as the Marketing Event shows it. */
export interface PublishedEvent {
  readonly title: string;
  readonly summary: string | null;
  readonly starts_at: Date;
  readonly ends_at: Date;
  readonly sales_event_type: string | null;
  /** The team's name, as written. */
  readonly team_name: string;
}

/** The Marketing Event for a published event with the id `id`. */
export const marketingEvent = (
  id: string,
  row: PublishedEvent,
  siteUrl: string,
): MarketingEventFields => ({
  eventName: row.title,
  eventOrganizer: row.team_name,
  ...(row.summary === null ? {} : { eventDescription: row.summary }),
  startDateTime: row.starts_at.toISOString(),
  endDateTime: row.ends_at.toISOString(),
  eventUrl: new URL(`/events/${id}`, siteUrl).href,
  eventType: row.sales_event_type ?? defaultEventType,
});

/** A contact from a signup: the name split, the company and job title when given. */
export const contactOf = (signup: {
  readonly name: string;
  readonly email: string;
  readonly company: string | null;
  readonly job_title: string | null;
}): ContactFields => ({
  email: signup.email,
  ...splitName(signup.name),
  ...(signup.company === null ? {} : { company: signup.company }),
  ...(signup.job_title === null ? {} : { jobtitle: signup.job_title }),
});

/**
 * The contact properties for the ad a sign-up came from: `arr_` and the name
 * of each value it has, and the event's title as `arr_utm_arrangement`;
 * undefined when it has no value, so a sign-up without a source sends none.
 */
const adSourceProperties = (
  source: AdSource | null,
  title: string,
): Record<string, string> | undefined => {
  const properties: Record<string, string> = {};
  for (const key of adSourceKeys) {
    const value = source?.[key];
    if (value !== undefined) properties[`arr_${key}`] = value;
  }
  return Object.keys(properties).length === 0
    ? undefined
    : { ...properties, arr_utm_arrangement: title };
};

/** The private app's token, and where the site is: what sending needs. */
const HubSpotConfig = Config.all({
  token: Config.Redacted("HUBSPOT_ACCESS_TOKEN"),
  url: Config.String("SITE_URL"),
});

/** Sales events are sent to HubSpot: the token and the site's address are set. */
export const configured = Config.option(HubSpotConfig).pipe(
  Config.map(Option.isSome),
);

interface SignupRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly company: string | null;
  readonly job_title: string | null;
  readonly ad_source: AdSource | null;
  readonly created_at: Date;
}

/**
 * Sales events told to the event's HubSpot sender, as `SalesEvents` is told.
 * Without the token or `SITE_URL` it sends nothing.
 */
export const layerSalesEvents = Layer.effect(
  SalesEvents,
  Effect.gen(function* () {
    const settings = yield* Config.option(HubSpotConfig);
    if (Option.isNone(settings)) {
      return SalesEvents.of({
        published: () => Effect.void,
        cancelled: () => Effect.void,
        signedUp: () => Effect.void,
        signupCancelled: () => Effect.void,
      });
    }
    const siteUrl = settings.value.url;
    const sql = yield* SqlClient.SqlClient;
    const sender = yield* HubSpotEvent.client;
    const send = (event: string, payload: typeof Send.payloadSchema.Type) =>
      sender(event).Send(payload, { discard: true }).pipe(Effect.orDie);

    // The registration, then the ad it came from in a message of its own: HubSpot
    // refuses the properties until they are made, and that must not cost the
    // registration.
    const registered = (event: string, signup: SignupRow, title: string) => {
      const { email } = signup;
      if (email === null) return Effect.void;
      const properties = adSourceProperties(signup.ad_source, title);
      return send(event, {
        key: `registered/${signup.id}`,
        kind: "registered",
        contact: contactOf({ ...signup, email }),
        at: signup.created_at.toISOString(),
      }).pipe(
        Effect.andThen(
          properties === undefined
            ? Effect.void
            : send(event, {
                key: `source/${signup.id}`,
                kind: "source",
                email,
                properties,
              }),
        ),
      );
    };

    return SalesEvents.of({
      published: (event, { wasSalesEvent }) =>
        Effect.gen(function* () {
          const [row] = yield* sql<PublishedEvent & { published_at: Date }>`
            SELECT e.title, e.summary, e.starts_at, e.ends_at, e.sales_event_type,
              e.published_at, t.name AS team_name
            FROM events e
              JOIN documents d ON d.id = e.id
              JOIN teams t ON t.id = d.team_id
            WHERE e.id = ${event} AND e.sales_event AND e.deleted_at IS NULL
          `;
          if (row === undefined) return;
          yield* send(event, {
            key: `event/${event}/${row.published_at.getTime()}`,
            kind: "event",
            event: marketingEvent(event, row, siteUrl),
          });
          // Turned on just now: those signed up before are sent, earliest first.
          if (wasSalesEvent) return;
          const signups = yield* sql<SignupRow>`
            SELECT id, name, email, company, job_title, ad_source, created_at
            FROM attendees WHERE event_id = ${event}
            ORDER BY created_at, id
          `;
          yield* Effect.forEach(
            signups,
            (signup) => registered(event, signup, row.title),
            {
              discard: true,
            },
          );
        }).pipe(Effect.orDie),
      cancelled: (event) =>
        Effect.gen(function* () {
          const [row] = yield* sql<{ deleted_at: Date }>`
            SELECT deleted_at FROM events
            WHERE id = ${event} AND sales_event AND deleted_at IS NOT NULL
          `;
          if (row === undefined) return;
          yield* send(event, {
            key: `cancelled/${event}/${row.deleted_at.getTime()}`,
            kind: "cancelled",
          });
        }).pipe(Effect.orDie),
      signedUp: (event, signup) =>
        Effect.gen(function* () {
          const [row] = yield* sql<SignupRow & { title: string }>`
            SELECT a.id, a.name, a.email, a.company, a.job_title, a.ad_source, a.created_at,
              e.title
            FROM attendees a JOIN events e ON e.id = a.event_id
            WHERE a.id = ${signup}::uuid AND e.sales_event
          `;
          if (row !== undefined) yield* registered(event, row, row.title);
        }).pipe(Effect.orDie),
      signupCancelled: (event, signup) =>
        Effect.gen(function* () {
          if (signup.email === null) return;
          const [row] = yield* sql<{ now: Date }>`
            SELECT now() AS now FROM events WHERE id = ${event} AND sales_event
          `;
          if (row === undefined) return;
          yield* send(event, {
            key: `left/${signup.id}`,
            kind: "left",
            email: signup.email,
            at: row.now.toISOString(),
          });
        }).pipe(Effect.orDie),
    });
  }),
);

/** A token HubSpot does not accept: tried again once it is replaced. */
const isRefusedToken = (error: HubSpotError) =>
  error instanceof HubSpotApiError &&
  (error.status === 401 || error.status === 403);

/**
 * Sends the events' messages to HubSpot, each event's in order. What may
 * work later (a rate limit, HubSpot unavailable, a token it does not
 * accept) is tried again: the message is left for the cluster to run
 * again, and the event's later messages wait behind it. A refusal of what
 * was sent is logged, and the message is done.
 */
export const sender = (
  options: { readonly retry?: Parameters<typeof retryTransient>[0] } = {},
) =>
  HubSpotEvent.toLayer(
    Effect.gen(function* () {
      const hubspot = yield* HubSpot;
      const address = yield* Entity.CurrentAddress;
      const externalEventId = address.entityId;

      const deliver = (payload: typeof Send.payloadSchema.Type) => {
        switch (payload.kind) {
          case "event":
            return payload.event === undefined
              ? Effect.void
              : hubspot.upsertMarketingEvent({
                  ...payload.event,
                  externalEventId,
                  eventCancelled: false,
                });
          case "cancelled":
            return hubspot.cancelMarketingEvent(externalEventId);
          case "registered": {
            const { contact, at } = payload;
            return contact === undefined || at === undefined
              ? Effect.void
              : hubspot.upsertContact(contact).pipe(
                  Effect.andThen(
                    hubspot.recordParticipation({
                      externalEventId,
                      state: "REGISTERED",
                      email: contact.email,
                      at: new Date(at),
                    }),
                  ),
                );
          }
          case "source": {
            const { email, properties } = payload;
            return email === undefined || properties === undefined
              ? Effect.void
              : hubspot.upsertContact({ ...properties, email });
          }
          case "left": {
            const { email, at } = payload;
            return email === undefined || at === undefined
              ? Effect.void
              : hubspot.recordParticipation({
                  externalEventId,
                  state: "CANCELLED",
                  email,
                  at: new Date(at),
                });
          }
        }
      };

      return HubSpotEvent.of({
        Send: ({ payload }) =>
          deliver(payload).pipe(
            retryTransient(options.retry),
            // What was sent is wrong: sent again it would be refused again.
            Effect.catchIf(
              (error): error is HubSpotApiError =>
                error instanceof HubSpotApiError && !isRefusedToken(error),
              (error) =>
                Effect.logWarning("HubSpot refused a message", {
                  event: externalEventId,
                  kind: payload.kind,
                  status: error.status,
                  reason: error.message,
                }),
            ),
            Effect.tapError((error) =>
              isRefusedToken(error)
                ? Effect.logError("HubSpot does not accept the token", {
                    event: externalEventId,
                    kind: payload.kind,
                  })
                : Effect.void,
            ),
            // Still failing: left for the next runner.
            Effect.orDie,
          ),
      });
    }),
  );

/**
 * Sends sales events to HubSpot with the private app `HUBSPOT_ACCESS_TOKEN`.
 * Without it or `SITE_URL`, with a warning, it drops each message: the
 * server starts all the same.
 */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const settings = yield* Config.option(HubSpotConfig);
    if (Option.isSome(settings)) {
      return sender().pipe(
        Layer.provide(HubSpot.layerFetch({ token: settings.value.token })),
      );
    }
    yield* Effect.logWarning(
      "HUBSPOT_ACCESS_TOKEN or SITE_URL not set: nothing is sent to HubSpot",
    );
    return HubSpotEvent.toLayer(
      HubSpotEvent.of({
        Send: ({ payload }) =>
          Effect.logInfo("HubSpot message not sent (not configured)", {
            key: payload.key,
          }),
      }),
    );
  }),
);
