import wasmUrl from "@automerge/automerge/automerge.wasm?url";
import { initializeWasm } from "@automerge/automerge/slim";
import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Loading } from "./components/Loading.tsx";
import { loadSite } from "./i18n.ts";
import { Account, accountLoader } from "./routes/account/Account.tsx";
import { Privacy } from "./routes/privacy/Privacy.tsx";
import {
  EventError,
  EventPage,
  eventLoader,
} from "./routes/site/EventPage.tsx";
import { Home, homeLoader } from "./routes/site/Home.tsx";
import {
  LoginFailed,
  loginFailedRedirect,
} from "./routes/site/LoginFailed.tsx";
import { SiteLayout, siteLoader } from "./routes/site/SiteLayout.tsx";
import { EventEditor } from "./routes/studio/EventEditor.tsx";
import { StudioLayout, studioLoader } from "./routes/studio/StudioLayout.tsx";
import {
  NoEventSelected,
  Team,
  TeamError,
  teamLoader,
} from "./routes/studio/Team.tsx";
import { NoTeamSelected, Teams, teamsLoader } from "./routes/studio/Teams.tsx";
import "@fontsource-variable/inter";
import "./global.css";

// The slim build loads Automerge's WebAssembly explicitly, so Vite needs no
// wasm plugin. @automerge/prosemirror imports the same slim entry point.
await initializeWasm(wasmUrl);
// The site's name and language, before anything shows.
await loadSite();

/** Around every page: state kept in the URL's query, with nuqs. */
const Root = () => (
  <NuqsAdapter>
    <Outlet />
  </NuqsAdapter>
);

const router = createBrowserRouter([
  {
    Component: Root,
    HydrateFallback: Loading,
    children: [
      // The public site: published content, no login needed.
      {
        id: "site",
        path: "/",
        Component: SiteLayout,
        loader: siteLoader,
        HydrateFallback: Loading,
        children: [
          { index: true, Component: Home, loader: homeLoader },
          {
            path: "events/:id",
            Component: EventPage,
            loader: eventLoader,
            ErrorBoundary: EventError,
          },
          // The signed-in user's own settings.
          { path: "account", Component: Account, loader: accountLoader },
          { path: "privacy", Component: Privacy },
          // A failed login, which the server answers at the address of
          // OAUTH_REDIRECT_URI: the path must be the same.
          { path: "auth/callback", loader: loginFailedRedirect },
          { path: "login-failed", Component: LoginFailed },
        ],
      },
      // The studio: everything else, behind login. Its columns nest: teams,
      // then the selected team's events, then the selected event.
      {
        path: "/studio",
        Component: StudioLayout,
        loader: studioLoader,
        shouldRevalidate: () => false,
        HydrateFallback: Loading,
        children: [
          { index: true, loader: () => redirect("/studio/teams") },
          {
            path: "teams",
            Component: Teams,
            // Only waits for the synced tables; the list itself is live.
            loader: teamsLoader,
            shouldRevalidate: () => false,
            children: [
              { index: true, Component: NoTeamSelected },
              {
                path: ":teamId",
                Component: Team,
                loader: teamLoader,
                ErrorBoundary: TeamError,
                children: [
                  { index: true, Component: NoEventSelected },
                  { path: "events/:id", Component: EventEditor },
                ],
              },
            ],
          },
        ],
      },
      // Two local replicas syncing with each other, no server or login needed.
      // For developers: only in `pnpm dev` and test servers (vite.config.ts),
      // and loaded on its own, so other builds leave it out entirely.
      ...(import.meta.env.PLAYGROUND
        ? [
            {
              path: "/playground",
              lazy: async () => ({
                Component: (await import("./routes/Playground.tsx")).Playground,
              }),
            },
          ]
        : []),
    ],
  },
]);

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
