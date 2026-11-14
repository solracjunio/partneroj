// The service worker. For now it only keeps the app's shell (HTML, JS,
// CSS, icons) so the installed app opens fast and offline. It never
// caches the API: stale balances are worse than "Sem conexão" when the
// numbers are money. It also shows the push notifications (plan section 4).
import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

import { clickTarget, notificationFrom } from "./notification";

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

// A push from the worker. The notification must be shown before the event
// ends (waitUntil), or Chrome counts the push as silent.
self.addEventListener("push", (event) => {
  const { title, options } = notificationFrom(event.data?.text() ?? null);
  event.waitUntil(self.registration.showNotification(title, options));
});

// A tap on it: the app's window if one is open, a new one if not.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = clickTarget(event.notification.data);
  event.waitUntil(openApp(url));
});

async function openApp(url: string): Promise<void> {
  const [open] = await self.clients.matchAll({ type: "window" });
  if (open === undefined) {
    await self.clients.openWindow(url);
    return;
  }
  await open.focus();
  await open.navigate(url);
}
