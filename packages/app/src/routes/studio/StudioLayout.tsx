import { m } from "@skjera/i18n/messages";
import { NavLink, Outlet, useLoaderData } from "react-router";
import { Shell } from "../../components/Shell.tsx";
import { SubscribeLink } from "../../components/SubscribeLink.tsx";
import { UserMenu } from "../../components/UserMenu.tsx";
import { setLocalUser } from "../../documents/repo.ts";
import { requireMe } from "../../site/client.ts";

/** Loads the signed-in user, sending the browser to log in if there is none. */
export async function studioLoader({ request }: { request: Request }) {
  const me = await requireMe(request);
  setLocalUser(me);
  return me;
}

/** The backoffice: creating, editing and publishing content. */
export function StudioLayout() {
  const me = useLoaderData<typeof studioLoader>();
  return (
    <Shell
      fill
      links={<NavLink to="/studio">{m.common_studio()}</NavLink>}
      actions={
        <>
          <SubscribeLink />
          <UserMenu me={me} />
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}
