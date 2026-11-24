// Miles and feet, or kilometers and meters. The math always works in miles, feet and °F inside;
// these helpers only change what people see and type. The choice is saved on the device.
// First visit: the US, Liberia and Myanmar get miles; everyone else gets kilometers.
const KEY = "hikepace.units";
const guess = () => (/-(US|LR|MM)\b/i.test(navigator.language || "") ? "imperial" : "metric");
let units = (() => { try { return localStorage.getItem(KEY) || guess(); } catch { return guess(); } })();

export const getUnits = () => units;
export function setUnits(u) {
  units = u;
  try { localStorage.setItem(KEY, u); } catch {}
}
export const metric = () => units === "metric";

const n = (x, digits = 0) => Number(x).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

// Distance: miles in → "5.2 mi" or "8.4 km"
export const toDist = (mi) => (metric() ? mi * 1.609344 : mi);
export const fromDist = (v) => (metric() ? v / 1.609344 : v);
export const dist = (mi, digits = 1) => `${n(toDist(mi), digits)} ${metric() ? "km" : "mi"}`;
export const distUnit = () => (metric() ? "km" : "miles");

// Height: feet in → "2,000 ft" or "610 m"
export const toElev = (ft) => (metric() ? ft * 0.3048 : ft);
export const fromElev = (v) => (metric() ? v / 0.3048 : v);
export const elev = (ft) => `${n(Math.round(toElev(ft) / (metric() ? 5 : 10)) * (metric() ? 5 : 10))} ${metric() ? "m" : "ft"}`;
export const elevExact = (ft) => `${n(Math.round(toElev(ft)))} ${metric() ? "m" : "ft"}`;
export const elevUnit = () => (metric() ? "meters" : "feet");

// Temperature: °F in → "72°F" or "22°C"
export const toTemp = (f) => (metric() ? (f - 32) * (5 / 9) : f);
export const temp = (f) => `${Math.round(toTemp(f))}°${metric() ? "C" : "F"}`;
export const deg = (f) => `${Math.round(toTemp(f))}°`;
export const freezing = () => (metric() ? "0°C" : "32°F");

// Wind: mph in → "20 mph" or "32 km/h"
export const speed = (mph) => `${Math.round(metric() ? mph * 1.609344 : mph)} ${metric() ? "km/h" : "mph"}`;

// Food weight: pounds in → "1.5 lb" or "0.7 kg"
export const weight = (lb) => `${n(metric() ? lb * 0.4536 : lb, 1)} ${metric() ? "kg" : "lb"}`;
