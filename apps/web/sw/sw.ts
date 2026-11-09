// The service worker. For now it only keeps the app's shell (HTML, JS,
// CSS, icons) so the installed app opens fast and offline. It never
// caches the API: stale balances are worse than "Sem conexão" when the
// numbers are money. Push notifications come here later in block 5.
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  /** The built files, injected by vite-plugin-pwa at build time. */
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// A single-page app: every page of the app (/, /convite/...) is the same
// index.html. /api and the old prototype are not the app, so they always
// go to the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/prototipo/],
  }),
);

// A new version takes over at once instead of waiting for every tab of
// the old one to close (registerType "autoUpdate" in vite.config.ts).
void self.skipWaiting();
clientsClaim();
