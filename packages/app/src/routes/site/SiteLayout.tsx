import { m } from "@skjera/i18n/messages";
import { LogIn } from "lucide-react";
import { Link, Outlet, useLoaderData } from "react-router";
import { Shell } from "../../components/Shell.tsx";
import { SignedIn } from "../../components/SignedIn.tsx";
import { fetchMe, loginUrl } from "../../site/client.ts";

export const siteLoader = () => fetchMe();

/** The public site. Anyone can read it; signing in leads to the studio. */
export function SiteLayout() {
  const me = useLoaderData<typeof siteLoader>();
  return (
    <Shell
      actions={
        me === null ? (
          <a href={loginUrl("/studio")}>
            {m.common_log_in()}
            <LogIn size={16} strokeWidth={1.5} aria-hidden="true" />
          </a>
        ) : (
          <>
            <Link to="/studio">{m.common_studio()}</Link>
            <SignedIn me={me} />
          </>
        )
      }
    >
      <Outlet />
    </Shell>
  );
}
