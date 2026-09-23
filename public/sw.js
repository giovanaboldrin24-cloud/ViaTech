// Service worker: recebe as notificações push e mantém o "casco" do app em cache.
const CACHE = "rotina-v1";
const SHELL = ["/", "/app.css", "/app.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  // Rede primeiro (para sempre ter a versão nova), cache como reserva offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Rotina", body: event.data?.text() }; }
  const options = {
    body: data.body || "",
    tag: data.tag,
    renotify: Boolean(data.tag),
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url || "/", key: data.key || "" },
    actions: data.actions || [],
    requireInteraction: Boolean(data.key),
  };
  event.waitUntil(self.registration.showNotification(data.title || "Rotina", options));
});

self.addEventListener("notificationclick", (event) => {
  const { url, key } = event.notification.data || {};
  event.notification.close();
  if (key && (event.action === "done" || event.action === "skip")) {
    event.waitUntil(fetch("/api/complete", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, status: event.action === "done" ? "done" : "skipped" }),
    }).catch(() => {}));
    return;
  }
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === location.origin) {
        await client.focus();
        client.postMessage({ type: "navigate", url });
        return;
      }
    }
    await self.clients.openWindow(url || "/");
  })());
});
