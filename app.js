// hikepace: page logic. Works anywhere in the world, all with free services and no accounts:
//   weather, sunrise/sunset and elevation: Open-Meteo · trails, campsites, water: OpenStreetMap
//   (US only) federal campgrounds: Recreation.gov · who manages the land: Bureau of Land Management
import {
  PACES, ENDINGS, END_TYPES, estimateHike, paceFactor, describePace, sampleHike, tempAtTop, estimateWater, estimateFood,
  gearChecklist, warnings, describeWeather, isThunder, addHours, formatDuration, routeStats, routeEffort, timeRange,
  campsAlongRoute, waterAlongRoute, campRules, milesBetween,
} from "./calc.js";
import * as U from "./units.js";
import { trailRoute } from "./trail.js";
import { placesAround, landAt } from "./places.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "trailprep.trips"; // old name on purpose: keeps trips saved before the rename
// route = the trail's points (from a GPX file or found on the map), needed for the climb chart,
// "where can I camp?" and water along the way.
const state = { place: null, forecast: null, inputs: null, route: null };
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const round1 = (x) => Math.round(x * 10) / 10;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Times ----------
// Open-Meteo gives times in the trail's own time zone. We keep every time as a
// "trail-local" clock time (stored as UTC under the hood), so the plan reads
// correctly no matter where the phone is.
const parseLocal = (s) => new Date(s.length === 16 ? s + ":00Z" : s + "Z");
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const fmtRange = (r) => `${fmtTime(r.best)} – ${fmtTime(r.worst)}`;
const fmtBetween = (r) => `between ${fmtTime(r.best)} and ${fmtTime(r.worst)}`;

// ---------- Usage counts ----------
// Anonymous counts through GoatCounter and Google Analytics 4 (no names). Only the action and the
// state or country are counted, never the exact trail, place, or date, to keep trips private.
function track(name, title) {
  try { window.goatcounter?.count?.({ path: name, title: title || name, event: true }); } catch {}
  // GA4 event names allow only letters, numbers and underscores. Regions go in as a detail
  // of one "plan_region" event instead of a new event name per state.
  try {
    if (name.startsWith("region-")) window.gtag?.("event", "plan_region", { region: name.slice(7) });
    else window.gtag?.("event", name.replace(/-/g, "_"));
  } catch {}
}

// ---------- Units in the form ----------
// People type in their own units; inside, the app always works in miles and feet.
const DIST_FIELDS = ["up-miles", "back-miles", "past-miles"];
const ELEV_FIELDS = ["up-gain", "trailhead-elev", "back-gain", "past-gain"];
const readDist = (id) => ($(id).value === "" ? 0 : U.fromDist(+$(id).value));
const readElev = (id) => ($(id).value === "" ? null : U.fromElev(+$(id).value));
const setDist = (id, mi) => { $(id).value = mi == null || mi === "" || !Number.isFinite(+mi) ? "" : round1(U.toDist(mi)); };
const setElev = (id, ft) => { $(id).value = ft == null || ft === "" || !Number.isFinite(+ft) ? "" : Math.round(U.toElev(ft)); };
// "mile 5" or "km 8"
const atMile = (mi) => (U.metric() ? `km ${round1(mi * 1.609344)}` : `mile ${round1(mi)}`);

function showUnits() {
  const m = U.metric();
  $("units-btn").textContent = m ? "km · m" : "mi · ft";
  document.querySelectorAll(".u-dist").forEach((el) => { el.textContent = m ? "Kilometers" : "Miles"; });
  document.querySelectorAll(".u-elev").forEach((el) => { el.textContent = m ? "meters" : "feet"; });
  document.querySelectorAll("[data-units]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.units === U.getUnits())));
  $("up-miles").placeholder = m ? "e.g. 6" : "e.g. 4";
  $("up-gain").placeholder = m ? "e.g. 450" : "e.g. 1500";
}

// Switching units converts whatever is already typed, so nothing has to be entered again.
function switchUnits(u) {
  if (u === U.getUnits()) return;
  const dists = DIST_FIELDS.map((id) => ($(id).value === "" ? "" : readDist(id)));
  const elevs = ELEV_FIELDS.map((id) => readElev(id));
  U.setUnits(u);
  DIST_FIELDS.forEach((id, i) => setDist(id, dists[i]));
  ELEV_FIELDS.forEach((id, i) => setElev(id, elevs[i]));
  showUnits();
  updateForm();
  renderPaceCards();
  showPace();
  renderSettings();
  if (state.lastRouteStats) showRouteCard(state.lastRouteStats);
  if (state.inputs && state.forecast && !$("results").hidden) render(state.savedName, { quiet: true });
  renderSaved();
  track(`units-${u}`);
}

// ---------- Place search ----------
// One box takes a trail name, landmark, peak, town, or coordinates, anywhere in the world.
// Trails and landmarks come from OpenStreetMap (free; asks for at most 1 search per second).
// Towns come from Open-Meteo as a backup.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const OSM_TYPES = {
  path: "Trail", footway: "Trail", track: "Trail", bridleway: "Trail", hiking: "Trail", foot: "Trail", trailhead: "Trailhead",
  peak: "Peak", volcano: "Peak", saddle: "Pass", ridge: "Ridge", cliff: "Cliff", spring: "Spring", waterfall: "Waterfall",
  attraction: "Landmark", viewpoint: "Viewpoint", camp_site: "Campground", picnic_site: "Picnic area",
  parking: "Parking", nature_reserve: "Park", national_park: "Park", protected_area: "Park", park: "Park",
  city: "Town", town: "Town", village: "Town", hamlet: "Town", administrative: "Town",
};

async function osmSearch(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8&q=${encodeURIComponent(q)}`;
  let res;
  try { res = await fetch(url, { headers: { "Accept-Language": "en" } }); } catch { return []; } // busy or offline: fall back to towns
  if (!res.ok) return [];
  return (await res.json()).map((x) => ({
    name: x.name || x.display_name.split(",")[0],
    area: [x.address?.city || x.address?.town || x.address?.village || x.address?.county, x.address?.state, x.address?.country_code?.toUpperCase()].filter(Boolean).join(", "),
    region: x.address?.country_code === "us" ? x.address?.state : x.address?.country,
    country: x.address?.country_code?.toUpperCase(),
    type: OSM_TYPES[x.type] || "Place",
    osmType: x.osm_type, osmId: x.osm_id,
    latitude: +x.lat,
    longitude: +x.lon,
  }));
}

async function townSearch(q) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return ((await res.json()).results || []).map((x) => ({
    name: x.name, area: [x.admin1, x.country_code].filter(Boolean).join(", "), type: "Town", latitude: x.latitude, longitude: x.longitude,
    region: x.country_code === "US" ? x.admin1 : x.country, country: x.country_code,
  }));
}

// AllTrails-style names ("Seven Sacred Pools via Soldier Pass to Brins Mesa Loop, Arizona")
// are not one place on any map, so split them into the places they mention.
function trailPieces(query) {
  const [main, ...rest] = query.split(",");
  const region = rest.join(",").trim();
  const pieces = main
    .split(/\s+(?:via|to|and|from|&|\+)\s+|\s+-\s+/i)
    .map((s) => s.replace(/\b(loop|out and back|out-and-back|trailhead|hike)\b/gi, "").trim())
    .filter((s) => s.length > 2);
  return { pieces: pieces.slice(0, 4), region };
}

async function searchPlaces(query) {
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) return [{ name: "Custom point", area: "", type: "Coordinates", latitude: +coords[1], longitude: +coords[2] }];

  let results = await osmSearch(query);
  if (!results.length) {
    const { pieces, region } = trailPieces(query);
    if (pieces.length > 1 || pieces[0] !== query) {
      for (const piece of pieces) {
        await wait(1100); // be polite to OpenStreetMap's free service
        const found = await osmSearch(region ? `${piece}, ${region}` : piece);
        results.push(...found.map((r) => ({ ...r, matched: piece })));
      }
    }
  }
  if (!results.length) results = await townSearch(query.split(",")[0]);

  // One trail is often many map pieces with the same name: show it once per area.
  const seen = new Set();
  return results.filter((r) => {
    const key = r.type === "Trail" ? `${r.name}|${r.area}` : `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`;
    return seen.has(key) ? false : seen.add(key);
  }).slice(0, 8);
}

const placeLabel = (p) => `${p.name}${p.area ? ` · ${p.area}` : ""}`;

function choosePlace(p) {
  state.route = p.route || null; // a plain place has no route; a trail or a GPX file does
  if (!p.route) { state.lastRouteStats = null; $("route-card").hidden = true; }
  state.place = { name: placeLabel(p), lat: p.latitude, lon: p.longitude, region: p.region || "Unknown", country: p.country || null };
  $("place-results").innerHTML = "";
  $("place-chosen").textContent = `✓ ${state.place.name}`;
  if (Number.isFinite(p.elevFt)) return setTrailheadElev(p.elevFt, p.elevNote || "From your route.");
  lookUpElevation(p.latitude, p.longitude);
}

// Fill in the starting elevation (used for thin-air time) and say where it came from,
// so people can fix it when the spot they picked is the summit or a lake, not the trailhead.
function setTrailheadElev(ft, note) {
  setElev("trailhead-elev", ft);
  $("elev-note").textContent = note;
}

async function lookUpElevation(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    const m = (await res.json()).elevation?.[0];
    if (Number.isFinite(m)) setTrailheadElev(Math.round(m * 3.28084), "From the map spot you picked. If that's a summit or a lake, change it to the trailhead's elevation.");
  } catch {
    $("elev-note").textContent = "Couldn't look it up. Add it if you know it.";
  }
}

// A trail was picked: find its whole path and fill in distance, climb and trailhead by itself.
async function chooseTrail(r) {
  choosePlace(r);
  const status = $("gpx-status");
  status.innerHTML = `<div class="loading"><span class="spinner" aria-hidden="true"></span> Walking the trail on the map to measure it…</div>`;
  try {
    const pts = await trailRoute(r);
    if (!pts) throw new Error("no path");
    applyRoute(pts, { name: r.name, area: r.area, region: r.region, country: r.country, source: "map" });
    track("trail-autofill");
  } catch {
    status.innerHTML = `<div class="muted">Couldn't measure this trail from the map. Type the distance and climb below, or use a GPX file.</div>`;
  }
}

