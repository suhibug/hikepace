# Trail Prep

A free hike planner that tells you, before you leave:

- **How long the hike will take** for your pace and group size
- **Daylight**: when you'll reach the top, when you'll finish, the latest safe start time, and what time to start to see sunrise from the top
- **Weather during your hike**, hour by hour, plus how much colder it gets at the top
- **How much water and food to bring**, as a range
- **A pack list for the conditions** (layers, rain shell, headlamp, sunscreen, sleeping bag rating) with the reason for each item
- **Safety warnings** for storms, heat, cold, strong wind, and finishing after dark

**Import a route:** load a GPX file from AllTrails, Strava, Garmin, Coros, or most other hiking apps, and Trail Prep fills in the trailhead, distance, and elevation gain. The file is read on your device and never uploaded.

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

## How to use it

1. Import a GPX route (it fills in everything below), or search for the trail, a landmark, or the nearest town.
2. **The way up:** miles and feet of climbing to the top (or the turnaround point).
3. **The way back:** same trail, a different trail back to the start, or down to a tram, shuttle, or car. For a tram or shuttle you can add the last departure time, and Trail Prep warns you if you might miss it.
4. Date, start time, trip type, and pace (hiking with others? pick the slowest person's pace).
5. Tap **Plan my hike**, then **Save for offline** before you lose signal.

No GPX file? Free options: draw the trail on CalTopo and export it, or export a hike you recorded from your watch's app.

On a phone, open the site and choose **Add to Home Screen** to use it like an app.

## How the estimates work

All numbers are rough guides, and the app says so.

- **Time, as a range:** Naismith's rule (3 mph, plus 1 hour per 2,000 ft of climbing), about 10 minutes of rest per hour, and about 10 more minutes per 1,000 ft of descent. Every time is shown as a range from "if you keep your pace" to "if you get tired"; the range widens on longer days because people slow down as the day goes on. Safety warnings use the tired end.
  - **Relaxed:** about 2.3 mph on flat ground, plus 1 hour for every 1,540 ft of climbing
  - **Average:** about 3 mph on flat ground, plus 1 hour for every 2,000 ft of climbing
  - **Fast:** about 3.8 mph on flat ground, plus 1 hour for every 2,500 ft of climbing
  - **Your own pace:** learned from the way up of a climb you already did. For hikes much longer than that climb, Trail Prep scales the time the way endurance runners do (Riegel's formula) and adds a "getting tired" case.
- **Altitude:** above about 6,000 ft, thinner air slows most people down, so times get about 6% longer per 1,000 ft (measured at the middle of the climb). The trailhead elevation is filled in for you and can be corrected.
- **Temperature at the top:** about 3.5 °F colder per 1,000 ft of climbing.
- **Water:** to drink while hiking, 0.35 to 1.1 liters per hour depending on the hottest "feels like" temperature (a bit more for big climbs). Backpacking adds camp water: 2 to 3 liters per night with cooking, 1 to 1.5 without.
- **Food (what to pack):** trail snacks of 200 to 300 calories per hour of hiking, plus dinner (600 to 900) and breakfast (400 to 600) for each night; 10% more in the cold. Backpacking food is about 1,600 to 2,000 calories per pound.
- **Pack list:** grouped into essentials, clothing, traction and safety, and camp. It looks at the forecast and the last 3 days of snow, so it suggests things like microspikes, gaiters, or checking the avalanche forecast when there's recent snow up high.

The formulas live in `calc.js` so they're easy to read and change.

## Run it on your computer

No installs needed beyond Python, which comes with macOS:

```bash
cd trail-prep
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Ideas for later (from the survey)

- Water sources along the trail, with user reports
- Permits, legal camping, and BLM land
- Road conditions to the trailhead
- Group planning (who's coming, everyone's pace and gear)

## License

MIT. Free for anyone to use, copy, and improve.
