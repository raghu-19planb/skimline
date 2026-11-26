// Step 6 — true-colour satellite stills for the home page.
//
// Each shot is a real Sentinel-2 L2A scene, cropped around a point. Nothing is drawn onto
// the pixels here; any aircraft or labels on the home page are added by the page itself
// and are captioned there as illustration.
//
// Usage: node 06-hero-images.mjs
// Output: ../web/public/hero/<name>.jpg and ../web/public/hero/shots.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import sharp from 'sharp';

const STAC = 'https://earth-search.aws.element84.com/v1/search';
const OUT_W = 1920;
const OUT_H = 1080;

// The reservoir pair uses the wettest and driest scenes already found by the observation step.
const observed = JSON.parse(readFileSync('../web/public/data/es-catalonia-observed.json', 'utf8'));
const baells = observed.reservoirs.find((r) => /Baells/.test(r.name ?? ''));
const wettest = baells.series.reduce((a, b) => (b.water_share > a.water_share ? b : a));
const april2023 = baells.series.find((s) => s.date === '2023-04-02');

const SHOTS = [
  { name: 'baells-full', scene: wettest.scene, centre: [1.878, 42.135], widthKm: 9, place: 'La Baells reservoir, Catalonia', note: `Nearly full. Water covers ${Math.round(wettest.water_share * 100)}% of the area it covers when full.` },
  { name: 'baells-low', scene: april2023.scene, centre: [1.878, 42.135], widthKm: 9, place: 'La Baells reservoir, Catalonia', note: `Less than half. Water covers ${Math.round(april2023.water_share * 100)}% of the area it covers when full. Closed to scooper aircraft that week.` },
  { name: 'culebra-fire', scene: 'S2A_30TTM_20220618_0_L2A', centre: [-6.235, 41.955], widthKm: 22, place: 'Sierra de la Culebra, Zamora', note: 'wildfire, June 2022' },
  { name: 'okanagan-clear', scene: 'S2B_11ULR_20230815_0_L2A', centre: [-119.55, 49.9], widthKm: 30, place: 'Okanagan Lake, British Columbia', note: 'two days before the McDougall Creek wildfire spread' },
];

async function item(id) {
  const res = await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ collections: ['sentinel-2-l2a'], ids: [id], limit: 1 }) });
  const f = (await res.json()).features[0];
  if (!f) throw new Error(`scene ${id} not found`);
  return f;
}

mkdirSync('../web/public/hero', { recursive: true });
const meta = [];
for (const shot of SHOTS) {
  const it = await item(shot.scene);
  const epsg = it.properties['proj:epsg'] ?? Number(String(it.properties['proj:code']).split(':')[1]);
  const [cx, cy] = proj4('WGS84', `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`).forward(shot.centre);
  const a = it.assets.visual;
  const [px, , ox, , , oy] = a['proj:transform'];
  const [rows, cols] = a['proj:shape'];
  const halfW = (shot.widthKm * 1000) / 2;
  const halfH = (halfW * OUT_H) / OUT_W;
  const win = [Math.round((cx - halfW - ox) / px), Math.round((oy - cy - halfH) / px), Math.round((cx + halfW - ox) / px), Math.round((oy - cy + halfH) / px)];
  if (win[0] < 0 || win[1] < 0 || win[2] > cols || win[3] > rows) { console.warn(`${shot.name}: crop falls off the edge of ${shot.scene}, skipped`); continue; }
  const tiff = await fromUrl(a.href);
  const img = await tiff.getImage();
  const data = await img.readRasters({ window: win, width: OUT_W, height: OUT_H, interleave: true, resampleMethod: 'bilinear' });
  await sharp(Buffer.from(data.buffer), { raw: { width: OUT_W, height: OUT_H, channels: 3 } }).jpeg({ quality: 78, mozjpeg: true }).toFile(`../web/public/hero/${shot.name}.jpg`);
  meta.push({ name: shot.name, file: `${shot.name}.jpg`, place: shot.place, note: shot.note, date: it.properties.datetime.slice(0, 10), scene: shot.scene });
  console.log(`${shot.name}: ${it.properties.datetime.slice(0, 10)} ${shot.scene}`);
}
const record = { reservoir: baells.name, months: baells.series.length, first: baells.series[0].date, last: baells.series.at(-1).date };
writeFileSync('../web/public/hero/shots.json', JSON.stringify({ record, source: 'Copernicus Sentinel-2 L2A (ESA), true colour, via Earth Search STAC', shots: meta }, null, 2));
