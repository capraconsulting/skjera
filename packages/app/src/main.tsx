import wasmUrl from "@automerge/automerge/automerge.wasm?url";
import { initializeWasm } from "@automerge/automerge/slim";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Loading } from "./components/Loading.tsx";
import { Playground } from "./routes/Playground.tsx";
import {
  EventError,
  EventPage,
  eventLoader,
} from "./routes/site/EventPage.tsx";
import { Home, homeLoader } from "./routes/site/Home.tsx";
import { SiteLayout, siteLoader } from "./routes/site/SiteLayout.tsx";
import { EventEditor } from "./routes/studio/EventEditor.tsx";
import { StudioLayout, studioLoader } from "./routes/studio/StudioLayout.tsx";
import {
  NoEventSelected,
  Team,
  teamAction,
  teamLoader,
} from "./routes/studio/Team.tsx";
import {
  createTeamAction,
  NoTeamSelected,
  Teams,
  teamsLoader,
  teamsShouldRevalidate,
} from "./routes/studio/Teams.tsx";
import "./global.css";

// The slim build loads Automerge's WebAssembly explicitly, so Vite needs no
// wasm plugin. @automerge/prosemirror imports the same slim entry point.
await initializeWasm(wasmUrl);

const router = createBrowserRouter([
  // The public site: published content, no login needed.
  {
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
        loader: teamsLoader,
        shouldRevalidate: teamsShouldRevalidate,
        action: createTeamAction,
        children: [
          { index: true, Component: NoTeamSelected },
          {
            path: ":teamId",
            Component: Team,
            loader: teamLoader,
            action: teamAction,
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
  { path: "/playground", Component: Playground },
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
