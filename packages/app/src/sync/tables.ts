import {
  type AdSource,
  type Answers,
  type AttendeeRow,
  AttendeesApi,
  type DocumentId,
  type DocumentRow,
  DocumentsApi,
  type EventRow,
  type GuestDetails,
  type Locale,
  PublicSyncApi,
  SyncApi,
  type TagRow,
  type TeamId,
  type TeamLogosChange,
  type TeamRow,
  TeamsApi,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { syncedTable } from "@skjera/snapsync/client";
import { Effect } from "effect";
import { HttpApi, HttpApiClient } from "effect/http-api";
import { sayWhy } from "../problems.ts";
import { type PublicClient, provideHttp, runPublic } from "../site/client.ts";
import { guestSignup, rememberGuestSignup } from "../site/guestSignups.ts";

class Api extends HttpApi.make("studio")
  .add(SyncApi)
  .add(PublicSyncApi)
  .add(TeamsApi)
  .add(DocumentsApi)
  .add(AttendeesApi) {}

const makeClient = HttpApiClient.make(Api, {
  baseUrl: window.location.origin,
});

const request = <A, E>(
  f: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>,
) => Effect.runPromise(provideHttp(makeClient.pipe(Effect.flatMap(f))));

/** Runs a write over the studio's API, failing with a message for people. */
const sendRequest = <E extends { readonly _tag: string }>(
  f: (client: Effect.Success<typeof makeClient>) => Effect.Effect<unknown, E>,
) =>
  request((client) =>
    f(client).pipe(
      Effect.asVoid,
      Effect.mapError((error) => new Error(failureMessage(error))),
    ),
  );

/** Runs a write over the site's API, failing with a message for people. */
const sendPublic = <E extends { readonly _tag: string }>(
  f: (client: PublicClient) => Effect.Effect<unknown, E>,
) =>
  runPublic((client) =>
    f(client).pipe(
      Effect.asVoid,
      // The refusal's problem goes along, for the form to tell which field.
      Effect.mapError((error) =>
        Object.assign(new Error(failureMessage(error)), {
          problem: "problem" in error ? error.problem : undefined,
        }),
      ),
    ),
  );

const failureMessage = (failure: { readonly _tag: string }) =>
  failure._tag === "TeamNotEmpty"
    ? m.studio_only_empty_teams()
    : sayWhy(failure, m.common_something_wrong());

/** Tags published events have had: suggestions when tagging. */
export const tags = syncedTable({
  id: "tags",
  getKey: (tag: TagRow) => tag.id,
  pull: (since) =>
    request((client) =>
      client.sync.tags({ query: since === undefined ? {} : { since } }),
    ),
});

export const teams = syncedTable({
  id: "teams",
  getKey: (team: TeamRow) => team.id,
  pull: (since) =>
    request((client) =>
      client.sync.teams({ query: since === undefined ? {} : { since } }),
    ),
  write: {
    insert: (team) =>
      sendRequest((client) =>
        client.teams.create({ payload: { id: team.id, name: team.name } }),
      ),
    // A logo change, passed as metadata, goes to its own endpoint; any
    // other update is a rename. Each sends only what it changes, so one
    // person renaming and another changing a logo don't undo each other.
    update: (team, metadata) => {
      const logos = (metadata as TeamChange | undefined)?.logos;
      return sendRequest((client) =>
        logos === undefined
          ? client.teams.rename({
              params: { id: team.id },
              payload: { name: team.name },
            })
          : client.teams.setLogos({ params: { id: team.id }, payload: logos }),
      );
    },
    delete: (team) =>
      sendRequest((client) => client.teams.delete({ params: { id: team.id } })),
  },
});

/** Pass as a team update's metadata to change its logos rather than its name. */
export type TeamChange = { readonly logos: TeamLogosChange };

export const documents = syncedTable({
  id: "documents",
  getKey: (document: DocumentRow) => document.id,
  pull: (since) =>
    request((client) =>
      client.sync.documents({ query: since === undefined ? {} : { since } }),
    ),
  write: {
    insert: (document) =>
      sendRequest((client) =>
        client.documents.create({
          payload: {
            id: document.id,
            type: document.type,
            teamId: document.teamId,
          },
        }),
      ),
    // Gone already is as good as deleted.
    delete: (document) =>
      sendRequest((client) =>
        client.documents
          .delete({ params: { id: document.id } })
          .pipe(Effect.catchTag("DocumentNotFound", () => Effect.void)),
      ),
  },
});

/**
 * Publishes a draft as of `heads`, the version the user saw. The server
 * must have all of it. The published version arrives as a row of `events`.
 */
export const publishDraft = (id: DocumentId, heads: ReadonlyArray<string>) =>
  provideHttp(
    makeClient.pipe(
      Effect.flatMap((client) =>
        client.documents.update({
          params: { id },
          payload: { published: true, heads: [...heads] },
        }),
      ),
    ),
  );

/**
 * Takes a published event off the site, keeping its draft. The row of
 * `events` leaves with it.
 */
export const unpublishDocument = (id: DocumentId) =>
  provideHttp(
    makeClient.pipe(
      Effect.flatMap((client) =>
        client.documents.unpublish({ params: { id } }),
      ),
    ),
  );

/**
 * Makes a published event's draft the published version again. The event's
 * row of `events` follows the draft's new heads.
 */
export const discardChanges = (id: DocumentId) =>
  provideHttp(
    makeClient.pipe(
      Effect.flatMap((client) =>
        client.documents.discardChanges({ params: { id } }),
      ),
    ),
  );

/**
 * Makes the draft equal to its version at `heads`, in every field, without
 * publishing. The change reaches the editor through the sync.
 */
export const restoreVersion = (id: DocumentId, heads: ReadonlyArray<string>) =>
  provideHttp(
    makeClient.pipe(
      Effect.flatMap((client) =>
        client.documents.restore({
          params: { id },
          payload: { heads: [...heads] },
        }),
      ),
    ),
  );

/** An event's versions, newest first: who changed it, when, and what it was then. */
export const eventHistory = (id: DocumentId) =>
  request((client) =>
    client.documents
      .history({ params: { id } })
      .pipe(Effect.mapError((error) => new Error(failureMessage(error)))),
  );

/**
 * Makes a new, never-published event in the same team with the content of an
 * event's draft, under `copy`, the id the studio picked. Asking again with the
 * same id makes no second copy.
 */
export const copyDocument = (id: DocumentId, copy: DocumentId) =>
  provideHttp(
    makeClient.pipe(
      Effect.flatMap((client) =>
        client.documents.copy({ params: { id }, payload: { id: copy } }),
      ),
    ),
  );

/**
 * Moves an event to another team, while it has never been published. The
 * request is explicit, not an update of the table's row, so a refusal never
 * shows the event in the other team and back.
 */
export const moveDocument = (id: DocumentId, teamId: TeamId) =>
  provideHttp(
    makeClient.pipe(
      Effect.flatMap((client) =>
        client.documents.move({ params: { id }, payload: { teamId } }),
      ),
    ),
  );

/**
 * What people can't eat at an event, for its organizers: the texts, sorted,
 * with nothing that says who gave them.
 */
export const dietaryPreferences = (id: DocumentId) =>
  request((client) =>
    client.attendees
      .dietaryPreferences({ params: { id } })
      .pipe(Effect.mapError((error) => new Error(failureMessage(error)))),
  );

/** Those an event's organizers noted as invited, in the order they were added. */
export const invitations = (id: DocumentId) =>
  request((client) =>
    client.attendees
      .invitations({ params: { id } })
      .pipe(Effect.mapError((error) => new Error(failureMessage(error)))),
  );

/**
 * Notes someone as invited to an event: nothing is sent to them. A refusal
 * keeps its problem, for the form to tell which field it belongs to.
 */
export const invite = (
  id: DocumentId,
  person: { readonly name?: string; readonly email: string },
) =>
  request((client) =>
    client.attendees.invite({ params: { id }, payload: person }).pipe(
      Effect.mapError((error) =>
        Object.assign(new Error(failureMessage(error)), {
          problem: "problem" in error ? error.problem : undefined,
        }),
      ),
    ),
  );

/** Published events: every one for members, the public ones for anyone. */
export const events = syncedTable({
  id: "events",
  getKey: (event: EventRow) => event.id,
  pull: (since) =>
    request((client) =>
      client.publicSync.events({ query: since === undefined ? {} : { since } }),
    ),
});

/**
 * Signups: for signed-in users all of them, with who signed up; for anyone
 * else those of public events, to count.
 */
export const attendees = syncedTable({
  id: "attendees",
  getKey: (attendee: AttendeeRow) => attendee.id,
  pull: (since) =>
    request((client) =>
      client.publicSync.attendees({
        query: since === undefined ? {} : { since },
      }),
    ),
  write: {
    // Signing up, as the signed-in user or as a guest (see `Signup`).
    insert: (attendee, metadata) => {
      const { guest, dietary, answers, online, locale, honeypot, source } =
        metadata as Signup;
      return sendPublic((client) =>
        client.events
          .attend({
            params: { id: attendee.eventId },
            payload: {
              id: attendee.id,
              ...(guest === undefined ? {} : { guest }),
              ...(dietary === undefined ? {} : { dietary }),
              ...(answers === undefined ? {} : { answers }),
              ...(online === undefined ? {} : { online }),
              ...(locale === undefined ? {} : { locale }),
              ...(honeypot === undefined ? {} : { honeypot }),
              ...(source === undefined ? {} : { source }),
            },
          })
          .pipe(
            Effect.tap((signup) =>
              Effect.sync(() => {
                if (signup === null) return;
                rememberGuestSignup(attendee.eventId, {
                  id: attendee.id,
                  cancelToken: signup.cancelToken,
                });
              }),
            ),
          ),
      );
    },
    // Changing one's own answers; a guest's with the token they were given.
    update: (attendee, metadata) => {
      const change = metadata as SignupChange;
      const guest = guestSignup(attendee.eventId);
      if (guest?.id === attendee.id) {
        return sendPublic((client) =>
          client.events.changeAsGuest({
            params: { id: attendee.eventId, token: guest.cancelToken },
            payload: change,
          }),
        );
      }
      return sendPublic((client) =>
        client.events.change({
          params: { id: attendee.eventId },
          payload: change,
        }),
      );
    },
    // Cancelling one's own signup, a guest's with the token they were
    // given, or taking someone off as an organizer (see `Removal`).
    delete: (attendee, metadata) => {
      if ((metadata as Removal | undefined)?.asOrganizer === true) {
        return sendRequest((client) =>
          client.attendees.remove({ params: { id: attendee.id } }),
        );
      }
      const guest = guestSignup(attendee.eventId);
      if (guest?.id === attendee.id) {
        const { honeypot } = (metadata ?? {}) as GuestCancel;
        return sendPublic((client) =>
          client.events
            .leaveAsGuest({
              params: { id: attendee.eventId, token: guest.cancelToken },
              query: honeypot === undefined ? {} : { honeypot },
            })
            // Gone either way: cancelled now, or already before.
            .pipe(
              Effect.catchTag("SignupNotFound", () => Effect.void),
              Effect.tap(() =>
                Effect.sync(() => rememberGuestSignup(attendee.eventId, null)),
              ),
            ),
        );
      }
      return sendPublic((client) =>
        client.events.leave({ params: { id: attendee.eventId } }),
      );
    },
  },
});

/**
 * What changing a signup sends: pass it as the update's metadata, and set
 * the row's `changedAt`, so the update has a change to send.
 */
export type SignupChange = {
  readonly answers?: Answers;
  /** Follows online rather than in person; asked while the event is streamed. */
  readonly online?: boolean;
  /** A guest's own: kept as given when left out, empty clears. */
  readonly phone?: string;
  readonly company?: string;
};

/** Pass as a delete's metadata to take someone off as an organizer. */
export type Removal = { readonly asOrganizer: true };

/** Pass as a guest's delete's metadata: what the cancel form's hidden field held. */
export type GuestCancel = { readonly honeypot: string };

/** What signing up sends besides the row: pass it as the insert's metadata. */
export type Signup = {
  /** Signing up as a guest, without an account. */
  readonly guest?: GuestDetails;
  readonly dietary?: string;
  /** Answers to the event's questions, by question id. */
  readonly answers?: Answers;
  /** Follows online rather than in person; asked while the event is streamed. */
  readonly online?: boolean;
  /** The language they signed up in: emails to them are in it. */
  readonly locale?: Locale;
  /** What a guest form's hidden field held: filled only by a bot. */
  readonly honeypot?: string;
  /** The ad they came from, kept from the address of the event's page. */
  readonly source?: AdSource;
};
