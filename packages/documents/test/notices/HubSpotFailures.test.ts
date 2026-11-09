import * as A from "@automerge/automerge";
import { assert, describe, layer } from "@effect/vitest";
import { HubSpotApiError, HubSpotUnavailable } from "@skjera/hubspot";
import * as HubSpotTest from "@skjera/hubspot/testing";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, Layer, Logger, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/documents/index.ts";
import {
  type AdSource,
  adSourceKeys,
  type DocumentId,
  SiteSettings,
} from "../../src/Model.ts";
import { Announcements } from "../../src/notices/Announcements.ts";
import * as HubSpotSync from "../../src/notices/HubSpotSync.ts";
import { Notifications } from "../../src/notices/Notifications.ts";
import { Teams } from "../../src/Teams.ts";
import { clusterSettled } from "../cluster.ts";
import { TestDatabase } from "../TestDatabase.ts";
import { cluster } from "./helpers.ts";

// What HubSpot is sent of a sales event and its sign-ups, from the change
// that causes it to the portal, on a cluster on the test database and a
// HubSpot portal in memory. Tests share a database, so each has events of
// its own and reads only those.

const alice = new Identity({ issuer: "https://idp.example", subject: "alice" });
const siteUrl = "https://skjera.example";
const _day = 24 * 60 * 60 * 1000;

/** Settings that make HubSpot configured. */
const settings = {
  HUBSPOT_ACCESS_TOKEN: "pat-test",
  SITE_URL: siteUrl,
} as const;

const provider = (env: Record<string, string>) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      OAUTH_ALLOWED_DOMAINS: "members.example",
      ...env,
    }),
  );

/** A logger that keeps what is logged, in `log`. */
const keeping = (log: Array<string>) =>
  Logger.layer([
    Logger.make(({ logLevel, message }) => {
      log.push(`${logLevel} ${JSON.stringify(message)}`);
    }),
  ]);

/** Retries fast, and few: the cluster then runs a failing message again. */
const quickly = { times: 1, base: "1 millis" } as const;

/** Sales events on a cluster, sending to `portal`. */
const syncLayer = (
  portal: ReturnType<typeof HubSpotTest.make>,
  env: Record<string, string> = settings,
  log: Array<string> = [],
) =>
  Layer.suspend(() =>
    Layer.mergeAll(
      Documents.layer,
      Teams.layer,
      HubSpotSync.sender({ retry: quickly }),
    ).pipe(
      Layer.provideMerge(Attendance.layer),
      Layer.provideMerge(
        HubSpotSync.layerSalesEvents.pipe(Layer.provide(provider(env))),
      ),
      Layer.provideMerge(Announcements.layerTest),
      Layer.provideMerge(Notifications.layerTest),
      Layer.provideMerge(portal.layer),
      Layer.provideMerge(SiteSettings.layer.pipe(Layer.provide(provider(env)))),
      Layer.provideMerge(cluster),
      Layer.provideMerge(TestDatabase),
      Layer.provideMerge(keeping(log)),
    ),
  );

/** `read`'s answer, once it has one. */
const eventually = <A>(read: () => A | undefined) =>
  Effect.sync(read).pipe(
    Effect.filterOrFail(
      (found): found is A => found !== undefined,
      () => "not yet",
    ),
    Effect.retry({ schedule: Schedule.spaced("50 millis"), times: 200 }),
    Effect.orDie,
  );

/** The entries of `log` with `needle`, once there is one. */
const logged = (log: ReadonlyArray<string>, needle: string) =>
  eventually(() => {
    const found = log.filter((entry) => entry.includes(needle));
    return found.length > 0 ? found : undefined;
  });

let teams = 0;
let titles = 0;
const newTitle = () => `Seminar ${++titles} ${crypto.randomUUID()}`;

interface Draft {
  readonly title?: string;
  readonly team?: string;
  readonly summary?: string;
  readonly start?: string;
  readonly end?: string;
  readonly salesEvent?: boolean;
  readonly salesEventType?: string;
  readonly guests?: boolean;
  readonly recurring?: boolean;
}

