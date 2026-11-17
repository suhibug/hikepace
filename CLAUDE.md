# Trail Prep: notes for Claude Code

Free, offline-ready hike planner built by Suhitha (GitHub: suhibug). Plain HTML, CSS and JavaScript. No build step, no framework, no backend, no paid services.

## Files
- `index.html`: the page and form
- `app.js`: page logic: place search, forecast fetch, rendering, saved trips (localStorage)
- `calc.js`: all estimate math as pure functions (time, water, food, daylight, gear, warnings)
- `sw.js`: service worker. Network-first (online always gets the newest files), falls back to the saved copy offline. Bump `CACHE` when the file list changes.
- `manifest.webmanifest`, `icon.svg`: lets phones install it to the home screen

## Rules
- Keep it free: only free, keyless APIs (Open-Meteo for weather and geocoding). No accounts, no API keys, no paid hosting.
- Keep it simple to read. Suhitha is learning; prefer clear code and short comments over clever code.
- Every estimate is labeled a rough guide. Never present a number as a safety guarantee.
- Usage counting: GoatCounter (dashboard trailprep.goatcounter.com) via `track()` in app.js. Count actions and state/country only, never exact trails, places, or dates.
- Never commit the raw survey CSV (it has respondents' names). Only share totals.
- Test with `python3 -m http.server 8000` and open http://localhost:8000.
