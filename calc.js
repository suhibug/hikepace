// hikepace: the math behind every estimate.
// Pure functions only (no page or network code), so they are easy to test.
// Every number here is a rough guide, and the app says so on screen.
// Inside, everything is in miles, feet and °F. units.js turns that into km, m and °C for people who use them.
import { dist, elev, temp, speed } from "./units.js";

// ---------- Time on trail ----------

// Naismith's rule: 3 mph on flat ground, plus 1 hour for every 2,000 ft of climbing.
// We add about 10 minutes of rest per hour, and on the way back down about
// 10 more minutes per 1,000 ft of descent (steep downhill is slower than people expect).
// The factors come from real hikes in the hikepace survey (Nov 2026, 6 timed hikes):
// people who called themselves "fast" matched Naismith's rule, but "average" hikers took
// about 1.3-1.4x as long once long breaks at the top are taken out. So "average" is 1.2 here
// (1.2 x the 10-minute rests above ≈ 1.4x Naismith), and "relaxed" is a step slower than that.
// Checked against 8,648 GPS-recorded hikes by 321 people from hikr.org (Kaggle, public domain), mostly
// experienced Alpine hikers: relaxed ≈ their slowest 10%, average ≈ slower than their typical hiker
// (casual hikers are slower, as the survey showed), fast ≈ their fastest 15%.
export const PACES = {
  relaxed: { label: "Relaxed", emoji: "🐢", factor: 1.5, who: "Lots of stops, new to hiking, hiking with kids, or taking photos." },
  average: { label: "Average", emoji: "🥾", factor: 1.2, who: "Most people who hike now and then, with normal breaks." },
  fast: { label: "Fast", emoji: "⚡", factor: 0.85, who: "You hike or run often and keep breaks short." },
  custom: { label: "Your own", emoji: "📈" }, // learned from a past hike
};

// How much one person's time changes from hike to hike: in the hikr.org data, 80% of a person's hikes
// took between 0.77x and 1.32x their usual time (heat, breaks, how they felt). So the "if you get tired"
// end of every range is at least 1.3x the "keep your pace" end.
const SPREAD = 1.3;

// "Effort hours": how long a stretch takes at average pace, rests included.
export function effortHours(miles, gainFt, descentFt = 0) {
  return (miles / 3 + gainFt / 2000 + descentFt / 6000) * (7 / 6);
}

// Thin air: above about 6,000 ft most people slow down, roughly 6% more per 1,000 ft.
// Uses the middle of the climb (trailhead plus half the climb). Capped so it never more than doubles.
export function altitudeFactor(trailheadFt, climbFt = 0) {
  const middle = (trailheadFt || 0) + climbFt / 2;
  return middle <= 6000 ? 1 : Math.min(1.5, 1 + 0.06 * ((middle - 6000) / 1000));
}

// A pace is either a preset ({ factor }) or learned from a past climb ({ ref: { miles, gainFt, hours } }).
export function paceFactor(pace) {
  return pace.ref ? pace.ref.hours / refEffort(pace.ref) : pace.factor;
}

// Plain-English version of a pace, e.g. "about 2.3 mph on flat ground, plus 1 hour for every 1,540 ft of climbing".
// The 7/6 is the short rests that effort hours include, so this is the average speed with those rests.
export function describePace(factor) {
  const perHour = 3 / (factor * (7 / 6));
  const climbPerHour = 2000 / (factor * (7 / 6));
  return `about ${dist(perHour)} an hour on flat ground, plus 1 hour for every ${elev(climbPerHour)} of climbing (short rests included)`;
}

// What a pace means for a typical hike: 8 km / 5 mi with 500 m / 1,640 ft of climbing, there and back on the same trail.
export function sampleHike(factor) {
  return { miles: 5, gainFt: 1640, ...timeRange(effortHours(5, 1640, 1640), { factor }) };
}

// Effort of the climb we learned a pace from, with its own altitude taken out
// (if we know it), so a climb done high up isn't mistaken for a slow hiker.
function refEffort(ref) {
  return effortHours(ref.miles, ref.gainFt) * altitudeFactor(ref.elevFt, ref.gainFt);
}

