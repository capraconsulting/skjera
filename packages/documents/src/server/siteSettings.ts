import { Effect } from "effect";
import { Site, SiteSettings } from "../Model.ts";
import * as HubSpotSync from "../notices/HubSpotSync.ts";
import * as Mail from "../notices/Mail.tsx";

/** The site's settings as the server answers them: the configured ones,
 *  with whether emails are sent and how sales events reach HubSpot. */
export const siteSettings = Effect.gen(function* () {
  const config = yield* SiteSettings;
  const sendsEmail = yield* Mail.emailsSent;
  const salesEvents = yield* HubSpotSync.configured;
  return Site.make({
    ...config,
    sendsEmail,
    ...(salesEvents ? { salesEvents } : {}),
  });
});
