import dns from "node:dns";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Make Vite print http://localhost:5173 rather than the address localhost
// resolves to. The OAuth callback is on localhost, and the login cookie only
// comes back to the host it was set on, so 127.0.0.1 would break logging in.
dns.setDefaultResultOrder("verbatim");

// The backend (packages/server). Same origin for the browser, so the session
// cookie and the login redirect just work. The port stays 5173 for `vite
// preview` too, because the OAuth callback URL points there.
const backend = {
  port: 5173,
  strictPort: true,
  proxy: {
    "/auth": "http://localhost:3000",
    "/api": "http://localhost:3000",
    "/site-assets": "http://localhost:3000",
    "/automerge": { target: "ws://localhost:3000", ws: true },
  },
};

export default defineConfig({
  plugins: [react()],
  server: backend,
  preview: backend,
});
