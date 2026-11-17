// Trail Prep: the math behind every estimate.
// Pure functions only (no page or network code), so they are easy to test.
// Every number here is a rough guide, and the app says so on screen.

// ---------- Time on trail ----------

// Naismith's rule: 3 mph on flat ground, plus 1 hour for every 2,000 ft of climbing.
// We add about 10 minutes of rest per hour, and on the way back down about
// 10 more minutes per 1,000 ft of descent (steep downhill is slower than people expect).
export const PACES = {
  relaxed: { label: "Relaxed", factor: 1.3 },
  average: { label: "Average", factor: 1.0 },
  fast: { label: "Fast", factor: 0.8 },
  custom: { label: "Your own" }, // learned from a past hike
};

// "Effort hours": how long a stretch takes at average pace, rests included.
export function effortHours(miles, gainFt, descentFt = 0) {
  return (miles / 3 + gainFt / 2000 + descentFt / 6000) * (7 / 6);
}

// A pace is either a preset ({ factor }) or learned from a past climb ({ ref: { miles, gainFt, hours } }).
export function paceFactor(pace) {
  return pace.ref ? pace.ref.hours / effortHours(pace.ref.miles, pace.ref.gainFt) : pace.factor;
}

// Plain-English version of a pace, e.g. "about 2.3 mph on flat ground, plus 1 hour for every 1,540 ft of climbing".
export function describePace(factor) {
  const mph = 3 / factor;
  const ftPerHour = Math.round(2000 / factor / 10) * 10;
  return `about ${mph.toFixed(1)} mph on flat ground, plus 1 hour for every ${ftPerHour.toLocaleString()} ft of climbing`;
}

// Turns effort hours into a real time range for this hiker:
//   best  = you keep your pace the whole way
//   worst = you get tired. People slow down more the longer the day, so the gap grows with length.
export function timeRange(effort, pace) {
  if (pace.ref) {
    const ratio = effort / effortHours(pace.ref.miles, pace.ref.gainFt);
    if (ratio <= 1) {
      const best = pace.ref.hours * ratio;
      return { best, worst: best * 1.15 };
    }
    // Longer than the climb we learned from. Runners use the same idea (Riegel's formula):
    // twice the distance takes a bit more than twice the time. The tired case slows down much more.
    return { best: pace.ref.hours * ratio ** 1.06, worst: pace.ref.hours * ratio ** 1.45 };
  }
  const best = effort * pace.factor;
  return { best, worst: best * (1 + Math.min(0.4, 0.03 * best)) };
}

// How the hike ends:
//   "outback" = same trail back down, so the top (or turnaround) is halfway
//   "loop"    = a different trail back to the start
//   "oneway"  = ends somewhere else: a tram, a shuttle, or a car waiting
export const ENDINGS = {
  outback: "same trail back",
  loop: "loop",
  oneway: "ends at a tram, shuttle or car",
};
export const END_TYPES = { tram: "tram", shuttle: "shuttle", car: "car pickup" };

// The whole hike: the way up to the top (or turnaround point), then the way back or down to the end.
export function estimateHike({ upMiles, upGainFt, ending, backMiles = 0, backGainFt = 0, pace, heavyPack = false, days = 1 }) {
  const returnMiles = ending === "outback" ? upMiles : backMiles;
  // Back at the start, you've come down everything you climbed. When the hike ends at a tram
  // or car we don't know how far down that is, so no descent time is added.
  const descentFt = ending === "oneway" ? 0 : upGainFt + backGainFt;
  const pack = heavyPack ? 1.15 : 1; // a full backpacking pack slows everyone down
  const effortTop = effortHours(upMiles, upGainFt) * pack;
  const effortAll = effortHours(upMiles + returnMiles, upGainFt + backGainFt, descentFt) * pack;
  return {
    totalMiles: round1(upMiles + returnMiles),
    totalGainFt: Math.round(upGainFt + backGainFt),
    top: timeRange(effortTop, pace),
    finish: timeRange(effortAll / days, pace), // per hiking day on backpacking trips
  };
}

// ---------- Temperature at the top ----------

// Air cools about 3.5 °F for every 1,000 ft you climb.
export function tempAtTop(trailheadTempF, gainFt) {
  return trailheadTempF - 3.5 * (gainFt / 1000);
}

// ---------- Water ----------

