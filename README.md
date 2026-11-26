# Skimline

*Working name.* An open-data map of where water-scooping firefighting aircraft can refill in Canada and Spain, how long each load takes from any point, and how drought takes refill sites away.

**Planning aid, not for flight operations.** Depth, obstacles and approach terrain are not checked.

## What it does

1. **Measures the longest straight scooping run** in every lake and reservoir, from OpenStreetMap outlines.
2. **Maps minutes per load** from any point to the nearest usable water, using the US Forest Service turnaround rule of thumb.
3. **Watches reservoirs from space.** For the largest reservoirs it reads Sentinel-2 imagery month by month and re-measures the run on the water actually present.
4. **Ranks past fires** (2016 onward, 100 ha or more) by how far they were from usable water.

Pilot regions: Ourense–Zamora (Spain, with the Portuguese border) and Okanagan–Shuswap (British Columbia).

The full method, every source and every limitation are on the site's Methods page (`web/methods.html`). `web/planners.html` sets out the decisions it supports, and `web/src/tour.ts` is the animated tour: add a step there when a feature is added.

## Layout

```
pipeline/   Node scripts that build the data (no Python needed)
  regions.mjs          region list and analysis parameters
  01-fetch-water.mjs   lakes and reservoirs from OpenStreetMap
  02-runs.mjs          longest straight run per water body
  03-fetch-fires.mjs   fire perimeters (NBAC for Canada, EFFIS for Europe)
  05-observe.mjs       monthly Sentinel-2 water and run per reservoir
  04-manifest.mjs      index the site reads (run last)
  lib/ test/           geometry and raster code, unit tests
web/        the site (Vite, TypeScript, MapLibre)
  src/model.ts         the analytical model, with sources
  public/data/         pipeline output the site loads
docs/       roadmap
data/raw/   downloads (not committed)
```

## Run it

```
cd pipeline
npm install
node 01-fetch-water.mjs es-northwest
node 02-runs.mjs es-northwest
node 03-fetch-fires.mjs es-northwest
node 05-observe.mjs es-northwest 12 2021 2025
node 04-manifest.mjs
npm test

cd ../web
npm install
npm run dev
```

To add a region, add an entry to `pipeline/regions.mjs` and run the steps for its id. Regions that are queued but not built go in the `PLANNED` list in the same file; the site shows them as planned.

## Deploy

The site is static. On Vercel, import the repository; `vercel.json` sets the build command and output folder.

## Data and licences

- Water outlines: © OpenStreetMap contributors, ODbL.
- Fire perimeters: National Burned Area Composite, Natural Resources Canada (Open Government Licence – Canada); EFFIS, European Commission (CC BY 4.0).
- Imagery: Copernicus Sentinel-2, via Earth Search STAC.
- Basemap: OpenFreeMap / OpenMapTiles / OpenStreetMap.

## Licence

Code: MIT, see `LICENSE`. Data layers keep the licences listed above.