$("place-search").addEventListener("click", async () => {
  const q = $("place").value.trim();
  if (!q) return $("place").focus();
  state.place = null;
  $("place-chosen").textContent = "";
  $("gpx-status").innerHTML = "";
  $("place-results").innerHTML = `<li class="loading"><span class="spinner" aria-hidden="true"></span> Searching trails, peaks and towns…</li>`;
  try {
    track("search");
    const results = await searchPlaces(q);
    $("place-results").innerHTML = "";
    if (!results.length) {
      $("place-results").innerHTML = "<li>No match. Try one landmark on the trail (like a peak or the trailhead), the nearest town, or paste coordinates like 34.885, -111.782.</li>";
      return;
    }
    const pick = (r) => (r.type === "Trail" && r.osmType ? chooseTrail(r) : choosePlace(r));
    if (results.length === 1 && !results[0].matched) return pick(results[0]);
    if (results.some((r) => r.matched)) {
      $("place-results").innerHTML = "<li>No exact match for the full name, so here are places on your trail. Pick the one closest to where you start.</li>";
    }
    results.forEach((r, i) => {
      const li = document.createElement("li");
      li.style.setProperty("--i", i);
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="r-icon" aria-hidden="true"></span><span class="r-text"><b></b><span class="small muted"></span></span><span class="tag"></span>`;
      b.querySelector(".r-icon").textContent = { Trail: "🥾", Peak: "🏔️", Trailhead: "🚩", Town: "🏘️", Park: "🌲", Waterfall: "💦", Spring: "💧", Campground: "⛺" }[r.type] || "📍";
      b.querySelector("b").textContent = r.name;
      b.querySelector(".muted").textContent = r.area;
      // Skip the tag when the name already says it ("Soldier Pass" is already a pass).
      if (!r.name.toLowerCase().includes(r.type.toLowerCase())) b.querySelector(".tag").textContent = r.type;
      else b.querySelector(".tag").remove();
      b.addEventListener("click", () => pick(r));
      li.appendChild(b);
      $("place-results").appendChild(li);
    });
  } catch {
    $("place-results").innerHTML = "<li>Could not search. Are you online?</li>";
  }
});
$("place").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("place-search").click(); }
});

$("place-gps").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("This device cannot share its location.");
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const spot = await describeSpot(pos.coords.latitude, pos.coords.longitude);
      choosePlace({ name: "My location", ...spot, latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    },
    () => alert("Could not get your location."),
  );
});

// ---------- A route: from a GPX file, or a trail found on the map ----------
// GPX is the route file almost every hiking app can export. Reading it happens
// entirely on the device: the file is never uploaded anywhere.
function readGpx(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a GPX file");
  let nodes = [...doc.getElementsByTagName("trkpt")];
  if (!nodes.length) nodes = [...doc.getElementsByTagName("rtept")];
  const points = nodes.map((n) => ({
    lat: parseFloat(n.getAttribute("lat")),
    lon: parseFloat(n.getAttribute("lon")),
    ele: parseFloat(n.getElementsByTagName("ele")[0]?.textContent),
    time: Date.parse(n.getElementsByTagName("time")[0]?.textContent ?? ""),
  })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const name = (doc.querySelector("trk > name") || doc.querySelector("rte > name") || doc.querySelector("metadata > name"))?.textContent.trim();
  return { points, name };
}

// Look up which town and country a spot is in, so the forecast and labels make sense.
async function describeSpot(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&lat=${lat}&lon=${lon}`, { headers: { "Accept-Language": "en" } });
    const a = (await res.json()).address || {};
    return {
      area: [a.city || a.town || a.village || a.county, a.state, a.country_code?.toUpperCase()].filter(Boolean).join(", "),
      region: a.country_code === "us" ? a.state : a.country,
      country: a.country_code?.toUpperCase(),
    };
  } catch {
    return { area: "", region: "Unknown" };
  }
}

// Fills the form from a route and shows a little card with its numbers and climb shape.
// source "gpx": a file (it may end somewhere else, like at a tram). source "map": a trail we measured,
// which most people hike there and back.
function applyRoute(points, { name, area, region, country, source }) {
  const r = routeStats(points);
  const hasEle = r.gainFt !== null;
  if (source === "map" && !r.isLoop) {
    // There and back on the same trail: the whole trail is the way out, and every downhill on the way
    // out is a climb on the way back.
    setDist("up-miles", r.miles);
    setElev("up-gain", r.gainFt);
    setElev("back-gain", hasEle ? r.outAndBackGainFt - r.gainFt : "");
    $("ending").value = "outback";
  } else {
    // The way up = start to the highest point. The way back = the rest of the route.
    setDist("up-miles", hasEle ? r.topMiles : r.miles);
    setElev("up-gain", r.topGainFt);
    $("ending").value = r.isLoop ? "loop" : "oneway";
    setDist("back-miles", hasEle ? Math.round((r.miles - r.topMiles) * 10) / 10 : 0);
    setElev("back-gain", hasEle ? Math.max(0, r.gainFt - r.topGainFt) : "");
  }
  updateForm();
  choosePlace({ name: name || "Route start", area, region, country, latitude: r.start.lat, longitude: r.start.lon, route: points,
    elevFt: Number.isFinite(r.start.ele) ? Math.round(r.start.ele * 3.28084) : undefined,
    elevNote: source === "map" ? "From the trail's lower end on the map." : "From your GPX file." });
  if (name) $("place").value = name;
  state.lastRouteStats = { ...r, source, name, points };
  showRouteCard(state.lastRouteStats);

  const status = $("gpx-status");
  status.innerHTML = "";
  if (!r.isLoop && source === "gpx") {
    status.appendChild(choiceNote(`This route ends ${U.dist(r.gapMiles)} from where it starts, so I set the way back to a tram, shuttle or car. Pick which one below. Walking back the same trail?`,
      "I'll hike back the same way", () => {
        setDist("up-miles", r.miles);
        setElev("up-gain", r.gainFt);
        setElev("back-gain", hasEle ? r.outAndBackGainFt - r.gainFt : "");
        $("ending").value = "outback";
        updateForm();
        return "✓ Set to hike back the same way.";
      }));
  }
  if (!r.isLoop && source === "map") {
    status.appendChild(choiceNote("Set as there and back on the same trail. Ending somewhere else, like a shuttle or a car?",
      "It ends somewhere else", () => {
        setDist("up-miles", hasEle ? r.topMiles : r.miles);
        setElev("up-gain", r.topGainFt);
        setDist("back-miles", hasEle ? Math.round((r.miles - r.topMiles) * 10) / 10 : 0);
        setElev("back-gain", hasEle ? Math.max(0, r.gainFt - r.topGainFt) : "");
        $("ending").value = "oneway";
        updateForm();
        return "✓ Set to end somewhere else. Pick what's at the end below.";
      }));
  }
  return r;
}

function choiceNote(text, label, onClick) {
  const note = document.createElement("div");
  note.className = "muted note";
  note.textContent = text + " ";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "secondary small-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => { note.textContent = onClick(); });
  note.appendChild(btn);
  return note;
}

function showRouteCard(r) {
  const card = $("route-card");
  card.hidden = false;
  const oneWay = r.source === "map" && !r.isLoop;
  card.innerHTML = `
    <div class="route-stats">
      <div><span>📏</span><b>${U.dist(r.miles)}</b><small>${oneWay ? "one way" : r.isLoop ? "loop" : "total"}</small></div>
      <div><span>⛰️</span><b>${r.gainFt !== null ? U.elev(r.gainFt) : "?"}</b><small>climb</small></div>
      <div><span>🏔️</span><b>${r.highFt !== null ? U.elevExact(r.highFt) : "?"}</b><small>highest</small></div>
    </div>
    ${miniProfile(r.points)}
    <p class="small muted">${r.source === "map" ? "Measured from OpenStreetMap and free elevation data. Peaks can read a little low, so check it against your trail guide and change any number below." : "From your GPX file. Change any number below."}</p>`;
  card.classList.remove("pop");
  void card.offsetWidth; // restart the little pop animation
  card.classList.add("pop");
}

// A small climb-shape drawing for the route card.
function miniProfile(points) {
  const ele = points.map((p) => p.ele).filter(Number.isFinite);
  if (ele.length < 2) return "";
  const lo = Math.min(...ele), hi = Math.max(...ele), W = 300, H = 56;
  const step = Math.max(1, Math.floor(points.length / 80));
  const pts = points.filter((p, i) => Number.isFinite(p.ele) && (i % step === 0 || i === points.length - 1));
  const xy = pts.map((p, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 4 - ((p.ele - lo) / Math.max(1, hi - lo)) * (H - 10)).toFixed(1)}`);
  return `<svg class="mini-profile" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="M0,${H} L${xy.join(" L")} L${W},${H} Z"/><path class="ln" d="M${xy.join(" L")}"/></svg>`;
}

$("gpx").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // lets the same file be picked again later
  if (!file) return;
  const status = $("gpx-status");
  status.textContent = "Reading your route…";
  try {
    const { points, name } = readGpx(await file.text());
    if (points.length < 2) throw new Error("No route points");
    const spot = await describeSpot(points[0].lat, points[0].lon);
    const r = applyRoute(points, { name, ...spot, source: "gpx" });
    track("gpx-import");
    if (r.gainFt === null) status.prepend(Object.assign(document.createElement("div"), { textContent: "This file has no elevation, so please add the climb yourself." }));
    // A recorded hike (not just a planned route) has times, so it can teach us the hiker's pace.
    if (r.elapsedHours > 0.25 && r.gainFt !== null) {
      const useTop = r.topHours > 0.25 && r.topMiles > 0;
      status.appendChild(choiceNote(`This looks like a hike you recorded: ${useTop ? `${formatDuration(r.topHours)} to the top, ` : ""}${formatDuration(r.elapsedHours)} in total.`,
        "Use this hike to learn my pace", () => {
          setDist("past-miles", useTop ? r.topMiles : r.miles);
          setElev("past-gain", useTop ? r.topGainFt : r.gainFt);
          $("past-hours").value = Math.round((useTop ? r.topHours : r.elapsedHours) * 100) / 100;
          setPace("custom");
          saveMyPace(Number.isFinite(r.start.ele) ? Math.round(r.start.ele * 3.28084) : undefined);
          return "✓ Saved as your pace. Now search or import the hike you're planning.";
        }));
    }
  } catch {
    status.textContent = "Couldn't read that file. Make sure it's a .gpx route file (most hiking apps can export one).";
  }
});

// ---------- Forecast ----------
async function fetchForecast(place) {
  const params = new URLSearchParams({
    latitude: place.lat, longitude: place.lon, timezone: "auto", forecast_days: "16", past_days: "3",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,snowfall",
    daily: "sunrise,sunset,temperature_2m_min,temperature_2m_max,weather_code,snowfall_sum",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error("Weather service error");
  return res.json();
}

// ---------- Form ----------
function readInputs() {
  const ending = $("ending").value;
  return {
    upMiles: readDist("up-miles"),
    upGainFt: readElev("up-gain") || 0,
    trailheadFt: readElev("trailhead-elev"),
    ending,
    endType: $("end-type").value,
    backMiles: ending === "outback" ? 0 : readDist("back-miles"),
    backGainFt: readElev("back-gain") || 0,
    lastDeparture: ending === "oneway" && $("end-type").value !== "car" ? $("last-time").value : "",
    date: $("date").value,
    time: $("time").value,
    nights: +$("nights").value,
    cooking: $("cooking").checked,
    pace: $("pace").value,
    paceRef: $("pace").value === "custom" ? loadMyPace() : null,
  };
}

// Trips saved by older versions used a total distance; turn them into "way up / way back".
function normalizeInputs(i) {
  if (i.upMiles) return i;
  const ending = i.ending || "outback";
  const upMiles = i.topMiles || (ending === "outback" ? i.miles / 2 : ending === "oneway" ? i.miles : i.miles * 0.6);
  const upGainFt = i.topGainFt ?? i.gainFt ?? 0;
  return {
    ...i, ending, endType: "car", lastDeparture: "", upMiles, upGainFt,
    backMiles: ending === "outback" ? 0 : Math.max(0, i.miles - upMiles),
    backGainFt: Math.max(0, (i.gainFt || 0) - upGainFt),
  };
}

function makePace(i) {
  if (i.pace === "custom") return i.paceRef ? { ref: i.paceRef } : { factor: i.customFactor || 1 };
  return { factor: PACES[i.pace]?.factor ?? 1 };
}

const endName = (i) => END_TYPES[i.endType] || "end";

// Show only the questions that matter for the chosen way back, and keep a running total.
function updateForm() {
  const i = readInputs();
  $("end-type-wrap").hidden = i.ending !== "oneway";
  $("back-miles-wrap").hidden = i.ending === "outback";
  $("last-time-wrap").hidden = i.ending !== "oneway" || i.endType === "car";
  $("cooking-wrap").hidden = i.nights === 0;
  const d = U.metric() ? "Kilometers" : "Miles";
  $("back-miles-label").textContent = i.ending === "loop" ? `${d} from the top back to the start` : `${d} from the top to the ${endName(i)}`;
  if (!i.upMiles) return ($("totals").textContent = "");
  const total = i.upMiles + (i.ending === "outback" ? i.upMiles : i.backMiles);
  $("totals").textContent = `Total: ${U.dist(total)} and ${U.elev(i.upGainFt + i.backGainFt)} of climbing`;
}

// ---------- Your pace ----------
// Three ready-made paces as tappable cards, each showing what it means on a typical hike,
// plus "your own", learned from a hike the person already did and kept only on this device.
const PACE_KEY = "trailprep.myPace"; // old name on purpose: keeps a pace saved before the rename
function loadMyPace() {
  try { return JSON.parse(localStorage.getItem(PACE_KEY)); } catch { return null; }
}

const sampleText = (factor) => {
  const s = sampleHike(factor);
  return `${formatDuration(s.best)}–${formatDuration(s.worst)} for ${U.dist(s.miles, 0)} with ${U.elev(s.gainFt)} up`;
};

function renderPaceCards() {
  const current = $("pace").value;
  $("pace-cards").innerHTML = ["relaxed", "average", "fast", "custom"].map((k) => {
    const p = PACES[k];
    const sub = k === "custom" ? (loadMyPace() ? "Learned from your hike" : "From a hike you did") : sampleText(p.factor);
    return `<button type="button" role="radio" class="pace-card" data-pace="${k}" aria-checked="${k === current}">
      <span class="p-emoji" aria-hidden="true">${p.emoji}</span><b>${p.label}</b><small>${sub}</small></button>`;
  }).join("");
}

function setPace(k) {
  $("pace").value = k;
  document.querySelectorAll(".pace-card").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.pace === k)));
  showPace();
}

$("pace-cards").addEventListener("click", (e) => {
  const b = e.target.closest(".pace-card");
  if (!b) return;
  setPace(b.dataset.pace);
  b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
  navigator.vibrate?.(8);
  track(`pace-${b.dataset.pace}`);
});

function saveMyPace(elevFt) {
  const miles = readDist("past-miles"), gainFt = readElev("past-gain") || 0, hours = +$("past-hours").value;
  if (!miles || !hours) {
    $("past-result").textContent = "Add the distance to the top and how long it took.";
    return;
  }
  // elevFt: where the climb started, when we know it (from a GPX), so altitude can be taken into account.
  try { localStorage.setItem(PACE_KEY, JSON.stringify({ miles, gainFt, hours, elevFt: typeof elevFt === "number" ? elevFt : undefined })); } catch {}
  track("pace-saved");
  renderPaceCards();
  showPace();
  renderSettings();
}

function myPaceSummary(mine) {
  const factor = paceFactor({ ref: mine });
  const pct = Math.round((factor / PACES.average.factor - 1) * 100);
  const vsAverage = Math.abs(pct) < 5 ? "about the same as Average" : pct > 0 ? `${pct}% slower than Average` : `${-pct}% faster than Average`;
  return { factor, text: `${describePace(factor)} (${vsAverage}).` };
}

function showPace() {
  const pace = $("pace").value, mine = loadMyPace();
  $("my-pace").hidden = pace !== "custom";
  if (pace !== "custom") {
    $("pace-desc").textContent = `${PACES[pace].label}: ${describePace(PACES[pace].factor)}. ${PACES[pace].who}`;
    return;
  }
  if (!mine) {
    $("pace-desc").textContent = "Enter a climb you already did below, and hikepace will use your real pace.";
    $("past-result").textContent = "";
    return;
  }
  $("pace-desc").textContent = `Your pace: ${myPaceSummary(mine).text} On hikes much longer than this one, hikepace adds time for getting tired.`;
  $("past-result").textContent = `✓ Learned from your climb of ${U.dist(mine.miles)} and ${U.elev(mine.gainFt)} in ${formatDuration(mine.hours)}.`;
  if ($("past-miles").value === "") setDist("past-miles", mine.miles);
  if ($("past-gain").value === "") setElev("past-gain", mine.gainFt);
  $("past-hours").value ||= mine.hours;
}

$("past-save").addEventListener("click", () => saveMyPace());

// ---------- Settings ----------
function renderSettings() {
  $("pace-explain").innerHTML = ["relaxed", "average", "fast"].map((k) => {
    const p = PACES[k];
    return `<div class="explain"><div class="explain-head"><span aria-hidden="true">${p.emoji}</span><b>${p.label}</b></div>
      <p class="small">${p.who}</p>
      <p class="small muted">${describePace(p.factor)[0].toUpperCase() + describePace(p.factor).slice(1)}.</p>
      <p class="small"><b>Example:</b> ${sampleText(p.factor)} (there and back). The first time is "if you keep your pace", the second "if you get tired".</p></div>`;
  }).join("");
  const mine = loadMyPace();
  $("my-pace-status").textContent = mine
    ? `Saved: ${myPaceSummary(mine).text} Learned from ${U.dist(mine.miles)} and ${U.elev(mine.gainFt)} in ${formatDuration(mine.hours)}.`
    : "Not set yet. Pick \"Your own\" under Your pace and enter a hike you did, or use a recorded GPX file.";
}

$("settings-btn").addEventListener("click", () => { renderSettings(); $("settings").showModal(); track("settings"); });
$("settings").addEventListener("click", (e) => {
  if (e.target.closest("[data-close]") || e.target === $("settings")) $("settings").close(); // tap outside closes it
  const u = e.target.closest("[data-units]")?.dataset.units;
  if (u) switchUnits(u);
});
$("units-btn").addEventListener("click", () => switchUnits(U.metric() ? "imperial" : "metric"));
$("clear-data").addEventListener("click", () => {
  if (!confirm("Delete your saved trips and your pace from this phone?")) return;
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(PACE_KEY); } catch {}
  renderSaved(); renderPaceCards(); showPace(); renderSettings();
});

// ---------- Plan ----------
$("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.place) return showError("Pick where you're hiking first: search a trail, use a GPX file, or tap Near me.");
  const inputs = readInputs();
  if (!inputs.upMiles || !inputs.date || !inputs.time) return showError("Add the distance to the top, the date and the start time.");
  if (inputs.ending !== "outback" && !inputs.backMiles) return showError(inputs.ending === "loop" ? "Add the distance from the top back to the start." : `Add the distance from the top to the ${endName(inputs)}.`);
  if (inputs.pace === "custom" && !inputs.paceRef) return showError("Save your pace first (enter a past climb under \"Teach hikepace your pace\"), or pick another pace.");
  $("plan-btn").disabled = true;
  $("plan-btn").textContent = "Checking the sky… ☁️";
  try {
    state.forecast = await fetchForecast(state.place);
    track(inputs.nights ? "plan-backpacking" : "plan-day-hike");
    track(`region-${state.place.region}`, `Planned in ${state.place.region}`);
    state.inputs = inputs;
    state.savedName = null;
    render();
  } catch {
    showError("Could not get the forecast. If you're offline, open a saved trip below.");
  } finally {
    $("plan-btn").disabled = false;
    $("plan-btn").textContent = "Plan my hike 🥾";
  }
});

function showError(msg) {
  $("results").hidden = false;
  $("results").innerHTML = `<div class="alert danger">${msg}</div>`;
  $("results").scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- Build the plan ----------
function buildPlan(rawInputs, forecast) {
  const inputs = normalizeInputs(rawInputs);
  const start = parseLocal(`${inputs.date}T${inputs.time}`);
  const days = inputs.nights + 1;
  // Trailhead elevation: from the route when we have it, otherwise the weather service's estimate for that spot.
  const trailheadFt = inputs.trailheadFt ?? (Number.isFinite(forecast.elevation) ? Math.round(forecast.elevation * 3.28084) : 0);
  const est = estimateHike({ ...inputs, pace: makePace(inputs), heavyPack: inputs.nights > 0, days, trailheadFt });

  const daily = forecast.daily.time.map((t, i) => ({
    date: t,
    sunrise: parseLocal(forecast.daily.sunrise[i]),
    sunset: parseLocal(forecast.daily.sunset[i]),
    min: forecast.daily.temperature_2m_min[i],
    max: forecast.daily.temperature_2m_max[i],
    code: forecast.daily.weather_code[i],
    snowCm: forecast.daily.snowfall_sum?.[i] ?? 0,
  }));
  const dayIndex = daily.findIndex((d) => d.date === inputs.date);
  if (dayIndex === -1) return { error: "That date is outside the 16-day forecast. Plan again closer to your trip." };
  const first = daily[dayIndex];

  // Every time is a range: "if you keep your pace" to "if you get tired".
  const at = (h) => addHours(start, h);
  const top = { best: at(est.top.best), worst: at(est.top.worst) };
  const finish = { best: at(est.finish.best), worst: at(est.finish.worst) };

  // Hours of weather that matter: from the start until the latest you could finish.
  const end = addHours(start, inputs.nights * 24 + est.finish.worst);
  const hours = forecast.hourly.time.map((t, i) => ({
    time: parseLocal(t),
    temp: forecast.hourly.temperature_2m[i],
    feels: forecast.hourly.apparent_temperature[i],
    rain: forecast.hourly.precipitation_probability[i] ?? 0,
    code: forecast.hourly.weather_code[i],
    wind: forecast.hourly.wind_speed_10m[i],
    gust: forecast.hourly.wind_gusts_10m[i],
    uv: forecast.hourly.uv_index[i] ?? 0,
    snow: forecast.hourly.snowfall?.[i] ?? 0,
  })).filter((h) => h.time >= addHours(start, -1) && h.time <= end);
  if (!hours.length) return { error: "No hourly forecast for that time yet. Try a date within the next 16 days." };

  const climbToTop = days === 1 ? inputs.upGainFt : est.totalGainFt / days;
  const w = {
    maxFeelsF: Math.max(...hours.map((h) => h.feels)),
    minFeelsF: Math.min(...hours.map((h) => tempAtTop(h.feels, climbToTop))),
    maxRainChance: Math.max(...hours.map((h) => h.rain)),
    maxGustMph: Math.max(...hours.map((h) => h.gust)),
    maxUv: Math.max(...hours.map((h) => h.uv)),
    thunder: hours.some((h) => isThunder(h.code)),
    nights: inputs.nights,
    cooking: inputs.cooking ?? true,
    totalGainFt: est.totalGainFt,
    topFt: trailheadFt + climbToTop,
    minTempTopF: Math.min(...hours.map((h) => tempAtTop(h.temp, climbToTop))),
    snowDuring: hours.some((h) => h.snow > 0 || (h.code >= 71 && h.code <= 86)),
    // Snow at the trailhead in the 3 days before (and the day of) the hike.
    snowRecentCm: daily.slice(Math.max(0, dayIndex - 3), dayIndex + 1).reduce((sum, d) => sum + d.snowCm, 0),
    // Camp is assumed to sit halfway up the climb.
    nightLowF: inputs.nights > 0
      ? Math.min(...daily.slice(dayIndex + 1, dayIndex + 1 + inputs.nights).map((d) => tempAtTop(d.min, climbToTop / 2)))
      : null,
  };

  const light = {
    startsInDark: start < first.sunrise,
    darkLikely: finish.best > first.sunset,
    darkPossible: finish.worst > first.sunset,
    tight: finish.worst > addHours(first.sunset, -0.5),
    latestStart: addHours(first.sunset, -0.5 - est.finish.worst),
    sunriseAtTopStart: addHours(first.sunrise, -est.top.worst),
  };
  w.headlamp = light.startsInDark || finish.worst > addHours(first.sunset, -1) || inputs.nights > 0;
  w.headlampWhy = inputs.nights > 0 ? "You'll be at camp after dark." : light.startsInDark ? "You start before sunrise." : "If you get tired, you could finish close to or after sunset.";

  // Tram or shuttle at the end: will they make the last one?
  let ride = null;
  if (inputs.ending === "oneway" && days === 1) {
    const last = inputs.lastDeparture ? parseLocal(`${inputs.date}T${inputs.lastDeparture}`) : null;
    ride = { name: endName(inputs), last, level: !last ? null : finish.best > last ? "danger" : finish.worst > last ? "warn" : "ok" };
  }

  const hoursLow = est.finish.best * days, hoursHigh = est.finish.worst * days;
  return {
    inputs, start, est, top, finish, first, hours, w, light, days, ride, trailheadFt,
    daily: daily.slice(dayIndex, dayIndex + days),
    water: estimateWater({ hoursLow, hoursHigh, gainFt: est.totalGainFt, maxFeelsF: w.maxFeelsF, nights: inputs.nights, cooking: w.cooking }),
    food: estimateFood({ hoursLow, hoursHigh, nights: inputs.nights, minFeelsF: w.minFeelsF }),
    gear: gearChecklist(w),
    alerts: warnings({ day: light, w }),
  };
}

// ---------- Show the plan ----------
function render(savedName, { quiet = false } = {}) {
  const { forecast, place } = state;
  const p = buildPlan(state.inputs, forecast);
  const inputs = p.inputs ?? state.inputs;
  const out = $("results");
  out.hidden = false;
  if (p.error) return (out.innerHTML = `<div class="alert warn">${p.error}</div>`);

  const perDay = p.days > 1 ? " per day" : "";
  const paceLabel = inputs.pace === "custom" ? "your own" : PACES[inputs.pace].label;
  out.innerHTML = `
    <div class="result-hero">
      <p class="eyebrow">${fmtDay(p.start)} · ${paceLabel} pace${inputs.nights ? ` · ${inputs.nights} night${inputs.nights > 1 ? "s" : ""}` : ""}</p>
      <h2>${esc(place.name)}</h2>
      <p class="muted">${U.dist(p.est.totalMiles)} · ${U.elev(p.est.totalGainFt)} of climbing · ${inputs.ending === "oneway" ? `ends at a ${endName(inputs)}` : ENDINGS[inputs.ending]}</p>
      ${savedName ? `<p class="muted small">Saved plan · forecast from ${esc(savedName)}</p>` : ""}
      <div class="big-time"><span class="count" data-to="${p.est.finish.best}">${formatDuration(p.est.finish.best)}</span> – ${formatDuration(p.est.finish.worst)}<small>on the trail${perDay}, breaks included</small></div>
      ${daylightBar(p)}
    </div>

    ${p.alerts.map((a) => `<div class="alert ${a.level}">${a.text}</div>`).join("")}
    ${rideAlert(p)}

    <div class="cards">
      <div class="card"><div class="c-emoji" aria-hidden="true">💧</div><div class="label">Water</div><div class="big">${p.water.total[0]}–${p.water.total[1]} L</div>
        <div class="small">${inputs.nights
          ? `Hiking: ${p.water.hike[0]}–${p.water.hike[1]} L · At camp: ${p.water.camp[0]}–${p.water.camp[1]} L for ${p.w.cooking ? "drinking and cooking" : "drinking"}. Carry only what you need between water sources you can filter.`
          : "To drink while hiking. Carry the high end if it's hot or you're unsure."}</div></div>
      <div class="card"><div class="c-emoji" aria-hidden="true">🍫</div><div class="label">Food to pack</div>
        <div class="big">${p.food.total[0].toLocaleString()}–${p.food.total[1].toLocaleString()} cal</div>
        <div class="small">${inputs.nights
          ? `Trail snacks: ${p.food.snacks[0].toLocaleString()}–${p.food.snacks[1].toLocaleString()} · Dinner and breakfast: ${p.food.meals[0].toLocaleString()}–${p.food.meals[1].toLocaleString()}. About ${U.weight(p.food.pounds[0])}–${U.weight(p.food.pounds[1])}.`
          : "Snacks: about 200–300 calories for every hour on the trail."}</div></div>
    </div>

    <h3>Your day</h3>
    <ul class="timeline">
      <li><span>🚶 You start</span><b>${fmtTime(p.start)}</b></li>
      ${p.days === 1 ? `<li><span>🏔️ Reach the top</span><b>${fmtRange(p.top)}</b></li>` : ""}
      <li><span>${p.days > 1 ? "⛺ Reach camp (each day)" : inputs.ending === "oneway" ? `🚌 Reach the ${endName(inputs)}` : "🏁 Back at the start"}</span><b>${fmtRange(p.finish)}</b></li>
      <li><span>🌅 Sunset</span><b>${fmtTime(p.first.sunset)}</b></li>
      ${p.ride?.last ? `<li><span>Last ${p.ride.name} leaves</span><b>${fmtTime(p.ride.last)}</b></li>` : ""}
      ${p.light.startsInDark ? `<li><span>🌄 Sunrise</span><b>${fmtTime(p.first.sunrise)}</b></li>` : ""}
      ${p.light.latestStart < parseLocal(`${inputs.date}T00:00`)
        ? `<li class="hint"><span>This hike is longer than the daylight. Plan to hike part of it in the dark, with a charged headlamp.</span><b></b></li>`
        : `<li class="hint"><span>Latest start to finish 30 min before sunset, even if you get tired</span><b>${fmtTime(p.light.latestStart)}</b></li>`}
    </ul>
    <p class="range-note">Each range runs from "if you keep your pace" to "if you get tired." Real hikers' times change up to about 30% from one day to the next (heat, breaks, how you feel), so plan around the later time.${p.est.altitudeSlowdown ? ` This hike is high up (trailhead about ${U.elev(p.trailheadFt)}), so times include about ${p.est.altitudeSlowdown}% extra for thinner air.` : ""}</p>
    ${p.days === 1 ? `<p class="no-print">Want sunrise from the top? Start by <b>${fmtTime(p.light.sunriseAtTopStart)}</b> (sunrise is ${fmtTime(p.first.sunrise)}).
      <button type="button" id="sunrise-btn" class="link">Use this start time</button></p>` : ""}

    ${state.route ? profileChart(p, inputs) : ""}

    <div id="camp-box"></div>

    <h3>Weather ${p.days > 1 ? "by day" : "during your hike"}</h3>
    ${p.days > 1 ? dailyCards(p.daily) : weatherChart(p)}

    <h3>Pack list for these conditions</h3>
    ${gearList(p.gear)}

    <div class="actions no-print">
      <button type="button" id="save-btn">💾 Save for offline</button>
      <button type="button" id="share-btn" class="secondary">Share</button>
      <button type="button" id="print-btn" class="secondary">Print / PDF</button>
    </div>
    <p class="disclaimer">All estimates are a rough guide based on standard hiking rules of thumb, real recorded hikes and the forecast. Weather in the mountains changes fast. Check official sources (weather service, park offices) and turn back if conditions change.</p>`;

  if (p.days === 1) wireChart(p);
  if (state.route) wireProfile(p, inputs);
  fillCampBox(p, inputs);
  $("save-btn").addEventListener("click", saveTrip);
  $("print-btn").addEventListener("click", () => { track("print"); window.print(); });
  $("share-btn").addEventListener("click", () => shareTrip(p, inputs));
  $("sunrise-btn")?.addEventListener("click", () => {
    track("sunrise-start");
    const t = p.light.sunriseAtTopStart;
    state.inputs = { ...inputs, date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16) };
    $("date").value = state.inputs.date;
    $("time").value = state.inputs.time;
    render(savedName);
  });
  // gear checkboxes: a little tick sound-free "pop" and a counter of what's packed
  out.querySelectorAll(".gear input").forEach((c) => c.addEventListener("change", () => {
    const all = out.querySelectorAll(".gear input"), done = out.querySelectorAll(".gear input:checked").length;
    $("packed").textContent = done === all.length ? "All packed! 🎒✨" : `${done} of ${all.length} packed`;
    if (done === all.length) celebrate("Ready to go! 🎒");
    navigator.vibrate?.(6);
  }));
  if (!quiet) {
    out.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth" });
    countUp(out.querySelector(".count"));
    if (!savedName) celebrate(p.alerts.some((a) => a.level === "danger") ? "Plan ready. Read the warnings ⚠️" : "Your plan is ready! 🥾");
  }
}

// Sun bar: the day from dark to dark, with when you start, reach the top and finish, and a little
// hiker that walks from your start to your finish.
function daylightBar(p) {
  if (p.days > 1) return "";
  const from = Math.min(p.start, p.first.sunrise) - 3600e3, to = Math.max(p.finish.worst, p.first.sunset) + 3600e3;
  const pct = (d) => ((d - from) / (to - from)) * 100;
  const band = (r, cls, label) => `<div class="band ${cls}" style="left:${pct(r.best)}%;width:${Math.max(1, pct(r.worst) - pct(r.best))}%" title="${label} ${fmtRange(r)}"></div>`;
  return `<div class="sunbar" role="img" aria-label="Daylight from sunrise ${fmtTime(p.first.sunrise)} to sunset ${fmtTime(p.first.sunset)}; you finish ${fmtBetween(p.finish)}">
    <div class="sky" style="--rise:${pct(p.first.sunrise)}%;--set:${pct(p.first.sunset)}%"></div>
    ${band(p.top, "top-band", "Top")}
    ${band(p.finish, "finish-band", "Finish")}
    <div class="pin sun" style="left:${pct(p.first.sunset)}%"><span>🌅</span></div>
    <div class="walker" style="--from:${pct(p.start)}%;--to:${pct(p.finish.best)}%"><span>🥾</span></div>
    <div class="sunbar-labels"><span style="left:${pct(p.start)}%">Start ${fmtTime(p.start)}</span><span style="left:${pct(p.first.sunset)}%">Sunset ${fmtTime(p.first.sunset)}</span></div>
  </div>
  <div class="sunbar-key small muted"><span><i class="k top-band"></i>Reach the top</span><span><i class="k finish-band"></i>Finish</span><span><i class="k night"></i>Dark</span></div>`;
}

// Climb chart: the trail's height along the way. Slide a finger along it to see how high you are
// and when you'd get there at your pace. Water and campsites pop up on it once they load.
function profileChart(p, inputs) {
  return `<h3>The climb</h3>
    <div class="profile" id="profile">
      <svg role="img" aria-label="Trail elevation along the route"></svg>
      <div class="tip" id="pf-tip" hidden></div>
      <p class="small muted">Slide your finger along the trail to see when you'd be there. ${inputs.ending === "outback" ? "This is the way out; you come back the same way." : ""}</p>
    </div>`;
}

function profileModel(p, inputs) {
  const pts = state.route;
  const trackPts = routeEffort(pts);
  const slow = (inputs.nights > 0 ? 1.15 : 1) * (1 + p.est.altitudeSlowdown / 100);
  const pace = makePace(inputs);
  const ele = pts.map((x) => (Number.isFinite(x.ele) ? x.ele * 3.28084 : null));
  const known = ele.filter((x) => x !== null);
  return { pts, trackPts, slow, pace, ele, lo: Math.min(...known), hi: Math.max(...known), total: trackPts[trackPts.length - 1].mile };
}

function wireProfile(p, inputs) {
  const box = $("profile");
  if (!box) return;
  const m = profileModel(p, inputs);
  if (!Number.isFinite(m.lo)) { box.innerHTML = `<p class="small muted">This route has no elevation.</p>`; return; }
  // Drawn at the real width of the screen, so text and lines never get stretched.
  const W = Math.max(280, Math.round(box.clientWidth)), H = 200, T = 30, B = 24, L = 8, R = 8;
  const span = Math.max(30, m.hi - m.lo);
  const x = (mi) => L + (mi / m.total) * (W - L - R);
  const y = (ft) => T + (1 - (ft - m.lo) / span) * (H - T - B);
  const step = Math.max(1, Math.floor(m.pts.length / 220));
  const idx = m.pts.map((_, i) => i).filter((i) => m.ele[i] !== null && (i % step === 0 || i === m.pts.length - 1));
  const line = idx.map((i) => `${x(m.trackPts[i].mile).toFixed(1)},${y(m.ele[i]).toFixed(1)}`);
  const svg = box.querySelector("svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const topI = idx.reduce((a, i) => (m.ele[i] > m.ele[a] ? i : a), idx[0]);
  svg.innerHTML = `
    <defs><linearGradient id="pf-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".45"/><stop offset="1" stop-color="var(--brand)" stop-opacity=".05"/></linearGradient></defs>
    <path class="pf-area" d="M${x(0)},${H - B} L${line.join(" L")} L${x(m.total)},${H - B} Z" fill="url(#pf-fill)"/>
    <path class="pf-line" d="M${line.join(" L")}"/>
    <text class="axis" x="${L}" y="${H - 6}">${U.metric() ? "0 km" : "0 mi"}</text>
    <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${U.dist(m.total)}</text>
    <text class="axis top-label" x="${Math.max(40, Math.min(W - 40, x(m.trackPts[topI].mile)))}" y="${Math.max(14, y(m.ele[topI]) - 10)}" text-anchor="middle">▲ ${U.elevExact(m.ele[topI])}</text>
    <g id="pf-pins"></g>
    <line id="pf-cross" class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <circle id="pf-dot" class="dot s1" r="5" visibility="hidden"/>
    <rect class="hit" x="0" y="0" width="${W}" height="${H}"/>`;
  // draw-in animation
  const pl = svg.querySelector(".pf-line");
  if (!reduceMotion() && pl.getTotalLength) {
    const len = pl.getTotalLength();
    pl.style.strokeDasharray = len; pl.style.strokeDashoffset = len;
    requestAnimationFrame(() => { pl.style.transition = "stroke-dashoffset 1.2s ease"; pl.style.strokeDashoffset = 0; });
  }
  state.profile = { x, y, m, H, B };
  const tip = $("pf-tip"), cross = $("pf-cross"), dot = $("pf-dot");
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const mi = Math.max(0, Math.min(m.total, (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * m.total));
    let i = m.trackPts.findIndex((t) => t.mile >= mi);
    if (i < 0) i = m.trackPts.length - 1;
    const e2 = m.ele[i] ?? m.lo;
    const eta = timeRange(m.trackPts[i].effort * m.slow, m.pace);
    cross.setAttribute("x1", x(m.trackPts[i].mile)); cross.setAttribute("x2", x(m.trackPts[i].mile)); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(m.trackPts[i].mile)); dot.setAttribute("cy", y(e2)); dot.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-head">${atMile(m.trackPts[i].mile)} · ${U.elevExact(e2)}</div><b>${fmtRange({ best: addHours(p.start, eta.best), worst: addHours(p.start, eta.worst) })}</b> you'd be here`;
    tip.style.left = `${Math.min(Math.max(((x(m.trackPts[i].mile) / W) * r.width) - 80, 0), r.width - 170)}px`;
    tip.style.top = `${Math.min(y(e2) + 18, H - 70)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);
}

// Water drops and tents on the climb chart.
function pinProfile(items) {
  const g = $("pf-pins"), pf = state.profile;
  if (!g || !pf) return;
  g.innerHTML = items.map((it, k) => {
    let i = pf.m.trackPts.findIndex((t) => t.mile >= it.mile);
    if (i < 0) i = pf.m.trackPts.length - 1;
    const cx = pf.x(pf.m.trackPts[i].mile), cy = pf.y(pf.m.ele[i] ?? pf.m.lo);
    return `<text class="pin-emoji" x="${cx}" y="${cy - 6}" text-anchor="middle" style="animation-delay:${k * 60}ms">${it.icon}<title>${esc(it.label)}</title></text>`;
  }).join("");
}

// ---------- Where to camp and where to find water ----------
const CAMP_KIND = (c) => c.kind === "ground" ? "Campground" : c.flags.includes("p") ? "Tent spot" : c.flags.includes("b") ? "Backcountry site" : "Campsite";
const mapLink = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
const waterText = (w) => w ? `${w.kind === "spring" ? "Spring" : "Water tap"}${w.name ? ` (${esc(w.name)})` : ""} ${w.d < 0.1 ? "right there" : `${U.dist(w.d)} away`}${w.kind === "spring" && !w.drinkable ? ", filter it" : ""}` : `No mapped water within ${U.dist(1, 1)}`;
const inUS = () => !state.place?.country || state.place.country === "US";

async function fillCampBox(p, inputs) {
  const box = $("camp-box");
  if (!box) return;
  const route = state.route;
  const backpacking = inputs.nights > 0;
  if (!route && !backpacking) return; // a day hike without a route: nothing to add

  box.innerHTML = `<p class="muted small loading"><span class="spinner" aria-hidden="true"></span> Looking for ${backpacking ? "campsites and " : ""}water near your trail…</p>`;
  // The area to load: around the route, or about 15 km around the trailhead.
  const pts = route || [{ lat: state.place.lat, lon: state.place.lon }];
  const pad = route ? 0.03 : 0.12;
  const lats = pts.map((x) => x.lat), lons = pts.map((x) => x.lon);
  const { rows: places, source } = await placesAround(Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad);
  if ($("camp-box") !== box) return; // the plan changed while loading
  if (source === "none") {
    box.innerHTML = `<h3>${backpacking ? "Where to camp" : "Water on the way"}</h3><p class="muted">No campsites or water are mapped near this trail on OpenStreetMap (or the map service is busy right now). Carry all your water, and check the park or local office for where you can camp.</p>`;
    return;
  }

  let html = "";
  const pins = [];
  if (backpacking && route) {
    const slow = 1.15 * (1 + p.est.altitudeSlowdown / 100); // full pack and thin air, same as the rest of the plan
    const { camps, pick, cutoff, reach } = campsAlongRoute({ points: route, places, start: p.start, sunset: p.first.sunset, pace: makePace(inputs), slow });
    const shown = camps.filter((c) => c.status !== "late").slice(-8);
    const late = camps.filter((c) => c.status === "late").length;
    camps.forEach((c) => pins.push({ mile: c.mile, icon: c === pick ? "⭐" : "⛺", label: `${c.name || CAMP_KIND(c)} · ${atMile(c.mile)}` }));
    html += `<h3>Where to camp tonight ⛺</h3>
      <p class="small muted">Campsites within about ${U.dist(0.35)} of your trail, at your pace. "Easy" means you get there at least 45 minutes before sunset (${fmtTime(p.first.sunset)}) to set up, even if you get tired.</p>`;
    // Where you'll be when it's time to stop, even if you get tired (helps most when no campsite is mapped).
    if (reach?.end) {
      html += `<div class="camp reach"><b>You can reach the end of this trail before ${fmtTime(cutoff)}</b> <span class="muted">(set-up time, even if you get tired)</span></div>`;
    } else if (reach) {
      html += `<div class="camp reach"><b>By ${fmtTime(cutoff)} you'll be around ${atMile(reach.mile)}</b> <span class="muted">(even if you get tired)</span>
        <div class="small land" data-lat="${reach.lat}" data-lon="${reach.lon}" data-kind="spot"></div>
        <div class="small"><a href="${mapLink(reach.lat, reach.lon)}" target="_blank" rel="noopener">See it on the map</a></div></div>`;
    }
    if (!camps.length) {
      html += `<p>No campsites are mapped near this trail. Wild or dispersed camping may still be allowed, so check the rules for where you plan to stop${reach && !reach.end ? " (above)" : ""}.</p>`;
    } else if (!shown.length) {
      html += `<div class="alert warn">You can't reach any mapped campsite before dark at your pace. Start earlier (set up by ${fmtTime(cutoff)}) or plan a shorter first day.</div>`;
    } else {
      if (pick) html += campCard(pick, true);
      html += `<ul class="camp-list">${shown.filter((c) => c !== pick).reverse().map((c) => `<li>${campCard(c, false)}</li>`).join("")}</ul>`;
      if (late) html += `<p class="small muted">${late} more campsite${late > 1 ? "s" : ""} farther along that you'd reach after dark.</p>`;
    }
  } else if (backpacking) {
    // No route: show the closest campsites to the trailhead, and ask for a route for the "before dark" part.
    const near = places.filter((x) => x[2] === "camp" || x[2] === "ground")
      .map((x) => ({ lat: x[0], lon: x[1], kind: x[2], name: x[3], flags: x[4], ridbId: x[5], d: milesBetween({ lat: x[0], lon: x[1] }, state.place) }))
      .sort((a, b) => a.d - b.d).slice(0, 5);
    html += `<h3>Campsites near the trailhead ⛺</h3>
      <p class="small muted">Search a trail (or use a GPX file) above to see which campsites you can reach before dark at your pace.</p>
      ${near.length ? `<ul class="camp-list">${near.map((c) => `<li><div class="camp"><b>${esc(c.name || CAMP_KIND(c))}</b> <span class="muted">· ${CAMP_KIND(c)} · ${U.dist(c.d)} away</span>
        <div class="small land" data-lat="${c.lat}" data-lon="${c.lon}" data-kind="${c.kind}"></div>
        <div class="small"><a href="${mapLink(c.lat, c.lon)}" target="_blank" rel="noopener">Map</a>${c.ridbId ? ` · <a href="https://www.recreation.gov/camping/campgrounds/${c.ridbId}" target="_blank" rel="noopener">Book on Recreation.gov</a>` : ""}</div></div></li>`).join("")}</ul>` : `<p class="muted">No campsites mapped nearby.</p>`}`;
  }

  if (route) {
    const water = waterAlongRoute(route, places);
    water.forEach((w) => pins.push({ mile: w.mile, icon: "💧", label: `${w.kind === "spring" ? "Spring" : "Water"} · ${atMile(w.mile)}` }));
    html += `<h3>Water on the way 💧</h3>`;
    html += water.length
      ? `<ul class="water-list">${water.slice(0, 12).map((w) => `<li><span>${atMile(w.mile)}</span> ${w.kind === "spring" ? "Spring" : "Water tap"}${w.name ? ` · ${esc(w.name)}` : ""}${w.offTrailMi >= 0.1 ? ` <span class="muted">(${U.dist(w.offTrailMi)} off trail)</span>` : ""}${w.kind === "spring" && !w.drinkable ? ` <span class="muted">· filter or treat</span>` : ""}</li>`).join("")}</ul>
         <p class="small muted">Springs can be dry, especially in summer or in the desert. Check recent trip reports, and carry enough to reach the next sure source.</p>`
      : `<p class="muted">No mapped springs or taps within ${U.dist(0.25, 2)} of this trail. Carry all your water.</p>`;
  }
  html += `<p class="small muted">Campsites and water: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors${source === "files" ? " and Recreation.gov" : ""}.${inUS() ? " Land: Bureau of Land Management." : ""} Rules change (fire bans, closures), so check with the park or land office before you go.</p>`;
  box.innerHTML = html;
  pinProfile(pins);
  track(backpacking ? "camps-shown" : "water-shown");

  // "Whose land is this?" for each campsite shown (a campground is always fine to camp at). US only:
  // the land map covers the United States; elsewhere rules depend on the country and the park.
  for (const el of box.querySelectorAll(".land")) {
    if (el.dataset.kind === "ground") { el.textContent = "Campground: camping allowed (may need a reservation)."; continue; }
    if (!inUS()) { el.textContent = "Camping rules depend on the country and the park. Check with the local office."; el.classList.add("check"); continue; }
    el.textContent = "Checking whose land this is…";
    landAt(+el.dataset.lat, +el.dataset.lon).then((code) => {
      const r = campRules(code);
      el.textContent = `${r.label}: ${r.rule}`;
      el.classList.add(r.ok === true ? "ok" : r.ok === false ? "no" : "check");
    });
  }
}

