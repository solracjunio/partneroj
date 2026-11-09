import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Same shape as production, where Caddy serves the page and /api on
    // one origin: the SameSite=Strict session cookie then works here too,
    // with no CORS. The prefix is cut, as Caddy's handle_path does.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
