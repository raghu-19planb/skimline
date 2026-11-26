// Step 5 — observe each reservoir from space, month by month.
//
// The mapped outline of a reservoir is usually its full level. This step measures what
// was actually water on a given day, from Sentinel-2 imagery (10 m), and re-measures the
// longest straight scooping run inside that observed water.
//
// Usage: node 05-observe.mjs <region-id> [maxReservoirs=10] [firstYear=2021] [lastYear=2025]
// Output: ../web/public/data/<region-id>-observed.json
//
// Imagery: Copernicus Sentinel-2 L2A, read as cloud-optimised GeoTIFFs through the public
// Earth Search STAC catalogue (Element 84), no login. Only the pixels over each reservoir
// are downloaded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { REGIONS, PARAMS } from './regions.mjs';
import { erode, fillGaps, longestChord, rasterise } from './lib/raster.mjs';

const STAC = 'https://earth-search.aws.element84.com/v1/search';
const PX = 10; // metres
// A pixel inside the mapped outline counts as water if any of three independent signs says so.
// Single indices miss water under haze, glint or low winter sun; a miss breaks a straight run,
// so false "dry" pixels matter far more here than in an area estimate.
const NDWI_WATER = 0.0; // green vs near-infrared (McFeeters)
const MNDWI_WATER = 0.1; // green vs short-wave infrared (Xu)
const SCL_WATER = 6; // ESA scene classification: water
const SCENES_PER_MONTH = 3; // measure the clearest few and keep the wettest: water does not flicker within a month
const MAX_BAD = 0.03; // skip a scene if more than 3 % of the reservoir is cloud, shadow or missing
const BAD_SCL = new Set([0, 1, 3, 8, 9, 10]); // nodata, saturated, cloud shadow, cloud (medium, high), cirrus

const [id, maxArg, y0Arg, y1Arg] = process.argv.slice(2);
const region = REGIONS[id];
if (!region) throw new Error(`Unknown region "${id}"`);
const MAX = Number(maxArg ?? 10);
const Y0 = Number(y0Arg ?? 2021);
const Y1 = Number(y1Arg ?? 2025);

const water = JSON.parse(readFileSync(`../web/public/data/${id}-water.geojson`, 'utf8'));
const targets = water.features.filter((f) => f.properties.kind === 'reservoir' && f.properties.run_m >= 1500).slice(0, MAX);

const utm = (epsg) => `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`;

async function search(bbox, year) {
  const res = await fetch(STAC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime: `${year}-01-01T00:00:00Z/${year}-12-31T23:59:59Z`,
      query: { 'eo:cloud_cover': { lt: 50 } },
      limit: 500,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`STAC ${res.status}`);
  return (await res.json()).features;
}

