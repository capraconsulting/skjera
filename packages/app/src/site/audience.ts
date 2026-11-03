import type { EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";

/** Whether guests can sign up, in the words of a front-page row and of the event's page. */
export const audience = (
  event: Pick<EventRow, "allowGuests">,
): { readonly badge: string; readonly page: string } =>
  event.allowGuests
    ? { badge: m.site_badge_open_to_all(), page: m.site_open_to_all() }
    : { badge: m.site_badge_internal_only(), page: m.site_internal_only() };
