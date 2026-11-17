# Trail Prep: notes for Claude Code

Free, offline-ready hike planner built by Suhitha (GitHub: suhibug). Plain HTML, CSS and JavaScript. No build step, no framework, no backend, no paid services.

## Files
- `index.html`: the page and form
- `app.js`: page logic: place search, forecast fetch, rendering, saved trips (localStorage)
- `calc.js`: all estimate math as pure functions (time, water, food, daylight, gear, warnings)
- `sw.js`: service worker. Network-first (online always gets the newest files), falls back to the saved copy offline. Bump `CACHE` when the file list changes.
- `manifest.webmanifest`, `icon.svg`: lets phones install it to the home screen
- `tools/hike-stats.mjs`: reads every GPX in `hike-data/` and writes `hike-data/hike-stats.csv` (start, top, finish times, distance, climbing, rest at top). Run: `node tools/hike-stats.mjs hike-data`. Used to check the estimates against real hikes from the survey.

## Rules
- Keep it free: only free, keyless APIs (Open-Meteo for weather and geocoding). No accounts, no API keys, no paid hosting.
- Keep it simple to read. Suhitha is learning; prefer clear code and short comments over clever code.
- Every estimate is labeled a rough guide. Never present a number as a safety guarantee.
- Usage counting: GoatCounter (dashboard trailprep.goatcounter.com) and Google Analytics 4 (ID in `analytics.js`, same property as the portfolio) via `track()` in app.js. Count actions and state/country only, never exact trails, places, or dates. No session recording tools (like Clarity) here, since people type trail names.
- Never commit the raw survey CSV or anyone's GPX files (names, routes and times are personal). `hike-data/`, `*.gpx` and `*.csv` are gitignored. Only share totals.
- Test with `python3 -m http.server 8000` and open http://localhost:8000.
