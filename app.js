// Trail Prep: page logic. Weather comes from Open-Meteo (free, no account or key).
import {
  PACES, estimateHikeTime, tempAtTop, estimateWater, estimateFood, daylightPlan,
  gearChecklist, warnings, describeWeather, isThunder, addHours, formatDuration, routeStats,
} from "./calc.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "trailprep.trips";
const state = { place: null, forecast: null, inputs: null };

// ---------- Times ----------
// Open-Meteo gives times in the trail's own time zone. We keep every time as a
// "trail-local" clock time (stored as UTC under the hood), so the plan reads
// correctly no matter where the phone is.
const parseLocal = (s) => new Date(s.length === 16 ? s + ":00Z" : s + "Z");
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// ---------- Usage counts ----------
// Anonymous counts through GoatCounter (no cookies, no names). Only the action and the
// state or country are counted, never the exact trail, place, or date, to keep trips private.
function track(name, title) {
  try { window.goatcounter?.count?.({ path: name, title: title || name, event: true }); } catch {}
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
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
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
  state.place = { name: placeLabel(p), lat: p.latitude, lon: p.longitude, region: p.region || "Unknown" };
  $("place-results").innerHTML = "";
  $("place-chosen").textContent = `✓ ${state.place.name} (${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)})`;
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

    $("miles").value = r.miles;
    if (r.gainFt !== null) $("gain").value = r.gainFt;
    const spot = await describeSpot(r.start.lat, r.start.lon);
    choosePlace({ name: name || "Route start", area: spot.area, region: spot.region, latitude: r.start.lat, longitude: r.start.lon });
    $("place").value = name || "";
    track("gpx-import");

    status.innerHTML = "";
    const line = document.createElement("div");
    line.textContent = `✓ Imported ${name ? `"${name}"` : "your route"}: ${r.miles} mi` +
      (r.gainFt !== null ? `, ${r.gainFt.toLocaleString()} ft gain, high point ${r.highFt.toLocaleString()} ft.` : ". This file has no elevation, so please add the elevation gain yourself.");
    status.appendChild(line);
    if (!r.isLoop) {
      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = `This route is one-way (it ends ${r.gapMiles} mi from where it starts). If you'll hike back the same way, tap below.`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = "Hiking back the same way? Make it out-and-back";
      btn.addEventListener("click", () => {
        $("miles").value = Math.round(r.miles * 2 * 10) / 10;
        if (r.gainFt !== null) $("gain").value = r.outAndBackGainFt;
        note.textContent = `✓ Doubled for an out-and-back: ${$("miles").value} mi${r.gainFt !== null ? `, ${(+$("gain").value).toLocaleString()} ft gain` : ""}.`;
      });
      note.appendChild(document.createElement("br"));
      note.appendChild(btn);
      status.appendChild(note);
    }
  } catch {
    status.textContent = "Couldn't read that file. Make sure it's a .gpx route file (most hiking apps can export one).";
  }
});