function campCard(c, isPick) {
  const when = c.status === "easy" ? `Arrive ${fmtRange({ best: c.arriveBest, worst: c.arriveWorst })}` : `Only if you keep your pace: ${fmtTime(c.arriveBest)}`;
  return `<div class="camp${isPick ? " pick" : ""}">
    ${isPick ? `<div class="label">⭐ Best pick</div>` : ""}
    <b>${esc(c.name || CAMP_KIND(c))}</b> <span class="muted">· ${CAMP_KIND(c)} · ${atMile(c.mile)}${c.offTrailMi >= 0.1 ? ` (${U.dist(c.offTrailMi)} off trail)` : ""}</span>
    <span class="tag ${c.status}">${c.status === "easy" ? "Easy before dark" : "Tight"}</span>
    <div class="small">${when}</div>
    <div class="small">💧 ${waterText(c.water)}</div>
    <div class="small land" data-lat="${c.lat}" data-lon="${c.lon}" data-kind="${c.kind}"></div>
    <div class="small"><a href="${mapLink(c.lat, c.lon)}" target="_blank" rel="noopener">Map</a>${c.ridbId ? ` · <a href="https://www.recreation.gov/camping/campgrounds/${c.ridbId}" target="_blank" rel="noopener">Book on Recreation.gov</a>` : ""}</div>
  </div>`;
}

