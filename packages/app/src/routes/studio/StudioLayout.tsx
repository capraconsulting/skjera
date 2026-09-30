import { Link, Outlet, useLoaderData } from "react-router";
import { Shell } from "../../components/Shell.tsx";
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
      brand={{ to: "/studio/posts", label: "Skjera Studio" }}
      links={<Link to="/">View site</Link>}
      actions={
        <>
          <span data-testid="me">{me.email ?? me.name ?? me.subject}</span>
          <form method="post" action="/auth/logout">
            <button type="submit">Log out</button>
          </form>
        </>
      }
    >
      <Outlet />
    </Shell>
  );
}
