// Turns a trail you searched for into a full route with distance and elevation, anywhere in the world.
// All free, no keys:
//   1. OpenStreetMap gives the trail's path. One trail is often saved as many small pieces with the
//      same name, so we collect the pieces near the spot you picked and join them up.
//   2. Open-Meteo's elevation service gives the height of points along the path (about every 30 m).
// The result looks like an imported GPX route, so the rest of the app treats both the same way.
import { milesBetween } from "./calc.js";

// Several free Overpass servers. If one is busy we try the next.
export const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export async function overpass(query, timeoutMs = 20000) {
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), signal: ctrl.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" } });
      clearTimeout(timer);
      if (res.ok) return await res.json();
      lastErr = new Error(`Overpass ${res.status}`);
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error("Overpass failed");
}

// Gets the pieces of a trail. found = a search result: { osmType, osmId, name, latitude, longitude }.
// Uses OpenStreetMap's search (Nominatim), which can return each piece's path: every path with the same
// name within about 5 km of the spot you picked.
async function trailPieces(found) {
  const d = 0.05; // degrees, about 5 km
  const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
    format: "jsonv2", polygon_geojson: "1", polygon_threshold: "0.00001", limit: "40", dedupe: "0", q: found.name, bounded: "1",
    viewbox: `${found.longitude - d},${found.latitude + d},${found.longitude + d},${found.latitude - d}`,
  });
  const res = await fetch(url, { headers: { "Accept-Language": "en" } });
  if (!res.ok) throw new Error("Search service busy");
  const pieces = [];
  for (const x of await res.json()) {
    const g = x.geojson;
    if (!g || (x.name || "").toLowerCase() !== found.name.toLowerCase()) continue;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const c of lines) if (c.length > 1) pieces.push(c.map(([lon, lat]) => ({ lat, lon })));
  }
  return pieces;
}

const lengthOf = (pts) => pts.reduce((s, p, i) => (i ? s + milesBetween(pts[i - 1], p) : 0), 0);

// Joins the pieces into the longest connected line. Pieces whose ends are within about 60 m count as joined.
export function joinPieces(pieces) {
  const NEAR = 0.04; // miles
  let best = [];
  // Try starting from each piece (both directions) and keep the longest chain. Trails have few pieces, so this is quick.
  for (let s = 0; s < pieces.length; s++) {
    for (const flip of [false, true]) {
      const used = new Set([s]);
      let line = flip ? [...pieces[s]].reverse() : [...pieces[s]];
      for (;;) {
        const end = line[line.length - 1];
        let next = -1, rev = false, gap = NEAR;
        pieces.forEach((p, i) => {
          if (used.has(i)) return;
          const a = milesBetween(end, p[0]), b = milesBetween(end, p[p.length - 1]);
          if (a < gap) { gap = a; next = i; rev = false; }
          if (b < gap) { gap = b; next = i; rev = true; }
        });
        if (next < 0) break;
        used.add(next);
        const add = rev ? [...pieces[next]].reverse() : pieces[next];
        line = line.concat(add.slice(1));
      }
      if (lengthOf(line) > lengthOf(best)) best = line;
    }
  }
  return best;
}

// Evenly spaced points along a line, about every `stepMi` miles (and at most `max` of them).
function resample(line, stepMi, max) {
  const total = lengthOf(line);
  const step = Math.max(stepMi, total / (max - 1));
  const out = [line[0]];
  let need = step, i = 1, carried = 0;
  while (i < line.length) {
    const a = line[i - 1], b = line[i], seg = milesBetween(a, b);
    if (carried + seg >= need && seg > 0) {
      const t = (need - carried) / seg;
      const p = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      out.push(p);
      line = [p, ...line.slice(i)]; i = 1; carried = 0; need = step; // continue from the new point
    } else { carried += seg; i++; }
  }
  const last = line[line.length - 1];
  if (milesBetween(out[out.length - 1], last) > step / 4) out.push(last);
  return out;
}

// Heights in meters from Open-Meteo (100 points per request).
export async function elevations(points) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((p) => p.lat.toFixed(5)).join(",")}&longitude=${chunk.map((p) => p.lon.toFixed(5)).join(",")}`);
    if (!res.ok) throw new Error("Elevation service error");
    out.push(...(await res.json()).elevation);
  }
  return out;
}

// The whole job: a searched trail → route points with elevation, starting at the lower end (usually the trailhead).
export async function trailRoute(found) {
  const pieces = await trailPieces(found);
  if (!pieces.length) return null;
  const line = joinPieces(pieces);
  if (lengthOf(line) < 0.1) return null;
  const pts = resample(line, 0.02, 300); // about every 30 m, at most 300 points (3 elevation requests)
  const ele = await elevations(pts);
  // The free elevation map is a bit bumpy (it's made from satellite data in ~90 m squares), and the bumps
  // would count as extra climbing. Smoothing over about 150 m takes them out, but keeps real hills.
  pts.forEach((p, i) => {
    const near = ele.slice(Math.max(0, i - 2), i + 3);
    p.ele = near.reduce((a, b) => a + b, 0) / near.length;
  });
  pts[0].ele = ele[0]; pts[pts.length - 1].ele = ele[ele.length - 1]; // keep the true start and end heights
  // Start at the lower end: most trails start low and climb.
  if (pts[pts.length - 1].ele < pts[0].ele - 5) pts.reverse();
  return pts;
}
