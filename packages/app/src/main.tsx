import wasmUrl from "@automerge/automerge/automerge.wasm?url";
import { initializeWasm } from "@automerge/automerge/slim";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Playground } from "./routes/Playground.tsx";
import { Home, homeLoader } from "./routes/site/Home.tsx";
import { Post, PostError, postLoader } from "./routes/site/Post.tsx";
import { SiteLayout, siteLoader } from "./routes/site/SiteLayout.tsx";
import { PostEditor } from "./routes/studio/PostEditor.tsx";
import { StudioLayout, studioLoader } from "./routes/studio/StudioLayout.tsx";
import { Team, teamAction, teamLoader } from "./routes/studio/Team.tsx";
import {
  createTeamAction,
  Teams,
  teamsLoader,
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
    children: [
      { index: true, Component: Home, loader: homeLoader },
      {
        path: "posts/:id",
        Component: Post,
        loader: postLoader,
        ErrorBoundary: PostError,
      },
    ],
  },
  // The studio: everything else, behind login.
  {
    path: "/studio",
    Component: StudioLayout,
    loader: studioLoader,
    children: [
      { index: true, loader: () => redirect("/studio/teams") },
      {
        path: "teams",
        Component: Teams,
        loader: teamsLoader,
        action: createTeamAction,
      },
      {
        path: "teams/:teamId",
        Component: Team,
        loader: teamLoader,
        action: teamAction,
      },
      { path: "posts/:id", Component: PostEditor },
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