// Liters per hour of hiking, based on the hottest "feels like" temperature during the hike.
function waterRatePerHour(maxFeelsF) {
  if (maxFeelsF >= 95) return [0.9, 1.1];
  if (maxFeelsF >= 80) return [0.7, 0.9];
  if (maxFeelsF >= 60) return [0.5, 0.7];
  return [0.35, 0.5];
}

export function estimateWater({ totalHours, gainFt, maxFeelsF, nights = 0 }) {
  const [lo, hi] = waterRatePerHour(maxFeelsF);
  const climbBonus = gainFt >= 2000 ? 0.25 : 0;           // big climbs make you sweat more
  const hikeLow = totalHours * lo + climbBonus;
  const hikeHigh = totalHours * hi + climbBonus;
  // Camp needs: drinking at night and in the morning, plus cooking.
  const campPerNight = nights > 0 ? [2, 3] : [0, 0];
  return {
    low: round1(hikeLow + campPerNight[0] * nights),
    high: round1(hikeHigh + campPerNight[1] * nights),
    perHour: [lo, hi],
  };
}

// ---------- Food ----------

// Day hikes: pack about 200-300 calories of snacks per hour on the trail.
// Overnight: about 2,500-4,000 calories per full day, which is roughly 1.5-2 lb of food.
export function estimateFood({ totalHours, nights = 0, minFeelsF }) {
  const coldBoost = minFeelsF < 40 ? 1.1 : 1;            // your body burns more to stay warm
  if (nights === 0) {
    return {
      kind: "snacks",
      caloriesLow: roundTo(totalHours * 200 * coldBoost, 50),
      caloriesHigh: roundTo(totalHours * 300 * coldBoost, 50),
    };
  }
  const days = nights + 1;
  return {
    kind: "trip",
    caloriesLow: roundTo(days * 2500 * coldBoost, 100),
    caloriesHigh: roundTo(days * 4000 * coldBoost, 100),
    poundsLow: round1(days * 1.5),
    poundsHigh: round1(days * 2),
  };
}

// ---------- Gear and layers ----------

// Takes a summary of the weather during the hike and returns a checklist with reasons.
export function gearChecklist(w) {
  const items = [
    { item: "Map or downloaded trail (offline)", why: "Phone signal often drops on trails." },
    { item: "First-aid kit", why: "Always." },
    { item: "Phone and a charged battery pack", why: "Always." },
  ];
  const add = (item, why) => items.push({ item, why });

  if (w.headlamp) add("Headlamp, fully charged, plus spare batteries or a cable", `${w.headlampWhy} Charge it the night before: a dead headlamp on a dark descent is a real danger.`);
  if (w.maxUv >= 3 || w.maxFeelsF >= 75) add("Sunscreen, sunglasses and a sun hat", `UV index up to ${Math.round(w.maxUv)}.`);
  if (w.maxFeelsF >= 85) add("Electrolytes or salty snacks", `Feels like up to ${Math.round(w.maxFeelsF)}°F. You will sweat out salt, not just water.`);
  if (w.minFeelsF < 60) add("Warm mid-layer (fleece or light puffy)", `Feels like ${Math.round(w.minFeelsF)}°F at the coldest point, including at the top.`);
  if (w.minFeelsF < 40) add("Warm hat and gloves", `Feels like ${Math.round(w.minFeelsF)}°F. Hands and ears get cold first.`);
  if (w.maxGustMph >= 20) add("Wind shell", `Gusts up to ${Math.round(w.maxGustMph)} mph. A rain shell works but you may sweat more.`);
  if (w.maxRainChance >= 30) add("Rain shell and a pack cover or liner", `Up to ${Math.round(w.maxRainChance)}% chance of rain.`);
  if (w.maxRainChance >= 50) add("Waterproof shoes or extra socks", "Wet feet get cold and blister fast.");
  if (w.thunder) add("A turnaround time before storms", "Thunderstorms are possible. Plan to be off peaks and open ridges early.");
  if (w.nights > 0 && w.nightLowF !== null) {
    const bag = Math.floor((w.nightLowF - 10) / 5) * 5;
    add(`Sleeping bag rated about ${bag}°F`, `Night low near ${Math.round(w.nightLowF)}°F at camp. A much warmer bag can be just as bad: you will sweat and sleep poorly.`);
  }
  return items;
}