function rideAlert(p) {
  if (!p.ride) return "";
  const { name, last, level } = p.ride;
  if (level === "danger") return `<div class="alert danger">Even at your pace you'd reach the ${name} around ${fmtTime(p.finish.best)}, after the last one leaves at ${fmtTime(last)}. Start earlier or plan another way down.</div>`;
  if (level === "warn") return `<div class="alert warn">If you get tired, you could miss the last ${name} at ${fmtTime(last)} (you'd arrive ${fmtBetween(p.finish)}). Start earlier to be safe.</div>`;
  if (level === "ok") return "";
  if (name === "car pickup") return `<div class="alert warn">Tell your ride you'll arrive ${fmtBetween(p.finish)}.</div>`;
  return `<div class="alert warn">Check when the last ${name} leaves and enter it above, so hikepace can warn you if you might miss it.</div>`;
}

// Weather icon for a WMO code; a moon instead of a sun at night.
function weatherIcon(code, night) {
  if (code === 0) return night ? "🌙" : "☀️";
  if (code <= 2) return night ? "☁️" : "⛅";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67 || (code >= 80 && code <= 82)) return "🌧️";
  if (code <= 77 || code <= 86) return "❄️";
  return "⛈️";
}

// Temperature over the hike as a line chart (inline SVG): "feels like" at the trailhead and
// at the top, night shaded, freezing marked, and when you reach the top and finish.
// Hovering or tapping shows every number for that hour. A table view sits underneath.
function weatherChart(p) {
  const hrs = p.hours;
  const climb = p.inputs.upGainFt;
  const W = 700, H = 230, L = 40, R = 16, T = 14, B = 30;
  const t0 = hrs[0].time.getTime(), t1 = hrs[hrs.length - 1].time.getTime();
  const x = (d) => L + ((d.getTime() - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const base = hrs.map((h) => U.toTemp(h.feels));
  const tops = hrs.map((h) => U.toTemp(tempAtTop(h.feels, climb)));
  const stepT = U.metric() ? 5 : 10;
  let lo = Math.floor((Math.min(...tops, ...base) - 2) / stepT) * stepT;
  let hi = Math.ceil((Math.max(...base, ...tops) + 2) / stepT) * stepT;
  if (hi - lo < stepT * 2) hi = lo + stepT * 2;
  const y = (f) => T + ((hi - f) / (hi - lo)) * (H - T - B);
  const line = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(hrs[i].time).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [];
  for (let f = lo; f <= hi; f += stepT) ticks.push(f);
  const step = hrs.length > 12 ? 3 : 2;
  const night = (d) => d < p.first.sunrise || d > p.first.sunset;
  const clampX = (d) => Math.max(L, Math.min(W - R, x(d)));
  const mid = (r) => new Date((r.best.getTime() + r.worst.getTime()) / 2);
  const marks = [
    { at: mid(p.top), label: "Top" },
    { at: mid(p.finish), label: p.inputs.ending === "oneway" ? "End" : "Finish" },
  ].filter((m) => m.at.getTime() >= t0 && m.at.getTime() <= t1);
  const lastI = hrs.length - 1;
  const fz = U.toTemp(32);

  return `
    <div class="chart" id="wx-chart">
      <div class="legend"><span><i class="key s1"></i>Feels like at the trailhead</span><span><i class="key s2"></i>Feels like at the top (estimated)</span></div>
      <div class="chart-box">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Feels-like temperature during the hike, at the trailhead and at the top">
          ${t0 < p.first.sunrise.getTime() ? `<rect class="night" x="${L}" y="${T}" width="${Math.max(0, clampX(p.first.sunrise) - L)}" height="${H - T - B}"/>` : ""}
          ${p.first.sunset.getTime() < t1 ? `<rect class="night" x="${clampX(p.first.sunset)}" y="${T}" width="${W - R - clampX(p.first.sunset)}" height="${H - T - B}"/>` : ""}
          ${ticks.map((f) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(f)}" y2="${y(f)}"/><text class="axis" x="${L - 6}" y="${y(f) + 4}" text-anchor="end">${f}°</text>`).join("")}
          ${fz > lo && fz < hi ? `<line class="freeze" x1="${L}" x2="${W - R}" y1="${y(fz)}" y2="${y(fz)}"/><text class="axis" x="${W - R}" y="${y(fz) - 4}" text-anchor="end">Freezing ${U.freezing()}</text>` : ""}
          ${marks.map((m) => `<line class="mark" x1="${x(m.at)}" x2="${x(m.at)}" y1="${T}" y2="${H - B}"/><text class="mark-label" x="${x(m.at) + 4}" y="${T + 11}">${m.label} ~${fmtTime(m.at)}</text>`).join("")}
          ${hrs.map((h, i) => (i % step ? "" : `<text class="axis" x="${x(h.time)}" y="${H - 10}" text-anchor="middle">${fmtTime(h.time).replace(":00", "")}</text>`)).join("")}
          <path class="ln s1" d="${line(base)}"/>
          <path class="ln s2" d="${line(tops)}"/>
          <circle class="dot s1" cx="${x(hrs[lastI].time)}" cy="${y(base[lastI])}" r="4"/>
          <circle class="dot s2" cx="${x(hrs[lastI].time)}" cy="${y(tops[lastI])}" r="4"/>
          <line class="cross" id="wx-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
          <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
        </svg>
        <div class="tip" id="wx-tip" hidden></div>
      </div>
      <p class="small muted">Shaded = dark. The top line is estimated from your climb (${U.metric() ? "about 6.5°C colder per 1,000 m" : "about 3.5°F colder per 1,000 ft"}).</p>
      <div class="hour-strip">${hrs.map((h) => `
        <div class="hour"><div class="h-time">${fmtTime(h.time).replace(":00", "")}</div><div class="h-icon">${weatherIcon(h.code, night(h.time))}</div>
          <div class="h-temp">${U.deg(h.feels)}</div><div class="h-sub">💧${h.rain}%</div><div class="h-sub">💨${U.speed(h.gust).split(" ")[0]}</div></div>`).join("")}
      </div>
      <details class="no-print"><summary>Show as a table</summary>${hourlyTable(hrs)}</details>
    </div>`;
}

// Crosshair + tooltip for the weather chart (mouse, touch and pen).
function wireChart(p) {
  const box = document.querySelector("#wx-chart .chart-box");
  if (!box) return;
  const svg = box.querySelector("svg"), cross = $("wx-cross"), tip = $("wx-tip");
  const hrs = p.hours, climb = p.inputs.upGainFt;
  const t0 = hrs[0].time.getTime(), t1 = hrs[hrs.length - 1].time.getTime();
  const show = (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * 700;
    const t = t0 + ((sx - 40) / (700 - 56)) * (t1 - t0);
    let i = hrs.findIndex((h) => h.time.getTime() >= t);
    if (i < 0) i = hrs.length - 1;
    if (i > 0 && t - hrs[i - 1].time.getTime() < hrs[i].time.getTime() - t) i -= 1;
    const h = hrs[i];
    const cx = 40 + ((h.time.getTime() - t0) / Math.max(1, t1 - t0)) * (700 - 56);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.replaceChildren();
    const row = (val, label, cls) => {
      const d = document.createElement("div");
      if (cls) { const k = document.createElement("i"); k.className = `key ${cls}`; d.appendChild(k); }
      const b = document.createElement("b"); b.textContent = val; d.appendChild(b);
      d.appendChild(document.createTextNode(` ${label}`));
      tip.appendChild(d);
    };
    const head = document.createElement("div"); head.className = "tip-head";
    head.textContent = `${fmtTime(h.time)} · ${describeWeather(h.code)}`; tip.appendChild(head);
    row(U.temp(h.feels), "trailhead", "s1");
    row(U.temp(tempAtTop(h.feels, climb)), "top", "s2");
    row(`${h.rain}%`, "chance of rain");
    row(`${U.speed(h.wind)} / ${U.speed(h.gust)}`, "wind / gusts");
    const left = (cx / 700) * r.width;
    tip.style.left = `${Math.min(Math.max(left + 10, 0), r.width - 170)}px`;
  };
  const hide = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", hide);
  window.addEventListener("resize", hide);
}

function hourlyTable(hours) {
  return `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Sky</th><th>Temp</th><th>Feels</th><th>Rain</th><th>Wind / gust</th><th>UV</th></tr></thead><tbody>
    ${hours.map((h) => `<tr class="${isThunder(h.code) ? "danger-row" : ""}"><td>${fmtTime(h.time)}</td><td>${describeWeather(h.code)}</td><td>${U.deg(h.temp)}</td><td>${U.deg(h.feels)}</td><td>${h.rain}%</td><td>${U.speed(h.wind).split(" ")[0]} / ${U.speed(h.gust)}</td><td>${Math.round(h.uv)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function dailyCards(days) {
  return `<div class="day-cards">${days.map((d) => `
    <div class="day-card"><div class="h-time">${fmtDay(parseLocal(d.date + "T12:00"))}</div><div class="d-icon">${weatherIcon(d.code, false)}</div>
      <div><b>${U.deg(d.max)}</b> / ${U.deg(d.min)}</div><div class="small muted">${describeWeather(d.code)}${d.snowCm ? ` · ${Math.round(d.snowCm)} cm snow` : ""}</div>
      <div class="small muted">☀ ${fmtTime(d.sunrise)} – ${fmtTime(d.sunset)}</div></div>`).join("")}</div>`;
}

function gearList(items) {
  const groups = [...new Set(items.map((g) => g.group))];
  return `<p id="packed" class="packed small">Tick things off as you pack</p>` + groups.map((grp) => `<h4 class="gear-group">${grp}</h4><ul class="gear">${items.filter((g) => g.group === grp)
    .map((g) => `<li><label><input type="checkbox"> <b>${g.item}</b></label><span class="small muted">${g.why}</span></li>`).join("")}</ul>`).join("");
}

// ---------- Fun bits ----------
// A short burst of confetti and a toast when a plan is ready. Skipped for people who turn off motion.
function celebrate(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
  navigator.vibrate?.([10, 40, 10]);
  if (reduceMotion()) return;
  const cv = document.createElement("canvas");
  cv.className = "confetti";
  document.body.appendChild(cv);
  const s = devicePixelRatio || 1, ctx = cv.getContext("2d");
  cv.width = innerWidth * s; cv.height = innerHeight * s; ctx.scale(s, s);
  const colors = ["#2f7d62", "#f0a35e", "#f7d34a", "#5aa7de", "#e86f6f", "#9bd17a"];
  const bits = Array.from({ length: 90 }, (_, i) => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 60, y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 12, vy: -6 - Math.random() * 9, r: 3 + Math.random() * 4,
    spin: Math.random() * 6, vs: (Math.random() - 0.5) * 0.4, c: colors[i % colors.length],
  }));
  const t0 = performance.now();
  const draw = (now) => {
    const t = now - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 0.35; b.x += b.vx; b.y += b.vy; b.vx *= 0.99; b.spin += b.vs;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.spin);
      ctx.globalAlpha = Math.max(0, 1 - t / 1800); ctx.fillStyle = b.c;
      ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r); ctx.restore();
    }
    if (t < 1800) requestAnimationFrame(draw); else cv.remove();
  };
  requestAnimationFrame(draw);
}

// The big time counts up when the plan appears.
function countUp(el) {
  if (!el || reduceMotion()) return;
  const to = +el.dataset.to, t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / 700);
    el.textContent = formatDuration(Math.max(0.05, to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Share the plan as text (the phone's share sheet, or copy to clipboard).
async function shareTrip(p, inputs) {
  const text = `🥾 ${state.place.name}, ${fmtDay(p.start)}\n` +
    `Start ${fmtTime(p.start)} · back ${fmtRange(p.finish)} · sunset ${fmtTime(p.first.sunset)}\n` +
    `${U.dist(p.est.totalMiles)}, ${U.elev(p.est.totalGainFt)} up · water ${p.water.total[0]}–${p.water.total[1]} L\n` +
    `Planned with hikepace: https://suhibug.github.io/hikepace/`;
  track("share");
  try {
    if (navigator.share) await navigator.share({ title: "My hike plan", text });
    else { await navigator.clipboard.writeText(text); celebrate("Copied! Paste it to your hiking buddy 📋"); }
  } catch { /* closed the share sheet */ }
}

// ---------- Saved trips (work offline) ----------
function loadTrips() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function storeTrips(trips) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(trips)); return true; } catch { return false; }
}

