import { NavLink, Outlet, useLoaderData } from "react-router";
import { Shell } from "../../components/Shell.tsx";
import { SignedIn } from "../../components/SignedIn.tsx";
import { fetchMe, loginUrl } from "../../site/client.ts";

/** Loads the signed-in user, sending the browser to log in if there is none. */
export async function studioLoader({ request }: { request: Request }) {
  const me = await fetchMe();
  if (me === null) {
    const url = new URL(request.url);
    window.location.assign(loginUrl(url.pathname + url.search));
    return new Promise<never>(() => {});
  }
  return me;
}

/** The backoffice: creating, editing and publishing content. */
export function StudioLayout() {
  const me = useLoaderData<typeof studioLoader>();
  return (
    <Shell
      links={<NavLink to="/studio/teams">Teams</NavLink>}
      actions={<SignedIn me={me} />}
    >
      <Outlet />
    </Shell>
  );
}
