import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { LogIn } from "lucide-react";
import type { MouseEvent } from "react";
import { NavLink, Outlet, useLoaderData, useLocation } from "react-router";
import { Shell } from "../../components/layout/Shell.tsx";
import { SubscribeLink } from "../../components/menus/SubscribeLink.tsx";
import { UserMenu } from "../../components/menus/UserMenu.tsx";
import { currentSite } from "../../i18n.ts";
import { fetchMe, loginUrl } from "../../site/client.ts";
import { loadHubSpot } from "../../site/hubSpot.ts";
import { loginReturnFrom } from "../../site/loginFailure.ts";

export const siteLoader = () => {
  const { hubSpot } = currentSite();
  if (hubSpot !== undefined) loadHubSpot(hubSpot);
  return fetchMe();
};

/** Points the log-in link at the page's address as it is right now. */
const pointAtCurrentAddress = (event: MouseEvent<HTMLAnchorElement>) => {
  event.currentTarget.href = loginUrl(loginReturnFrom(window.location));
};

/** The public site. Anyone can read it; logging in comes back to the page. */
export function SiteLayout() {
  const me = useLoaderData<typeof siteLoader>();
  const here = useLocation();
  return (
    <Shell
      links={
        me === null ? null : (
          <NavLink to={appPaths.studio}>{m.common_studio()}</NavLink>
        )
      }
      actions={
        me === null ? (
          <a
            href={loginUrl(loginReturnFrom(here))}
            // The front page's filters change the address without the
            // router: take it as it is when the link is used, whether by a
            // click, a middle-click or the context menu's "open in new tab".
            onClick={pointAtCurrentAddress}
            onAuxClick={pointAtCurrentAddress}
            onContextMenu={pointAtCurrentAddress}
          >
            {m.common_log_in()}
            <LogIn size={16} strokeWidth={1.5} aria-hidden="true" />
          </a>
        ) : (
          <>
            <SubscribeLink />
            <UserMenu me={me} />
          </>
        )
      }
    >
      <Outlet />
    </Shell>
  );
}
