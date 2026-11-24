# hikepace

(Formerly called Trail Prep. Live at https://suhibug.github.io/hikepace/)

A free hike planner for **anywhere in the world**. Type a trail's name, and it measures the trail for you (distance, climb, highest point) and tells you, before you leave:

- **How long the hike will take** for your pace and group size
- **Daylight**: when you'll reach the top, when you'll finish, the latest safe start time, and what time to start to see sunrise from the top
- **Weather during your hike**, hour by hour, plus how much colder it gets at the top
- **How much water and food to bring**, as a range
- **A pack list for the conditions** (layers, rain shell, headlamp, sunscreen, sleeping bag rating) with the reason for each item
- **Safety warnings** for storms, heat, cold, strong wind, and finishing after dark
- **Where to camp tonight** (backpacking): the campsites near your route that **you** can reach before dark at your own pace, the best pick (the farthest one with water close by), and whether camping is allowed on that land (BLM, National Forest, National Park, state, tribal or private)
- **Water on the way**: springs and taps along your route, with the mile you reach each one

**Type a trail or a peak, get the numbers:** search "Camelback Mountain" and hikepace finds the trails that reach the top, starts each one where you park, and measures the walk (distance, climb, trailhead elevation) with a free walking-route service and free elevation data. It offers the best ways up ("via Cholla Trail, 1.4 mi"). Search a trail by name and it measures that trail. Suggestions appear as you type, nearby places first.

**It learns your pace once:** the first time you open it, it asks for one hike you've done and how long it took, then uses your real pace for every plan. No pace? Pick Relaxed, Average or Fast, each explained with an example.

**One question per screen:** Where → your trail → when → your plan. The plan has tabs (your day, weather, pack list, camp and water) instead of one long page, and a tab bar for Plan, Trips and You.

**Kilometers or miles:** tap the unit button at the top (or Settings). People outside the US get kilometers, meters and °C by default.

**Fun to use:** a sunrise splash screen, a pace meter, a sun bar with a little boot walking from your start to your finish, a climb chart you can slide your finger along to see when you'll reach each point, water and tent pins on the chart, a pack list you tick off, and a small celebration when your plan is ready. People who turn off motion on their phone don't get the animations.

**Import a route:** load a GPX file from AllTrails, Strava, Garmin, Coros, or most other hiking apps, and hikepace fills in the trailhead, distance, and elevation gain. The file is read on your device and never uploaded.

It works **offline**: plan a trip while you have signal, tap **Save for offline**, and the plan opens on the trail with no signal.

It's free, needs no account, and has no ads. Weather comes from [Open-Meteo](https://open-meteo.com/), a free weather service.

## Why I built it

I surveyed 14 hikers in October 2026 before writing any code. What they told me:

| Finding | Responses |
|---|---|
| Have brought the wrong amount of food or water | 13 of 14 |
| Would trust a tool's water and calorie estimate as a rough guide (or fully) | 13 of 14 |
| Do night hikes or backpacking, not just day hikes | 10 of 14 |
| Use AllTrails to plan | 11 of 14 |

The most annoying parts of planning were unpredictable weather, not knowing the weather at different points and times on the trail, and guessing how long a hike (or a group) will take. Several people had been caught off guard by cold, rain, darkness, or the wrong sleeping bag. When asked what one free tool should do, the top answers were trail weather and conditions, an "effort estimate" for water and calories, and water sources.

**The second survey (November 2026)** collected 6 real hikes with start, top and finish times, water and food. It showed that one formula doesn't fit everyone: hikers who called themselves "fast" matched the standard rule, but "average" hikers took 1.5 to 2 times as long. So hikepace's paces were adjusted, and it can learn your own pace from a hike you recorded. The first survey's top backpacking problem, finding a flat, legal campsite, became the "Where to camp tonight" feature.

## How to use it

1. First time only: tell it one hike you've done and how long it took (or pick a pace).
2. **Where to?** Type a trail or a peak and tap it. It measures the way up for you; pick another way up if there's more than one.
3. **Your trail:** check the numbers (✏️ Fix the numbers if your guide says otherwise) and how you get back: same way, loop, or ends at a tram, shuttle or car.
4. **When:** tap a day, a start time (or Sunrise) and day hike or nights.
5. **Your plan:** swipe through the tabs, tick off the pack list, then **Save** before you lose signal.

No GPX file? Free options: draw the trail on CalTopo and export it, or export a hike you recorded from your watch's app.

On a phone, open the site and choose **Add to Home Screen** to use it like an app.

## How the estimates work

All numbers are rough guides, and the app says so.

- **Time, as a range:** Naismith's rule (3 mph, plus 1 hour per 2,000 ft of climbing), about 10 minutes of rest per hour, and about 10 more minutes per 1,000 ft of descent. Every time is shown as a range from "if you keep your pace" to "if you get tired". The tired end is at least 1.3 times the first, because in 8,648 recorded hikes one person's times varied that much from day to day (heat, breaks, how they felt), and it widens a bit more on long days. Safety warnings use the tired end.
  - 🐢 **Relaxed:** about 1.7 mph (2.8 km/h) on flat ground, plus 1 hour for every 1,140 ft (350 m) of climbing, short rests included
  - 🥾 **Average:** about 2.1 mph (3.4 km/h), plus 1 hour for every 1,430 ft (440 m) (set from the November 2026 survey's real hikes)
  - ⚡ **Fast:** about 3 mph (4.8 km/h), plus 1 hour for every 2,020 ft (615 m)
  - Settings shows each pace with an example hike, so people can pick the right one.
  - **Your own pace:** learned from the way up of a climb you already did. For hikes much longer than that climb, hikepace scales the time the way endurance runners do (Riegel's formula) and adds a "getting tired" case.
- **Altitude:** above about 6,000 ft, thinner air slows most people down, so times get about 6% longer per 1,000 ft (measured at the middle of the climb). The trailhead elevation is filled in for you and can be corrected.
- **Temperature at the top:** about 3.5 °F colder per 1,000 ft of climbing.
- **Water:** to drink while hiking, 0.35 to 1.1 liters per hour depending on the hottest "feels like" temperature (a bit more for big climbs). Backpacking adds camp water: 2 to 3 liters per night with cooking, 1 to 1.5 without.
- **Food (what to pack):** trail snacks of 200 to 300 calories per hour of hiking, plus dinner (600 to 900) and breakfast (400 to 600) for each night; 10% more in the cold. Backpacking food is about 1,600 to 2,000 calories per pound.
- **Pack list:** grouped into essentials, clothing, traction and safety, and camp. It looks at the forecast and the last 3 days of snow, so it suggests things like microspikes, gaiters, or checking the avalanche forecast when there's recent snow up high.

- **Where to camp:** hikepace walks your route point by point at your pace (steep parts count as slower, a full pack adds 15%), and marks each campsite within about a third of a mile of the trail as "easy" (you arrive at least 45 minutes before sunset to set up, even if you get tired), "tight" (only if you keep your pace), or after dark. It also says where you'll be by set-up time, in case no campsite is mapped there.
- **Legal camping:** a live lookup on the Bureau of Land Management's free land map tells who manages the land at each campsite, and hikepace shows what that land usually allows. Rules change (fire bans, closures), so always check with the land office.

The formulas live in `calc.js` so they're easy to read and change.

### Checked against real hikes

The paces were checked against the free [GPS-recorded hikes from hikr.org](https://www.kaggle.com/datasets/roccoli/gpx-hike-tracks) dataset on Kaggle (public domain): 8,648 usable hikes by 321 people, mostly experienced hikers in the Alps. Relaxed matches their slowest 10%, Fast their fastest 15%, and Average is a bit slower than their typical hiker, which fits casual hikers (the survey showed the same). It also showed breaks take about 30% of a hiking day, and that harder terrain is slower.

## Where the data comes from

All free:

| Data | Source |
|---|---|
| Weather, sunrise and sunset, elevation | [Open-Meteo](https://open-meteo.com/) |
| Search with suggestions (nearby first) | [Photon](https://photon.komoot.io/) by komoot, from OpenStreetMap |
| Each trail's path, parking lots and trailheads | [OpenStreetMap](https://www.openstreetmap.org/) (Nominatim) |
| Walking distance from the car to the top | [OSRM](https://routing.openstreetmap.de/) on routing.openstreetmap.de (FOSSGIS) |
| Height along a trail | [Open-Meteo elevation](https://open-meteo.com/en/docs/elevation-api) (Copernicus 90 m map) |
| Campsites, tent spots, springs, drinking water, trailheads | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL license |
| Federal campgrounds (with booking links) | [Recreation.gov RIDB](https://ridb.recreation.gov/) |
| Who manages the land | [Bureau of Land Management](https://gis.blm.gov/) Surface Management Agency map |

Campsites and water work **everywhere**: Arizona uses ready-made files (with US federal campgrounds), and everywhere else is asked live from OpenStreetMap (Overpass, with Nominatim as the backup). The land-manager check is US only. To add ready-made files for another state, run the two tools below with its code (for example `US-UT`).

## What each file does

| File | What it does |
|---|---|
| `index.html` | The page: the plan form and the empty results area |
| `style.css` | How it looks, including the phone layout (app-like on the home screen) and dark mode |
| `app.js` | The screens and what they do: first-time pace questions, search with suggestions, measuring the trail, when, the plan with tabs (sun bar, climb chart, weather, pack list, camp), Trips and You |
| `trail.js` | Measures trails: a searched trail's pieces joined into one path, or the best ways up a peak (trails near the top, starting where you park, walked with OSRM). Adds heights from Open-Meteo |
| `places.js` | Finds campsites, springs and water near a trail anywhere (ready-made files first, then live from OpenStreetMap), and the US land-manager lookup |
| `units.js` | Miles/feet/°F or kilometers/meters/°C. The math always works in miles and feet; this only changes what people see and type |
| `calc.js` | All the math, as plain functions with no page code: time, pace, water, food, daylight, gear, warnings, campsites along a route |
| `sw.js` | Service worker: saves the app (and the campsite data you've looked at) on the phone so it works with no signal |
| `manifest.webmanifest`, `icon*.png`, `icon.svg` | Lets phones install hikepace to the home screen with its own icon |
| `analytics.js` | Anonymous visit counts (no names, no trails or places) |
| `data/places/` | Campsites, springs, water and trailheads, split into small half-degree squares so a phone only downloads the area it needs. Made by `tools/build-places.mjs` |
| `tools/fetch-open-data.mjs` | Downloads the free campsite, spring, water and trailhead data (and Recreation.gov campgrounds) for a state |
| `tools/build-places.mjs` | Turns that download into the small files in `data/places/` |
| `tools/hike-stats.mjs` | Reads recorded GPX hikes into a table (start, top, finish, rest) to check the estimates against real hikes |

Survey answers and people's GPX files stay private on my computer (`hike-data/`, never uploaded).

## Update the campsite data

```bash
node tools/fetch-open-data.mjs US-AZ   # needs RIDB_KEY=... in hike-data/.keys for Recreation.gov campgrounds
node tools/build-places.mjs
```

## Run it on your computer

No installs needed beyond Python, which comes with macOS:

```bash
cd hikepace
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Ideas for later (from the survey)

- Trail search suggestions as you type
- A map view of the trail with campsites and water
- User reports on springs (flowing or dry) and campsites
- Permits for specific areas
- Road conditions to the trailhead
- Group planning (who's coming, everyone's pace and gear)

## License

MIT. Free for anyone to use, copy, and improve.
