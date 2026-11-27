// Experiment — what do "ice" pixels look like, and what gets mistaken for them?
//
// Lists, for one water body and a span of dates, each scene's typical reflectance inside
// the outline and how the scene classification labels it, so the ice test's thresholds
// can be chosen from evidence. Written after summer images of lakes in British Columbia
// were flagged as ice, which pointed at wildfire smoke.
//
// Usage: node experiments/ice-diagnose.mjs <region-id> <name-contains> <from YYYY-MM-DD> <to YYYY-MM-DD>
// Prints a table; writes nothing.
import { readFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { rasterise } from '../lib/raster.mjs';

const PX = 10;
const [id, nameContains, from, to] = process.argv.slice(2);
const water = JSON.parse(readFileSync(`../web/public/data/${id}-water.geojson`, 'utf8'));
const feature = water.features.find((f) => (f.properties.name ?? '').includes(nameContains));
const polys = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
let w0 = Infinity, s0 = Infinity, e0 = -Infinity, n0 = -Infinity;
for (const rings of polys) for (const [x, y] of rings[0]) { w0 = Math.min(w0, x); e0 = Math.max(e0, x); s0 = Math.min(s0, y); n0 = Math.max(n0, y); }

const res = await fetch('https://earth-search.aws.element84.com/v1/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ collections: ['sentinel-2-l2a'], bbox: [w0, s0, e0, n0], datetime: `${from}T00:00:00Z/${to}T23:59:59Z`, query: { 'eo:cloud_cover': { lt: 90 } }, limit: 60 }),
});
const items = (await res.json()).features.sort((a, b) => a.properties.datetime.localeCompare(b.properties.datetime));
const read = async (href, win) => (await (await (await fromUrl(href)).getImage()).readRasters({ window: win }))[0];
const median = (values) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

console.log(`${feature.properties.name}: median reflectance inside the outline, and scene-classification shares`);
console.log('date        cloud%   blue green   red   nir  swir  ndsi blue/red | scl: water snow cloud other');
for (const it of items) {
  const epsg = it.properties['proj:epsg'] ?? Number(String(it.properties['proj:code']).split(':')[1]);
  const fwd = proj4('WGS84', `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`).forward;
  const [, , ox, , , oy] = it.assets.green['proj:transform'];
  const [rows, cols] = it.assets.green['proj:shape'];
  const px = polys.map((rings) => rings.map((ring) => ring.map((p) => { const [x, y] = fwd(p); return [(x - ox) / PX, (oy - y) / PX]; })));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const rings of px) for (const [x, y] of rings[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  x0 = Math.floor(x0 / 2) * 2 - 2; y0 = Math.floor(y0 / 2) * 2 - 2; x1 = Math.ceil(x1 / 2) * 2 + 2; y1 = Math.ceil(y1 / 2) * 2 + 2;
  if (x0 < 0 || y0 < 0 || x1 > cols || y1 > rows) continue;
  const w = x1 - x0, h = y1 - y0;
  const inside = rasterise(px.map((rings) => rings.map((ring) => ring.map(([x, y]) => [x - x0, y - y0]))), w, h);
  const half = [x0 / 2, y0 / 2, x1 / 2, y1 / 2];
  let bands;
  try {
    bands = await Promise.all([read(it.assets.green.href, [x0, y0, x1, y1]), read(it.assets.nir.href, [x0, y0, x1, y1]), read(it.assets.scl.href, half), read(it.assets.swir16.href, half), read(it.assets.blue.href, [x0, y0, x1, y1]), read(it.assets.red.href, [x0, y0, x1, y1])]);
  } catch { continue; }
  const [green, nir, scl, swir, blue, red] = bands;
  const offset = it.properties['earthsearch:boa_offset_applied'] === false && Number(it.properties['s2:processing_baseline']) >= 4 ? 1000 : 0;
  const g = [], n = [], s = [], bl = [], rd = [];
  const classes = { water: 0, snow: 0, cloud: 0, other: 0 };
  let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!inside[i] || green[i] === 0) continue;
    const j = (y >> 1) * (w / 2) + (x >> 1);
    bl.push((blue[i] - offset) / 10000); rd.push((red[i] - offset) / 10000); g.push((green[i] - offset) / 10000); n.push((nir[i] - offset) / 10000); s.push((swir[j] - offset) / 10000);
    const c = scl[j];
    classes[c === 6 ? 'water' : c === 11 ? 'snow' : c === 8 || c === 9 || c === 10 ? 'cloud' : 'other']++;
    count++;
  }
  if (!count) continue;
  const mg = median(g), mn = median(n), ms = median(s), mb = median(bl), mr = median(rd);
  const share = (k) => String(Math.round((classes[k] / count) * 100)).padStart(5);
  console.log(
    `${it.properties.datetime.slice(0, 10)}  ${String(Math.round(it.properties['eo:cloud_cover'])).padStart(5)}  ${mb.toFixed(3)} ${mg.toFixed(3)} ${mr.toFixed(3)} ${mn.toFixed(3)} ${ms.toFixed(3)} ${((mg - ms) / (mg + ms)).toFixed(2).padStart(5)}     ${(mb / mr).toFixed(2)} |      ${share('water')}${share('snow')}${share('cloud')}${share('other')}`,
  );
}