// ---------- Forecast ----------
async function fetchForecast(place) {
  const params = new URLSearchParams({
    latitude: place.lat, longitude: place.lon, timezone: "auto", forecast_days: "16",
    temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,uv_index",
    daily: "sunrise,sunset,temperature_2m_min,temperature_2m_max,weather_code",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!res.ok) throw new Error("Weather service error");
  return res.json();
}

// ---------- Form ----------
function readInputs() {
  return {
    miles: +$("miles").value,
    gainFt: +$("gain").value || 0,
    date: $("date").value,
    time: $("time").value,
    nights: +$("nights").value,
    pace: $("pace").value,
    groupSize: +$("group").value || 1,
  };
}

$("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.place) return showError("Pick a trailhead location first (search, coordinates, or use my location).");
  const inputs = readInputs();
  if (!inputs.miles || !inputs.date || !inputs.time) return showError("Add the distance, date and start time.");
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
function buildPlan(inputs, forecast) {
  const start = parseLocal(`${inputs.date}T${inputs.time}`);
  const days = inputs.nights + 1;
  const time = estimateHikeTime({
    miles: inputs.miles / days, gainFt: inputs.gainFt / days,
    pace: inputs.pace, groupSize: inputs.groupSize, heavyPack: inputs.nights > 0,
  });

  const daily = forecast.daily.time.map((t, i) => ({
    date: t,
    sunrise: parseLocal(forecast.daily.sunrise[i]),
    sunset: parseLocal(forecast.daily.sunset[i]),
    min: forecast.daily.temperature_2m_min[i],
    max: forecast.daily.temperature_2m_max[i],
    code: forecast.daily.weather_code[i],
  }));
  const dayIndex = daily.findIndex((d) => d.date === inputs.date);
  if (dayIndex === -1) return { error: "That date is outside the 16-day forecast. Plan again closer to your trip." };
  const first = daily[dayIndex];

  // Hours of weather that matter: from the start until the end of the last hiking day.
  const end = addHours(start, inputs.nights * 24 + time.totalHours);
  const hours = forecast.hourly.time.map((t, i) => ({
    time: parseLocal(t),
    temp: forecast.hourly.temperature_2m[i],
    feels: forecast.hourly.apparent_temperature[i],
    rain: forecast.hourly.precipitation_probability[i] ?? 0,
    code: forecast.hourly.weather_code[i],
    wind: forecast.hourly.wind_speed_10m[i],
    gust: forecast.hourly.wind_gusts_10m[i],
    uv: forecast.hourly.uv_index[i] ?? 0,
  })).filter((h) => h.time >= addHours(start, -1) && h.time <= end);
  if (!hours.length) return { error: "No hourly forecast for that time yet. Try a date within the next 16 days." };

  const dayGain = inputs.gainFt / days;
  const w = {
    maxFeelsF: Math.max(...hours.map((h) => h.feels)),
    minFeelsF: Math.min(...hours.map((h) => tempAtTop(h.feels, dayGain))),
    maxRainChance: Math.max(...hours.map((h) => h.rain)),
    maxGustMph: Math.max(...hours.map((h) => h.gust)),
    maxUv: Math.max(...hours.map((h) => h.uv)),
    thunder: hours.some((h) => isThunder(h.code)),
    nights: inputs.nights,
    // Camp is assumed to sit halfway up the climb.
    nightLowF: inputs.nights > 0
      ? Math.min(...daily.slice(dayIndex + 1, dayIndex + 1 + inputs.nights).map((d) => tempAtTop(d.min, dayGain / 2)))
      : null,
  };

  const light = daylightPlan({ start, totalHours: time.totalHours, toHighPointHours: time.toHighPointHours, sunrise: first.sunrise, sunset: first.sunset });
  w.headlamp = light.startsInDark || light.finish > addHours(first.sunset, -1) || inputs.nights > 0;
  w.headlampWhy = inputs.nights > 0 ? "You'll be at camp after dark." : light.startsInDark ? "You start before sunrise." : "You finish close to or after sunset.";

  return {
    start, time, first, hours, w, light, days,
    daily: daily.slice(dayIndex, dayIndex + days),
    water: estimateWater({ totalHours: time.totalHours * days, gainFt: inputs.gainFt, maxFeelsF: w.maxFeelsF, nights: inputs.nights }),
    food: estimateFood({ totalHours: time.totalHours * days, nights: inputs.nights, minFeelsF: w.minFeelsF }),
    gear: gearChecklist(w),
    alerts: warnings({ day: light, w }),
  };
}

// ---------- Show the plan ----------
function render(savedName) {
  const { inputs, forecast, place } = { ...state };
  const p = buildPlan(inputs, forecast);
  const out = $("results");
  out.hidden = false;
  if (p.error) return (out.innerHTML = `<div class="alert warn">${p.error}</div>`);

  const perDay = p.days > 1 ? " per day" : "";
  const topF = (f) => Math.round(f);
  out.innerHTML = `
    <div class="summary-head">
      <div>
        <h2>${place.name}</h2>
        <p class="muted">${fmtDay(p.start)} · ${inputs.miles} mi · ${inputs.gainFt.toLocaleString()} ft gain · ${PACES[inputs.pace].label} pace${inputs.groupSize > 1 ? ` · group of ${inputs.groupSize}` : ""}${inputs.nights ? ` · ${inputs.nights} night${inputs.nights > 1 ? "s" : ""}` : ""}</p>
        ${savedName ? `<p class="muted">Saved plan · forecast from ${savedName}</p>` : ""}
      </div>
      <div class="actions no-print">
        <button type="button" id="save-btn">Save for offline</button>
        <button type="button" id="print-btn" class="secondary">Print / PDF</button>
      </div>
    </div>

    ${p.alerts.map((a) => `<div class="alert ${a.level}">${a.text}</div>`).join("")}

    <div class="cards">
      <div class="card"><div class="label">Time on trail${perDay}</div><div class="big">${formatDuration(p.time.totalHours)}</div>
        <div class="small">${formatDuration(p.time.movingHours)} moving + ${formatDuration(p.time.breakHours)} breaks</div></div>
      <div class="card"><div class="label">${inputs.nights ? "Water for the whole trip" : "Water to carry"}</div><div class="big">${p.water.low}–${p.water.high} L</div>
        <div class="small">${inputs.nights ? "Includes camp and cooking water. Carry only what you need between water sources you can filter." : "Carry the high end if it's hot or you're unsure."}</div></div>
      <div class="card"><div class="label">${p.food.kind === "snacks" ? "Snacks to pack" : "Food for the trip"}</div>
        <div class="big">${p.food.caloriesLow.toLocaleString()}–${p.food.caloriesHigh.toLocaleString()} cal</div>
        <div class="small">${p.food.kind === "snacks" ? "About 200–300 calories per hour" : `About ${p.food.poundsLow}–${p.food.poundsHigh} lb of food`}</div></div>
    </div>

    <h3>Daylight</h3>
    <ul class="timeline">
      <li><span>Sunrise</span><b>${fmtTime(p.first.sunrise)}</b></li>
      <li><span>You start</span><b>${fmtTime(p.start)}</b></li>
      <li><span>Reach the top (about)</span><b>${fmtTime(p.light.reachTop)}</b></li>
      <li><span>${p.days > 1 ? "Reach camp (about)" : "You finish (about)"}</span><b>${fmtTime(p.light.finish)}</b></li>
      <li><span>Sunset</span><b>${fmtTime(p.first.sunset)}</b></li>
      <li class="hint"><span>Latest start to finish 30 min before sunset</span><b>${fmtTime(p.light.latestStart)}</b></li>
    </ul>
    <p class="no-print">Want sunrise from the top? Start by <b>${fmtTime(p.light.sunriseAtTopStart)}</b>.
      <button type="button" id="sunrise-btn" class="link">Use this start time</button></p>

    <h3>Weather ${p.days > 1 ? "by day" : "during your hike"}</h3>
    <p class="small muted">Trailhead forecast. At the top it is usually about ${topF(3.5 * inputs.gainFt / p.days / 1000)}°F colder.</p>
    ${p.days > 1 ? dailyTable(p.daily) : hourlyTable(p.hours)}

    <h3>Pack list for these conditions</h3>
    <ul class="gear">${p.gear.map((g) => `<li><label><input type="checkbox"> <b>${g.item}</b></label><span class="small muted">${g.why}</span></li>`).join("")}</ul>

    <p class="disclaimer">All estimates are a rough guide based on standard hiking rules of thumb and the forecast. Weather in the mountains changes fast. Check official sources (NWS, park and forest offices) and turn back if conditions change.</p>`;

  $("save-btn").addEventListener("click", saveTrip);
  $("print-btn").addEventListener("click", () => { track("print"); window.print(); });
  $("sunrise-btn").addEventListener("click", () => {
    track("sunrise-start");
    const t = p.light.sunriseAtTopStart;
    state.inputs = { ...inputs, date: t.toISOString().slice(0, 10), time: t.toISOString().slice(11, 16) };
    $("date").value = state.inputs.date;
    $("time").value = state.inputs.time;
    render(savedName);
  });
  out.scrollIntoView({ behavior: "smooth" });
}

function hourlyTable(hours) {
  return `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Sky</th><th>Temp</th><th>Feels</th><th>Rain</th><th>Wind / gust</th><th>UV</th></tr></thead><tbody>
    ${hours.map((h) => `<tr class="${isThunder(h.code) ? "danger-row" : ""}"><td>${fmtTime(h.time)}</td><td>${describeWeather(h.code)}</td><td>${Math.round(h.temp)}°</td><td>${Math.round(h.feels)}°</td><td>${h.rain}%</td><td>${Math.round(h.wind)} / ${Math.round(h.gust)} mph</td><td>${Math.round(h.uv)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function dailyTable(days) {
  return `<div class="table-wrap"><table><thead><tr><th>Day</th><th>Sky</th><th>High</th><th>Low</th><th>Sunrise</th><th>Sunset</th></tr></thead><tbody>
    ${days.map((d) => `<tr><td>${fmtDay(parseLocal(d.date + "T12:00"))}</td><td>${describeWeather(d.code)}</td><td>${Math.round(d.max)}°</td><td>${Math.round(d.min)}°</td><td>${fmtTime(d.sunrise)}</td><td>${fmtTime(d.sunset)}</td></tr>`).join("")}
  </tbody></table></div>`;
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

function renderSaved() {
  const trips = loadTrips();
  $("saved").hidden = !trips.length;
  $("saved-list").innerHTML = trips.map((t) => `
    <li><button type="button" data-open="${t.id}">${t.place.name} · ${t.inputs.date} · ${t.inputs.miles} mi</button>
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
const today = new Date();
$("date").value = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
renderSaved();
const setOnline = () => $("offline-note").hidden = navigator.onLine;
window.addEventListener("online", setOnline);
window.addEventListener("offline", setOnline);
setOnline();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
