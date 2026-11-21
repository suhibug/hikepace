// Trail Prep: page logic. Weather comes from Open-Meteo (free, no account or key).
import {
  PACES, ENDINGS, END_TYPES, estimateHike, paceFactor, describePace, tempAtTop, estimateWater, estimateFood,
  gearChecklist, warnings, describeWeather, isThunder, addHours, formatDuration, routeStats,
  campsAlongRoute, waterAlongRoute, campRules, milesBetween,
} from "./calc.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "trailprep.trips";
// route = the GPX points when a route was imported (needed for "where can I camp?" and water along the way).
const state = { place: null, forecast: null, inputs: null, route: null };

// ---------- Times ----------
// Open-Meteo gives times in the trail's own time zone. We keep every time as a
// "trail-local" clock time (stored as UTC under the hood), so the plan reads
// correctly no matter where the phone is.
const parseLocal = (s) => new Date(s.length === 16 ? s + ":00Z" : s + "Z");
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

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

// ---------- Place search ----------
// One box takes a trail name, landmark, peak, town, or coordinates.
// Trails and landmarks come from OpenStreetMap (free; asks for at most 1 search per second).
// Towns come from Open-Meteo as a backup.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const OSM_TYPES = {
  path: "Trail", footway: "Trail", track: "Trail", bridleway: "Trail", trailhead: "Trailhead",
  peak: "Peak", saddle: "Pass", ridge: "Ridge", cliff: "Cliff", spring: "Spring", waterfall: "Waterfall",
  attraction: "Landmark", viewpoint: "Viewpoint", camp_site: "Campground", picnic_site: "Picnic area",
  parking: "Parking", nature_reserve: "Park", national_park: "Park", protected_area: "Park", park: "Park",
  city: "Town", town: "Town", village: "Town", hamlet: "Town", administrative: "Town",
};

async function osmSearch(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`;
  let res;
  try { res = await fetch(url, { headers: { "Accept-Language": "en" } }); } catch { return []; } // busy or offline: fall back to towns
  if (!res.ok) return [];
  return (await res.json()).map((x) => ({
    name: x.name || x.display_name.split(",")[0],
    area: [x.address?.city || x.address?.town || x.address?.county, x.address?.state, x.address?.country_code?.toUpperCase()].filter(Boolean).join(", "),
    region: x.address?.country_code === "us" ? x.address?.state : x.address?.country,
    type: OSM_TYPES[x.type] || "Place",
    latitude: +x.lat,
    longitude: +x.lon,
  }));
}

async function townSearch(q) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  return ((await res.json()).results || []).map((x) => ({
    name: x.name, area: [x.admin1, x.country_code].filter(Boolean).join(", "), type: "Town", latitude: x.latitude, longitude: x.longitude,
    region: x.country_code === "US" ? x.admin1 : x.country,
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

  // Drop near-duplicates (same spot found twice).
  const seen = new Set();
  return results.filter((r) => {
    const key = `${r.latitude.toFixed(3)},${r.longitude.toFixed(3)}`;
    return seen.has(key) ? false : seen.add(key);
  }).slice(0, 8);
}

function placeLabel(p) {
  return `${p.name}${p.area ? ` · ${p.area}` : ""}`;
}

function choosePlace(p) {
  state.route = p.route || null; // a searched place has no route; an imported GPX does
  state.place = { name: placeLabel(p), lat: p.latitude, lon: p.longitude, region: p.region || "Unknown" };
  $("place-results").innerHTML = "";
  $("place-chosen").textContent = `✓ ${state.place.name} (${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)})`;
  if (Number.isFinite(p.elevFt)) return setTrailheadElev(p.elevFt, "From your GPX file.");
  lookUpElevation(p.latitude, p.longitude);
}

// Fill in the starting elevation (used for thin-air time) and say where it came from,
// so people can fix it when the spot they picked is the summit or a lake, not the trailhead.
function setTrailheadElev(ft, note) {
  $("trailhead-elev").value = ft;
  $("elev-note").textContent = note;
}

async function lookUpElevation(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
    const m = (await res.json()).elevation?.[0];
    if (Number.isFinite(m)) setTrailheadElev(Math.round(m * 3.28084), "From the map spot you picked. If that's a summit or a lake, change it to the trailhead's elevation (it's on AllTrails or your map).");
  } catch {
    $("elev-note").textContent = "Couldn't look it up. Add it if you know it.";
  }
}

$("place-search").addEventListener("click", async () => {
  const q = $("place").value.trim();
  if (!q) return;
  state.place = null;
  $("place-chosen").textContent = "";
  $("place-results").innerHTML = "<li>Searching trails, landmarks and towns…</li>";
  try {
    track("search");
    const results = await searchPlaces(q);
    $("place-results").innerHTML = "";
    if (!results.length) {
      $("place-results").innerHTML = "<li>No match. Try one landmark on the trail (like a peak or the trailhead), the nearest town, or paste coordinates like 34.885, -111.782.</li>";
      return;
    }
    if (results.length === 1 && !results[0].matched) return choosePlace(results[0]);
    if (results.some((r) => r.matched)) {
      $("place-results").innerHTML = "<li>No exact match for the full name, so here are places on your trail. Pick the one closest to where you start.</li>";
    }
    for (const r of results) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<b></b> <span class="tag"></span><br><span class="small muted"></span>`;
      b.querySelector("b").textContent = r.name;
      // Skip the tag when the name already says it ("Soldier Pass" is already a pass).
      if (!r.name.toLowerCase().includes(r.type.toLowerCase())) b.querySelector(".tag").textContent = r.type;
      else b.querySelector(".tag").remove();
      b.querySelector(".muted").textContent = r.area;
      b.addEventListener("click", () => choosePlace(r));
      li.appendChild(b);
      $("place-results").appendChild(li);
    }
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
    (pos) => choosePlace({ name: "My location", latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
    () => alert("Could not get your location."),
  );
});

