// Experiment — does the width of clear water explain why a drawn-down reservoir is unusable?
//
// On 1 April 2023 the Catalan fire service said its amphibious aircraft could not use
// La Baells (26 % full). Our run measurement, with a 100 m corridor, still found over
// 2 km of straight water that day, and the depth check found it deep enough. This script
// re-measures the run on chosen dates for a range of corridor widths, to see whether a
// wider safety corridor separates the usable dates from the unusable one.
//
// Usage: node experiments/width-sensitivity.mjs <region-id> <name-contains> <date> [<date> ...]
// Prints a table; writes nothing.
import { readFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { erode, fillGaps, longestChord, rasterise } from '../lib/raster.mjs';

const PX = 10;
const WIDTHS_M = [100, 150, 200, 250, 300, 400];
const BAD_SCL = new Set([0, 1, 3, 8, 9, 10]);
const [id, nameContains, ...dates] = process.argv.slice(2);

const water = JSON.parse(readFileSync(`../web/public/data/${id}-water.geojson`, 'utf8'));
const observed = JSON.parse(readFileSync(`../web/public/data/${id}-observed.json`, 'utf8'));
const feature = water.features.find((f) => (f.properties.name ?? '').includes(nameContains));
const record = observed.reservoirs.find((r) => r.id === feature.properties.id);
const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;

async function item(scene) {
  const res = await fetch('https://earth-search.aws.element84.com/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collections: ['sentinel-2-l2a'], ids: [scene], limit: 1 }),
  });
  return (await res.json()).features[0];
}
async function read(href, win) {
  const img = await (await fromUrl(href)).getImage();
  return (await img.readRasters({ window: win }))[0];
}

/** The observed water mask for one scene, exactly as 05-observe.mjs builds it. */
async function waterMask(it) {
  const epsg = it.properties['proj:epsg'] ?? Number(String(it.properties['proj:code']).split(':')[1]);
  const fwd = proj4('WGS84', `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`).forward;
  const [, , ox, , , oy] = it.assets.green['proj:transform'];
  const px = polys.map((rings) => rings.map((ring) => ring.map((p) => { const [x, y] = fwd(p); return [(x - ox) / PX, (oy - y) / PX]; })));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const rings of px) for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  x0 = Math.floor(x0 / 2) * 2 - 2; y0 = Math.floor(y0 / 2) * 2 - 2; x1 = Math.ceil(x1 / 2) * 2 + 2; y1 = Math.ceil(y1 / 2) * 2 + 2;
  const w = x1 - x0, h = y1 - y0;
  const inside = rasterise(px.map((rings) => rings.map((ring) => ring.map(([x, y]) => [x - x0, y - y0]))), w, h);
  const half = [x0 / 2, y0 / 2, x1 / 2, y1 / 2];
  const [green, nir, scl, swir] = await Promise.all([
    read(it.assets.green.href, [x0, y0, x1, y1]),
    read(it.assets.nir.href, [x0, y0, x1, y1]),
    read(it.assets.scl.href, half),
    read(it.assets.swir16.href, half),
  ]);
  const offset = it.properties['earthsearch:boa_offset_applied'] === false && Number(it.properties['s2:processing_baseline']) >= 4 ? 1000 : 0;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!inside[i]) continue;
    const j = (y >> 1) * (w / 2) + (x >> 1);
    if (green[i] === 0 || nir[i] === 0 || BAD_SCL.has(scl[j])) continue;
    const a = green[i] - offset, b = nir[i] - offset, c = swir[j] - offset;
    if (scl[j] === 6 || (a + b > 0 && (a - b) / (a + b) > 0) || (a + c > 0 && (a - c) / (a + c) > 0.1)) mask[i] = 1;
  }
  return { mask: fillGaps(mask, inside, w, h), w, h };
}

console.log(`${feature.properties.name}: longest straight run (m) by clear corridor width`);
console.log(['date', 'fill %', ...WIDTHS_M.map((m) => `${m} m`)].map((s) => String(s).padStart(8)).join(''));
for (const date of dates) {
  const o = record.series.find((s) => s.date === date);
  if (!o) { console.log(`${date}: no observation on that date`); continue; }
  const { mask, w, h } = await waterMask(await item(o.scene));
  const runs = WIDTHS_M.map((m) => {
    const chord = longestChord(erode(mask, w, h, Math.round(m / 2 / PX)), w, h, 3);
    return chord ? Math.round(chord.lengthPx * PX) : 0;
  });
  console.log([date, o.fill_pct ?? '–', ...runs].map((s) => String(s).padStart(8)).join(''));
}
