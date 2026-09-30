import type { DocumentId, TeamId } from "@skjera/documents/api";
import { useEffect } from "react";
import { NavLink, Outlet, useLoaderData, useParams } from "react-router";
import { Shell } from "../../components/Shell.tsx";
import { SignedIn } from "../../components/SignedIn.tsx";
import { presence, startPresence } from "../../presence/presence.ts";
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
  const { teamId, id } = useParams();

  // Presence runs while the studio is open, and follows the selection.
  useEffect(() => startPresence(), []);
  useEffect(() => {
    presence.setLocation(
      teamId === undefined
        ? null
        : {
            teamId: teamId as TeamId,
            documentId: (id ?? null) as DocumentId | null,
          },
    );
  }, [teamId, id]);

  return (
    <Shell
      fill
      links={<NavLink to="/studio/teams">Studio</NavLink>}
      actions={<SignedIn me={me} />}
    >
      <Outlet />
    </Shell>
  );
}
