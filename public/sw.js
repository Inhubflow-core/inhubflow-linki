/* InHubFlow Web Push service worker. Payloads contain only navigation metadata. */
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = typeof data.title === "string" ? data.title : "InHubFlow";
  const options = {
    body: typeof data.body === "string" ? data.body : "Tienes una notificación pendiente.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: typeof data.notificationId === "string" ? data.notificationId : "inhubflow-notification",
    renotify: true,
    requireInteraction: data.priority === "critical" || data.priority === "urgent",
    data: { href: typeof data.href === "string" ? data.href : "/inbox" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => "focus" in client);
      if (existing) {
        existing.navigate(href);
        return existing.focus();
      }
      return self.clients.openWindow(href);
    }),
  );
});
