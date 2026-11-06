import type { EventContent, Site } from "@skjera/documents/api";

/**
 * Whether the studio offers the sales event setting: only on a site that
 * sends to HubSpot, and for a public event open to guests, as publishing
 * makes a sales event of no other.
 */
export const salesEventOffered = (
  site: Pick<Site, "salesEvents">,
  draft: Pick<EventContent, "public" | "guests">,
): boolean => site.salesEvents === true && draft.public && draft.guests;
