import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The backend (packages/server). Same origin for the browser, so the session
// cookie and the login redirect just work. The port stays 5173 for `vite
// preview` too, because the OAuth callback URL points there.
const backend = {
  port: 5173,
  strictPort: true,
  proxy: {
    "/auth": "http://localhost:3000",
    "/api": "http://localhost:3000",
    "/rpc": { target: "ws://localhost:3000", ws: true },
  },
};

export default defineConfig({
  plugins: [react()],
  server: backend,
  preview: backend,
});
