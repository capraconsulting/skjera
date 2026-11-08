import * as A from "@automerge/automerge";
import { assert, describe, it, layer } from "@effect/vitest";
import { HubSpotApiError, HubSpotUnavailable } from "@skjera/hubspot";
import * as HubSpotTest from "@skjera/hubspot/testing";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, Layer, Logger, Schedule } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import * as Recurring from "../../src/events/Recurring.ts";
import {
  type AdSource,
  adSourceKeys,
  type DocumentId,
  defaultEventType,
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
const day = 24 * 60 * 60 * 1000;

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
const memberSignsUp = (
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
const signedUpAt = (signup: string) =>
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

describe("splitName", () => {
  it("splits a name at the last space (AC-5)", () => {
    assert.deepStrictEqual(HubSpotSync.splitName("Kari Anne Nordmann"), {
      firstname: "Kari Anne",
      lastname: "Nordmann",
    });
    assert.deepStrictEqual(HubSpotSync.splitName("  Ola   Nordmann "), {
      firstname: "Ola",
      lastname: "Nordmann",
    });
  });

  it("sends a name of one word as the first name only (AC-5)", () => {
    assert.deepStrictEqual(HubSpotSync.splitName("Madonna"), {
      firstname: "Madonna",
    });
  });
});

describe("configured", () => {
  const configuredWith = (env: Record<string, string>) =>
    HubSpotSync.configured.pipe(
      Effect.provide(SiteSettings.layer),
      Effect.provide(provider(env)),
    );

  it.effect(
    "is true with the token and the site's address, and false without either (AC-11)",
    () =>
      Effect.gen(function* () {
        assert.isTrue(yield* configuredWith(settings));
        assert.isFalse(yield* configuredWith({ SITE_URL: siteUrl }));
        assert.isFalse(yield* configuredWith({ HUBSPOT_ACCESS_TOKEN: "pat" }));
        assert.isFalse(yield* configuredWith({}));
      }),
  );
});

const portal = HubSpotTest.make();

it("derives prior sales state inside HubSpotSync (AC-1)", async () => {
  const source = await readFile(
    new URL("../../src/notices/HubSpotSync.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /!row\.off_site && publications\[1\]\?\.sales_event/);
});

// Real clock: these tests talk to a real database.
layer(syncLayer(portal), { excludeTestServices: true })(
  "A sales event",
  (it) => {
    it.effect(
      "becomes a Marketing Event with the configured type when published with the setting on (AC-2, AC-1)",
      () =>
        Effect.gen(function* () {
          const { id, title } = yield* publishSales({
            team: "Capra Gruppen",
            summary: "Frokost og faglig påfyll",
          });
          const event = yield* eventually(() => portal.event(id));
          assert.deepStrictEqual(event, {
            externalEventId: id,
            externalAccountId: "skjera",
            eventName: title,
            eventOrganizer: "Capra Gruppen",
            eventDescription: "Frokost og faglig påfyll",
            startDateTime: "2036-10-15T06:00:00.000Z",
            endDateTime: "2036-10-15T08:00:00.000Z",
            eventUrl: `${siteUrl}/events/${id}`,
            eventType: defaultEventType,
            eventCancelled: false,
          });
        }),
    );

    it.effect("has the type the organiser wrote (AC-2)", () =>
      Effect.gen(function* () {
        const { id } = yield* publishSales({ salesEventType: "Workshop" });
        const event = yield* eventually(() => portal.event(id));
        assert.strictEqual(event.eventType, "Workshop");
      }),
    );

    it.effect(
      "is not sent when the setting is off, or the event is closed to guests (AC-1, AC-2)",
      () =>
        Effect.gen(function* () {
          const off = yield* publishNew({ salesEvent: false });
          const closed = yield* publishSales({ guests: false });
          const never = yield* publishNew();
          yield* settle;
          for (const { id } of [off, closed, never]) {
            assert.isUndefined(portal.event(id));
          }
        }),
    );

    it.effect(
      "updates its Marketing Event when it is published again (AC-3, AC-1)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales({ summary: "Before" });
          yield* eventually(() => portal.event(id));
          yield* publishDraft(id, {
            title: "A new title",
            summary: "After",
            start: "2036-10-16T09:00+02:00[Europe/Oslo]",
            end: "2036-10-16T11:00+02:00[Europe/Oslo]",
            salesEvent: true,
          });
          const updated = yield* eventually(() => {
            const event = portal.event(id);
            return event?.eventName === "A new title" ? event : undefined;
          });
          assert.strictEqual(updated.eventDescription, "After");
          assert.strictEqual(updated.startDateTime, "2036-10-16T07:00:00.000Z");
          assert.strictEqual(updated.endDateTime, "2036-10-16T09:00:00.000Z");
        }),
    );

    it.effect(
      "updates its Marketing Event when it moves on to its next date (AC-3, AC-1)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales({
            start: "2040-01-05T08:00+01:00[Europe/Oslo]",
            end: "2040-01-05T10:00+01:00[Europe/Oslo]",
            recurring: true,
          });
          yield* eventually(() => portal.event(id));
          yield* Recurring.moveEnded(new Date("2040-01-06T00:00:00Z"));
          const moved = yield* eventually(() => {
            const event = portal.event(id);
            return event?.startDateTime === "2040-01-12T07:00:00.000Z"
              ? event
              : undefined;
          });
          assert.strictEqual(moved.endDateTime, "2040-01-12T09:00:00.000Z");
        }),
    );

    it.effect(
      "has its Marketing Event cancelled when it is unpublished, and not when it is published again (AC-4, AC-1)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          yield* eventually(() => portal.event(id));
          yield* (yield* Documents).unpublish(id);
          yield* eventually(() =>
            portal.event(id)?.eventCancelled === true ? true : undefined,
          );
          const documents = yield* Documents;
          yield* documents.publish(id, (yield* documents.get(id)).heads, alice);
          yield* eventually(() =>
            portal.event(id)?.eventCancelled === false ? true : undefined,
          );
        }),
    );

    it.effect(
      "does not register existing sign-ups again after unpublish and republish (AC-1)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          yield* guestSignsUp(id);
          yield* participations(portal, id, 1);
          yield* (yield* Documents).unpublish(id);
          const documents = yield* Documents;
          yield* documents.publish(id, (yield* documents.get(id)).heads, alice);
          yield* settle;
          assert.strictEqual(portal.participations(id).length, 1);
        }),
    );

    it.effect(
      "has its Marketing Event cancelled when it is deleted before it is over (AC-4)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          yield* eventually(() => portal.event(id));
          yield* (yield* Documents).delete(id, alice);
          yield* eventually(() =>
            portal.event(id)?.eventCancelled === true ? true : undefined,
          );
        }),
    );

    it.effect(
      "registers a guest with name, company and job title, at the time of the sign-up (AC-5)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          const guest = yield* guestSignsUp(id, {
            name: "Kari Anne Nordmann",
            company: "Acme",
            jobTitle: "CTO",
          });
          const [registered] = yield* participations(portal, id, 1);
          assert.strictEqual(registered?.email, guest.email);
          assert.strictEqual(registered?.state, "REGISTERED");
          assert.strictEqual(
            registered?.at.getTime(),
            (yield* signedUpAt(guest.id)).getTime(),
          );
          assert.deepStrictEqual(portal.contact(guest.email), {
            email: guest.email,
            firstname: "Kari Anne",
            lastname: "Nordmann",
            company: "Acme",
            jobtitle: "CTO",
          });
        }),
    );

    it.effect("registers a member too, without a company (AC-5)", () =>
      Effect.gen(function* () {
        const { id } = yield* publishSales();
        const member = yield* memberSignsUp(id, "Marie Anne Hansen");
        const [registered] = yield* participations(portal, id, 1);
        const email = member.email ?? "";
        assert.strictEqual(registered?.email, email);
        assert.deepStrictEqual(portal.contact(email), {
          email,
          firstname: "Marie Anne",
          lastname: "Hansen",
        });
      }),
    );

    it.effect(
      "sends a guest's and a member's ad source to the contact as arr_ properties, with the event's title (AC-3)",
      () =>
        Effect.gen(function* () {
          const { id, title } = yield* publishSales();
          const guest = yield* guestSignsUp(id, {
            company: "Acme",
            source: {
              utm_source: "linkedin",
              utm_campaign: "spring",
              li_fat_id: "abc",
            },
          });
          const member = yield* memberSignsUp(id, "Marie Hansen", {
            fbclid: "F",
          });
          yield* participations(portal, id, 2);
          yield* eventually(() =>
            portal.contact(guest.email)?.arr_utm_arrangement === undefined ||
            portal.contact(member.email ?? "")?.arr_utm_arrangement ===
              undefined
              ? undefined
              : true,
          );
          assert.deepStrictEqual(portal.contact(guest.email), {
            email: guest.email,
            firstname: "Gus",
            lastname: "Guest",
            company: "Acme",
            arr_utm_source: "linkedin",
            arr_utm_campaign: "spring",
            arr_li_fat_id: "abc",
            arr_utm_arrangement: title,
          });
          assert.deepStrictEqual(portal.contact(member.email ?? ""), {
            email: member.email ?? "",
            firstname: "Marie",
            lastname: "Hansen",
            arr_fbclid: "F",
            arr_utm_arrangement: title,
          });
        }),
    );

    it.effect(
      "sends the ad source of sign-ups already there when the setting is turned on (AC-3)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishNew();
          const guest = yield* guestSignsUp(id, {
            source: { utm_source: "linkedin" },
          });
          yield* settle;
          assert.isUndefined(portal.contact(guest.email));

          const title = newTitle();
          yield* publishDraft(id, { salesEvent: true, title });
          yield* participations(portal, id, 1);
          const contact = yield* eventually(() =>
            portal.contact(guest.email)?.arr_utm_arrangement === undefined
              ? undefined
              : portal.contact(guest.email),
          );
          assert.strictEqual(contact.arr_utm_source, "linkedin");
          assert.strictEqual(contact.arr_utm_arrangement, title);
        }),
    );

    it.effect(
      "sends only the values a sign-up has and leaves the contact's other values as they are (AC-4)",
      () =>
        Effect.gen(function* () {
          const first = yield* publishSales();
          const second = yield* publishSales();
          const email = `repeat-${crypto.randomUUID()}@example.org`;
          yield* guestSignsUp(first.id, {
            email,
            source: { utm_source: "meta", utm_campaign: "autumn" },
          });
          yield* eventually(() =>
            portal.contact(email)?.arr_utm_campaign === "autumn"
              ? true
              : undefined,
          );
          yield* guestSignsUp(second.id, {
            email,
            source: { utm_source: "linkedin" },
          });
          const contact = yield* eventually(() =>
            portal.contact(email)?.arr_utm_source === "linkedin"
              ? portal.contact(email)
              : undefined,
          );
          assert.strictEqual(contact.arr_utm_campaign, "autumn");
          assert.strictEqual(contact.arr_utm_arrangement, second.title);
        }),
    );

    it.effect(
      "sets invitere_til_arrangementer and sende_nyhetsbrev to Ja on a guest's and a member's contact, and registers them (AC-2)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          const guest = yield* guestSignsUp(id, { consent: true });
          const member = yield* memberSignsUp(
            id,
            "Marie Hansen",
            undefined,
            true,
          );
          yield* participations(portal, id, 2);
          for (const email of [guest.email, member.email ?? ""]) {
            const contact = yield* eventually(() =>
              portal.contact(email)?.sende_nyhetsbrev === undefined
                ? undefined
                : portal.contact(email),
            );
            assert.strictEqual(contact.invitere_til_arrangementer, "Ja");
            assert.strictEqual(contact.sende_nyhetsbrev, "Ja");
          }
        }),
    );

    it.effect(
      "sends no consent for a sign-up without the box ticked, and keeps a consent given before (AC-3)",
      () =>
        Effect.gen(function* () {
          const first = yield* publishSales();
          const second = yield* publishSales();
          const email = `consent-${crypto.randomUUID()}@example.org`;
          yield* guestSignsUp(first.id, { email, consent: true });
          yield* eventually(() =>
            portal.contact(email)?.sende_nyhetsbrev === "Ja" ? true : undefined,
          );
          yield* guestSignsUp(second.id, { email });
          yield* participations(portal, second.id, 1);
          yield* settle;
          assert.strictEqual(
            portal.contact(email)?.invitere_til_arrangementer,
            "Ja",
          );
          assert.strictEqual(portal.contact(email)?.sende_nyhetsbrev, "Ja");

          const stranger = yield* guestSignsUp(second.id);
          const member = yield* memberSignsUp(second.id, "Marie Hansen");
          yield* participations(portal, second.id, 3);
          yield* settle;
          for (const each of [stranger.email, member.email ?? ""]) {
            const properties = Object.keys(portal.contact(each) ?? {});
            assert.deepStrictEqual(
              properties.filter(
                (name) =>
                  name === "invitere_til_arrangementer" ||
                  name === "sende_nyhetsbrev",
              ),
              [],
            );
          }
        }),
    );

    it.effect(
      "sends no arr_ property for a sign-up without a source (AC-4)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          const guest = yield* guestSignsUp(id);
          const member = yield* memberSignsUp(id, "Marie Hansen");
          yield* participations(portal, id, 2);
          yield* settle;
          for (const email of [guest.email, member.email ?? ""]) {
            const properties = Object.keys(portal.contact(email) ?? {});
            assert.deepStrictEqual(
              properties.filter((name) => name.startsWith("arr_")),
              [],
            );
          }
        }),
    );

    it.effect(
      "sends nothing of an event that is not a sales event, even for a guest with an ad source (AC-5, AC-3)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishNew();
          const guest = yield* guestSignsUp(id, {
            source: { utm_source: "linkedin" },
          });
          yield* memberSignsUp(id, "Marie Hansen");
          yield* (yield* Attendance).leaveAsGuest(id, guest.token);
          yield* settle;
          assert.isUndefined(portal.event(id));
          assert.deepStrictEqual(portal.participations(id), []);
          assert.isUndefined(portal.contact(guest.email));
        }),
    );

    it.effect(
      "records a guest cancelling with their link, a guest confirming from their email, a member leaving and the organiser taking someone off, each at its time (AC-6)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishSales();
          const attendance = yield* Attendance;
          const byLink = yield* guestSignsUp(id);
          const byEmail = yield* guestSignsUp(id);
          const removed = yield* guestSignsUp(id);
          const member = yield* memberSignsUp(id, "Marie Hansen");
          yield* participations(portal, id, 4);

          const before = Date.now();
          yield* attendance.leaveAsGuest(id, byLink.token);
          const expiresAt = Date.now() + 60_000;
          yield* attendance.confirmCancel(
            id,
            attendance.cancelLinkToken(id, byEmail.id, expiresAt),
          );
          yield* attendance.leave(id, member);
          yield* attendance.remove(removed.id);
          const cancelled = (yield* participations(portal, id, 8)).filter(
            ({ state }) => state === "CANCELLED",
          );
          const after = Date.now();

          assert.sameMembers(
            cancelled.map(({ email }) => email),
            [byLink.email, byEmail.email, member.email ?? "", removed.email],
          );
          for (const { at } of cancelled) {
            assert.isAtLeast(at.getTime(), before - 1000);
            assert.isAtMost(at.getTime(), after + 1000);
          }
        }),
    );

    it.effect(
      "records the organiser taking someone off after the event has ended (AC-6)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const { id } = yield* publishSales();
          const guest = yield* guestSignsUp(id);
          yield* participations(portal, id, 1);
          yield* sql`
          UPDATE events SET starts_at = now() - interval '2 days',
            ends_at = now() - interval '1 day' WHERE id = ${id}
        `;
          yield* (yield* Attendance).remove(guest.id);
          const found = yield* participations(portal, id, 2);
          assert.deepStrictEqual(
            found.map(({ email, state }) => [email, state]),
            [
              [guest.email, "REGISTERED"],
              [guest.email, "CANCELLED"],
            ],
          );
        }),
    );

    it.effect(
      "sends everyone already signed up, earliest first, when the setting is turned on (AC-7)",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const { id } = yield* publishNew();
          const first = yield* guestSignsUp(id);
          yield* sql`
            UPDATE attendees SET created_at = created_at - interval '1 second'
            WHERE id = ${first.id}::uuid
          `;
          const second = yield* memberSignsUp(id, "Marie Hansen");
          yield* settle;
          assert.isUndefined(portal.event(id));

          yield* publishDraft(id, { salesEvent: true });
          const found = yield* participations(portal, id, 2);
          assert.deepStrictEqual(
            found.map(({ email, state }) => [email, state]),
            [
              [first.email, "REGISTERED"],
              [second.email, "REGISTERED"],
            ],
          );
          // The Marketing Event was made before they were registered.
          assert.isDefined(portal.event(id));
          assert.strictEqual(portal.calls()[0], "upsertMarketingEvent");
        }),
    );

    it.effect(
      "sends the sign-ups already there once, however often it is published again (AC-7)",
      () =>
        Effect.gen(function* () {
          const { id } = yield* publishNew();
          yield* guestSignsUp(id);
          yield* publishDraft(id, { salesEvent: true });
          yield* participations(portal, id, 1);
          yield* publishDraft(id, { salesEvent: true, summary: "Again" });
          yield* settle;
          assert.strictEqual(portal.participations(id).length, 1);
        }),
    );
  },
);

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

import { readFile } from "node:fs/promises";
