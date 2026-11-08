import * as Snapsync from "@skjera/snapsync/server";
import { Layer } from "effect";
import { Attendance } from "./attendance/Attendance.ts";
import { Invitations } from "./attendance/Invitations.ts";
import * as SignupRetention from "./attendance/SignupRetention.ts";
import { DocumentEvents } from "./events/DocumentEvents.ts";
import { Documents } from "./events/Documents.ts";
import { Presence } from "./events/Presence.ts";
import * as Recurring from "./events/Recurring.ts";
import { SiteSettings } from "./Model.ts";
import * as HubSpotSync from "./notices/HubSpotSync.ts";
import * as Mail from "./notices/Mail.tsx";
import { OrganizerEmails } from "./notices/OrganizerEmails.ts";
import * as SlackChannel from "./notices/SlackChannel.ts";
import * as Cluster from "./server/Cluster.ts";
import * as Database from "./server/Database.ts";
import { Sync } from "./server/Sync.ts";
import { Teams } from "./Teams.ts";

export * from "./api/DocumentsApi.ts";
export * from "./api/errors.ts";
export * from "./api/ImagesApi.ts";
export * from "./api/Problems.ts";
export * from "./api/PublicApi.ts";
export * from "./api/SyncApi.ts";
export * from "./api/TeamsApi.ts";
export * from "./attendance/Attendance.ts";
export * from "./attendance/Invitations.ts";
export * from "./events/ContentTypes.ts";
export * from "./events/DocumentEvents.ts";
export * from "./events/Documents.ts";
export * as DraftSync from "./events/DraftSync.ts";
export * from "./events/DraftSyncProtocol.ts";
export * as Images from "./events/Images.ts";
export * from "./events/Presence.ts";
export * as Recurring from "./events/Recurring.ts";
export * from "./Model.ts";
export * from "./notices/Announcements.ts";
export * as HubSpotSync from "./notices/HubSpotSync.ts";
export * as Mail from "./notices/Mail.tsx";
export * from "./notices/Notifications.ts";
export * from "./notices/OrganizerEmails.ts";
export * from "./notices/SalesEvents.ts";
export * as SlackChannel from "./notices/SlackChannel.ts";
export * from "./server/ApiHandlers.ts";
export * as Cluster from "./server/Cluster.ts";
export * as Database from "./server/Database.ts";
export * from "./server/SignupLimits.ts";
export * from "./server/Sync.ts";
export * as CalendarFeed from "./site/CalendarFeed.ts";
export * as Embed from "./site/Embed.ts";
export * as Manifest from "./site/Manifest.ts";
export * as PublicEvents from "./site/PublicEvents.ts";
export * as Sharing from "./site/Sharing.ts";
export { loginFailurePage } from "./site/Sharing.ts";
export * from "./Teams.ts";

/**
 * Teams, documents, their change events, attendance and syncing them, on the
 * database at `DATABASE_URL`, with the cluster running their background
 * work and emails. Needs `Crypto` and `Email`.
 */
export const layer = Layer.mergeAll(
  Documents.layer,
  DocumentEvents.layer,
  Teams.layer,
  Invitations.layer,
  OrganizerEmails.layer,
  Presence.layer,
  Sync.layer,
  // After a restore, clients start over: before serving pulls.
  Layer.effectDiscard(Snapsync.ensureCurrent),
  Cluster.jobs,
  Mail.layerMailer,
  Mail.reminders,
  SignupRetention.job,
  Recurring.job,
  SlackChannel.layer,
  SlackChannel.deadlines,
  HubSpotSync.layer,
).pipe(
  Layer.provideMerge(Attendance.layer),
  Layer.provideMerge(HubSpotSync.layerSalesEvents),
  Layer.provideMerge(Mail.layerNotifications),
  Layer.provideMerge(SlackChannel.layerAnnouncements),
  Layer.provideMerge(Cluster.layer),
  Layer.provideMerge(SiteSettings.layer),
  Layer.provideMerge(Database.layer),
);
