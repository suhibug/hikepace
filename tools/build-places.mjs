// Packs the downloaded map data (hike-data/open-data/) into small "tiles" the app loads: data/places/.
// Each tile covers half a degree of latitude and longitude (about 35 x 30 miles), so a phone only
// downloads the area around the hike, not the whole state.
//
// One row per place:  [lat, lon, kind, name, flags, extra]
//   kind:  "camp" = campsite or tent spot · "ground" = federal campground (Recreation.gov)
//          "spring" = natural spring · "water" = drinking water tap or fountain · "trailhead"
//   flags: letters for quick facts. b = backcountry / dispersed, p = single tent spot, f = has a fee,
//          r = can be reserved, d = water marked drinkable, t = toilets
//   extra: Recreation.gov id (for a booking link), or "" otherwise
//
// Run after tools/fetch-open-data.mjs:  node tools/build-places.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";

const SRC = "hike-data/open-data";
const OUT = "data/places";
const TILE = 0.5; // degrees

const tiles = new Map(); // "33.0_-112.0" -> rows
const tileKey = (lat, lon) => `${(Math.floor(lat / TILE) * TILE).toFixed(1)}_${(Math.floor(lon / TILE) * TILE).toFixed(1)}`;
const round = (x) => Math.round(x * 1e5) / 1e5; // about 1 m, plenty for a map pin
function add(lat, lon, kind, name, flags, extra = "") {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const k = tileKey(lat, lon);
  if (!tiles.has(k)) tiles.set(k, []);
  tiles.get(k).push([round(lat), round(lon), kind, name || "", flags, extra]);
}
const read = (f) => JSON.parse(readFileSync(`${SRC}/${f}`, "utf8"));
const yes = (v) => v === "yes" || v === "designated";

const states = [...new Set(readdirSync(SRC).filter((f) => /^[a-z]{2}_campsites\.geojson$/.test(f)).map((f) => f.slice(0, 2)))];
const counts = {};
const count = (kind) => { counts[kind] = (counts[kind] || 0) + 1; };

for (const st of states) {
  // Federal campgrounds first, so the same campground from OpenStreetMap can be skipped below.
  const grounds = [];
  if (existsSync(`${SRC}/ridb_${st}_facilities.json`)) {
    for (const f of read(`ridb_${st}_facilities.json`)) {
      if (f.FacilityTypeDescription !== "Campground" || !f.FacilityLatitude) continue;
      grounds.push([f.FacilityLatitude, f.FacilityLongitude]);
      add(f.FacilityLatitude, f.FacilityLongitude, "ground", titleCase(f.FacilityName), f.Reservable ? "rf" : "f", String(f.FacilityID));
      count("ground");
    }
  }
  const nearGround = (lat, lon) => grounds.some(([a, b]) => Math.abs(a - lat) < 0.004 && Math.abs(b - lon) < 0.005); // ~400 m

  for (const { geometry, properties: p } of read(`${st}_campsites.geojson`).features) {
    const [lon, lat] = geometry.coordinates;
    if (p.tourism === "caravan_site") continue; // RV parks: not for hikers
    if (p.tourism === "camp_site" && nearGround(lat, lon)) continue; // already listed from Recreation.gov
    let flags = "";
    if (yes(p.backcountry) || p.camp_site === "basic" || p.impromptu === "yes") flags += "b";
    if (p.tourism === "camp_pitch") flags += "p";
    if (p.fee === "yes") flags += "f";
    if (p.reservation === "required" || p.reservation === "yes") flags += "r";
    if (yes(p.drinking_water)) flags += "d";
    if (yes(p.toilets)) flags += "t";
    add(lat, lon, "camp", p.name, flags);
    count("camp");
  }
  for (const { geometry, properties: p } of read(`${st}_springs.geojson`).features) {
    add(geometry.coordinates[1], geometry.coordinates[0], "spring", p.name, yes(p.drinking_water) ? "d" : "");
    count("spring");
  }
  for (const { geometry, properties: p } of read(`${st}_drinking_water.geojson`).features) {
    if (p.drinking_water === "no") continue; // a tap marked not drinkable
    add(geometry.coordinates[1], geometry.coordinates[0], "water", p.name, "d");
    count("water");
  }
  for (const { geometry, properties: p } of read(`${st}_trailheads.geojson`).features) {
    add(geometry.coordinates[1], geometry.coordinates[0], "trailhead", p.name, "");
    count("trailhead");
  }
}

// "KAIBAB LAKE CAMPGROUND" -> "Kaibab Lake Campground"
function titleCase(s) {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const [k, rows] of tiles) writeFileSync(`${OUT}/${k}.json`, JSON.stringify(rows));
// index.json tells the app which tiles exist, so it never asks for one that isn't there.
writeFileSync(`${OUT}/index.json`, JSON.stringify({
  tile: TILE,
  tiles: [...tiles.keys()].sort(),
  states: states.map((s) => s.toUpperCase()),
  built: new Date().toISOString().slice(0, 10),
  credits: "© OpenStreetMap contributors (ODbL) · Recreation.gov (RIDB)",
}));
console.log(`${tiles.size} tiles for ${states.join(", ").toUpperCase()}:`, counts);
