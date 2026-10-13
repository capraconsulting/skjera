import { m } from "@skjera/i18n/messages";
import { LogIn } from "lucide-react";
import { NavLink, Outlet, useLoaderData } from "react-router";
import { Shell } from "../../components/Shell.tsx";
import { SubscribeLink } from "../../components/SubscribeLink.tsx";
import { UserMenu } from "../../components/UserMenu.tsx";
import { currentSite } from "../../i18n.ts";
import { fetchMe, loginUrl } from "../../site/client.ts";
import { loadHubSpot } from "../../site/hubSpot.ts";

export const siteLoader = () => {
  const { hubSpot } = currentSite();
  if (hubSpot !== undefined) loadHubSpot(hubSpot);
  return fetchMe();
};

/** The public site. Anyone can read it; signing in leads to the studio. */
export function SiteLayout() {
  const me = useLoaderData<typeof siteLoader>();
  return (
    <Shell
      links={
        me === null ? null : <NavLink to="/studio">{m.common_studio()}</NavLink>
      }
      actions={
        me === null ? (
          <a href={loginUrl("/studio")}>
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
