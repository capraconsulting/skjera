import { useEffect } from "react";
import { currentSite } from "./i18n.ts";

/** The pages with a tab title of their own; the rest show the site's name. */
export type TitledPage =
  | { readonly page: "front" }
  | { readonly page: "event"; readonly title: string }
  | { readonly page: "privacy"; readonly heading: string };

/**
 * The browser tab's title, as Skjer has it: the front page names the site
 * and its companies, an event's page is the event's title, and the privacy
 * page is named before the site.
 */
export const pageTitle = (
  page: TitledPage,
  siteName: string,
  siteDescription?: string,
) => {
  switch (page.page) {
    case "front":
      return siteDescription ?? siteName;
    case "event":
      return page.title.trim() === "" ? siteName : page.title;
    case "privacy":
      return `${page.heading} | ${siteName}`;
  }
};

/** Shows the page's title in the tab while it's open, then the site's name. */
export function usePageTitle(page: TitledPage) {
  const site = currentSite();
  const title = pageTitle(page, site.name, site.description);
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = currentSite().name;
    };
  }, [title]);
}