/** Writes `draft` into an event's draft the way the studio does. */
const write = (event: EventContent, draft: Draft) => {
  const content = event as Record<string, unknown>;
  if (draft.title !== undefined) A.updateText(event, ["title"], draft.title);
  A.updateText(event, ["place"], "Kantina");
  if (draft.summary !== undefined) {
    if (content.summary === undefined) content.summary = "";
    A.updateText(event, ["summary"], draft.summary);
  }
  content.start = new A.ImmutableString(
    draft.start ?? "2036-10-15T08:00+02:00[Europe/Oslo]",
  );
  content.end = new A.ImmutableString(
    draft.end ?? "2036-10-15T10:00+02:00[Europe/Oslo]",
  );
  content.public = true;
  content.guests = draft.guests ?? true;
  if (draft.salesEvent !== undefined) content.salesEvent = draft.salesEvent;
  if (draft.salesEventType !== undefined) {
    if (content.salesEventType === undefined) content.salesEventType = "";
    A.updateText(event, ["salesEventType"], draft.salesEventType);
  }
  if (draft.recurring !== undefined) {
    content.recurring = draft.recurring;
    content.repeatEvery = 1;
    content.repeatUnit = new A.ImmutableString("week");
  }
};

/** Applies `draft` to the event's draft and publishes it. */
const publishDraft = (id: DocumentId, draft: Draft) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const snapshot = yield* documents.get(id);
    const doc = A.change(A.load<EventContent>(snapshot.draft), (event) =>
      write(event, draft),
    );
    const change = A.getLastLocalChange(doc);
    if (change === undefined) throw new Error("no change");
    const heads = yield* documents.applyChanges(id, [change], alice);
    yield* documents.publish(id, heads, alice);
  }).pipe(Effect.orDie);

/** A new event, published from a draft. */
const publishNew = (draft: Draft = {}) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const team = yield* (yield* Teams).create(
      draft.team ?? `Team ${++teams}`,
      alice,
    );
    const id = yield* documents.create("event", team.id, alice);
    const title = draft.title ?? newTitle();
    yield* publishDraft(id, { ...draft, title });
    return { id: id as DocumentId, title };
  }).pipe(Effect.orDie);

/** A sales event, published. */
const publishSales = (draft: Draft = {}) =>
  publishNew({ salesEvent: true, ...draft });

let guests = 0;
/** A guest signs up; the signup's id and address. */
const guestSignsUp = (
  event: DocumentId,
  details: {
    readonly name?: string;
    readonly company?: string;
    readonly jobTitle?: string;
    readonly email?: string;
    readonly source?: AdSource;
    readonly consent?: boolean;
  } = {},
) =>
  Effect.gen(function* () {
    const id = crypto.randomUUID();
    const email = details.email ?? `guest${++guests}-${id}@example.org`;
    const token = yield* (yield* Attendance).attendAsGuest(
      event,
      {
        name: details.name ?? "Gus Guest",
        email,
        ...(details.company === undefined ? {} : { company: details.company }),
        ...(details.jobTitle === undefined
          ? {}
          : { jobTitle: details.jobTitle }),
      },
      {
        id,
        ...(details.source === undefined ? {} : { source: details.source }),
        ...(details.consent === true ? { consent: true } : {}),
      },
    );
    return { id, email, token };
  }).pipe(Effect.orDie);

let members = 0;
/** A member signs up; their identity. */
const _memberSignsUp = (
  event: DocumentId,
  name: string,
  source?: AdSource,
  consent?: boolean,
) =>
  Effect.gen(function* () {
    const user = new Identity({
      issuer: "https://idp.example",
      subject: `member-${++members}-${crypto.randomUUID()}`,
      email: `member${members}-${crypto.randomUUID()}@example.com`,
      name,
    });
    yield* (yield* Attendance).attend(event, user, {
      ...(source === undefined ? {} : { source }),
      ...(consent === true ? { consent: true } : {}),
    });
    return user;
  }).pipe(Effect.orDie);

