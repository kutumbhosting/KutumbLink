// Deliberately minimal: caches only the app shell (this page + manifest),
// never the /api/* calls, since check-in must always hit the live server.
const CACHE = "kutumb-checkin-shell-v2";
const SHELL_FILES = ["/checkin-app/", "/checkin-app/index.html", "/checkin-app/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache API calls or anything cross-origin (e.g. the QR library CDN).
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) return;
  if (!SHELL_FILES.includes(url.pathname)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