// ---------- Warnings shown at the top ----------

export function warnings({ day, w }) {
  const list = [];
  if (w.thunder) list.push({ level: "danger", text: "Thunderstorms in the forecast. Summit early and be below open ridges by early afternoon." });
  if (day.darkLikely) list.push({ level: "danger", text: "Even at your pace, you finish after sunset. Start earlier, or bring a charged headlamp and plan to hike in the dark." });
  else if (day.darkPossible) list.push({ level: "warn", text: "If you get tired, you could finish after sunset. Bring a charged headlamp." });
  else if (day.tight) list.push({ level: "warn", text: "If you get tired, you finish within 30 minutes of sunset. Little room for delays." });
  if (w.maxFeelsF >= 95) list.push({ level: "danger", text: `Extreme heat: feels like up to ${Math.round(w.maxFeelsF)}°F. Start at sunrise and finish before midday.` });
  else if (w.maxFeelsF >= 85) list.push({ level: "warn", text: `Hot: feels like up to ${Math.round(w.maxFeelsF)}°F. Start early and carry the high end of the water range.` });
  if (w.minFeelsF <= 20) list.push({ level: "danger", text: `Very cold: feels like ${Math.round(w.minFeelsF)}°F. Frostbite risk on exposed skin.` });
  if (w.maxGustMph >= 40) list.push({ level: "danger", text: `Strong gusts up to ${Math.round(w.maxGustMph)} mph. Exposed ridges can be dangerous.` });
  return list;
}

// ---------- Weather codes (WMO) ----------

export function describeWeather(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}
export const isThunder = (code) => code >= 95;

// ---------- Helpers ----------

export function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000);
}
export function formatDuration(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 60) return `${h + 1} h`;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}
function round1(x) { return Math.round(x * 10) / 10; }
function roundTo(x, step) { return Math.round(x / step) * step; }

// ---------- Routes from GPX files ----------

// Distance between two GPS points in miles (haversine formula).
export function milesBetween(a, b) {
  const R = 3958.8; // Earth's radius in miles
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Turns a list of points ({lat, lon, ele in meters}) into trail stats.
// GPS elevation jitters up and down, so small wiggles under 3 m are ignored;
// otherwise a flat walk would look like hundreds of feet of climbing.
export function routeStats(points) {
  let miles = 0, gainM = 0, lossM = 0, highM = -Infinity, topMiles = 0, topGainM = 0, topTime = null;
  const hasEle = points.some((p) => Number.isFinite(p.ele));
  let anchor = hasEle ? points.find((p) => Number.isFinite(p.ele)).ele : 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) miles += milesBetween(points[i - 1], p);
    if (!hasEle || !Number.isFinite(p.ele)) continue;
    if (p.ele - anchor >= 3) { gainM += p.ele - anchor; anchor = p.ele; }
    else if (anchor - p.ele >= 3) { lossM += anchor - p.ele; anchor = p.ele; }
    if (p.ele > highM) { highM = p.ele; topMiles = miles; topGainM = gainM; topTime = p.time; } // remember where the top is
  }
  const gapMiles = points.length > 1 ? milesBetween(points[0], points[points.length - 1]) : 0;
  // Recorded hikes (not planned routes) have a time on each point.
  const times = points.map((p) => p.time).filter(Number.isFinite);
  const elapsedHours = times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 3600000 : null;
  const topHours = elapsedHours && Number.isFinite(topTime) ? (topTime - Math.min(...times)) / 3600000 : null;
  return {
    miles: Math.round(miles * 10) / 10,
    gainFt: hasEle ? Math.round((gainM * 3.28084) / 10) * 10 : null,
    // Hiking back the same way, every descent on the way out becomes a climb.
    outAndBackGainFt: hasEle ? Math.round(((gainM + lossM) * 3.28084) / 10) * 10 : null,
    highFt: hasEle ? Math.round(highM * 3.28084) : null,
    topMiles: hasEle ? Math.round(topMiles * 10) / 10 : null,
    topGainFt: hasEle ? Math.round((topGainM * 3.28084) / 10) * 10 : null,
    isLoop: gapMiles < 0.2, // starts and ends in the same place
    gapMiles: Math.round(gapMiles * 10) / 10,
    start: points[0],
    elapsedHours,
    topHours,
  };
}
