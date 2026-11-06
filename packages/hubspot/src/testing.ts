import { Effect, Layer } from "effect";
import {
  type Contact,
  externalAccountId,
  HubSpot,
  HubSpotApiError,
  type HubSpotError,
  type MarketingEvent,
  type ParticipationState,
} from "./HubSpot.ts";

// A pretend HubSpot portal in memory, for testing what is sent to HubSpot:
// its Marketing Events, contacts and who registered for or cancelled each,
// and failures on cue. It behaves as HubSpot does where it matters: an
// event is made or updated by its external id, a cancel or a registration
// for an event that is not there is refused (404), and a contact is
// updated, not replaced, by the same email.

export interface StoredEvent extends MarketingEvent {
  readonly externalAccountId: string;
}

export interface StoredParticipation {
  readonly email: string;
  readonly state: ParticipationState;
  readonly at: Date;
}

type Method =
  | "upsertMarketingEvent"
  | "cancelMarketingEvent"
  | "upsertContact"
  | "recordParticipation";

export const make = () => {
  const events = new Map<string, StoredEvent>();
  const contacts = new Map<string, Record<string, string>>();
  const participations = new Map<string, Array<StoredParticipation>>();
  const calls: Array<Method> = [];
  const failures: Array<{
    readonly method: Method;
    readonly error: HubSpotError;
  }> = [];

  /** Records the call, and fails with the error set for `method`, if any, once. */
  const call = (method: Method) =>
    Effect.suspend(() => {
      calls.push(method);
      const at = failures.findIndex((each) => each.method === method);
      if (at === -1) return Effect.void;
      const [next] = failures.splice(at, 1);
      return next === undefined ? Effect.void : Effect.fail(next.error);
    });

  const notFound = (method: Method, id: string) =>
    Effect.fail(
      new HubSpotApiError({
        call: method,
        status: 404,
        message: `No marketing event ${id}`,
      }),
    );

  const hubspot = HubSpot.of({
    upsertMarketingEvent: (event) =>
      Effect.andThen(
        call("upsertMarketingEvent"),
        Effect.sync(() => {
          events.set(event.externalEventId, { ...event, externalAccountId });
        }),
      ),
    cancelMarketingEvent: (id) =>
      Effect.andThen(
        call("cancelMarketingEvent"),
        Effect.suspend(() => {
          const found = events.get(id);
          if (found === undefined) return notFound("cancelMarketingEvent", id);
          events.set(id, { ...found, eventCancelled: true });
          return Effect.void;
        }),
      ),
    upsertContact: (contact: Contact) =>
      Effect.andThen(
        call("upsertContact"),
        Effect.sync(() => {
          const properties = Object.fromEntries(
            Object.entries(contact).filter(([, value]) => value !== undefined),
          ) as Record<string, string>;
          contacts.set(contact.email, {
            ...contacts.get(contact.email),
            ...properties,
          });
        }),
      ),
    recordParticipation: ({ externalEventId, state, email, at }) =>
      Effect.andThen(
        call("recordParticipation"),
        Effect.suspend(() => {
          if (!events.has(externalEventId)) {
            return notFound("recordParticipation", externalEventId);
          }
          participations.set(externalEventId, [
            ...(participations.get(externalEventId) ?? []),
            { email, state, at },
          ]);
          if (!contacts.has(email)) contacts.set(email, { email });
          return Effect.void;
        }),
      ),
  });

  return {
    hubspot,
    layer: Layer.succeed(HubSpot, hubspot),
    /** The Marketing Event with this external id, as it is now. */
    event: (id: string): StoredEvent | undefined => events.get(id),
    /** The contact's properties, as they are now. */
    contact: (email: string): Record<string, string> | undefined =>
      contacts.get(email),
    /** Who registered for or cancelled the event, in the order it happened. */
    participations: (id: string): ReadonlyArray<StoredParticipation> => [
      ...(participations.get(id) ?? []),
    ],
    /** Every call made, whether it went through or not, oldest first. */
    calls: (): ReadonlyArray<Method> => [...calls],
    /** Makes the next call of `method` fail with `error`. */
    failNext: (method: Method, error: HubSpotError) => {
      failures.push({ method, error });
    },
  };
};
