import * as Snapsync from "@skjera/snapsync/server";
import { Layer } from "effect";
import { Attendance } from "./Attendance.ts";
import * as Cluster from "./Cluster.ts";
import * as Database from "./Database.ts";
import { DocumentEvents } from "./DocumentEvents.ts";
import { Documents } from "./Documents.ts";
import * as Mail from "./Mail.tsx";
import { Presence } from "./Presence.ts";
import * as SlackChannel from "./SlackChannel.ts";
import { Sync } from "./Sync.ts";
import { Teams } from "./Teams.ts";

export * from "./Announcements.ts";
export * from "./Attendance.ts";
export * as CalendarFeed from "./CalendarFeed.ts";
export * as Cluster from "./Cluster.ts";
export * from "./ContentTypes.ts";
export * as Database from "./Database.ts";
export * from "./DocumentEvents.ts";
export * from "./Documents.ts";
export * from "./DocumentsApi.ts";
export * as DraftSync from "./DraftSync.ts";
export * from "./DraftSyncProtocol.ts";
export * as Embed from "./Embed.ts";
export * from "./errors.ts";
export * as Images from "./Images.ts";
export * from "./ImagesApi.ts";
export * as Mail from "./Mail.tsx";
export * from "./Model.ts";
export * from "./Notifications.ts";
export * from "./Presence.ts";
export * from "./Problems.ts";
export * from "./PublicApi.ts";
export * as PublicEvents from "./PublicEvents.ts";
export * as Sharing from "./Sharing.ts";
export * as SlackChannel from "./SlackChannel.ts";
export * from "./Sync.ts";
export * from "./SyncApi.ts";
export * from "./Teams.ts";
export * from "./TeamsApi.ts";

/**
 * Teams, documents, their change events, attendance and syncing them, on the
 * database at `DATABASE_URL`, with the cluster running their background
 * work and emails. Needs `Crypto` and `Email`.
 */
export const layer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  Teams.layer,
  Presence.layer,
  Sync.layer,
  // After a restore, clients start over: before serving pulls.
  Layer.effectDiscard(Snapsync.ensureCurrent),
  Cluster.jobs,
  Mail.layerMailer,
  Mail.reminders,
  SlackChannel.layer,
  SlackChannel.deadlines,
).pipe(
  Layer.provideMerge(Attendance.layer),
  Layer.provideMerge(Mail.layerNotifications),
  Layer.provideMerge(SlackChannel.layerAnnouncements),
  Layer.provideMerge(Cluster.layer),
  Layer.provideMerge(Database.layer),
);
