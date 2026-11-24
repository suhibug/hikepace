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

export async function overpass(query, timeoutMs = 20000, servers = 2) {
  let lastErr;
  for (const url of OVERPASS.slice(0, servers)) {
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

// Adds a height (meters) to evenly spaced points along a line, smoothed so the free map's bumps
// don't count as extra climbing.
// Open-Meteo counts every point as a request (600 a minute per person), so we ask for at most 120
// heights, then fill in the points between them. The path itself keeps every bend (about every 25 m),
// so switchbacks aren't cut short and the distance stays right.
export async function withElevation(line) {
  const pts = resample(line, 0.015, 900);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + milesBetween(pts[i - 1], pts[i]));
  const step = Math.max(1, Math.ceil(pts.length / 120));
  const idx = [];
  for (let i = 0; i < pts.length; i += step) idx.push(i);
  if (idx[idx.length - 1] !== pts.length - 1) idx.push(pts.length - 1);
  const raw = await elevations(idx.map((i) => pts[i]));
  // The free elevation map is a bit bumpy (it's made from satellite data in ~90 m squares), and the bumps
  // would count as extra climbing. Smoothing over about 150 m takes them out, but keeps real hills.
  const spacing = cum[cum.length - 1] / Math.max(1, idx.length - 1);
  const k = Math.max(0, Math.round(0.047 / Math.max(spacing, 0.005)));
  const smooth = raw.map((_, j) => {
    const near = raw.slice(Math.max(0, j - k), j + k + 1);
    return near.reduce((x, y) => x + y, 0) / near.length;
  });
  smooth[0] = raw[0]; smooth[smooth.length - 1] = raw[raw.length - 1]; // keep the true start and end heights
  // Fill in heights between the looked-up points.
  for (let j = 0; j < idx.length - 1; j++) {
    const a = idx[j], b = idx[j + 1];
    for (let i = a; i <= b; i++) {
      const t = cum[b] === cum[a] ? 0 : (cum[i] - cum[a]) / (cum[b] - cum[a]);
      pts[i].ele = smooth[j] + (smooth[j + 1] - smooth[j]) * t;
    }
  }
  return pts;
}

// A searched trail → route points with elevation, starting at the lower end (usually the trailhead).
export async function trailRoute(found) {
  const pieces = await trailPieces(found);
  if (!pieces.length) return null;
  const line = joinPieces(pieces);
  if (lengthOf(line) < 0.1) return null;
  const pts = await withElevation(line);
  if (pts[pts.length - 1].ele < pts[0].ele - 5) pts.reverse(); // most trails start low and climb
  return pts;
}

// ---------- Ways up a peak (or to a waterfall, viewpoint, any spot) ----------
// Most famous hikes are saved on the map as the peak itself, not as a trail. So we look for the
// parking lots and trailheads nearby, ask a free walking-route service (OSRM on routing.openstreetmap.de)
// how far each one is on foot, and keep the best few. Each way up starts at the car and ends at the top.
const OSRM = "https://routing.openstreetmap.de/routed-foot";
const CAR = "https://routing.openstreetmap.de/routed-car";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function startsNear(lat, lon) {
  const out = [];
  // 1) The named trails near the top (from Photon, OpenStreetMap's free search with "what's near here").
  //    The far end of each trail is where people start, and it gives a nice label: "via Echo Canyon Trail".
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&radius=1.5&limit=15` +
      "&osm_tag=highway:path&osm_tag=highway:footway&osm_tag=highway:track&osm_tag=highway:bridleway";
    const names = [...new Set((await fetch(url).then((r) => r.json())).features
      .map((f) => (f.properties.name || "").split(";")[0].trim()).filter(Boolean))].slice(0, 4);
    for (const name of names) {
      const pieces = await trailPieces({ name, latitude: lat, longitude: lon });
      await pause(1100); // OpenStreetMap asks for at most 1 search a second
      if (!pieces.length) continue;
      const line = joinPieces(pieces);
      const a = line[0], b = line[line.length - 1];
      const far = milesBetween(a, { lat, lon }) > milesBetween(b, { lat, lon }) ? a : b;
      if (milesBetween(far, { lat, lon }) < 0.2) continue;
      // Start where you can park: the nearest road a car can reach (OSRM), if it's close to the trail's end.
      // A trail's last piece near the parking lot often has another name, so this adds it back.
      // Both starts go in; waysUp keeps the road one only if it adds a short walk (in a neighborhood the
      // "nearest road" can be a private street that makes a long detour).
      out.push({ ...far, name: `via ${name}`, kind: "Trail" });
      try {
        const near = (await fetch(`${CAR}/nearest/v1/driving/${far.lon},${far.lat}`).then((r) => r.json())).waypoints?.[0];
        if (near && near.distance > 30 && near.distance < 1000) out.push({ lat: near.location[1], lon: near.location[0], name: `via ${name}`, kind: "Trail", road: true });
      } catch { /* the trail's end is enough */ }
    }
  } catch { /* no trail names: parking lots below */ }
  // 2) Parking lots and trailheads from OpenStreetMap search. It returns at most 40 per ask, and cities
  //    have hundreds of parking lots, so look close to the top first, then wider.
  if (!out.length) {
    for (const [phrase, kind, d] of [["[trailhead]", "Trailhead", 0.04], ["[parking]", "Parking", 0.012], ["[parking]", "Parking", 0.035]]) {
      const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
        format: "jsonv2", limit: "40", q: phrase, bounded: "1", viewbox: `${lon - d},${lat + d},${lon + d},${lat - d}`,
      });
      try {
        for (const x of await fetch(url).then((r) => (r.ok ? r.json() : []))) {
          out.push({ lat: +x.lat, lon: +x.lon, name: x.name || "", kind: x.type === "parking" ? "Parking" : kind });
        }
      } catch { /* try the next one */ }
      await pause(1100);
    }
  }
  // Drop repeats (a trailhead and its parking lot) and anything right at the top.
  const keep = [];
  for (const c of out.sort((a, b) => (b.name ? 1 : 0) - (a.name ? 1 : 0))) {
    if (milesBetween(c, { lat, lon }) < 0.05) continue;
    if (keep.some((k) => milesBetween(k, c) < 0.06 && k.name !== c.name)) continue;
    keep.push(c);
  }
  return keep.sort((a, b) => milesBetween(a, { lat, lon }) - milesBetween(b, { lat, lon })).slice(0, 15);
}

// Returns up to 3 ways up: [{ label, miles, line, points }], shortest first, starting at the car.
// Only the shortest gets its heights right away (points); call withElevation(way.line) for another one.
export async function waysUp(target) {
  const top = { lat: target.latitude, lon: target.longitude };
  const starts = await startsNear(top.lat, top.lon);
  if (!starts.length) return [];
  const coords = [top, ...starts].map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
  const table = await fetch(`${OSRM}/table/v1/driving/${coords}?destinations=0&annotations=distance`).then((r) => r.json());
  const options = starts.map((s, i) => ({ ...s, miles: (table.distances?.[i + 1]?.[0] ?? NaN) / 1609.344 }))
    .filter((s) => Number.isFinite(s.miles) && s.miles > 0.1 && s.miles < 12)
    // For each trail, use the road start if it's at most 0.4 mi more walking, else the trail's own end.
    .filter((s, _, all) => {
      const twin = all.find((t) => t !== s && t.kind === "Trail" && t.name === s.name);
      if (!twin) return true;
      return s.road ? s.miles <= twin.miles + 0.4 : !(twin.miles <= s.miles + 0.4);
    })
    .sort((a, b) => a.miles - b.miles);
  // Keep ways that are really different: not the same length from almost the same spot.
  const picked = [];
  for (const o of options) {
    if (options[0] && o.miles > options[0].miles * 3) break; // a huge detour is probably a map mix-up
    if (picked.some((p) => Math.abs(p.miles - o.miles) < 0.2 || milesBetween(p, o) < 0.25)) continue;
    picked.push(o);
    if (picked.length === 3) break;
  }
  const ways = [];
  for (const o of picked) {
    const r = await fetch(`${OSRM}/route/v1/driving/${o.lon},${o.lat};${top.lon},${top.lat}?overview=full&geometries=geojson`).then((x) => x.json());
    const line = r.routes?.[0]?.geometry?.coordinates?.map(([lon, lat]) => ({ lat, lon }));
    if (!line || line.length < 2) continue;
    ways.push({ label: o.name || (o.kind === "Parking" ? "from the parking lot" : "from the trailhead"), kind: o.kind, miles: o.miles, line });
  }
  if (ways[0]) ways[0].points = await withElevation(ways[0].line);
  return ways;
}
