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
  // The longest run at each clear width, best over the polygon's parts.
  const bestAt = PARAMS.corridorWidthsM.map(() => null);
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
    PARAMS.corridorWidthsM.forEach((width, k) => {
      // A wider corridor can only shorten the run, so stop once a narrower one found nothing worth keeping.
      if (k > 0 && !bestAt[k - 1]) return;
      const run = longestRun(pr, width, PARAMS.directionStepDeg);
      if (run && (!bestAt[k] || run.length > bestAt[k].length)) {
        bestAt[k] = { length: run.length, bearing: run.bearing, a: unproject(run.a, lon0, lat0), b: unproject(run.b, lon0, lat0) };
      }
    });
  }
  const best = bestAt[0];
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
      // One entry per clear width in meta.widths: [metres, bearing, lon, lat, lon, lat]; zeros where no run fits.
      runs_w: bestAt.map((b) => (b ? [Math.round(b.length), Math.round(b.bearing), r5(b.a[0]), r5(b.a[1]), r5(b.b[0]), r5(b.b[1])] : [0, 0, 0, 0, 0, 0])),
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

// OpenStreetMap sometimes holds one water body twice: once on its own and once inside a
// larger composite outline (several reservoirs or a whole river system under one name).
// Both then yield the same run, and the site would count one refill site twice. Where two
// features' runs coincide, keep the smaller outline, which is the water body itself.
const near = (a, b) => Math.hypot((a[0] - b[0]) * 82000, (a[1] - b[1]) * 111000) < 60; // metres, mid-latitude
const sameRun = (p, q) => (near(p.run.slice(0, 2), q.run.slice(0, 2)) && near(p.run.slice(2), q.run.slice(2))) || (near(p.run.slice(0, 2), q.run.slice(2)) && near(p.run.slice(2), q.run.slice(0, 2)));
const dropped = [];
for (let a = 0; a < out.length; a++) {
  for (let b = a + 1; b < out.length; b++) {
    if (!out[a] || !out[b] || !sameRun(out[a].properties, out[b].properties)) continue;
    const loser = out[a].properties.area_km2 > out[b].properties.area_km2 ? a : b;
    dropped.push(`${out[loser].properties.name ?? out[loser].properties.id} (${out[loser].properties.area_km2} km²)`);
    out[loser] = null;
  }
}
for (let k = out.length - 1; k >= 0; k--) if (!out[k]) out.splice(k, 1);
if (dropped.length) console.log(`  dropped ${dropped.length} composite duplicate(s): ${dropped.join('; ')}`);
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
      widths: PARAMS.corridorWidthsM,
      minRunKeptM: PARAMS.minRunKeptM,
      inputPolygons: raw.features.length,
    },
    features: out,
  }),
);
console.log(`${id}: ${raw.features.length} polygons in, ${measured} measured, ${out.length} kept (run ≥ ${PARAMS.minRunKeptM} m)`);
for (const f of out.slice(0, 8)) console.log(`  ${String(f.properties.run_m).padStart(6)} m  ${f.properties.kind.padEnd(9)} ${f.properties.name ?? '(unnamed)'}`);
