import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Same-origin API in development: the browser talks only to :5173, so the
    // session cookie and the CSRF token behave exactly as behind the
    // production reverse proxy. The backend serves everything under /api.
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  // `vite preview` serves the built dist on the same address and reuses
  // server.proxy, so run_frontend_prod.bat is a drop-in for the dev server.
  preview: {
    host: true,
    port: 5173,
  },
});
