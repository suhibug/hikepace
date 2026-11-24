// Campsites, springs and water taps near a hike, anywhere in the world.
//   - Arizona (and any state built with tools/build-places.mjs): small ready-made files in data/places/,
//     which also include federal campgrounds from Recreation.gov. Fast, and they work offline once seen.
//   - Everywhere else: asked live from OpenStreetMap (Overpass API). If that's busy, OpenStreetMap's
//     search (Nominatim) is the backup.
// Every place is one row: [lat, lon, kind, name, flags, extra]  (same format as tools/build-places.mjs)
//   kind: camp, ground, spring, water · flags: b backcountry, p tent spot, f fee, r reservable, d drinkable, t toilets
import { overpass } from "./trail.js";

let placeIndex = null;
const tileCache = new Map();
const liveCache = new Map();

async function fromTiles(minLat, minLon, maxLat, maxLon) {
  placeIndex ??= await fetch("data/places/index.json").then((r) => r.json()).catch(() => ({ tiles: [], tile: 0.5 }));
  const t = placeIndex.tile, have = new Set(placeIndex.tiles);
  const keys = [];
  for (let la = Math.floor(minLat / t) * t; la <= maxLat; la += t) {
    for (let lo = Math.floor(minLon / t) * t; lo <= maxLon; lo += t) keys.push(`${la.toFixed(1)}_${lo.toFixed(1)}`);
  }
  const covered = keys.filter((k) => have.has(k));
  if (!covered.length) return null; // not an area we have files for
  const rows = [];
  for (const key of covered) {
    if (!tileCache.has(key)) tileCache.set(key, fetch(`data/places/${key}.json`).then((r) => r.json()).catch(() => []));
    rows.push(...(await tileCache.get(key)));
  }
  return rows;
}

const yes = (v) => v === "yes" || v === "designated";
function rowFromTags(lat, lon, tags) {
  if (tags.tourism === "camp_site" || tags.tourism === "camp_pitch") {
    let flags = "";
    if (yes(tags.backcountry) || tags.camp_site === "basic" || tags.impromptu === "yes") flags += "b";
    if (tags.tourism === "camp_pitch") flags += "p";
    if (tags.fee === "yes") flags += "f";
    if (tags.reservation === "required" || tags.reservation === "yes") flags += "r";
    if (yes(tags.drinking_water)) flags += "d";
    if (yes(tags.toilets)) flags += "t";
    return [lat, lon, "camp", tags.name || "", flags, ""];
  }
  if (tags.natural === "spring") return [lat, lon, "spring", tags.name || "", yes(tags.drinking_water) ? "d" : "", ""];
  if (tags.drinking_water === "no") return null; // a tap marked not drinkable
  return [lat, lon, "water", tags.name || "", "d", ""];
}

async function fromOverpass(s, w, n, e) {
  const b = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:20];(nwr["tourism"~"^(camp_site|camp_pitch)$"](${b});nwr["natural"="spring"](${b});` +
    `nwr["amenity"~"^(drinking_water|water_point)$"](${b});nwr["man_made"="water_tap"](${b}););out center tags;`;
  const data = await overpass(q, 12000);
  return data.elements.map((x) => rowFromTags(x.lat ?? x.center?.lat, x.lon ?? x.center?.lon, x.tags || {})).filter(Boolean);
}

// Backup: OpenStreetMap search by category. It returns at most 40 of each, which is plenty near one trail.
async function fromNominatim(s, w, n, e) {
  const rows = [];
  for (const [phrase, tagsOf] of [
    ["[camp_site]", (x) => ({ tourism: "camp_site", ...x.extratags })],
    ["[drinking_water]", (x) => ({ amenity: "drinking_water", ...x.extratags })],
    ["[spring]", (x) => ({ natural: "spring", ...x.extratags })],
  ]) {
    const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
      format: "jsonv2", extratags: "1", limit: "40", q: phrase, bounded: "1", viewbox: `${w},${n},${e},${s}`,
    });
    try {
      const list = await fetch(url).then((r) => (r.ok ? r.json() : []));
      for (const x of list) {
        const row = rowFromTags(+x.lat, +x.lon, { name: x.name, ...tagsOf(x) });
        if (row) rows.push(row);
      }
    } catch { /* skip this kind */ }
    await new Promise((r) => setTimeout(r, 1100)); // OpenStreetMap asks for at most 1 search a second
  }
  return rows;
}

// Returns { rows, source } where source is "files", "live" or "none".
export async function placesAround(minLat, minLon, maxLat, maxLon) {
  const tiles = await fromTiles(minLat, minLon, maxLat, maxLon);
  if (tiles) return { rows: tiles, source: "files" };
  const key = [minLat, minLon, maxLat, maxLon].map((x) => x.toFixed(2)).join(",");
  if (!liveCache.has(key)) {
    liveCache.set(key, fromOverpass(minLat, minLon, maxLat, maxLon)
      .catch(() => fromNominatim(minLat, minLon, maxLat, maxLon))
      .then((rows) => ({ rows, source: rows.length ? "live" : "none" }))
      .catch(() => ({ rows: [], source: "none" })));
  }
  return liveCache.get(key);
}

// Who manages the land at a spot (US only), from the Bureau of Land Management's free land map.
// Returns an agency code like "BLM", "USFS", "NPS" (see campRules in calc.js), or null if it can't tell.
const landCache = new Map();
export async function landAt(lat, lon) {
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
