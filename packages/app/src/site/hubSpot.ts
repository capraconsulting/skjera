import type { Site } from "@skjera/documents/api";

const loader = "hs-script-loader";

/** Loads HubSpot's script for the account from its EU servers, once per page. */
export const loadHubSpot = (account: string) => {
  if (hasHubSpot()) return;
  const script = document.createElement("script");
  script.id = loader;
  script.async = true;
  script.defer = true;
  script.src = `https://js-eu1.hs-scripts.com/${account}.js`;
  document.head.append(script);
};

/**
 * Whether data reaches HubSpot: the site loads its script (an account is
 * set), or sends the sign-ups to sales events from the server.
 */
export const sharesWithHubSpot = (
  site: Pick<Site, "hubSpot" | "salesEvents">,
): boolean =>
  (site.hubSpot !== undefined && site.hubSpot !== "") ||
  site.salesEvents === true;

/** This page has loaded HubSpot: it runs until the page is left. */
export const hasHubSpot = () => document.getElementById(loader) !== null;

/** Opens HubSpot's cookie banner; HubSpot reads the queue when it starts. */
export const showCookieSettings = () => {
  const queued = window as { _hsp?: unknown[] };
  queued._hsp = queued._hsp ?? [];
  queued._hsp.push(["showBanner"]);
};

/**
 * Shows `url` in a page of its own, without what this one has loaded: from a
 * loader, like `requireMe`. Back and Forward have already moved the address.
 */
export const loadAfresh = (url: string): Promise<never> => {
  if (window.location.href === url) window.location.reload();
  else window.location.assign(url);
  return new Promise<never>(() => {});
};
