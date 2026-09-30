import { Layer } from "effect";
import * as Database from "./Database.ts";
import { DocumentEvents } from "./DocumentEvents.ts";
import { Documents } from "./Documents.ts";

export * from "./ContentTypes.ts";
export * as Database from "./Database.ts";
export * from "./DocumentEvents.ts";
export * from "./Documents.ts";
export * from "./errors.ts";
export * from "./Model.ts";
export {
  CatchUp,
  DocumentsAuth,
  DocumentsRpc,
  DraftChanged,
  OpenedDocument,
} from "./Rpc.ts";
export * as RpcServer from "./RpcServer.ts";

/** Documents and their change events, on the database at `DATABASE_URL`. */
export const layer = Layer.mergeAll(Documents.layer, DocumentEvents.layer).pipe(
  Layer.provideMerge(Database.layer),
);
