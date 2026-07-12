const CACHE_NAME = "carnet-mipc-v2";
const ASSETS = [
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];
 
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});
 
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
 
self.addEventListener("fetch", (event) => {
  // Never cache GitHub API calls — always go to network for data.
  if (event.request.url.includes("api.github.com")) return;
 
  // Network-first pour le shell de l'app : une mise à jour du code est prise en
  // compte dès le prochain chargement, sans attendre un changement de CACHE_NAME.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
 