// ---------- Import a route (GPX) ----------
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

// Look up which town and state the route starts in, so the forecast and labels make sense.
async function describeSpot(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&lat=${lat}&lon=${lon}`, { headers: { "Accept-Language": "en" } });
    const a = (await res.json()).address || {};
    return {
      area: [a.city || a.town || a.village || a.county, a.state, a.country_code?.toUpperCase()].filter(Boolean).join(", "),
      region: a.country_code === "us" ? a.state : a.country,
    };
  } catch {
    return { area: "", region: "Unknown" };
  }
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
    const r = routeStats(points);
    const setVal = (id, v) => { $(id).value = v ?? ""; };

    // The way up = start to the highest point. The way back = the rest of the route.
    setVal("up-miles", r.gainFt !== null ? r.topMiles : r.miles);
    setVal("up-gain", r.topGainFt);
    $("ending").value = r.isLoop ? "loop" : "oneway";
    setVal("back-miles", r.gainFt !== null ? Math.round((r.miles - r.topMiles) * 10) / 10 : 0);
    setVal("back-gain", r.gainFt !== null ? Math.max(0, r.gainFt - r.topGainFt) : "");
    updateForm();
    const spot = await describeSpot(r.start.lat, r.start.lon);
    choosePlace({ name: name || "Route start", area: spot.area, region: spot.region, latitude: r.start.lat, longitude: r.start.lon, route: points,
      elevFt: Number.isFinite(r.start.ele) ? Math.round(r.start.ele * 3.28084) : undefined });
    $("place").value = name || "";
    track("gpx-import");

    status.innerHTML = "";
    const line = document.createElement("div");
    line.textContent = `✓ Imported ${name ? `"${name}"` : "your route"}: ${r.miles} mi` +
      (r.gainFt !== null
        ? `, ${r.gainFt.toLocaleString()} ft of climbing. The top (${r.highFt.toLocaleString()} ft) is at mile ${r.topMiles}.`
        : ". This file has no elevation, so please add the climb yourself.");
    status.appendChild(line);
    if (!r.isLoop) {
      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = `This route ends ${r.gapMiles} mi from where it starts, so I set the way back to a tram, shuttle or car. Pick which one below. If you'll walk back the same trail instead, tap here:`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = "I'll hike back the same way";
      btn.addEventListener("click", () => {
        // The whole route becomes the way out; every descent on the way out is a climb on the way back.
        setVal("up-miles", r.miles);
        setVal("up-gain", r.gainFt);
        setVal("back-gain", r.gainFt !== null ? r.outAndBackGainFt - r.gainFt : "");
        $("ending").value = "outback";
        updateForm();
        note.textContent = "✓ Set to hike back the same way.";
      });
      note.appendChild(document.createElement("br"));
      note.appendChild(btn);
      status.appendChild(note);
    }
    // A recorded hike (not just a planned route) has times, so it can teach us the hiker's pace.
    if (r.elapsedHours > 0.25 && r.gainFt !== null) {
      const useTop = r.topHours > 0.25 && r.topMiles > 0;
      const rec = document.createElement("div");
      rec.className = "muted";
      rec.textContent = `This looks like a hike you recorded: ${useTop ? `${formatDuration(r.topHours)} to the top, ` : ""}${formatDuration(r.elapsedHours)} in total.`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = "Use this hike to learn my pace";
      btn.addEventListener("click", () => {
        setVal("past-miles", useTop ? r.topMiles : r.miles);
        setVal("past-gain", useTop ? r.topGainFt : r.gainFt);
        setVal("past-hours", Math.round((useTop ? r.topHours : r.elapsedHours) * 100) / 100);
        $("pace").value = "custom";
        saveMyPace(Number.isFinite(r.start.ele) ? Math.round(r.start.ele * 3.28084) : undefined);
        rec.textContent = "✓ Saved as your pace. Now import or enter the hike you're planning.";
      });
      rec.appendChild(document.createElement("br"));
      rec.appendChild(btn);
      status.appendChild(rec);
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
    upMiles: +$("up-miles").value,
    upGainFt: +$("up-gain").value || 0,
    trailheadFt: $("trailhead-elev").value === "" ? null : +$("trailhead-elev").value,
    ending,
    endType: $("end-type").value,
    backMiles: ending === "outback" ? 0 : +$("back-miles").value || 0,
    backGainFt: +$("back-gain").value || 0,
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
  $("back-miles-label").textContent = i.ending === "loop" ? "Miles from the top back to the start" : `Miles from the top to the ${endName(i)}`;
  if (!i.upMiles) return ($("totals").textContent = "");
  const total = i.upMiles + (i.ending === "outback" ? i.upMiles : i.backMiles);
  $("totals").textContent = `Total: ${Math.round(total * 10) / 10} mi and ${(i.upGainFt + i.backGainFt).toLocaleString()} ft of climbing`;
}

