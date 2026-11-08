import * as OAuth from "@skjera/oauth";
import { Effect, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiSchema } from "effect/http-api";
import * as Documents from "./HandlerServices.ts";
import { SignupLimits } from "./SignupLimits.ts";

export class Api extends HttpApi.make("skjera")
  .add(Documents.SessionApi)
  .add(Documents.SiteApi)
  .add(Documents.ImagesApi)
  .add(Documents.PublicImagesApi)
  // Public: no middleware, published content only.
  .add(Documents.EventsApi)
  .add(Documents.AttendeesApi)
  .add(Documents.SyncApi)
  .add(Documents.PublicSyncApi)
  .add(Documents.TeamsApi)
  .add(Documents.DocumentsApi) {}

const SessionHandlers = HttpApiBuilder.group(Api, "session", (handlers) =>
  handlers.handle("me", () =>
    Effect.gen(function* () {
      return yield* OAuth.CurrentUser;
    }),
  ),
);

const SiteHandlers = HttpApiBuilder.group(Api, "site", (handlers) =>
  handlers.handle("settings", () => Documents.siteSettings.pipe(Effect.orDie)),
);

const ImagesHandlers = HttpApiBuilder.group(Api, "images", (handlers) =>
  Effect.gen(function* () {
    const images = yield* Documents.Images.Images;
    return handlers
      .handle("upload", ({ payload }) => images.upload(payload))
      .handle("list", ({ query }) =>
        images.list().pipe(
          Effect.mapError(
            () =>
              new Documents.ImageListUnavailable({
                message: "Couldn't list the images",
              }),
          ),
          Effect.map((all) => {
            const page = Documents.Images.pageOf(
              all,
              query.after,
              Documents.imagePageSize,
            );
            if (page === undefined) {
              return new Documents.InvalidImageCursor({
                message: "That is not a place in the list",
              });
            }
            return {
              images: page.images.map((image) => ({
                url: `${Documents.imagesPath}/${image.id}`,
                uploadedAt: image.uploadedAt.toISOString(),
              })),
              next: page.next,
            };
          }),
          Effect.flatMap((page) =>
            page instanceof Documents.InvalidImageCursor
              ? Effect.fail(page)
              : Effect.succeed(page),
          ),
        ),
      );
  }),
);

const PublicImagesHandlers = HttpApiBuilder.group(
  Api,
  "publicImages",
  (handlers) =>
    Effect.gen(function* () {
      const images = yield* Documents.Images.Images;
      return handlers.handle("serve", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* images.get(params.id);
          if (Option.isNone(found)) return yield* new Documents.ImageNotFound();
          const { body, contentType, size } = found.value;
          const bytes = new Uint8Array(
            yield* Effect.promise(() => new Response(body).arrayBuffer()),
          );
          return HttpApiSchema.withHeaders({
            body: bytes,
            headers: {
              "content-type": contentType,
              ...(size === null ? {} : { "content-length": String(size) }),
              "cache-control": "public, max-age=31536000, immutable",
              "x-content-type-options": "nosniff",
              "content-security-policy": "default-src 'none'",
            },
          });
        }),
      );
    }),
);

const EventsHandlers = HttpApiBuilder.group(Api, "events", (handlers) =>
  Effect.gen(function* () {
    const attendance = yield* Documents.Attendance;
    const authenticator = yield* OAuth.Authenticator;
    const limits = yield* SignupLimits;
    const sync = yield* Documents.Sync;

    // These endpoints are open to anyone; a session shows members-only
    // events and signs up as a member.
    const currentUser = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* authenticator.fromCookies(request.cookies);
    });
    const signedIn = Effect.flatMap(currentUser, (user) =>
      Option.match(user, {
        onNone: () =>
          Effect.fail(
            new Documents.SignInRequired(
              Documents.refused({ _tag: "LogInToAttend" }),
            ),
          ),
        onSome: Effect.succeed,
      }),
    );

    return handlers
      .handle("event", ({ params }) =>
        sync.event(params.id).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(new Documents.EventNotFound({ id: params.id })),
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .handle("attend", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* currentUser;
          // Signing up and cancelling are counted per visitor, a member's apart from a guest's.
          return yield* Effect.gen(function* () {
            if (Option.isSome(user)) {
              yield* attendance.attend(params.id, user.value, payload);
              return null;
            }
            if (payload.guest === undefined) {
              return yield* new Documents.SignInRequired(
                Documents.refused({ _tag: "LogInOrGuest" }),
              );
            }
            const cancelToken = yield* attendance.attendAsGuest(
              params.id,
              payload.guest,
              payload,
            );
            return new Documents.GuestSignup({ cancelToken });
          }).pipe(limits.attempt(Option.isSome(user) ? "member" : "guest"));
        }),
      )
      .handle("leave", ({ params }) =>
        Effect.flatMap(signedIn, (user) =>
          attendance
            .leave(params.id, user)
            .pipe(limits.attempt(Documents.publicWriteLimits.leave)),
        ),
      )
      .handle("leaveAsGuest", ({ params, query }) =>
        attendance
          .leaveAsGuest(params.id, params.token, query.honeypot)
          .pipe(limits.attempt(Documents.publicWriteLimits.leaveAsGuest)),
      )
      .handle("guestSignup", ({ params }) =>
        attendance.guestSignup(params.id, params.token),
      )
      .handle("change", ({ params, payload }) =>
        Effect.flatMap(signedIn, (user) =>
          attendance
            .change(params.id, { user }, payload)
            .pipe(limits.attempt(Documents.publicWriteLimits.change)),
        ),
      )
      .handle("changeAsGuest", ({ params, payload }) =>
        attendance
          .change(params.id, { cancelToken: params.token }, payload)
          .pipe(limits.attempt(Documents.publicWriteLimits.changeAsGuest)),
      )
      .handle("requestCancel", ({ params, payload }) =>
        attendance
          .requestCancel(params.id, payload.email, payload.honeypot)
          .pipe(limits.attempt(Documents.publicWriteLimits.requestCancel)),
      )
      .handle("cancelLink", ({ params }) =>
        attendance.cancelLink(params.id, params.token),
      )
      .handle("confirmCancel", ({ params }) =>
        attendance
          .confirmCancel(params.id, params.token)
          .pipe(limits.attempt(Documents.publicWriteLimits.confirmCancel)),
      );
  }),
);