/** When a signup was made, as the table has it. */
const _signedUpAt = (signup: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ created_at: Date }>`
      SELECT created_at FROM attendees WHERE id = ${signup}::uuid
    `;
    return row?.created_at ?? new Date(Number.NaN);
  }).pipe(Effect.orDie);

type Portal = ReturnType<typeof HubSpotTest.make>;

/** The event's participations, once there are `count`. */
const participations = (portal: Portal, event: DocumentId, count: number) =>
  eventually(() => {
    const found = portal.participations(event);
    return found.length >= count ? found : undefined;
  });

/** Lets what is on its way reach the portal. */
const settle = clusterSettled;

const failing = HubSpotTest.make();

layer(syncLayer(failing), { excludeTestServices: true })(
  "A sales event when HubSpot fails",
  (it) => {
    const unavailable = new HubSpotUnavailable({
      call: "recordParticipation",
      message: "down",
      status: 503,
    });

    it.effect(
      "sends a sign-up and then its cancellation, in that order and each once, when HubSpot is back (AC-10)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          yield* eventually(() => failing.event(id));
          // More failures than one message's tries: the cluster runs it again.
          for (let i = 0; i < 3; i++) {
            failing.failNext("recordParticipation", unavailable);
          }
          const guest = yield* guestSignsUp(id);
          yield* (yield* Attendance).leaveAsGuest(id, guest.token);
          const found = yield* participations(failing, id, 2);
          yield* settle;
          assert.deepStrictEqual(
            failing
              .participations(id)
              .map(({ email, state }) => [email, state]),
            [
              [guest.email, "REGISTERED"],
              [guest.email, "CANCELLED"],
            ],
          );
          assert.strictEqual(found.length, 2);
        }),
      30_000,
    );

    it.effect(
      "sends a sign-up HubSpot first answered with 401, once it accepts the token (AC-10)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          yield* eventually(() => failing.event(id));
          failing.failNext(
            "upsertContact",
            new HubSpotApiError({
              call: "upsertContact",
              status: 401,
              message: "Invalid token",
            }),
          );
          const guest = yield* guestSignsUp(id);
          const [registered] = yield* participations(failing, id, 1);
          assert.strictEqual(registered?.email, guest.email);
        }),
      30_000,
    );
  },
);

const refusing = HubSpotTest.make();
const refusingLog: Array<string> = [];

layer(syncLayer(refusing, settings, refusingLog), {
  excludeTestServices: true,
})("A sales event when HubSpot refuses a sign-up", (it) => {
  it.effect(
    "logs the refusal and still sends the next message of the event (AC-10)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* publishSales();
        yield* eventually(() => refusing.event(id));
        refusing.failNext(
          "upsertContact",
          new HubSpotApiError({
            call: "upsertContact",
            status: 400,
            message: "Invalid email address",
          }),
        );
        const refused = yield* guestSignsUp(id);
        yield* logged(refusingLog, "400");
        const next = yield* guestSignsUp(id);
        const found = yield* participations(refusing, id, 1);
        assert.deepStrictEqual(
          found.map(({ email }) => email),
          [next.email],
        );
        assert.isUndefined(refusing.contact(refused.email));
      }),
    30_000,
  );
});

// A portal without the arr_ properties, as HubSpot is until marketing makes them.
const withoutProperties = HubSpotTest.make({ properties: [] });
const withoutPropertiesLog: Array<string> = [];

