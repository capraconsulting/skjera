import { Link, Outlet, useLoaderData } from "react-router";
import { Shell } from "../../components/Shell.tsx";
import { fetchMe, loginUrl } from "../../site/client.ts";

export const siteLoader = () => fetchMe();

/** The public site. Anyone can read it; signing in leads to the studio. */
export function SiteLayout() {
  const me = useLoaderData<typeof siteLoader>();
  return (
    <Shell
      brand={{ to: "/", label: "Skjera" }}
      actions={
        me === null ? (
          <a href={loginUrl("/studio")}>Log in</a>
        ) : (
          <>
            <Link to="/studio">Studio</Link>
            <span data-testid="me">{me.email ?? me.name ?? me.subject}</span>
            <form method="post" action="/auth/logout">
              <button type="submit">Log out</button>
            </form>
          </>
        )
      }
    >
      <Outlet />
    </Shell>
  );
}