const AttendeesHandlers = HttpApiBuilder.group(Api, "attendees", (handlers) =>
  Effect.gen(function* () {
    const attendance = yield* Documents.Attendance;
    const invitations = yield* Documents.Invitations;
    const organizerEmails = yield* Documents.OrganizerEmails;
    return handlers
      .handle("remove", ({ params }) => attendance.remove(params.id))
      .handle("dietaryPreferences", ({ params }) =>
        attendance.dietaryPreferences(params.id),
      )
      .handle("invitations", ({ params }) => invitations.invitations(params.id))
      .handle("invite", ({ params, payload }) =>
        invitations.invite(params.id, payload),
      )
      .handle("organizerEmails", ({ params }) =>
        organizerEmails.sent(params.id),
      )
      .handle("emailAttendees", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* organizerEmails.send(
            params.id,
            yield* OAuth.CurrentUser,
            payload,
          );
        }),
      );
  }),
);

const SyncHandlers = HttpApiBuilder.group(Api, "sync", (handlers) =>
  Effect.gen(function* () {
    const sync = yield* Documents.Sync;
    return handlers
      .handle("teams", ({ query }) => sync.teams(query.since))
      .handle("documents", ({ query }) => sync.documents(query.since))
      .handle("tags", ({ query }) => sync.tags(query.since));
  }),
);

/** Who is looking at the site: a signed-in member, if anyone. */
const viewer = Effect.gen(function* () {
  const authenticator = yield* OAuth.Authenticator;
  const request = yield* HttpServerRequest.HttpServerRequest;
  return yield* authenticator.fromCookies(request.cookies);
});
const audience = Effect.map(viewer, (user) =>
  Option.isSome(user) ? ("members" as const) : ("anyone" as const),
);

const PublicSyncHandlers = HttpApiBuilder.group(Api, "publicSync", (handlers) =>
  Effect.gen(function* () {
    const sync = yield* Documents.Sync;
    return handlers
      .handle("events", ({ query }) =>
        Effect.flatMap(audience, (who) => sync.events(query.since, who)),
      )
      .handle("attendees", ({ query }) =>
        Effect.flatMap(viewer, (who) => sync.attendees(query.since, who)),
      );
  }),
);

const TeamsHandlers = HttpApiBuilder.group(Api, "teams", (handlers) =>
  Effect.gen(function* () {
    const teams = yield* Documents.Teams;
    return handlers
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          return yield* teams.create(
            payload.name,
            yield* OAuth.CurrentUser,
            payload.id,
          );
        }),
      )
      .handle("rename", ({ params, payload }) =>
        teams.rename(params.id, payload.name),
      )
      .handle("setLogos", ({ params, payload }) =>
        teams.setLogos(params.id, payload),
      )
      .handle("delete", ({ params }) => teams.delete(params.id));
  }),
);

const DocumentsHandlers = HttpApiBuilder.group(Api, "documents", (handlers) =>
  Effect.gen(function* () {
    const documents = yield* Documents.Documents;
    return handlers
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          return yield* documents.create(
            payload.type,
            payload.teamId,
            yield* OAuth.CurrentUser,
            payload.id,
          );
        }),
      )
      .handle("copy", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* documents.copy(
            params.id,
            payload.id,
            yield* OAuth.CurrentUser,
          );
        }),
      )
      .handle("move", ({ params, payload }) =>
        documents.move(params.id, payload.teamId),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* OAuth.CurrentUser;
          return yield* payload.confirmed === undefined
            ? documents.publish(params.id, payload.heads, user)
            : documents.publishConfirmed(
                params.id,
                payload.heads,
                user,
                payload.confirmed,
              );
        }),
      )
      .handle("publishingNotice", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* documents.publishingNotice(
            params.id,
            payload.heads,
            yield* OAuth.CurrentUser,
          );
        }),
      )
      .handle("cancellingNotice", ({ params }) =>
        documents.cancellingNotice(params.id),
      )
      .handle("unpublish", ({ params, payload }) =>
        documents.unpublish(params.id, payload.confirmed),
      )
      .handle("discardChanges", ({ params }) =>
        Effect.gen(function* () {
          return yield* documents.discardChanges(
            params.id,
            yield* OAuth.CurrentUser,
          );
        }),
      )
      .handle("history", ({ params }) => documents.history(params.id))
      .handle("restore", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* documents.restore(
            params.id,
            payload.heads,
            yield* OAuth.CurrentUser,
          );
        }),
      )
      .handle("delete", ({ params, payload }) =>
        Effect.gen(function* () {
          return yield* documents.delete(
            params.id,
            yield* OAuth.CurrentUser,
            payload.confirmed,
          );
        }),
      );
  }),
);

export const ApiHandlers = HttpApiBuilder.layer(Api).pipe(
  Layer.provide([
    SessionHandlers,
    SiteHandlers,
    ImagesHandlers,
    PublicImagesHandlers,
    EventsHandlers,
    AttendeesHandlers,
    SyncHandlers,
    PublicSyncHandlers,
    TeamsHandlers,
    DocumentsHandlers,
  ]),
);
