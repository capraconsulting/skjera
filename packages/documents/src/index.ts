import * as Snapsync from "@skjera/snapsync/server";
import { Layer } from "effect";
import { Attendance } from "./Attendance.ts";
import * as Database from "./Database.ts";
import { DocumentEvents } from "./DocumentEvents.ts";
import { Documents } from "./Documents.ts";
import { Presence } from "./Presence.ts";
import { Sync } from "./Sync.ts";
import { Teams } from "./Teams.ts";

export * from "./Attendance.ts";
export * from "./ContentTypes.ts";
export * as Database from "./Database.ts";
export * from "./DocumentEvents.ts";
export * from "./Documents.ts";
export * from "./DocumentsApi.ts";
export * as DraftSync from "./DraftSync.ts";
export * from "./DraftSyncProtocol.ts";
export * from "./errors.ts";
export * as Images from "./Images.ts";
export * from "./ImagesApi.ts";
export * from "./Model.ts";
export * from "./Presence.ts";
export * from "./PublicApi.ts";
export * from "./Sync.ts";
export * from "./SyncApi.ts";
export * from "./Teams.ts";
export * from "./TeamsApi.ts";

/**
 * Teams, documents, their change events, attendance and syncing them, on the
 * database at `DATABASE_URL`, with syncing kept well (see snapsync).
 */
export const layer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  Teams.layer,
  Attendance.layer,
  Presence.layer,
  Sync.layer,
  // After a restore, clients start over; old tombstones are forgotten.
  Snapsync.maintain(),
).pipe(Layer.provideMerge(Database.layer));
