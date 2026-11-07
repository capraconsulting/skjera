# @skjera/hubspot

The parts of HubSpot's API Skjera uses, as an Effect service, on Effect's
`HttpClient`: Marketing Events and Contacts.

```ts
import { HubSpot, retryTransient } from "@skjera/hubspot";

const register = Effect.gen(function* () {
  const hubspot = yield* HubSpot;
  yield* hubspot.upsertContact({ email: "kari@example.com", firstname: "Kari" });
  yield* hubspot
    .recordParticipation({
      externalEventId: "0190a000-…",
      state: "REGISTERED",
      email: "kari@example.com",
      at: new Date(),
    })
    .pipe(retryTransient());
});

register.pipe(Effect.provide(HubSpot.layerFetch({ token })));
```

- `upsertMarketingEvent`: creates the Marketing Event, or updates it when its
  `externalEventId` is there already, under the account `skjera`.
- `cancelMarketingEvent`: marks it cancelled.
- `upsertContact`: creates or updates a contact by email; a property left out
  keeps what HubSpot has. Properties beyond `email`, `firstname`, `lastname`,
  `company` and `jobtitle` are given by their HubSpot name, and must exist in
  the account: HubSpot refuses the call otherwise.
- `recordParticipation`: registers someone for the event, or records that they
  cancelled, by email and at the time given.

Creating or updating an event is a PUT by external id, falling back to a POST when HubSpot has none. The requests are those of HubSpot's Marketing Events API
(`/marketing/v3/marketing-events/…`) and CRM Contacts API
(`/crm/v3/objects/contacts/batch/upsert`); every path is in `src/HubSpot.ts`.

## Errors

- `HubSpotApiError { status }`: HubSpot said no to what was sent (400, 404,
  409, …), or to the token (401, 403). Retrying won't help, unless it is the
  token that is replaced.
- `HubSpotRateLimited { retryAfter }`: too many calls, try again in that many
  seconds.
- `HubSpotUnavailable { status? }`: HubSpot couldn't be reached, or failed (a
  5xx).

`retryTransient({ times, base })` retries rate limits after `retryAfter`, and
unavailability after 1, 2, 4, … seconds, and nothing else.

## The private app

A private app in the HubSpot account, with the scopes
`crm.objects.marketing_events.read`, `crm.objects.marketing_events.write`,
`crm.objects.contacts.read` and `crm.objects.contacts.write`; its access token
is `HUBSPOT_ACCESS_TOKEN`.

## Testing

`@skjera/hubspot/testing` is a portal in memory: Marketing Events, contacts,
who registered for or cancelled each, and failures on cue.

```ts
const portal = HubSpotTest.make();
// Provide portal.layer; then look at portal.event(id), portal.contact(email),
// portal.participations(id), and portal.failNext("upsertContact", new HubSpotUnavailable({ … })).
```
