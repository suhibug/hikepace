// Saves the app's files on the phone so Trail Prep opens without signal.
// Online, it always loads the newest version; offline, it uses the saved copy.
const CACHE = "trail-prep-v5";
const FILES = ["./", "./index.html", "./style.css", "./app.js", "./calc.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  // "reload" skips the browser's short-term cache so we save the newest files, not old ones.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))));
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
  // Try the network first so updates show up right away, and refresh the saved copy.
  // With no signal, fall back to the saved copy.
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