// Turns effort hours into a real time range for this hiker:
//   best  = you keep your pace the whole way
//   worst = you get tired. People slow down more the longer the day, so the gap grows with length.
export function timeRange(effort, pace) {
  if (pace.ref) {
    const ratio = effort / refEffort(pace.ref);
    if (ratio <= 1) {
      const best = pace.ref.hours * ratio;
      return { best, worst: best * SPREAD };
    }
    // Longer than the climb we learned from. Runners use the same idea (Riegel's formula):
    // twice the distance takes a bit more than twice the time. The tired case slows down much more.
    const best = pace.ref.hours * ratio ** 1.06;
    return { best, worst: Math.max(best * SPREAD, pace.ref.hours * ratio ** 1.45) };
  }
  // Presets: a normal bad day (SPREAD), plus a little more on long days, when people slow down most.
  const best = effort * pace.factor;
  return { best, worst: best * (SPREAD + Math.min(0.15, 0.015 * best)) };
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
export function estimateHike({ upMiles, upGainFt, ending, backMiles = 0, backGainFt = 0, pace, heavyPack = false, days = 1, trailheadFt = 0 }) {
  const returnMiles = ending === "outback" ? upMiles : backMiles;
  // Back at the start, you've come down everything you climbed. When the hike ends at a tram
  // or car we don't know how far down that is, so no descent time is added.
  const descentFt = ending === "oneway" ? 0 : upGainFt + backGainFt;
  const pack = heavyPack ? 1.15 : 1; // a full backpacking pack slows everyone down
  const altitude = altitudeFactor(trailheadFt, upGainFt);
  const effortTop = effortHours(upMiles, upGainFt) * pack * altitude;
  const effortAll = effortHours(upMiles + returnMiles, upGainFt + backGainFt, descentFt) * pack * altitude;
  return {
    totalMiles: round1(upMiles + returnMiles),
    totalGainFt: Math.round(upGainFt + backGainFt),
    altitudeSlowdown: Math.round((altitude - 1) * 100), // percent
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

export function estimateWater({ hoursLow, hoursHigh, gainFt, maxFeelsF, nights = 0, cooking = true }) {
  const [lo, hi] = waterRatePerHour(maxFeelsF);
  const climbBonus = gainFt >= 2000 ? 0.25 : 0;           // big climbs make you sweat more
  // Camp, per night: drinking in the evening and morning, plus water for cooking dinner and breakfast.
  const camp = cooking ? [2, 3] : [1, 1.5];
  const hike = [round1(hoursLow * lo + climbBonus), round1(hoursHigh * hi + climbBonus)];
  const atCamp = [round1(camp[0] * nights), round1(camp[1] * nights)];
  return { hike, camp: atCamp, total: [round1(hike[0] + atCamp[0]), round1(hike[1] + atCamp[1])], perHour: [lo, hi] };
}

// ---------- Food ----------

// What to pack, not what you burn:
//   snacks while hiking: about 200-300 calories per hour on the trail
//   at camp, per night: dinner about 600-900 and breakfast about 400-600 calories
// Backpacking food averages about 100-125 calories per ounce, so 1,600-2,000 calories is about 1 lb.
export function estimateFood({ hoursLow, hoursHigh, nights = 0, minFeelsF }) {
  const cold = minFeelsF < 40 ? 1.1 : 1; // your body burns more to stay warm
  const snacks = [roundTo(hoursLow * 200 * cold, 50), roundTo(hoursHigh * 300 * cold, 50)];
  const meals = [roundTo(nights * 1000 * cold, 50), roundTo(nights * 1500 * cold, 50)];
  const total = [snacks[0] + meals[0], snacks[1] + meals[1]];
  return { snacks, meals, total, pounds: [round1(total[0] / 2000), round1(total[1] / 1600)] };
}

// ---------- Gear and layers ----------

// Takes a summary of the conditions and returns a grouped checklist, each item with its reason.
export function gearChecklist(w) {
  const items = [];
  const add = (group, item, why) => items.push({ group, item, why });
  const f = (x) => Math.round(x);
  const snowy = w.snowDuring || w.snowRecentCm >= 1;
  const icy = snowy || (w.minTempTopF <= 32 && w.maxRainChance >= 30);

  // Essentials
  add("Essentials", "Map or downloaded trail (offline)", "Phone signal often drops on trails.");
  add("Essentials", "First-aid kit", "Always.");
  add("Essentials", "Phone and a charged battery pack", "Always.");
  add("Essentials", "Tell someone your plan and when you'll be back", "If something goes wrong, someone knows where to look.");
  if (w.headlamp) add("Essentials", "Headlamp, fully charged, plus spare batteries or a cable", `${w.headlampWhy} Charge it the night before: a dead headlamp on a dark descent is a real danger.`);
  if (w.maxUv >= 3 || w.maxFeelsF >= 75 || snowy) add("Essentials", "Sunscreen, sunglasses and a sun hat", snowy ? "Snow reflects sunlight, so you can burn even when it's cold." : `UV index up to ${f(w.maxUv)}.`);
  if (w.maxFeelsF >= 85) add("Essentials", "Electrolytes or salty snacks", `Feels like up to ${temp(w.maxFeelsF)}. You will sweat out salt, not just water.`);

  // Clothing
  if (w.minFeelsF < 45) add("Clothing", "Base layer (wool or synthetic, not cotton)", "Cotton stays wet and pulls heat from your body.");
  if (w.minFeelsF < 60) add("Clothing", "Warm mid-layer (fleece or light puffy)", `Feels like ${temp(w.minFeelsF)} at the coldest point, including at the top.`);
  if (w.minFeelsF < 32) add("Clothing", "Insulated puffy jacket", `Feels like ${temp(w.minFeelsF)}. Put it on at every stop, before you get cold.`);
  if (w.minFeelsF < 40) add("Clothing", "Warm hat and gloves", `Feels like ${temp(w.minFeelsF)}. Hands and ears get cold first.`);
  if (w.minFeelsF < 15) add("Clothing", "Hand warmers and spare gloves", `Feels like ${temp(w.minFeelsF)}. Damp gloves stop working.`);
  if (w.maxGustMph >= 20) add("Clothing", "Wind shell", `Gusts up to ${speed(w.maxGustMph)}. A rain shell works but you may sweat more.`);
  if (w.maxRainChance >= 30) add("Clothing", "Rain shell and a pack cover or liner", `Up to ${f(w.maxRainChance)}% chance of rain.`);
  if (w.maxRainChance >= 50 || snowy) add("Clothing", "Waterproof shoes or extra socks", "Wet feet get cold and blister fast.");
  if (snowy) add("Clothing", "Gaiters", "They keep snow out of your shoes.");

  // Traction and safety
  if (icy) add("Traction & safety", "Microspikes (traction for snow and ice)",
    w.snowDuring ? "Snow is in the forecast during your hike." : w.snowRecentCm >= 1 ? `About ${f(w.snowRecentCm)} cm of snow fell near the trailhead in the last 3 days, and higher up there is usually more.` : "Below freezing at the top with rain or snow possible, so the trail may be icy.");
  if (w.totalGainFt >= 2000 || snowy) add("Traction & safety", "Trekking poles", snowy ? "Extra balance on snow and ice." : `${elev(w.totalGainFt)} of climbing. Poles save your knees on the way down.`);
  if (snowy && w.topFt >= 8000) add("Traction & safety", "Check the avalanche forecast (avalanche.org)", "Recent snow on high, steep slopes can slide. Avoid steep snowy slopes if you're unsure.");
  if (w.thunder) add("Traction & safety", "A turnaround time before storms", "Thunderstorms are possible. Plan to be off peaks and open ridges early.");

  // Camp
  if (w.nights > 0) {
    add("Camp", "Water filter or purification tablets", "Refill from streams and lakes instead of carrying it all.");
    if (w.cooking) add("Camp", "Stove, fuel and a lighter", w.nightLowF !== null && w.nightLowF < 32 ? "Below freezing, gas canisters weaken. Bring extra fuel and keep the canister in your sleeping bag overnight." : "For dinner and breakfast.");
    if (w.nightLowF !== null) {
      const bag = Math.floor((w.nightLowF - 10) / 5) * 5;
      add("Camp", `Sleeping bag rated about ${temp(bag)}`, `Night low near ${temp(w.nightLowF)} at camp. A much warmer bag can be just as bad: you will sweat and sleep poorly.`);
      if (w.nightLowF < 40) add("Camp", "Insulated sleeping pad (R-value 4 or higher)", "The cold ground takes more heat than the air does.");
      if (w.nightLowF < 32) add("Camp", "Keep water from freezing", "Use an insulated bottle, or store bottles upside down and inside your tent.");
    }
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
  if (w.maxFeelsF >= 95) list.push({ level: "danger", text: `Extreme heat: feels like up to ${temp(w.maxFeelsF)}. Start at sunrise and finish before midday.` });
  else if (w.maxFeelsF >= 85) list.push({ level: "warn", text: `Hot: feels like up to ${temp(w.maxFeelsF)}. Start early and carry the high end of the water range.` });
  if (w.minFeelsF <= 20) list.push({ level: "danger", text: `Very cold: feels like ${temp(w.minFeelsF)}. Frostbite risk on exposed skin.` });
  if (w.maxGustMph >= 40) list.push({ level: "danger", text: `Strong gusts up to ${speed(w.maxGustMph)}. Exposed ridges can be dangerous.` });
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

// ---------- Where to camp (backpacking) ----------
// The idea: walk the route at the hiker's own pace, see how far they get before it's too dark
// to set up a tent, and list the campsites near the trail they can reach in time.

// Hours from the start to every point of a route, at "effort" pace (before the hiker's pace is applied).
// Uses the same rule as the rest of the app, segment by segment, so steep parts count as slow.
// GPS elevation jitters, so changes under 3 m are ignored (same as routeStats).
export function routeEffort(points) {
  const out = [{ mile: 0, effort: 0 }];
  let miles = 0, effort = 0, anchor = points.find((p) => Number.isFinite(p.ele))?.ele ?? 0;
  for (let i = 1; i < points.length; i++) {
    const seg = milesBetween(points[i - 1], points[i]);
    let up = 0, down = 0;
    const ele = points[i].ele;
    if (Number.isFinite(ele)) {
      if (ele - anchor >= 3) { up = (ele - anchor) * 3.28084; anchor = ele; }
      else if (anchor - ele >= 3) { down = (anchor - ele) * 3.28084; anchor = ele; }
    }
    miles += seg;
    effort += effortHours(seg, up, down);
    out.push({ mile: miles, effort });
  }
  return out;
}

// Campsites near the route that can be reached before dark.
//   points:  the route ({ lat, lon, ele })
//   places:  rows from data/places tiles ([lat, lon, kind, name, flags, extra])
//   start:   Date the hike starts · sunset: Date of sunset that day
//   pace:    the hiker's pace (same object the rest of the app uses)
//   slow:    extra slow-down (heavy pack, thin air), e.g. 1.15
// Each campsite gets a best-case and a tired-case arrival time:
//   "easy"  = reached with time to set up (45 min before sunset) even if you get tired
//   "maybe" = only if you keep your pace
//   "late"  = after dark, so not suggested
export const SETUP_HOURS = 0.75;
export function campsAlongRoute({ points, places, start, sunset, pace, slow = 1, maxOffTrailMi = 0.35 }) {
  const track = routeEffort(points);
  // Checking every GPS point is slow on a phone, so use about one point every 0.05 mi.
  const sample = [];
  for (let i = 0; i < points.length; i++) {
    if (!sample.length || track[i].mile - track[sample[sample.length - 1]].mile >= 0.05 || i === points.length - 1) sample.push(i);
  }
  const cutoff = addHours(sunset, -SETUP_HOURS);
  const water = places.filter((p) => p[2] === "spring" || p[2] === "water");
  const camps = [];
  for (const place of places) {
    if (place[2] !== "camp" && place[2] !== "ground") continue;
    const spot = { lat: place[0], lon: place[1] };
    // Closest point on the route. The first time the trail passes near it counts (you'd camp the first time you reach it).
    let best = null;
    for (const i of sample) {
      const d = milesBetween(points[i], spot);
      if (d <= maxOffTrailMi && (!best || d < best.d - 0.02)) { best = { i, d }; if (d < 0.05) break; }
    }
    if (!best) continue;
    // Walking off the trail to the site: about 1.5 mph.
    const effort = track[best.i].effort * slow + best.d / 1.5;
    const range = timeRange(effort, pace);
    const arriveBest = addHours(start, range.best), arriveWorst = addHours(start, range.worst);
    const status = arriveWorst <= cutoff ? "easy" : arriveBest <= cutoff ? "maybe" : "late";
    // Nearest water to the campsite, within a mile.
    let nearWater = null;
    for (const w of water) {
      const d = milesBetween(spot, { lat: w[0], lon: w[1] });
      if (d <= 1 && (!nearWater || d < nearWater.d)) nearWater = { d, name: w[3], kind: w[2], drinkable: w[4].includes("d") };
    }
    camps.push({
      lat: place[0], lon: place[1], kind: place[2], name: place[3], flags: place[4], ridbId: place[5],
      mile: round1(track[best.i].mile), offTrailMi: round1(best.d), arriveBest, arriveWorst, status, water: nearWater,
    });
  }
  camps.sort((a, b) => a.mile - b.mile);
  // Where you'll be by set-up time even if you get tired: the last route point you reach in time.
  // Useful when no campsite is mapped, since dispersed camping may still be allowed there.
  let reach = null;
  for (const i of sample) {
    const r = timeRange(track[i].effort * slow, pace);
    if (addHours(start, r.worst) > cutoff) break;
    reach = { mile: round1(track[i].mile), lat: points[i].lat, lon: points[i].lon, end: i === points.length - 1 };
  }
  // The pick: the farthest campsite you can reach easily, preferring one with water within half a mile.
  const easy = camps.filter((c) => c.status === "easy");
  const pick = [...easy].reverse().find((c) => c.water && c.water.d <= 0.5) || easy[easy.length - 1] || null;
  return { camps, pick, cutoff, reach };
}

// Springs and taps within a quarter mile of the route, with the mile you reach them.
export function waterAlongRoute(points, places, maxOffTrailMi = 0.25) {
  const track = routeEffort(points);
  const found = [];
  for (const place of places) {
    if (place[2] !== "spring" && place[2] !== "water") continue;
    let best = null;
    for (let i = 0; i < points.length; i += 5) {
      const d = milesBetween(points[i], { lat: place[0], lon: place[1] });
      if (d <= maxOffTrailMi && (!best || d < best.d)) best = { i, d };
    }
    if (best) found.push({ name: place[3], kind: place[2], drinkable: place[4].includes("d"), mile: round1(track[best.i].mile), offTrailMi: round1(best.d) });
  }
  return found.sort((a, b) => a.mile - b.mile);
}

// What the land manager usually allows for camping outside a campground. Always a rough guide:
// rules change (fire bans, closures), so the app tells people to check before they go.
// Codes come from the Bureau of Land Management's land map (Surface Management Agency).
export function campRules(agency) {
  const rules = {
    BLM: { label: "BLM land", rule: "Dispersed camping is usually allowed (up to 14 days).", ok: true },
    USFS: { label: "National Forest", rule: "Dispersed camping is usually allowed. Check fire rules and closures.", ok: true },
    NPS: { label: "National Park", rule: "Backcountry camping needs a permit, only in allowed spots.", ok: false },
    FWS: { label: "Wildlife refuge", rule: "Camping is usually not allowed.", ok: false },
    BIA: { label: "Tribal land", rule: "Needs permission or a permit from the tribe.", ok: false },
    DOD: { label: "Military land", rule: "No public access.", ok: false },
    USBR: { label: "Bureau of Reclamation", rule: "Rules vary. Check the local office.", ok: null },
    ST: { label: "State Trust land", rule: "Camping needs a state recreation permit.", ok: null },
    SDA: { label: "State land", rule: "Rules vary. Check the state office.", ok: null },
    LG: { label: "City or county land", rule: "Camping is usually not allowed outside campgrounds.", ok: false },
    PVT: { label: "Private land", rule: "Ask the owner first.", ok: false },
  };
  return rules[agency] || { label: "Unknown land", rule: "Check the local rules before camping here.", ok: null };
}
