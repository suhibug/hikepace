# hikepace: notes for Claude Code

Free, offline-ready hike planner built by Suhitha (GitHub: suhibug). Plain HTML, CSS and JavaScript. No build step, no framework, no backend, no paid services.

## Files
- `index.html`: the page and form
- `app.js`: page logic: place search, trail autofill, forecast fetch, rendering (sun bar, climb chart, camps), settings sheet, saved trips (localStorage)
- `trail.js`: searched trail → route points with elevation (Nominatim `polygon_geojson` + `dedupe=0` for the pieces, joined; Open-Meteo elevation, smoothed). Overpass helper also lives here.
- `places.js`: campsites/water near a route anywhere: `data/places` tiles first, else live Overpass, else Nominatim category search. BLM land lookup (US only).
- `units.js`: metric/imperial display. Internals stay miles/feet/°F; convert only at input/output.
- `calc.js`: all estimate math as pure functions (time, water, food, daylight, gear, warnings)
- `sw.js`: service worker. Network-first (online always gets the newest files), falls back to the saved copy offline. Bump `CACHE` when the file list changes.
- `manifest.webmanifest`, `icon.svg`: lets phones install it to the home screen
- `data/places/`: campsite, spring, water and trailhead tiles (half-degree squares) loaded by the "where to camp" feature. Built by `tools/fetch-open-data.mjs` (OpenStreetMap + Recreation.gov) then `tools/build-places.mjs`. Arizona tiles; other places go live through places.js.
- `tools/hike-stats.mjs`: reads every GPX in `hike-data/` and writes `hike-data/hike-stats.csv` (start, top, finish times, distance, climbing, rest at top). Run: `node tools/hike-stats.mjs hike-data`. Used to check the estimates against real hikes from the survey.

## Rules
- Keep it free: only free, keyless APIs in the app (Open-Meteo, OpenStreetMap, the BLM land map). No accounts, no API keys in the app, no paid hosting. The one key (Recreation.gov RIDB) is used only by `tools/fetch-open-data.mjs` on Suhitha's computer and lives in `hike-data/.keys` (gitignored).
- Every file and function gets a short plain-English note on what it does, and the README's "What each file does" table stays current.
- Pace presets in calc.js come from the Nov 2026 survey and the hikr.org Kaggle dataset (average 1.2, relaxed 1.5, fast 0.85; tired end ≥1.3x). Change them only with new real-hike data. Analysis notes: `hike-data/findings-hikr-2026-11-23.md`; Kaggle key in `~/.kaggle/kaggle.json` (never commit).
- Works worldwide: never hard-code US units or US-only sources into user-facing text; use units.js helpers.
- localStorage keys stay `trailprep.*` on purpose so saved trips survive the rename.
- Credit OpenStreetMap (ODbL) and Recreation.gov wherever their data shows.
- Keep it simple to read. Suhitha is learning; prefer clear code and short comments over clever code.
- Every estimate is labeled a rough guide. Never present a number as a safety guarantee.
- Usage counting: GoatCounter (dashboard trailprep.goatcounter.com) and Google Analytics 4 (ID in `analytics.js`, same property as the portfolio) via `track()` in app.js. Count actions and state/country only, never exact trails, places, or dates. No session recording tools (like Clarity) here, since people type trail names.
- Never commit the raw survey CSV or anyone's GPX files (names, routes and times are personal). `hike-data/`, `*.gpx` and `*.csv` are gitignored. Only share totals.
- Test with `python3 -m http.server 8000` and open http://localhost:8000, or a Playwright script that serves files through `context.route` with an iPhone device profile.