// ---------- Your own pace ----------
// Learned from the way up of a hike the person already did, and kept only on this device.
const PACE_KEY = "trailprep.myPace";
function loadMyPace() {
  try { return JSON.parse(localStorage.getItem(PACE_KEY)); } catch { return null; }
}

function saveMyPace(elevFt) {
  const miles = +$("past-miles").value, gainFt = +$("past-gain").value || 0, hours = +$("past-hours").value;
  if (!miles || !hours) {
    $("past-result").textContent = "Add the miles to the top and how long it took.";
    return;
  }
  // elevFt: where the climb started, when we know it (from a GPX), so altitude can be taken into account.
  try { localStorage.setItem(PACE_KEY, JSON.stringify({ miles, gainFt, hours, elevFt: typeof elevFt === "number" ? elevFt : undefined })); } catch {}
  track("pace-saved");
  showPace();
}

function showPace() {
  const pace = $("pace").value, mine = loadMyPace();
  $("my-pace").hidden = pace !== "custom";
  if (pace !== "custom") {
    $("pace-desc").textContent = `${PACES[pace].label} means ${describePace(PACES[pace].factor)}.`;
    return;
  }
  if (!mine) {
    $("pace-desc").textContent = "Enter a climb you already did below, and Trail Prep will use your real pace.";
    $("past-result").textContent = "";
    return;
  }
  const factor = paceFactor({ ref: mine });
  const pct = Math.round((factor - 1) * 100);
  const vsAverage = Math.abs(pct) < 5 ? "about average" : pct > 0 ? `${pct}% slower than average` : `${-pct}% faster than average`;
  $("pace-desc").textContent = `Your pace: ${describePace(factor)} (${vsAverage}). On hikes much longer than this one, Trail Prep adds time for getting tired.`;
  $("past-result").textContent = `✓ Learned from your climb of ${mine.miles} mi and ${mine.gainFt.toLocaleString()} ft in ${formatDuration(mine.hours)}.`;
  $("past-miles").value ||= mine.miles;
  $("past-gain").value ||= mine.gainFt;
  $("past-hours").value ||= mine.hours;
}

$("pace").addEventListener("change", showPace);
$("past-save").addEventListener("click", () => saveMyPace());

$("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.place) return showError("Pick a trailhead location first (search, coordinates, or use my location).");
  const inputs = readInputs();
  if (!inputs.upMiles || !inputs.date || !inputs.time) return showError("Add the miles to the top, the date and the start time.");
  if (inputs.ending !== "outback" && !inputs.backMiles) return showError(inputs.ending === "loop" ? "Add the miles from the top back to the start." : `Add the miles from the top to the ${endName(inputs)}.`);
  if (inputs.pace === "custom" && !inputs.paceRef) return showError("Save your pace first (enter a past climb under \"Teach Trail Prep your pace\"), or pick another pace.");
  $("plan-btn").disabled = true;
  $("plan-btn").textContent = "Getting the forecast…";
  try {
    state.forecast = await fetchForecast(state.place);
    track(inputs.nights ? "plan-backpacking" : "plan-day-hike");
    track(`region-${state.place.region}`, `Planned in ${state.place.region}`);
    state.inputs = inputs;
    render();
  } catch {
    showError("Could not get the forecast. If you're offline, open a saved trip below.");
  } finally {
    $("plan-btn").disabled = false;
    $("plan-btn").textContent = "Plan my hike";
  }
});

function showError(msg) {
  $("results").hidden = false;
  $("results").innerHTML = `<div class="alert danger">${msg}</div>`;
}