layer(syncLayer(withoutProperties, settings, withoutPropertiesLog), {
  excludeTestServices: true,
})("A sales event when HubSpot lacks the arr_ properties", (it) => {
  it.effect(
    "records the registration, and logs and drops the refused ad source (AC-3)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* publishSales();
        yield* eventually(() => withoutProperties.event(id));
        const guest = yield* guestSignsUp(id, {
          source: { utm_source: "linkedin" },
        });
        const [registered] = yield* participations(withoutProperties, id, 1);
        assert.strictEqual(registered?.email, guest.email);
        yield* logged(withoutPropertiesLog, "400");
        assert.isUndefined(
          withoutProperties.contact(guest.email)?.arr_utm_source,
        );
      }),
    30_000,
  );

  it.effect(
    "records the registration, and logs and drops the refused consent (AC-2)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* publishSales();
        yield* eventually(() => withoutProperties.event(id));
        const guest = yield* guestSignsUp(id, { consent: true });
        const [registered] = yield* participations(withoutProperties, id, 1);
        assert.strictEqual(registered?.email, guest.email);
        yield* logged(withoutPropertiesLog, '"kind":"consent"');
        assert.isUndefined(
          withoutProperties.contact(guest.email)?.sende_nyhetsbrev,
        );
      }),
    30_000,
  );
});

// A portal with the arr_ properties but not the two consent properties.
const arrOnly = HubSpotTest.make({
  properties: [
    ...adSourceKeys.map((key) => `arr_${key}`),
    "arr_utm_arrangement",
  ],
});

layer(syncLayer(arrOnly), { excludeTestServices: true })(
  "A sales event when HubSpot lacks the consent properties",
  (it) => {
    it.effect(
      "keeps the ad source and the registration when the consent is refused (AC-2)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          yield* eventually(() => arrOnly.event(id));
          const guest = yield* guestSignsUp(id, {
            source: { utm_source: "linkedin" },
            consent: true,
          });
          const [registered] = yield* participations(arrOnly, id, 1);
          assert.strictEqual(registered?.email, guest.email);
          yield* eventually(() =>
            arrOnly.contact(guest.email)?.arr_utm_source === undefined
              ? undefined
              : true,
          );
          yield* settle;
          const contact = arrOnly.contact(guest.email);
          assert.strictEqual(contact?.arr_utm_source, "linkedin");
          assert.isUndefined(contact?.invitere_til_arrangementer);
          assert.isUndefined(contact?.sende_nyhetsbrev);
        }),
      30_000,
    );
  },
);

const unconfigured = HubSpotTest.make();
const unconfiguredLog: Array<string> = [];

layer(syncLayer(unconfigured, {}, unconfiguredLog), {
  excludeTestServices: true,
})("Without HUBSPOT_ACCESS_TOKEN", (it) => {
  it.effect(
    "publishes and signs up as before and sends nothing to HubSpot (AC-11)",
    () =>
      Effect.gen(function* () {
        const { id } = yield* publishSales();
        const guest = yield* guestSignsUp(id);
        yield* (yield* Attendance).leaveAsGuest(id, guest.token);
        yield* settle;
        assert.deepStrictEqual(unconfigured.calls(), []);
      }),
  );
});

describe("The server's layer", () => {
  const warned = (env: Record<string, string>) => {
    const log: Array<string> = [];
    return {
      log,
      layer: HubSpotSync.layer.pipe(
        Layer.provide(SiteSettings.layer),
        Layer.provide(provider(env)),
        Layer.provideMerge(cluster),
        Layer.provideMerge(TestDatabase),
        Layer.provideMerge(keeping(log)),
      ),
    };
  };

  for (const [name, env] of [
    ["the token", { SITE_URL: siteUrl }],
    ["the site's address", { HUBSPOT_ACCESS_TOKEN: "pat-test" }],
  ] as const) {
    const { log, layer: serverLayer } = warned(env);
    layer(serverLayer, { excludeTestServices: true })(
      `Without ${name}`,
      (it) => {
        it.effect(
          "warns at start that nothing is sent to HubSpot (AC-11)",
          () =>
            Effect.gen(function* () {
              yield* logged(log, "HUBSPOT_ACCESS_TOKEN");
              assert.isTrue(log.some((entry) => entry.startsWith("Warn")));
            }),
        );
      },
    );
  }
});
