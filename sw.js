// Saves the app's files on the phone so Trail Prep opens without signal.
// Bump the version whenever any of these files change, so phones pick up the update.
const CACHE = "trail-prep-v1";
const FILES = ["./", "./index.html", "./style.css", "./app.js", "./calc.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Weather and place search always go to the network; saved trips cover offline use.
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
