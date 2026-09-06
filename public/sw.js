/* InHubFlow Web Push service worker for Live Chat & CRM alerts */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" ? data.title : "🔥 InHubFlow Live Chat";
  const options = {
    body: typeof data.body === "string" ? data.body : "Nuevo mensaje de prospecto web en la landing page",
    icon: "/logo-icon.png",
    badge: "/logo-icon.png",
    tag: typeof data.notificationId === "string" ? data.notificationId : "inhubflow-chat-" + Date.now(),
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 200],
    data: { href: typeof data.href === "string" ? data.href : "/live-chat" },
    actions: [
      { action: "open", title: "Abrir Chat" }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetHref = event.notification.data?.href || "/live-chat";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && client.url.includes("/live-chat") && "focus" in client) {
          if ("navigate" in client) {
            client.navigate(targetHref);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetHref);
      }
    })
  );
});
