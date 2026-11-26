# Skimline

*Working name.* An open-data map of where water-scooping firefighting aircraft can refill in Canada and Spain, how long each load takes from any point, and how drought takes refill sites away.

**Planning aid, not for flight operations.** Depth, obstacles and approach terrain are not checked.

## What it does

1. **Measures the longest straight scooping run** in every lake and reservoir, from OpenStreetMap outlines.
2. **Maps minutes per load** from any point to the nearest usable water, using the US Forest Service turnaround rule of thumb.
3. **Watches reservoirs from space.** For the largest reservoirs it reads Sentinel-2 imagery month by month and re-measures the run on the water actually present.
4. **Ranks past fires** (2016 onward, 100 ha or more) by how far they were from usable water.

Regions built: Ourense–Zamora (Spain, with the Portuguese border), Berguedà–Solsonès (Catalonia) and Okanagan–Shuswap (British Columbia).

The full method, every source and every limitation are on the site's Methods page (`web/methods.html`). `web/planners.html` sets out the decisions it supports. When a feature is added, add a step to the guide in `web/src/plan/tour.ts` and an act to the recorded tour in `web/src/plan/demo.ts`.

## Layout

```
pipeline/            Node scripts that build the data (no Python needed)
  regions.mjs          region list, planned regions, analysis parameters
  01-fetch-water.mjs   lakes and reservoirs from OpenStreetMap
  02-runs.mjs          longest straight run per water body
  03-fetch-fires.mjs   fire perimeters (NBAC for Canada, EFFIS for Europe)
  05-observe.mjs       monthly Sentinel-2 water and run per reservoir
  06-hero-images.mjs   true-colour satellite stills for the home page
  07-levels.mjs        official gauge levels, known-deep runs, fill history
  experiments/         one-off investigations, kept so they can be repeated
  04-manifest.mjs      index the site reads (run last)
  lib/ test/           geometry and raster code, unit tests
web/                 the site (Vite, strict TypeScript, MapLibre)
  index.html           home            plan.html      the five planning steps
  guide.html           user guide      planners.html  decisions it supports
  methods.html         sources and limits
  src/plan/            the planning page
    model.ts             the analytical model, with sources
    analysis.ts          every number shown, as pure functions
    region.ts            loading and assembling a region
    map-view.ts          the only file that touches the map library
    panel.ts readout.ts  rendering
    format.ts            formatting and escaped HTML templates
    tour.ts demo.ts      step-by-step guide, recorded tour
  src/home/            hero, compare slider, recorded-tour player
  src/styles/          site.css (tokens, shared chrome) and one sheet per page type
  test/                unit tests for the model, analysis and formatting
  public/data/         pipeline output the site loads
docs/                roadmap
data/raw/            downloads (not committed)
```

## Quality

- **Strict TypeScript**, with no `any`.
- **Unit tests** for the model, the analysis and the formatting (`npm test` in `web/`), and for the run-length geometry (`npm test` in `pipeline/`).
- **Escaped by construction.** All markup is built with the `html` template in `format.ts`, which escapes every interpolated value, so a place name from open data cannot inject markup.
- **One design system.** Colours, type, radii and motion are tokens in `src/styles/site.css`.
- **CI** runs the type-check, tests, formatting check and a production build on every push.

`npm run check` in `web/` runs the type-check, tests and formatting check together.

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
