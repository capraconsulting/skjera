import { Layer } from "effect";
import * as Database from "./Database.ts";
import { DocumentEvents } from "./DocumentEvents.ts";
import { Documents } from "./Documents.ts";
import { PublishedPosts } from "./PublishedPosts.ts";
import { Teams } from "./Teams.ts";

export * from "./ContentTypes.ts";
export * as Database from "./Database.ts";
export * from "./DocumentEvents.ts";
export * from "./Documents.ts";
export * from "./errors.ts";
export * from "./Model.ts";
export * from "./PublicApi.ts";
export * from "./PublishedPosts.ts";
export {
  CatchUp,
  DocumentDeleted,
  DocumentsAuth,
  DocumentsRpc,
  DraftChanged,
  OpenedDocument,
} from "./Rpc.ts";
export * as RpcServer from "./RpcServer.ts";
export * from "./Teams.ts";

/**
 * Teams, documents, their change events and the published posts, on the
 * database at `DATABASE_URL`.
 */
export const layer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  PublishedPosts.layer,
  Teams.layer,
).pipe(Layer.provideMerge(Database.layer));
