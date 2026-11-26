// Step 1 — download open-water polygons from OpenStreetMap (Overpass API).
// Usage: node 01-fetch-water.mjs <region-id>
// Output: ../data/raw/<region-id>-water.geojson  (raw, not committed)
import { writeFileSync, mkdirSync } from 'node:fs';
import osmtogeojson from 'osmtogeojson';
import { REGIONS } from './regions.mjs';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
];
// Flowing or artificial water is excluded in v1: river reaches need a different method.
const EXCLUDED = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'wastewater', 'basin', 'moat', 'fish_pass', 'lock']);

const id = process.argv[2];
const region = REGIONS[id];
if (!region) throw new Error(`Unknown region "${id}". Known: ${Object.keys(REGIONS).join(', ')}`);

// Overpass wants south,west,north,east. Split the box into tiles to keep responses small.
function tiles([w, s, e, n], step = 0.7) {
  const out = [];
  for (let x = w; x < e - 1e-9; x += step)
    for (let y = s; y < n - 1e-9; y += step) out.push([x, y, Math.min(x + step, e), Math.min(y + step, n)]);
  return out;
}

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'open-water-research-pipeline/0.1' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240000),
      });
      if (res.ok) return await res.json();
      lastErr = new Error(`${url} → HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
  }
  throw lastErr;
}

const seen = new Set();
const features = [];
const list = tiles(region.bbox);
for (const [i, [w, s, e, n]] of list.entries()) {
  const q = `[out:json][timeout:180];(way["natural"="water"](${s},${w},${n},${e});relation["natural"="water"](${s},${w},${n},${e}););out body;>;out skel qt;`;
  const json = await overpass(q);
  const gj = osmtogeojson(json);
  let kept = 0;
  for (const f of gj.features) {
    if (!f.geometry || !/Polygon$/.test(f.geometry.type)) continue;
    if (seen.has(f.id)) continue;
    const p = f.properties || {};
    if (EXCLUDED.has(p.water) || p.waterway) continue;
    seen.add(f.id);
    features.push({
      type: 'Feature',
      id: f.id,
      properties: { osm: f.id, name: p.name || null, water: p.water || null },
      geometry: f.geometry,
    });
    kept++;
  }
  console.log(`tile ${i + 1}/${list.length}: +${kept} (total ${features.length})`);
  await new Promise((r) => setTimeout(r, 1500));
}

mkdirSync('../data/raw', { recursive: true });
writeFileSync(
  `../data/raw/${id}-water.geojson`,
  JSON.stringify({ type: 'FeatureCollection', fetched: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL), via Overpass API', features }),
);
console.log(`Saved ${features.length} water polygons for ${id}`);
