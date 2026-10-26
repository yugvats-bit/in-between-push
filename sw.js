// Service worker: receives pushes and shows them, even with the screen locked.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { title: event.data && event.data.text() }; }
  const title = data.title || "Seen.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: "in-between",      // replaces the previous one…
      renotify: true,         // …but still buzzes every time
      vibrate: [120, 80, 120],
      silent: false,
      data: { url: data.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(url);
    })
  );
});
