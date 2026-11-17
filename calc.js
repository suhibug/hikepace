// Trail Prep: the math behind every estimate.
// Pure functions only (no page or network code), so they are easy to test.
// Every number here is a rough guide, and the app says so on screen.

// ---------- Time on trail ----------

// Naismith's rule: 3 mph on flat ground, plus 1 hour for every 2,000 ft of climbing.
// Pace multipliers let people match it to how they actually hike.
export const PACES = {
  relaxed: { label: "Relaxed", factor: 1.3 },
  average: { label: "Average", factor: 1.0 },
  fast: { label: "Fast", factor: 0.8 },
};

export function estimateHikeTime({ miles, gainFt, pace = "average", groupSize = 1, heavyPack = false }) {
  const movingHours = miles / 3 + gainFt / 2000;
  let factor = PACES[pace]?.factor ?? 1;
  if (heavyPack) factor *= 1.15;                         // overnight pack slows everyone down
  if (groupSize > 2) factor *= 1 + 0.05 * (groupSize - 2); // groups move at the pace of the slowest person
  const moving = movingHours * factor;
  const breaks = moving * (10 / 60);                      // about 10 minutes of rest per hour
  const total = moving + breaks;
  return {
    movingHours: moving,
    breakHours: breaks,
    totalHours: total,
    // On an out-and-back or summit hike, the climb takes longer than the descent.
    toHighPointHours: total * 0.6,
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

// ---------- Daylight ----------

export function daylightPlan({ start, totalHours, toHighPointHours, sunrise, sunset }) {
  const finish = addHours(start, totalHours);
  const bufferMs = 30 * 60 * 1000;
  const latestStart = new Date(sunset.getTime() - bufferMs - totalHours * 3600000);
  return {
    finish,
    reachTop: addHours(start, toHighPointHours),
    finishesAfterDark: finish.getTime() > sunset.getTime(),
    tightOnLight: finish.getTime() > sunset.getTime() - bufferMs,
    startsInDark: start.getTime() < sunrise.getTime(),
    latestStart,
    // Start time needed to stand at the top right at sunrise.
    sunriseAtTopStart: addHours(sunrise, -toHighPointHours),
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

  if (w.headlamp) add("Headlamp", w.headlampWhy);
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
  if (day.finishesAfterDark) list.push({ level: "danger", text: "At this start time you finish after sunset. Start earlier or bring a headlamp and plan for the dark." });
  else if (day.tightOnLight) list.push({ level: "warn", text: "You finish within 30 minutes of sunset. Very little room for delays." });
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
