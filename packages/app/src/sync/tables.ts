import {
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
      Effect.mapError((error) => new Error(failureMessage(error))),
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
 * What people can't eat at an event, for its organizers: the texts, sorted,
 * with nothing that says who gave them.
 */
export const dietaryPreferences = (id: DocumentId) =>
  request((client) =>
    client.attendees
      .dietaryPreferences({ params: { id } })
      .pipe(Effect.mapError((error) => new Error(failureMessage(error)))),
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
      const { guest, dietary, answers, online, locale } = metadata as Signup;
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
        return sendPublic((client) =>
          client.events
            .leaveAsGuest({
              params: { id: attendee.eventId, token: guest.cancelToken },
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
};
