// Trail Prep: page logic. Weather comes from Open-Meteo (free, no account or key).
import {
  PACES, estimateHikeTime, tempAtTop, estimateWater, estimateFood, daylightPlan,
  gearChecklist, warnings, describeWeather, isThunder, addHours, formatDuration,
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

// ---------- Place search ----------
async function searchPlaces(query) {
  const coords = query.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) return [{ name: "Custom point", latitude: +coords[1], longitude: +coords[2] }];
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Place search failed");
  return (await res.json()).results || [];
}

function placeLabel(p) {
  return [p.name, p.admin1, p.country_code].filter(Boolean).join(", ");
}

function choosePlace(p) {
  state.place = { name: placeLabel(p), lat: p.latitude, lon: p.longitude, elevationM: p.elevation ?? null };
  $("place-results").innerHTML = "";
  $("place-chosen").textContent = `✓ ${state.place.name} (${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)})`;
}

$("place-search").addEventListener("click", async () => {
  const q = $("place").value.trim();
  if (!q) return;
  $("place-results").innerHTML = "<li>Searching…</li>";
  try {
    const results = await searchPlaces(q);
    $("place-results").innerHTML = "";
    if (!results.length) {
      $("place-results").innerHTML = "<li>No match. Try the nearest town or park, or paste coordinates like 35.346, -111.678.</li>";
      return;
    }
    if (results.length === 1) return choosePlace(results[0]);
    for (const r of results) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = placeLabel(r);
      b.addEventListener("click", () => choosePlace(r));
      li.appendChild(b);
      $("place-results").appendChild(li);
    }
  } catch {
    $("place-results").innerHTML = "<li>Could not search. Are you online?</li>";
  }
});

$("place-gps").addEventListener("click", () => {
  if (!navigator.geolocation) return alert("This device cannot share its location.");
  navigator.geolocation.getCurrentPosition(
    (pos) => choosePlace({ name: "My location", latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
    () => alert("Could not get your location."),
  );
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
  $("print-btn").addEventListener("click", () => window.print());
  $("sunrise-btn").addEventListener("click", () => {
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
