import dns from "node:dns";
import { serverRoutePrefixesFor } from "@skjera/server/routes";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Make Vite print http://localhost:5173 rather than the address localhost
// resolves to. The OAuth callback is on localhost, and the login cookie only
// comes back to the host it was set on, so 127.0.0.1 would break logging in.
dns.setDefaultResultOrder("verbatim");

// The backend (packages/server). Same origin for the browser, so the session
// cookie and the login redirect just work. The port stays 5173 for `vite
// preview` too, because the OAuth callback URL points there.
export const backendProxy = Object.fromEntries(
  serverRoutePrefixesFor(process.env.OAUTH_REDIRECT_URI).map((path) => [
    path,
    path === "/automerge"
      ? { target: "ws://localhost:3000", ws: true }
      : "http://localhost:3000",
  ]),
);

const backend = {
  port: 5173,
  strictPort: true,
  proxy: backendProxy,
};

/**
 * Whether the app has the /playground page, which is for developers: always
 * on the dev server, and in a build only with SKJERA_PLAYGROUND=true, which
 * `pnpm test-server` sets. The image's build leaves it out.
 */
export const includesPlayground = (
  command: "build" | "serve",
  env: Readonly<Record<string, string | undefined>>,
): boolean => command === "serve" || env.SKJERA_PLAYGROUND === "true";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: backend,
  preview: backend,
  define: {
    "import.meta.env.PLAYGROUND": JSON.stringify(
      includesPlayground(command, process.env),
    ),
  },
}));
