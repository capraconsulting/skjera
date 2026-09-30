import { Authenticator } from "@skjera/oauth";
import { CurrentUser, Unauthorized } from "@skjera/oauth/api";
import { Effect, Layer, Option, Stream } from "effect";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { Attendance } from "./Attendance.ts";
import { DocumentEvents } from "./DocumentEvents.ts";
import { Documents } from "./Documents.ts";
import {
  CatchUp,
  DocumentDeleted,
  DocumentsAuth,
  DocumentsRpc,
  DraftChanged,
  OpenedDocument,
} from "./Rpc.ts";
import { Teams } from "./Teams.ts";

/**
 * Authenticates each call with the session cookie from the WebSocket
 * handshake. The handshake must come from the app's own origin: browsers
 * attach cookies to cross-site WebSocket handshakes, and the Origin header is
 * the only thing that tells them apart.
 */
export const DocumentsAuthLive = Layer.effect(
  DocumentsAuth,
  Effect.gen(function* () {
    const authenticator = yield* Authenticator;
    return DocumentsAuth.of((effect, { headers }) =>
      Effect.gen(function* () {
        if (headers.origin !== authenticator.origin) {
          return yield* new Unauthorized({ message: "Unexpected origin" });
        }
        const identity = yield* authenticator.fromCookieHeader(headers.cookie);
        if (Option.isNone(identity)) {
          return yield* new Unauthorized({ message: "Not logged in" });
        }
        return yield* Effect.provideService(
          effect,
          CurrentUser,
          identity.value,
        );
      }),
    );
  }),
);

export const DocumentsRpcHandlers = DocumentsRpc.toLayer(
  Effect.gen(function* () {
    const documents = yield* Documents;
    const events = yield* DocumentEvents;
    const teams = yield* Teams;
    const attendance = yield* Attendance;

    return DocumentsRpc.of({
      ListTeams: () => teams.list,
      GetTeam: ({ id }) => teams.get(id),
      CreateTeam: ({ name }) =>
        Effect.gen(function* () {
          return yield* teams.create(name, yield* CurrentUser);
        }),
      RenameTeam: ({ id, name }) => teams.rename(id, name),
      DeleteTeam: ({ id }) => teams.delete(id),
      ListAttendees: ({ id }) => attendance.list(id),
      ListDocuments: ({ type, teamId }) => documents.list(type, teamId),
      CreateDocument: ({ type, teamId }) =>
        Effect.gen(function* () {
          return yield* documents.create(type, teamId, yield* CurrentUser);
        }),
      OpenDocument: ({ id, actor }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          yield* documents.registerActor(id, actor, user);
          const snapshot = yield* documents.get(id);
          return new OpenedDocument({
            type: snapshot.type,
            // A document's team can't be deleted while the document exists.
            team: yield* Effect.orDie(teams.get(snapshot.teamId)),
            draft: snapshot.draft,
            publication: yield* documents.publication(id),
          });
        }),
      SendChanges: ({ id, changes }) =>
        Effect.gen(function* () {
          return yield* documents.applyChanges(id, changes, yield* CurrentUser);
        }),
      ChangesSince: ({ id, heads }) => documents.changesSince(id, heads),
      // Subscribe before telling the client to catch up, so no change falls
      // between its catch-up and the first notification.
      WatchDocument: ({ id }) =>
        Stream.unwrap(
          Effect.map(events.subscribe, (stream) =>
            stream.pipe(
              Stream.filter(
                (event) =>
                  event._tag === "ListenerReconnected" || event.id === id,
              ),
              Stream.map((event): DraftChanged | CatchUp | DocumentDeleted => {
                if (event._tag === "ListenerReconnected") {
                  return new CatchUp({});
                }
                return event.op === "DELETE"
                  ? new DocumentDeleted({})
                  : new DraftChanged({ heads: event.heads });
              }),
              Stream.takeUntil((event) => event._tag === "DocumentDeleted"),
              Stream.prepend([new CatchUp({})]),
            ),
          ),
        ),
      DeleteDocument: ({ id }) => documents.delete(id),
      Publish: ({ id, heads }) =>
        Effect.gen(function* () {
          return yield* documents.publish(id, heads, yield* CurrentUser);
        }),
    });
  }),
);

/**
 * The documents API as a WebSocket endpoint on the app's HttpRouter.
 * Requires `Documents`, `DocumentEvents` and the oauth `Authenticator`.
 */
export const layerHttp = (options: { readonly path: `/${string}` }) =>
  RpcServer.layerHttp({
    group: DocumentsRpc,
    path: options.path,
    protocol: "websocket",
  }).pipe(
    Layer.provide([
      DocumentsRpcHandlers,
      DocumentsAuthLive,
      RpcSerialization.layerJson,
    ]),
  );
