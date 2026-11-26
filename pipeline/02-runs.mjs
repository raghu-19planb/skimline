// Step 2 — measure the longest straight scooping run in every water body.
// Usage: node 02-runs.mjs <region-id>
// Output: ../web/public/data/<region-id>-water.geojson
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { REGIONS, PARAMS } from './regions.mjs';
import { projectRings, unproject, ringsArea, longestRun } from './lib/run.mjs';

const id = process.argv[2];
const region = REGIONS[id];
if (!region) throw new Error(`Unknown region "${id}"`);

const raw = JSON.parse(readFileSync(`../data/raw/${id}-water.geojson`, 'utf8'));
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const out = [];
let measured = 0;

for (const f of raw.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null;
  let areaM2 = 0;
  for (const rings of polys) {
    if (!rings[0] || rings[0].length < 4) continue;
    const [lon0, lat0] = rings[0][0];
    const pr = projectRings(rings, lon0, lat0);
    areaM2 += ringsArea(pr);
    // Cheap reject: a body whose bounding diagonal is shorter than the minimum cannot hold a run.
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of pr[0]) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    if (Math.hypot(xmax - xmin, ymax - ymin) < PARAMS.minRunKeptM) continue;
    measured++;
    const run = longestRun(pr, PARAMS.corridorWidthM, PARAMS.directionStepDeg);
    if (run && (!best || run.length > best.length)) {
      best = { length: run.length, bearing: run.bearing, a: unproject(run.a, lon0, lat0), b: unproject(run.b, lon0, lat0) };
    }
  }
  if (!best || best.length < PARAMS.minRunKeptM) continue;
  out.push({
    type: 'Feature',
    properties: {
      id: f.properties.osm,
      name: f.properties.name,
      kind: f.properties.water === 'reservoir' ? 'reservoir' : 'lake',
      area_km2: Math.round(areaM2 / 1e4) / 100,
      run_m: Math.round(best.length),
      bearing: Math.round(best.bearing),
      run: [r5(best.a[0]), r5(best.a[1]), r5(best.b[0]), r5(best.b[1])],
    },
    geometry: {
      type: f.geometry.type,
      coordinates:
        f.geometry.type === 'Polygon'
          ? f.geometry.coordinates.map((ring) => ring.map(([x, y]) => [r5(x), r5(y)]))
          : f.geometry.coordinates.map((p) => p.map((ring) => ring.map(([x, y]) => [r5(x), r5(y)]))),
    },
  });
}

out.sort((a, b) => b.properties.run_m - a.properties.run_m);
mkdirSync('../web/public/data', { recursive: true });
writeFileSync(
  `../web/public/data/${id}-water.geojson`,
  JSON.stringify({
    type: 'FeatureCollection',
    meta: {
      region: id,
      source: raw.source,
      fetched: raw.fetched,
      corridorWidthM: PARAMS.corridorWidthM,
      minRunKeptM: PARAMS.minRunKeptM,
      inputPolygons: raw.features.length,
    },
    features: out,
  }),
);
console.log(`${id}: ${raw.features.length} polygons in, ${measured} measured, ${out.length} kept (run ≥ ${PARAMS.minRunKeptM} m)`);
for (const f of out.slice(0, 8)) console.log(`  ${String(f.properties.run_m).padStart(6)} m  ${f.properties.kind.padEnd(9)} ${f.properties.name ?? '(unnamed)'}`);
