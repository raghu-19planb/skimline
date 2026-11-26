// Step 4 — write the manifest the website reads: which regions exist and what was built.
// Usage: node 04-manifest.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { REGIONS, PARAMS } from './regions.mjs';

const dir = '../web/public/data';
const regions = [];
for (const [id, r] of Object.entries(REGIONS)) {
  const waterPath = `${dir}/${id}-water.geojson`;
  if (!existsSync(waterPath)) continue;
  const water = JSON.parse(readFileSync(waterPath, 'utf8'));
  const firesPath = `${dir}/${id}-fires.geojson`;
  const fires = existsSync(firesPath) ? JSON.parse(readFileSync(firesPath, 'utf8')) : null;
  const obsPath = `${dir}/${id}-observed.json`;
  regions.push({
    id,
    name: r.name,
    country: r.country,
    bbox: r.bbox,
    note: r.note,
    water: { file: `${id}-water.geojson`, count: water.features.length, inputPolygons: water.meta.inputPolygons, source: water.meta.source, fetched: water.meta.fetched },
    fires: fires && { file: `${id}-fires.geojson`, count: fires.features.length, source: fires.meta.source, fetched: fires.meta.fetched, minHa: fires.meta.minHa, firstYear: fires.meta.firstYear },
    observed: existsSync(obsPath) ? `${id}-observed.json` : null,
  });
}
writeFileSync(`${dir}/manifest.json`, JSON.stringify({ built: new Date().toISOString(), params: PARAMS, regions }, null, 2));
console.log(`manifest: ${regions.map((r) => r.id).join(', ')}`);
