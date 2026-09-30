import type { Identity } from "@skjera/oauth/api";
import { Link, Outlet, useLoaderData } from "react-router";

/** Loads the signed-in user, sending the browser to log in if there is none. */
export async function layoutLoader({ request }: { request: Request }) {
  const response = await fetch("/api/me");
  if (response.status === 401) {
    const url = new URL(request.url);
    window.location.assign(
      `/auth/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`,
    );
    return new Promise<never>(() => {});
  }
  if (!response.ok) {
    throw new Error(`Could not load the session (${response.status})`);
  }
  return (await response.json()) as Identity;
}

export function Layout() {
  const me = useLoaderData<typeof layoutLoader>();
  return (
    <div className="layout">
      <header className="header">
        <nav>
          <Link to="/posts">Posts</Link>
        </nav>
        <div className="user">
          <span data-testid="me">{me.email ?? me.name ?? me.subject}</span>
          <form method="post" action="/auth/logout">
            <button type="submit">Log out</button>
          </form>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