// ---------- Build the plan ----------
function buildPlan(rawInputs, forecast) {
  const inputs = normalizeInputs(rawInputs);
  const start = parseLocal(`${inputs.date}T${inputs.time}`);
  const days = inputs.nights + 1;
  // Trailhead elevation: from the GPX when we have it, otherwise the weather service's estimate for that spot.
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
function render(savedName) {
  const { forecast, place } = state;
  const p = buildPlan(state.inputs, forecast);
  const inputs = p.inputs ?? state.inputs;
  const out = $("results");
  out.hidden = false;
  if (p.error) return (out.innerHTML = `<div class="alert warn">${p.error}</div>`);

  const perDay = p.days > 1 ? " per day" : "";
  out.innerHTML = `
    <div class="summary-head">
      <div>
        <h2>${place.name}</h2>
        <p class="muted">${fmtDay(p.start)} · ${p.est.totalMiles} mi · ${p.est.totalGainFt.toLocaleString()} ft of climbing · ${inputs.ending === "oneway" ? `ends at a ${endName(inputs)}` : ENDINGS[inputs.ending]} · ${PACES[inputs.pace].label} pace${inputs.nights ? ` · ${inputs.nights} night${inputs.nights > 1 ? "s" : ""}` : ""}</p>
        ${savedName ? `<p class="muted">Saved plan · forecast from ${savedName}</p>` : ""}
      </div>
      <div class="actions no-print">
        <button type="button" id="save-btn">Save for offline</button>
        <button type="button" id="print-btn" class="secondary">Print / PDF</button>
      </div>
    </div>

    ${p.alerts.map((a) => `<div class="alert ${a.level}">${a.text}</div>`).join("")}
    ${rideAlert(p)}

    <div class="cards">
      <div class="card"><div class="label">Time on trail${perDay}</div><div class="big">${formatDuration(p.est.finish.best)} – ${formatDuration(p.est.finish.worst)}</div>
        <div class="small">If you keep your pace – if you get tired. Breaks included.</div></div>
      <div class="card"><div class="label">Water</div><div class="big">${p.water.total[0]}–${p.water.total[1]} L</div>
        <div class="small">${inputs.nights
          ? `Hiking: ${p.water.hike[0]}–${p.water.hike[1]} L · At camp: ${p.water.camp[0]}–${p.water.camp[1]} L for ${w_cook(p)}. Carry only what you need between water sources you can filter.`
          : "To drink while hiking. Carry the high end if it's hot or you're unsure."}</div></div>
      <div class="card"><div class="label">Food to pack</div>
        <div class="big">${p.food.total[0].toLocaleString()}–${p.food.total[1].toLocaleString()} cal</div>
        <div class="small">${inputs.nights
          ? `Trail snacks: ${p.food.snacks[0].toLocaleString()}–${p.food.snacks[1].toLocaleString()} · Dinner and breakfast: ${p.food.meals[0].toLocaleString()}–${p.food.meals[1].toLocaleString()}. About ${p.food.pounds[0]}–${p.food.pounds[1]} lb.`
          : "Snacks: about 200–300 calories for every hour on the trail."}</div></div>
    </div>

    <h3>Your day</h3>
    <ul class="timeline">
      <li><span>You start</span><b>${fmtTime(p.start)}</b></li>
      ${p.days === 1 ? `<li><span>Reach the top</span><b>${fmtRange(p.top)}</b></li>` : ""}
      <li><span>${p.days > 1 ? "Reach camp (each day)" : inputs.ending === "oneway" ? `Reach the ${endName(inputs)}` : "Back at the start"}</span><b>${fmtRange(p.finish)}</b></li>
      <li><span>Sunset</span><b>${fmtTime(p.first.sunset)}</b></li>
      ${p.ride?.last ? `<li><span>Last ${p.ride.name} leaves</span><b>${fmtTime(p.ride.last)}</b></li>` : ""}
      ${p.light.startsInDark ? `<li><span>Sunrise</span><b>${fmtTime(p.first.sunrise)}</b></li>` : ""}
      ${p.light.latestStart < parseLocal(`${inputs.date}T00:00`)
        ? `<li class="hint"><span>This hike is longer than the daylight. Plan to hike part of it in the dark, with a charged headlamp.</span><b></b></li>`
        : `<li class="hint"><span>Latest start to finish 30 min before sunset, even if you get tired</span><b>${fmtTime(p.light.latestStart)}</b></li>`}
    </ul>
    <p class="range-note">Each range runs from "if you keep your pace" to "if you get tired." Long days have wider ranges because people slow down more as the day goes on.${p.est.altitudeSlowdown ? ` This hike is high up (trailhead about ${p.trailheadFt.toLocaleString()} ft), so times include about ${p.est.altitudeSlowdown}% extra for thinner air.` : ""}</p>
    ${p.days === 1 ? `<p class="no-print">Want sunrise from the top? Start by <b>${fmtTime(p.light.sunriseAtTopStart)}</b> (sunrise is ${fmtTime(p.first.sunrise)}).
      <button type="button" id="sunrise-btn" class="link">Use this start time</button></p>` : ""}

    <div id="camp-box"></div>

    <h3>Weather ${p.days > 1 ? "by day" : "during your hike"}</h3>
    ${p.days > 1 ? dailyCards(p.daily) : weatherChart(p)}

    <h3>Pack list for these conditions</h3>
    ${gearList(p.gear)}

    <p class="disclaimer">All estimates are a rough guide based on standard hiking rules of thumb and the forecast. Weather in the mountains changes fast. Check official sources (NWS, park and forest offices) and turn back if conditions change.</p>`;

  if (p.days === 1) wireChart(p);
  fillCampBox(p, inputs);
  $("save-btn").addEventListener("click", saveTrip);
  $("print-btn").addEventListener("click", () => { track("print"); window.print(); });
  $("sunrise-btn")?.addEventListener("click", () => {
    track("sunrise-start");
    const t = p.light.sunriseAtTopStart;
    state.inputs = { ...inputs, date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16) };
    $("date").value = state.inputs.date;
    $("time").value = state.inputs.time;
    render(savedName);
  });
  out.scrollIntoView({ behavior: "smooth" });
}

