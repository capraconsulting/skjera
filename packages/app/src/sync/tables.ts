import type {
  AttendeeRow,
  CancellingNotice,
  DocumentId,
  DocumentRow,
  EventRow,
  PublishingNotice,
  TagRow,
  TeamId,
  TeamLogosChange,
  TeamRow,
} from "@skjera/documents/api";
import { syncedTable } from "@skjera/snapsync/client";
import { Effect } from "effect";
import {
  type AppClient,
  type PublicClient,
  requestEffect,
  runPublic,
  runRequest,
} from "../site/client.ts";
import { guestSignup, rememberGuestSignup } from "../site/guestSignups.ts";
import {
  attendPayload,
  type Signup,
  type SignupChange,
} from "./signupPayload.ts";

export type { Signup, SignupChange } from "./signupPayload.ts";

const request = <A, E>(f: (client: AppClient) => Effect.Effect<A, E>) =>
  runRequest(f);

/** Runs a write over the studio's API, failing with a message for people. */
const sendRequest = <E extends { readonly _tag: string }>(
  f: (client: AppClient) => Effect.Effect<unknown, E>,
) => request((client) => f(client).pipe(Effect.asVoid));

/** Runs a write over the site's API, failing with a message for people. */
const sendPublic = <E extends { readonly _tag: string }>(
  f: (client: PublicClient) => Effect.Effect<unknown, E>,
) => runPublic((client) => f(client).pipe(Effect.asVoid));

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

/** Deletes a document on the server without first removing its local row. */
export const deleteDocument = (id: DocumentId, confirmed?: CancellingNotice) =>
  request((client) =>
    client.documents
      .delete({
        params: { id },
        payload: confirmed === undefined ? {} : { confirmed },
      })
      .pipe(Effect.catchTag("DocumentNotFound", () => Effect.void)),
  );

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
    delete: (document) => deleteDocument(document.id).then(() => undefined),
  },
});

/**
 * Publishes a draft as of `heads`, the version the user saw. The server
 * must have all of it. The published version arrives as a row of `events`.
 */
export const publishingNotice = (
  id: DocumentId,
  heads: ReadonlyArray<string>,
) =>
  requestEffect((client) =>
    client.documents.publishingNotice({
      params: { id },
      payload: { heads: [...heads] },
    }),
  );

export const cancellingNotice = (id: DocumentId) =>
  requestEffect((client) =>
    client.documents.cancellingNotice({ params: { id } }),
  );

export const publishDraft = (
  id: DocumentId,
  heads: ReadonlyArray<string>,
  confirmed?: PublishingNotice,
) =>
  requestEffect((client) =>
    client.documents.update({
      params: { id },
      payload: {
        published: true,
        heads: [...heads],
        ...(confirmed === undefined ? {} : { confirmed }),
      },
    }),
  );

/**
 * Takes a published event off the site, keeping its draft. The row of
 * `events` leaves with it.
 */
export const unpublishDocument = (
  id: DocumentId,
  confirmed?: CancellingNotice,
) =>
  requestEffect((client) =>
    client.documents.unpublish({
      params: { id },
      payload: confirmed === undefined ? {} : { confirmed },
    }),
  );

/**
 * Makes a published event's draft the published version again. The event's
 * row of `events` follows the draft's new heads.
 */
export const discardChanges = (id: DocumentId) =>
  requestEffect((client) =>
    client.documents.discardChanges({ params: { id } }),
  );

/**
 * Makes the draft equal to its version at `heads`, in every field, without
 * publishing. The change reaches the editor through the sync.
 */
export const restoreVersion = (id: DocumentId, heads: ReadonlyArray<string>) =>
  requestEffect((client) =>
    client.documents.restore({
      params: { id },
      payload: { heads: [...heads] },
    }),
  );

/** An event's versions, newest first: who changed it, when, and what it was then. */
export const eventHistory = (id: DocumentId) =>
  request((client) => client.documents.history({ params: { id } }));

/**
 * Makes a new, never-published event in the same team with the content of an
 * event's draft, under `copy`, the id the studio picked. Asking again with the
 * same id makes no second copy.
 */
export const copyDocument = (id: DocumentId, copy: DocumentId) =>
  requestEffect((client) =>
    client.documents.copy({ params: { id }, payload: { id: copy } }),
  );

/**
 * Moves an event to another team, while it has never been published. The
 * request is explicit, not an update of the table's row, so a refusal never
 * shows the event in the other team and back.
 */
export const moveDocument = (id: DocumentId, teamId: TeamId) =>
  requestEffect((client) =>
    client.documents.move({ params: { id }, payload: { teamId } }),
  );

/**
 * What people can't eat at an event, for its organizers: the texts, sorted,
 * with nothing that says who gave them.
 */
export const dietaryPreferences = (id: DocumentId) =>
  request((client) => client.attendees.dietaryPreferences({ params: { id } }));

/** Those an event's organizers noted as invited, in the order they were added. */
export const invitations = (id: DocumentId) =>
  request((client) => client.attendees.invitations({ params: { id } }));

/**
 * Notes someone as invited to an event: nothing is sent to them. A refusal
 * keeps its problem, for the form to tell which field it belongs to.
 */
export const invite = (
  id: DocumentId,
  person: { readonly name?: string; readonly email: string },
) =>
  request((client) =>
    client.attendees.invite({ params: { id }, payload: person }),
  );

/** The emails organizers sent to everyone signed up to an event, newest first. */
export const organizerEmails = (id: DocumentId) =>
  request((client) => client.attendees.organizerEmails({ params: { id } }));

/**
 * Emails everyone signed up to an event, as the signed-in user. A refusal
 * keeps its problem, for the form to tell which field it belongs to.
 */
export const emailAttendees = (
  id: DocumentId,
  email: { readonly subject: string; readonly text: string },
) =>
  request((client) =>
    client.attendees.emailAttendees({ params: { id }, payload: email }),
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
      const payload = attendPayload(attendee.id, metadata as Signup);
      return sendPublic((client) =>
        client.events
          .attend({
            params: { id: attendee.eventId },
            payload,
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

/** Pass as a delete's metadata to take someone off as an organizer. */
export type Removal = { readonly asOrganizer: true };

/** Pass as a guest's delete's metadata: what the cancel form's hidden field held. */
export type GuestCancel = { readonly honeypot: string };
