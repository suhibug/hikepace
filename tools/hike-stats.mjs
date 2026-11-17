// Reads every GPX file in a folder and pulls out the numbers the survey would otherwise ask for:
// start time, time at the top, finish time, distance, climbing, rest at the top, and more.
//
// Usage (from the trail-prep folder):
//   node tools/hike-stats.mjs hike-data
// It prints a summary and writes hike-data/hike-stats.csv (kept private: hike-data/ is never uploaded).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { routeStats, milesBetween } from "../calc.js";

const folder = process.argv[2] || "hike-data";
const files = readdirSync(folder).filter((f) => f.toLowerCase().endsWith(".gpx"));
if (!files.length) {
  console.log(`No .gpx files found in ${folder}. Put the GPX files people send you there and run this again.`);
  process.exit(0);
}

// Pull track points (lat, lon, elevation, time) out of a GPX file without any extra libraries.
function readPoints(xml) {
  const points = [];
  for (const m of xml.matchAll(/<(?:trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/(?:trkpt|rtept)>/g)) {
    const lat = parseFloat(/lat="([^"]+)"/.exec(m[1])?.[1]);
    const lon = parseFloat(/lon="([^"]+)"/.exec(m[1])?.[1]);
    const ele = parseFloat(/<ele>([^<]+)<\/ele>/.exec(m[2])?.[1]);
    const time = Date.parse(/<time>([^<]+)<\/time>/.exec(m[2])?.[1] ?? "");
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon, ele, time });
  }
  return points;
}

// Minutes spent near the high point (within 0.15 mi) while barely moving: that's the rest at the top.
function restAtTopMinutes(points) {
  const withEle = points.filter((p) => Number.isFinite(p.ele) && Number.isFinite(p.time));
  if (withEle.length < 2) return null;
  const top = withEle.reduce((a, b) => (b.ele > a.ele ? b : a));
  let ms = 0;
  for (let i = 1; i < withEle.length; i++) {
    const a = withEle[i - 1], b = withEle[i];
    const hours = (b.time - a.time) / 3600000;
    if (hours <= 0) continue;
    const near = milesBetween(a, top) < 0.15;
    const slow = milesBetween(a, b) / hours < 0.6; // under 0.6 mph = stopped or milling around
    if (near && slow) ms += b.time - a.time;
  }
  return Math.round(ms / 60000);
}

// Time spent stopped anywhere (breaks), counting gaps where someone moved under 0.3 mph.
function movingHours(points) {
  let ms = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!Number.isFinite(a.time) || !Number.isFinite(b.time)) continue;
    const hours = (b.time - a.time) / 3600000;
    if (hours > 0 && milesBetween(a, b) / hours >= 0.3) ms += b.time - a.time;
  }
  return ms / 3600000;
}

// The trail's own clock time: ask the free Open-Meteo service which time zone the trailhead is in.
async function utcOffsetHours(lat, lon) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1`);
    return (await res.json()).utc_offset_seconds / 3600;
  } catch {
    return 0;
  }
}

const clock = (ms, offset) => {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + offset * 3600000);
  return d.toISOString().slice(11, 16);
};
const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : "");
const ft = (m) => (Number.isFinite(m) ? Math.round(m * 3.28084) : "");

const rows = [];
for (const file of files) {
  const xml = readFileSync(join(folder, file), "utf8");
  const points = readPoints(xml);
  if (points.length < 2) {
    console.log(`Skipped ${file}: no route points.`);
    continue;
  }
  const r = routeStats(points);
  const name = (/<trk>[\s\S]*?<name>([^<]*)<\/name>/.exec(xml) || /<name>([^<]*)<\/name>/.exec(xml))?.[1]?.trim() ?? "";
  const times = points.map((p) => p.time).filter(Number.isFinite);
  const start = times.length ? Math.min(...times) : NaN;
  const finish = times.length ? Math.max(...times) : NaN;
  const offset = times.length ? await utcOffsetHours(points[0].lat, points[0].lon) : 0;
  rows.push({
    file: basename(file),
    trail: name,
    date: Number.isFinite(start) ? new Date(start + offset * 3600000).toISOString().slice(0, 10) : "",
    start: clock(start, offset),
    top: Number.isFinite(r.topHours) ? clock(start + r.topHours * 3600000, offset) : "",
    finish: clock(finish, offset),
    total_miles: r.miles,
    total_gain_ft: r.gainFt ?? "",
    miles_to_top: r.topMiles ?? "",
    gain_to_top_ft: r.topGainFt ?? "",
    trailhead_ft: ft(points[0].ele),
    high_point_ft: r.highFt ?? "",
    hours_to_top: round1(r.topHours),
    total_hours: round1(r.elapsedHours),
    moving_hours: times.length ? round1(movingHours(points)) : "",
    rest_at_top_min: restAtTopMinutes(points) ?? "",
    ends: r.isLoop ? "back at start" : `${r.gapMiles} mi from start`,
  });
}

const cols = Object.keys(rows[0] ?? {});
const csv = [cols.join(","), ...rows.map((row) => cols.map((c) => `"${String(row[c]).replace(/"/g, '""')}"`).join(","))].join("\n");
const out = join(folder, "hike-stats.csv");
writeFileSync(out, csv + "\n");

for (const row of rows) {
  console.log(`\n${row.trail || row.file}  (${row.date})`);
  console.log(`  ${row.start} start → ${row.top || "?"} top → ${row.finish} finish`);
  console.log(`  ${row.total_miles} mi, ${row.total_gain_ft} ft climbing; top at mile ${row.miles_to_top} (${row.gain_to_top_ft} ft up)`);
  console.log(`  trailhead ${row.trailhead_ft} ft, high point ${row.high_point_ft} ft`);
  console.log(`  ${row.hours_to_top} h to the top, ${row.total_hours} h total (${row.moving_hours} h moving), ${row.rest_at_top_min} min resting at the top; ends ${row.ends}`);
}
console.log(`\nSaved ${rows.length} hike(s) to ${out}`);