// ---------- Where to camp and where to find water ----------
// Campsites, springs and taps come from small files in data/places/ (built from OpenStreetMap and
// Recreation.gov by tools/build-places.mjs). Each file covers a half-degree square, so the phone
// only downloads the area around the hike.
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let placeIndex = null;
const tileCache = new Map();
async function placesAround(minLat, minLon, maxLat, maxLon) {
  placeIndex ??= await fetch("data/places/index.json").then((r) => r.json()).catch(() => ({ tiles: [], tile: 0.5 }));
  const t = placeIndex.tile, have = new Set(placeIndex.tiles);
  const rows = [];
  for (let la = Math.floor(minLat / t) * t; la <= maxLat; la += t) {
    for (let lo = Math.floor(minLon / t) * t; lo <= maxLon; lo += t) {
      const key = `${la.toFixed(1)}_${lo.toFixed(1)}`;
      if (!have.has(key)) continue;
      if (!tileCache.has(key)) tileCache.set(key, fetch(`data/places/${key}.json`).then((r) => r.json()).catch(() => []));
      rows.push(...(await tileCache.get(key)));
    }
  }
  return rows;
}

// Who manages the land at a spot, from the Bureau of Land Management's free land map.
// Returns an agency code like "BLM", "USFS", "NPS" (see campRules in calc.js), or null if it can't tell.
const landCache = new Map();
async function landAt(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (!landCache.has(key)) {
    const url = "https://gis.blm.gov/arcgis/rest/services/lands/BLM_Natl_SMA_LimitedScale/MapServer/identify?" + new URLSearchParams({
      geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", sr: "4326", layers: "all:1", tolerance: "1",
      mapExtent: `${lon - 1},${lat - 1},${lon + 1},${lat + 1}`, imageDisplay: "600,600,96", returnGeometry: "false", f: "json",
    });
    landCache.set(key, fetch(url).then((r) => r.json()).then((d) => d.results?.[0]?.attributes?.ADMIN_AGENCY_CODE || null).catch(() => null));
  }
  return landCache.get(key);
}

const CAMP_KIND = (c) => c.kind === "ground" ? "Campground" : c.flags.includes("p") ? "Tent spot" : c.flags.includes("b") ? "Backcountry site" : "Campsite";
const mapLink = (lat, lon) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
const waterText = (w) => w ? `${w.kind === "spring" ? "Spring" : "Water tap"}${w.name ? ` (${esc(w.name)})` : ""} ${w.d < 0.1 ? "right there" : `${round1(w.d)} mi away`}${w.kind === "spring" && !w.drinkable ? ", filter it" : ""}` : "No mapped water within a mile";
const round1 = (x) => Math.round(x * 10) / 10;