function saveTrip() {
  track("save-trip");
  const trips = loadTrips().filter((t) => !(t.place.name === state.place.name && t.inputs.date === state.inputs.date));
  trips.unshift({ id: Date.now(), savedAt: new Date().toISOString(), place: state.place, inputs: state.inputs, forecast: state.forecast, route: state.route });
  if (!storeTrips(trips.slice(0, 20))) return alert("Could not save on this device.");
  $("save-btn").textContent = "Saved ✓";
  celebrate("Saved! Works without signal 📶");
  renderSaved();
}

function tripMiles(raw) {
  const i = normalizeInputs(raw);
  return i.upMiles + (i.ending === "outback" ? i.upMiles : i.backMiles);
}

function renderSaved() {
  const trips = loadTrips();
  $("saved").hidden = !trips.length;
  $("saved-list").innerHTML = trips.map((t) => `
    <li><button type="button" data-open="${t.id}">🗺️ ${esc(t.place.name)} · ${t.inputs.date} · ${U.dist(tripMiles(t.inputs))}</button>
    <button type="button" class="link" data-del="${t.id}">Delete</button></li>`).join("");
}

$("saved-list").addEventListener("click", (e) => {
  const open = e.target.closest("[data-open]")?.dataset.open, del = e.target.closest("[data-del]")?.dataset.del;
  const trips = loadTrips();
  if (open) {
    const t = trips.find((x) => String(x.id) === open);
    Object.assign(state, { place: t.place, inputs: t.inputs, forecast: t.forecast, route: t.route || null, savedName: new Date(t.savedAt).toLocaleString() });
    render(state.savedName);
  }
  if (del) {
    storeTrips(trips.filter((x) => String(x.id) !== del));
    renderSaved();
  }
});

// ---------- Start up ----------
$("plan-form").addEventListener("input", updateForm);
$("plan-form").addEventListener("change", updateForm);
$("gpx-help-link").addEventListener("click", (e) => {
  e.preventDefault();
  const box = $("gpx-help");
  box.hidden = !box.hidden;
  box.innerHTML = `A GPX file is a route saved as a file. You usually don't need one: just search the trail's name. If you have one:
    <ul>
      <li><b>Garmin, Coros, Apple Watch or Strava</b>: a hike you recorded can be exported as GPX, and hikepace learns your pace from it.</li>
      <li><b>CalTopo</b> (free account): draw the route on the map, then export it as GPX.</li>
      <li><b>AllTrails</b>: some trail pages let you download the route (may need their paid membership).</li>
    </ul>`;
});
showUnits();
renderPaceCards();
showPace();
updateForm();
const today = new Date();
$("date").value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
renderSaved();
const setOnline = () => $("offline-note").hidden = navigator.onLine;
window.addEventListener("online", setOnline);
window.addEventListener("offline", setOnline);
setOnline();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
