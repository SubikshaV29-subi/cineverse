
/* CineVerse Service Worker */

self.addEventListener("install", (event) => {
  // Activate the new service worker without waiting for old tabs.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Allow this service worker to control open CineVerse pages.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Handle only GET requests.
  if (event.request.method !== "GET") {
    return;
  }

  // Network-only strategy:
  // Always request fresh content from the CineVerse server.
  // This avoids caching movie data or account responses.
  event.respondWith(
    fetch(event.request).catch(() => {
      // Let the browser handle the network failure normally.
      return Response.error();
    })
  );
});