async function fillCampBox(p, inputs) {
  const box = $("camp-box");
  if (!box) return;
  const route = state.route;
  const backpacking = inputs.nights > 0;
  if (!route && !backpacking) return; // a day hike without a route: nothing to add

  box.innerHTML = `<p class="muted small">Looking for ${backpacking ? "campsites and " : ""}water near your route…</p>`;
  // The area to load: around the route, or 10 miles around the trailhead.
  const pts = route || [{ lat: state.place.lat, lon: state.place.lon }];
  const pad = route ? 0.05 : 0.15;
  const lats = pts.map((x) => x.lat), lons = pts.map((x) => x.lon);
  const places = await placesAround(Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad);
  if ($("camp-box") !== box) return; // the plan changed while loading
  if (!places.length) {
    box.innerHTML = `<h3>${backpacking ? "Where to camp" : "Water on the way"}</h3><p class="muted">Campsite and water data covers ${esc((placeIndex?.states || ["Arizona"]).join(", ").replace("AZ", "Arizona"))} for now. More places are coming.</p>`;
    return;
  }

  let html = "";
  if (backpacking && route) {
    const slow = 1.15 * (1 + p.est.altitudeSlowdown / 100); // full pack and thin air, same as the rest of the plan
    const { camps, pick, cutoff, reach } = campsAlongRoute({ points: route, places, start: p.start, sunset: p.first.sunset, pace: makePace(inputs), slow });
    const shown = camps.filter((c) => c.status !== "late").slice(-8);
    const late = camps.filter((c) => c.status === "late").length;
    html += `<h3>Where to camp tonight</h3>
      <p class="small muted">Campsites within about a third of a mile of your route, at your pace. "Easy" means you get there at least 45 minutes before sunset (${fmtTime(p.first.sunset)}) to set up, even if you get tired.</p>`;
    // Where you'll be when it's time to stop, even if you get tired (helps most when no campsite is mapped).
    if (reach && !reach.end) {
      html += `<div class="camp reach"><b>By ${fmtTime(cutoff)} you'll be around mile ${reach.mile}</b> <span class="muted">(even if you get tired)</span>
        <div class="small land" data-lat="${reach.lat}" data-lon="${reach.lon}" data-kind="spot"></div>
        <div class="small"><a href="${mapLink(reach.lat, reach.lon)}" target="_blank" rel="noopener">See it on the map</a></div></div>`;
    }
    if (!camps.length) {
      html += `<p>No campsites are mapped near this route. Dispersed camping may still be allowed, so check the land where you plan to stop (above).</p>`;
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
    html += `<h3>Campsites near the trailhead</h3>
      <p class="small muted">Import your route (GPX) above to see which campsites you can reach before dark at your pace.</p>
      <ul class="camp-list">${near.map((c) => `<li><div class="camp"><b>${esc(c.name || CAMP_KIND(c))}</b> <span class="muted">· ${CAMP_KIND(c)} · ${round1(c.d)} mi away</span>
        <div class="small land" data-lat="${c.lat}" data-lon="${c.lon}" data-kind="${c.kind}"></div>
        <div class="small"><a href="${mapLink(c.lat, c.lon)}" target="_blank" rel="noopener">Map</a>${c.ridbId ? ` · <a href="https://www.recreation.gov/camping/campgrounds/${c.ridbId}" target="_blank" rel="noopener">Book on Recreation.gov</a>` : ""}</div></div></li>`).join("")}</ul>`;
  }

  if (route) {
    const water = waterAlongRoute(route, places);
    html += `<h3>Water on the way</h3>`;
    html += water.length
      ? `<ul class="water-list">${water.slice(0, 12).map((w) => `<li><span>Mile ${w.mile}</span> ${w.kind === "spring" ? "Spring" : "Water tap"}${w.name ? ` · ${esc(w.name)}` : ""}${w.offTrailMi >= 0.1 ? ` <span class="muted">(${w.offTrailMi} mi off trail)</span>` : ""}${w.kind === "spring" && !w.drinkable ? ` <span class="muted">· filter or treat</span>` : ""}</li>`).join("")}</ul>
         <p class="small muted">Springs in the desert can be dry, especially in summer. Check recent trip reports, and carry enough to reach the next sure source.</p>`
      : `<p class="muted">No mapped springs or taps within a quarter mile of this route. Carry all your water.</p>`;
  }
  html += `<p class="small muted">Campsites and water: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors and Recreation.gov. Land: Bureau of Land Management. Rules change (fire bans, closures), so check with the land office before you go.</p>`;
  box.innerHTML = html;
  track(backpacking ? "camps-shown" : "water-shown");

  // Fill in "whose land is this?" for each campsite shown (a campground is always fine to camp at).
  for (const el of box.querySelectorAll(".land")) {
    if (el.dataset.kind === "ground") { el.textContent = "Campground: camping allowed (may need a reservation)."; continue; }
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
    ${isPick ? `<div class="label">Best pick</div>` : ""}
    <b>${esc(c.name || CAMP_KIND(c))}</b> <span class="muted">· ${CAMP_KIND(c)} · mile ${c.mile}${c.offTrailMi >= 0.1 ? ` (${c.offTrailMi} mi off trail)` : ""}</span>
    <span class="tag ${c.status}">${c.status === "easy" ? "Easy before dark" : "Tight"}</span>
    <div class="small">${when}</div>
    <div class="small">💧 ${waterText(c.water)}</div>
    <div class="small land" data-lat="${c.lat}" data-lon="${c.lon}" data-kind="${c.kind}"></div>
    <div class="small"><a href="${mapLink(c.lat, c.lon)}" target="_blank" rel="noopener">Map</a>${c.ridbId ? ` · <a href="https://www.recreation.gov/camping/campgrounds/${c.ridbId}" target="_blank" rel="noopener">Book on Recreation.gov</a>` : ""}</div>
  </div>`;
}

const fmtRange = (r) => `${fmtTime(r.best)} – ${fmtTime(r.worst)}`;
const fmtBetween = (r) => `between ${fmtTime(r.best)} and ${fmtTime(r.worst)}`;

function rideAlert(p) {
  if (!p.ride) return "";
  const { name, last, level } = p.ride;
  if (level === "danger") return `<div class="alert danger">Even at your pace you'd reach the ${name} around ${fmtTime(p.finish.best)}, after the last one leaves at ${fmtTime(last)}. Start earlier or plan another way down.</div>`;
  if (level === "warn") return `<div class="alert warn">If you get tired, you could miss the last ${name} at ${fmtTime(last)} (you'd arrive ${fmtBetween(p.finish)}). Start earlier to be safe.</div>`;
  if (level === "ok") return "";
  if (name === "car pickup") return `<div class="alert warn">Tell your ride you'll arrive ${fmtBetween(p.finish)}.</div>`;
  return `<div class="alert warn">Check when the last ${name} leaves and enter it above, so Trail Prep can warn you if you might miss it.</div>`;
}

const w_cook = (p) => (p.w.cooking ? "drinking and cooking" : "drinking");

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
  const tops = hrs.map((h) => tempAtTop(h.feels, climb));
  let lo = Math.floor((Math.min(...tops, ...hrs.map((h) => h.feels)) - 4) / 10) * 10;
  let hi = Math.ceil((Math.max(...hrs.map((h) => h.feels), ...tops) + 4) / 10) * 10;
  if (hi - lo < 20) hi = lo + 20;
  const y = (f) => T + ((hi - f) / (hi - lo)) * (H - T - B);
  const line = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${x(hrs[i].time).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const ticks = [];
  for (let f = lo; f <= hi; f += 10) ticks.push(f);
  const step = hrs.length > 12 ? 3 : 2;
  const night = (d) => d < p.first.sunrise || d > p.first.sunset;
  const clampX = (d) => Math.max(L, Math.min(W - R, x(d)));
  const mid = (r) => new Date((r.best.getTime() + r.worst.getTime()) / 2);
  const marks = [
    { at: mid(p.top), label: "Top" },
    { at: mid(p.finish), label: p.inputs.ending === "oneway" ? "End" : "Finish" },
  ].filter((m) => m.at.getTime() >= t0 && m.at.getTime() <= t1);
  const lastI = hrs.length - 1;

  return `
    <div class="chart" id="wx-chart">
      <div class="legend"><span><i class="key s1"></i>Feels like at the trailhead</span><span><i class="key s2"></i>Feels like at the top (estimated)</span></div>
      <div class="chart-box">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Feels-like temperature during the hike, at the trailhead and at the top">
          ${t0 < p.first.sunrise.getTime() ? `<rect class="night" x="${L}" y="${T}" width="${Math.max(0, clampX(p.first.sunrise) - L)}" height="${H - T - B}"/>` : ""}
          ${p.first.sunset.getTime() < t1 ? `<rect class="night" x="${clampX(p.first.sunset)}" y="${T}" width="${W - R - clampX(p.first.sunset)}" height="${H - T - B}"/>` : ""}
          ${ticks.map((f) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(f)}" y2="${y(f)}"/><text class="axis" x="${L - 6}" y="${y(f) + 4}" text-anchor="end">${f}°</text>`).join("")}
          ${32 > lo && 32 < hi ? `<line class="freeze" x1="${L}" x2="${W - R}" y1="${y(32)}" y2="${y(32)}"/><text class="axis" x="${W - R}" y="${y(32) - 4}" text-anchor="end">Freezing 32°</text>` : ""}
          ${marks.map((m) => `<line class="mark" x1="${x(m.at)}" x2="${x(m.at)}" y1="${T}" y2="${H - B}"/><text class="mark-label" x="${x(m.at) + 4}" y="${T + 11}">${m.label} ~${fmtTime(m.at)}</text>`).join("")}
          ${hrs.map((h, i) => (i % step ? "" : `<text class="axis" x="${x(h.time)}" y="${H - 10}" text-anchor="middle">${fmtTime(h.time).replace(":00", "")}</text>`)).join("")}
          <path class="ln s1" d="${line(hrs.map((h) => h.feels))}"/>
          <path class="ln s2" d="${line(tops)}"/>
          <circle class="dot s1" cx="${x(hrs[lastI].time)}" cy="${y(hrs[lastI].feels)}" r="4"/>
          <circle class="dot s2" cx="${x(hrs[lastI].time)}" cy="${y(tops[lastI])}" r="4"/>
          <line class="cross" id="wx-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
          <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
        </svg>
        <div class="tip" id="wx-tip" hidden></div>
      </div>
      <p class="small muted">Shaded = dark. The top line is estimated from your climb (about 3.5°F colder per 1,000 ft).</p>
      <div class="hour-strip">${hrs.map((h) => `
        <div class="hour"><div class="h-time">${fmtTime(h.time).replace(":00", "")}</div><div class="h-icon">${weatherIcon(h.code, night(h.time))}</div>
          <div class="h-temp">${Math.round(h.feels)}°</div><div class="h-sub">💧${h.rain}%</div><div class="h-sub">💨${Math.round(h.gust)}</div></div>`).join("")}
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
    row(`${Math.round(h.feels)}°F`, "trailhead", "s1");
    row(`${Math.round(tempAtTop(h.feels, climb))}°F`, "top", "s2");
    row(`${h.rain}%`, "chance of rain");
    row(`${Math.round(h.wind)} / ${Math.round(h.gust)} mph`, "wind / gusts");
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
    ${hours.map((h) => `<tr class="${isThunder(h.code) ? "danger-row" : ""}"><td>${fmtTime(h.time)}</td><td>${describeWeather(h.code)}</td><td>${Math.round(h.temp)}°</td><td>${Math.round(h.feels)}°</td><td>${h.rain}%</td><td>${Math.round(h.wind)} / ${Math.round(h.gust)} mph</td><td>${Math.round(h.uv)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function dailyCards(days) {
  return `<div class="day-cards">${days.map((d) => `
    <div class="day-card"><div class="h-time">${fmtDay(parseLocal(d.date + "T12:00"))}</div><div class="d-icon">${weatherIcon(d.code, false)}</div>
      <div><b>${Math.round(d.max)}°</b> / ${Math.round(d.min)}°</div><div class="small muted">${describeWeather(d.code)}${d.snowCm ? ` · ${Math.round(d.snowCm)} cm snow` : ""}</div>
      <div class="small muted">☀ ${fmtTime(d.sunrise)} – ${fmtTime(d.sunset)}</div></div>`).join("")}</div>`;
}

function gearList(items) {
  const groups = [...new Set(items.map((g) => g.group))];
  return groups.map((grp) => `<h4 class="gear-group">${grp}</h4><ul class="gear">${items.filter((g) => g.group === grp)
    .map((g) => `<li><label><input type="checkbox"> <b>${g.item}</b></label><span class="small muted">${g.why}</span></li>`).join("")}</ul>`).join("");
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
  trips.unshift({ id: Date.now(), savedAt: new Date().toISOString(), place: state.place, inputs: state.inputs, forecast: state.forecast });
  if (!storeTrips(trips.slice(0, 20))) return alert("Could not save on this device.");
  $("save-btn").textContent = "Saved ✓";
  renderSaved();
}

function tripMiles(raw) {
  const i = normalizeInputs(raw);
  return Math.round((i.upMiles + (i.ending === "outback" ? i.upMiles : i.backMiles)) * 10) / 10;
}

function renderSaved() {
  const trips = loadTrips();
  $("saved").hidden = !trips.length;
  $("saved-list").innerHTML = trips.map((t) => `
    <li><button type="button" data-open="${t.id}">${t.place.name} · ${t.inputs.date} · ${tripMiles(t.inputs)} mi</button>
    <button type="button" class="link" data-del="${t.id}">Delete</button></li>`).join("");
}

$("saved-list").addEventListener("click", (e) => {
  const open = e.target.dataset.open, del = e.target.dataset.del;
  const trips = loadTrips();
  if (open) {
    const t = trips.find((x) => String(x.id) === open);
    Object.assign(state, { place: t.place, inputs: t.inputs, forecast: t.forecast });
    render(new Date(t.savedAt).toLocaleString());
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
  box.innerHTML = `A GPX file is a route saved as a file. Free ways to get one:
    <ul>
      <li><b>CalTopo</b> (caltopo.com, free account): draw the trail on the map, then export it as GPX.</li>
      <li><b>Garmin, Coros or Apple Watch</b>: a hike you recorded can usually be exported as GPX from the watch's app or website.</li>
      <li><b>AllTrails</b>: some trail pages let you download the route as GPX (this may need their paid membership).</li>
    </ul>
    No file? Just type the miles and climb below.`;
});
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
