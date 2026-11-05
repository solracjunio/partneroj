// Service worker for the smoke test. The push has no payload, so the text is fixed.
/* global self, clients */

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("Partneroj", {
      body: "O aviso de teste chegou! 🎉",
      tag: "smoke-test",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
