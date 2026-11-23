// Downloads the free map data hikepace uses for "where can I camp?" and saves it in hike-data/open-data/
// (that folder is not uploaded to GitHub; tools/build-places.mjs turns it into the small files the app loads).
//
// Sources (all free):
//   - OpenStreetMap, through the Overpass API: campsites, springs, drinking water, trailheads.
//     Data © OpenStreetMap contributors, ODbL license (https://www.openstreetmap.org/copyright).
//   - Recreation.gov (RIDB API): federal campgrounds and permit areas. Needs a free key, read from
//     hike-data/.keys as RIDB_KEY=... (get one at https://ridb.recreation.gov, profile → Enable Developer Access).
//
// Run:  node tools/fetch-open-data.mjs            (Arizona, the default)
//       node tools/fetch-open-data.mjs US-UT      (any US state code, e.g. Utah)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

const STATE = process.argv[2] || "US-AZ";
const OUT = "hike-data/open-data";
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What to ask OpenStreetMap for. Each line is one kind of place.
const QUERIES = {
  campsites: 'nwr["tourism"="camp_site"](area.s);nwr["tourism"="camp_pitch"](area.s);',
  springs: 'nwr["natural"="spring"](area.s);',
  drinking_water: 'nwr["amenity"="drinking_water"](area.s);nwr["man_made"="water_tap"](area.s);nwr["amenity"="water_point"](area.s);',
  trailheads: 'nwr["highway"="trailhead"](area.s);',
};

// Asks Overpass, and tries again if it's busy (it often is).
async function overpass(body) {
  const q = `[out:json][timeout:180];area["ISO3166-2"="${STATE}"]->.s;(${body});out center tags;`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "hikepace-data/1.0" },
        body: "data=" + encodeURIComponent(q),
      });
      if (res.ok) return await res.json();
      console.log(`  busy (${res.status}), trying again in 30s…`);
    } catch (err) {
      console.log(`  ${err.message}, trying again in 30s…`);
    }
    await wait(30000);
  }
  throw new Error("Overpass kept failing; try again later");
}

const code = STATE.slice(3).toLowerCase(); // "az"
for (const [name, body] of Object.entries(QUERIES)) {
  console.log(`OpenStreetMap: ${name}…`);
  const data = await overpass(body);
  // Turn each place into a simple map point (ways and areas use their center).
  const features = data.elements.map((e) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [e.lon ?? e.center?.lon, e.lat ?? e.center?.lat] },
    properties: { osm: `${e.type[0]}${e.id}`, ...e.tags },
  }));
  writeFileSync(`${OUT}/${code}_${name}.geojson`, JSON.stringify({ type: "FeatureCollection", features }));
  console.log(`  saved ${features.length}`);
  await wait(5000); // be polite to the free server
}

// Recreation.gov: federal campgrounds (only if there's a key).
const keys = existsSync("hike-data/.keys") ? readFileSync("hike-data/.keys", "utf8") : "";
const ridbKey = keys.match(/^RIDB_KEY=(.+)$/m)?.[1].trim();
if (!ridbKey) {
  console.log("No RIDB_KEY in hike-data/.keys, so Recreation.gov campgrounds were skipped.");
} else {
  console.log("Recreation.gov: facilities…");
  const all = [];
  for (let offset = 0; ; offset += 50) {
    const res = await fetch(`https://ridb.recreation.gov/api/v1/facilities?state=${code.toUpperCase()}&limit=50&offset=${offset}&full=true`, {
      headers: { apikey: ridbKey, Accept: "application/json" },
    });
    const page = await res.json();
    all.push(...page.RECDATA);
    if (!page.RECDATA.length || all.length >= page.METADATA.RESULTS.TOTAL_COUNT) break;
    await wait(300);
  }
  writeFileSync(`${OUT}/ridb_${code}_facilities.json`, JSON.stringify(all));
  console.log(`  saved ${all.length}`);
}
console.log("Done. Next: node tools/build-places.mjs");