async function readWindow(href, win) {
  // The image host occasionally drops a request; retry a few times before giving up on the scene.
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const tiff = await fromUrl(href);
      const img = await tiff.getImage();
      const [data] = await img.readRasters({ window: win });
      return data;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Measure one reservoir on one scene. Returns null if the scene is unusable there. */
async function measure(polysLonLat, item) {
  const epsg = item.properties['proj:epsg'] ?? Number(String(item.properties['proj:code']).split(':')[1]);
  const fwd = proj4('WGS84', utm(epsg)).forward;
  const g = item.assets.green;
  const [, , ox, , , oy] = g['proj:transform'];
  const [rows, cols] = g['proj:shape'];
  // project the mapped outline into this scene's pixel grid
  const polys = polysLonLat.map((rings) => rings.map((ring) => ring.map((p) => { const [x, y] = fwd(p); return [(x - ox) / PX, (oy - y) / PX]; })));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const rings of polys) for (const [x, y] of rings[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  // even pixel bounds so the 20 m classification band lines up
  x0 = Math.floor(x0 / 2) * 2 - 2; y0 = Math.floor(y0 / 2) * 2 - 2; x1 = Math.ceil(x1 / 2) * 2 + 2; y1 = Math.ceil(y1 / 2) * 2 + 2;
  if (x0 < 0 || y0 < 0 || x1 > cols || y1 > rows) return null; // reservoir not fully inside this tile
  const w = x1 - x0, h = y1 - y0;
  const inside = rasterise(polys.map((rings) => rings.map((ring) => ring.map(([x, y]) => [x - x0, y - y0]))), w, h);
  let nInside = 0;
  for (let i = 0; i < inside.length; i++) nInside += inside[i];
  if (!nInside) return null;

  const half = [x0 / 2, y0 / 2, x1 / 2, y1 / 2];
  const [green, nir, scl, swir] = await Promise.all([
    readWindow(g.href, [x0, y0, x1, y1]),
    readWindow(item.assets.nir.href, [x0, y0, x1, y1]),
    readWindow(item.assets.scl.href, half),
    readWindow(item.assets.swir16.href, half),
  ]);
  // Since processing baseline 04.00 the digital numbers carry a +1000 offset unless the catalogue removed it.
  const offset = item.properties['earthsearch:boa_offset_applied'] === false && Number(item.properties['s2:processing_baseline']) >= 4 ? 1000 : 0;
  const mask = new Uint8Array(w * h);
  let nWater = 0, nBad = 0;
  const w2 = w / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      const gv = green[i], nv = nir[i];
      const j = (y >> 1) * w2 + (x >> 1);
      if (gv === 0 || nv === 0 || BAD_SCL.has(scl[j])) { nBad++; continue; }
      const a = gv - offset, b = nv - offset, c = swir[j] - offset;
      const ndwi = a + b > 0 ? (a - b) / (a + b) : -1;
      const mndwi = a + c > 0 ? (a - c) / (a + c) : -1;
      if (scl[j] === SCL_WATER || ndwi > NDWI_WATER || mndwi > MNDWI_WATER) { mask[i] = 1; nWater++; }
    }
  }
  if (nBad / nInside > MAX_BAD) return null;
  const halfPx = Math.round(PARAMS.corridorWidthM / 2 / PX);
  const chord = longestChord(erode(fillGaps(mask, inside, w, h), w, h, halfPx), w, h, PARAMS.directionStepDeg);
  const inv = proj4('WGS84', utm(epsg)).inverse;
  const toLonLat = ([px, py]) => inv([ox + (px + x0 + 0.5) * PX, oy - (py + y0 + 0.5) * PX]).map((v) => Math.round(v * 1e5) / 1e5);
  return {
    run_m: chord ? Math.round(chord.lengthPx * PX) : 0,
    line: chord ? [...toLonLat(chord.a), ...toLonLat(chord.b)] : null,
    water_share: Math.round((nWater / nInside) * 1000) / 1000,
    bad_share: Math.round((nBad / nInside) * 1000) / 1000,
  };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// Results are saved after every reservoir, and a re-run skips reservoirs already done
// for the same years, so a long job can be interrupted and resumed.
const outPath = `../web/public/data/${id}-observed.json`;
const save = (reservoirs) =>
  writeFileSync(
    outPath,
    JSON.stringify({
      meta: {
        region: id,
        built: new Date().toISOString(),
        source: 'Copernicus Sentinel-2 L2A (ESA), via Earth Search STAC (Element 84)',
        method: `Water = scene-classification water, or NDWI > ${NDWI_WATER}, or MNDWI > ${MNDWI_WATER}, inside the mapped outline at ${PX} m; single-pixel gaps filled; up to ${SCENES_PER_MONTH} clearest scenes per month (each with at most ${MAX_BAD * 100} % cloud, shadow or missing pixels), keeping the wettest; run = longest straight chord with a ${PARAMS.corridorWidthM} m clear corridor`,
        years: [Y0, Y1],
      },
      reservoirs,
    }),
  );
let result = [];
if (existsSync(outPath)) {
  const prev = JSON.parse(readFileSync(outPath, 'utf8'));
  if (prev.meta.years[0] === Y0 && prev.meta.years[1] === Y1) result = prev.reservoirs;
}
for (const f of targets) {
  const p = f.properties;
  if (result.some((r) => r.id === p.id)) { console.log(`${p.name ?? p.id}: already done, skipped`); continue; }
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const rings of polys) for (const [x, y] of rings[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  // one candidate list per month, clearest scene first
  const byMonth = new Map();
  for (let year = Y0; year <= Y1; year++) {
    let items = [];
    try { items = await search([w, s, e, n], year); } catch (err) { console.warn(`  search ${year} failed: ${err.message}`); }
    for (const it of items) {
      const m = it.properties.datetime.slice(0, 7);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(it);
    }
  }
  const months = [...byMonth.keys()].sort();
  const series = (await pool(months, 12, async (m) => {
    const candidates = byMonth.get(m).sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover']).slice(0, 6);
    let best = null;
    let used = 0;
    for (const it of candidates) {
      if (used >= SCENES_PER_MONTH) break;
      try {
        const r = await measure(polys, it);
        if (!r) continue;
        used++;
        if (!best || r.water_share > best.water_share) best = { date: it.properties.datetime.slice(0, 10), scene: it.id, ...r };
      } catch (err) {
        console.warn(`  ${it.id}: ${err.message}`);
      }
    }
    return best && { ...best, scenes: used };
  })).filter(Boolean);
  const runs = series.map((x) => x.run_m);
  console.log(`${(p.name ?? p.id).padEnd(34)} mapped ${String(p.run_m).padStart(5)} m | ${series.length} clear months | observed ${Math.min(...runs)} – ${Math.max(...runs)} m`);
  result.push({ id: p.id, name: p.name, mapped_run_m: p.run_m, series });
  save(result);
}

save(result);
console.log(`saved ${result.length} reservoirs`);
