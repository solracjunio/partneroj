import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Same shape as production, where Caddy serves the page and /api on one
// origin: the SameSite=Strict session cookie then works here too, with no
// CORS. The prefix is cut, as Caddy's handle_path does.
const apiProxy = {
  "/api": {
    target: "http://localhost:3000",
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [
    react(),
    // The installable app (plan section 5). injectManifest: the service
    // worker is ours (sw/sw.ts); the plugin only injects the list of
    // built files into it. Push (later in block 5) needs our own code
    // there, which generateSW would not allow.
    VitePWA({
      strategies: "injectManifest",
      srcDir: "sw",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Partneroj",
        short_name: "Partneroj",
        description: "Gestão para sócios",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#10233f",
        icons: [
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // The glob already takes the icons; adding them again would list
      // each one twice in the precache.
      includeManifestIcons: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png}"],
      },
    }),
  ],
  // `vite` (development) and `vite preview` (the built app, with the
  // service worker) both proxy /api.
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
});
