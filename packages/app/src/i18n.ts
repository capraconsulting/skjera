import { defaultSiteName, type Site } from "@skjera/documents/api";
import {
  baseLocale,
  defineCustomClientStrategy,
  getLocale,
  isLocale,
  type Locale,
  setLocale,
} from "@skjera/i18n/runtime";
import { runRequest } from "./site/client.ts";

// The interface's language: the one picked here (a cookie), else the site's
// (SITE_LOCALE, from /api/site), else English. Picking one reloads the page
// in it. Event content is in whatever language it was written in.

let site: Site = {
  name: defaultSiteName,
  locale: baseLocale,
  privacy: { operator: defaultSiteName },
};

defineCustomClientStrategy("custom-site", {
  getLocale: () => site.locale,
  // The site's stays: a pick goes in the cookie.
  setLocale: () => {},
});

/** Loads the site's name and language: before the first render. */
export const loadSite = async () => {
  try {
    const loaded = await runRequest((client) => client.site.settings());
    if (isLocale(loaded.locale)) site = loaded;
  } catch {
    // Offline or failing: English, and the name it was built with.
  }
  document.documentElement.lang = getLocale();
  document.title = site.name;
};

/** The site as configured: its name, logo, footer and privacy. */
export const currentSite = () => site;

/** The languages, each named in itself. */
export const languages: ReadonlyArray<{ locale: Locale; name: string }> = [
  { locale: "en", name: "English" },
  { locale: "nb", name: "Bokmål" },
  { locale: "nn", name: "Nynorsk" },
];

export { setLocale };
