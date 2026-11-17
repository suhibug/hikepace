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
export function describePace(factor) {
  const mph = 3 / factor;
  const ftPerHour = Math.round(2000 / factor / 10) * 10;
  return `about ${mph.toFixed(1)} mph on flat ground, plus 1 hour for every ${ftPerHour.toLocaleString()} ft of climbing`;
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
  if (w.maxFeelsF >= 85) add("Essentials", "Electrolytes or salty snacks", `Feels like up to ${f(w.maxFeelsF)}°F. You will sweat out salt, not just water.`);

  // Clothing
  if (w.minFeelsF < 45) add("Clothing", "Base layer (wool or synthetic, not cotton)", "Cotton stays wet and pulls heat from your body.");
  if (w.minFeelsF < 60) add("Clothing", "Warm mid-layer (fleece or light puffy)", `Feels like ${f(w.minFeelsF)}°F at the coldest point, including at the top.`);
  if (w.minFeelsF < 32) add("Clothing", "Insulated puffy jacket", `Feels like ${f(w.minFeelsF)}°F. Put it on at every stop, before you get cold.`);
  if (w.minFeelsF < 40) add("Clothing", "Warm hat and gloves", `Feels like ${f(w.minFeelsF)}°F. Hands and ears get cold first.`);
  if (w.minFeelsF < 15) add("Clothing", "Hand warmers and spare gloves", `Feels like ${f(w.minFeelsF)}°F. Damp gloves stop working.`);
  if (w.maxGustMph >= 20) add("Clothing", "Wind shell", `Gusts up to ${f(w.maxGustMph)} mph. A rain shell works but you may sweat more.`);
  if (w.maxRainChance >= 30) add("Clothing", "Rain shell and a pack cover or liner", `Up to ${f(w.maxRainChance)}% chance of rain.`);
  if (w.maxRainChance >= 50 || snowy) add("Clothing", "Waterproof shoes or extra socks", "Wet feet get cold and blister fast.");
  if (snowy) add("Clothing", "Gaiters", "They keep snow out of your shoes.");

  // Traction and safety
  if (icy) add("Traction & safety", "Microspikes (traction for snow and ice)",
    w.snowDuring ? "Snow is in the forecast during your hike." : w.snowRecentCm >= 1 ? `About ${f(w.snowRecentCm)} cm of snow fell near the trailhead in the last 3 days, and higher up there is usually more.` : "Below freezing at the top with rain or snow possible, so the trail may be icy.");
  if (w.totalGainFt >= 2000 || snowy) add("Traction & safety", "Trekking poles", snowy ? "Extra balance on snow and ice." : `${w.totalGainFt.toLocaleString()} ft of climbing. Poles save your knees on the way down.`);
  if (snowy && w.topFt >= 8000) add("Traction & safety", "Check the avalanche forecast (avalanche.org)", "Recent snow on high, steep slopes can slide. Avoid steep snowy slopes if you're unsure.");
  if (w.thunder) add("Traction & safety", "A turnaround time before storms", "Thunderstorms are possible. Plan to be off peaks and open ridges early.");

  // Camp
  if (w.nights > 0) {
    add("Camp", "Water filter or purification tablets", "Refill from streams and lakes instead of carrying it all.");
    if (w.cooking) add("Camp", "Stove, fuel and a lighter", w.nightLowF !== null && w.nightLowF < 32 ? "Below freezing, gas canisters weaken. Bring extra fuel and keep the canister in your sleeping bag overnight." : "For dinner and breakfast.");
    if (w.nightLowF !== null) {
      const bag = Math.floor((w.nightLowF - 10) / 5) * 5;
      add("Camp", `Sleeping bag rated about ${bag}°F`, `Night low near ${f(w.nightLowF)}°F at camp. A much warmer bag can be just as bad: you will sweat and sleep poorly.`);
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
