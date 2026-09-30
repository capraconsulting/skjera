import wasmUrl from "@automerge/automerge/automerge.wasm?url";
import { initializeWasm } from "@automerge/automerge/slim";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, redirect } from "react-router";
import { RouterProvider } from "react-router/dom";
import { Layout, layoutLoader } from "./routes/Layout.tsx";
import { Playground } from "./routes/Playground.tsx";
import { PostEditor } from "./routes/PostEditor.tsx";
import { createPostAction, Posts, postsLoader } from "./routes/Posts.tsx";
import "./styles.css";

// The slim build loads Automerge's WebAssembly explicitly, so Vite needs no
// wasm plugin. @automerge/prosemirror imports the same slim entry point.
await initializeWasm(wasmUrl);

const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    loader: layoutLoader,
    children: [
      { index: true, loader: () => redirect("/posts") },
      {
        path: "posts",
        Component: Posts,
        loader: postsLoader,
        action: createPostAction,
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
