// Step 5 — observe each reservoir from space, month by month.
//
// The mapped outline of a reservoir is usually its full level. This step measures what
// was actually water on a given day, from Sentinel-2 imagery (10 m), and re-measures the
// longest straight scooping run inside that observed water.
//
// Usage: node 05-observe.mjs <region-id> [maxReservoirs=10] [firstYear=2021] [lastYear=2025] [nameContains] [lakes]
// With nameContains, only reservoirs whose name contains that text are measured, whatever their rank.
// Output: ../web/public/data/<region-id>-observed.json
//
// Imagery: Copernicus Sentinel-2 L2A, read as cloud-optimised GeoTIFFs through the public
// Earth Search STAC catalogue (Element 84), no login. Only the pixels over each reservoir
// are downloaded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fromUrl } from 'geotiff';
import proj4 from 'proj4';
import { REGIONS, PARAMS } from './regions.mjs';
import { atLeast, distanceToDry, fillGaps, longestChord, rasterise } from './lib/raster.mjs';

const STAC = 'https://earth-search.aws.element84.com/v1/search';
const PX = 10; // metres
// A pixel inside the mapped outline counts as water if any of three independent signs says so.
// Single indices miss water under haze, glint or low winter sun; a miss breaks a straight run,
// so false "dry" pixels matter far more here than in an area estimate.
const NDWI_WATER = 0.0; // green vs near-infrared (McFeeters)
const MNDWI_WATER = 0.1; // green vs short-wave infrared (Xu)
const SCL_WATER = 6; // ESA scene classification: water
// Ice. A scooper cannot use a frozen surface, and one of the water tests above (MNDWI)
// is the same formula as the standard snow index, so ice must be caught first or it is
// counted as water.
//
// A pixel is ice if it passes the snow test (a high snow index on a bright surface) AND
// is white: blue and red reflect about equally. The whiteness test is there because
// wildfire smoke over open water also passes the snow test: it is bright in visible
// light and dark in short-wave infrared. Smoke is blue-tinted; snow and ice are not.
// Measured on White Lake, British Columbia (experiments/ice-diagnose.mjs): winter ice
// has blue/red of 0.99 to 1.04 with green above 0.6; smoke in August 2021 and 2023 has
// blue/red of 1.23 to 1.53 with green below 0.34.
//
// The scene classification's own snow class is not used: it labelled a fifth of that
// smoke-covered lake as snow, and labels most real lake ice as cloud. Thin, dark ice
// without snow on it is not bright enough to pass and will be missed.
const NDSI_ICE = 0.4;
const ICE_MIN_GREEN = 0.3; // reflectance
const ICE_MIN_NIR = 0.25;
const ICE_MAX_BLUE_OVER_RED = 1.15;
const SCENES_PER_MONTH = 3; // measure the clearest few and keep the wettest: water does not flicker within a month
const MAX_MEGAPIXELS = 3; // largest reservoir window read at full resolution
const MAX_BAD = 0.03; // skip a scene if more than 3 % of the reservoir is cloud, shadow or missing
const BAD_SCL = new Set([0, 1, 3, 8, 9, 10]); // nodata, saturated, cloud shadow, cloud (medium, high), cirrus

const [id, maxArg, y0Arg, y1Arg, onlyArgRaw, kindsArg] = process.argv.slice(2);
const onlyArg = onlyArgRaw || undefined;
const region = REGIONS[id];
if (!region) throw new Error(`Unknown region "${id}"`);
const MAX = Number(maxArg ?? 10);
const Y0 = Number(y0Arg ?? 2021);
const Y1 = Number(y1Arg ?? 2025);

const water = JSON.parse(readFileSync(`../web/public/data/${id}-water.geojson`, 'utf8'));
// Natural lakes are measured too when asked for ("lakes" as the sixth argument): their
// level barely changes, but in Canada they freeze.
const kinds = kindsArg === 'lakes' ? ['reservoir', 'lake'] : ['reservoir'];
/** Megapixels one scene of this water body needs at full resolution. */
function megapixels(f) {
  const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let w0 = Infinity, s0 = Infinity, e0 = -Infinity, n0 = -Infinity;
  for (const rings of ps) for (const [x, y] of rings[0]) { if (x < w0) w0 = x; if (x > e0) e0 = x; if (y < s0) s0 = y; if (y > n0) n0 = y; }
  return ((e0 - w0) * 111320 * Math.cos((s0 * Math.PI) / 180) * (n0 - s0) * 110540) / (PX * PX) / 1e6;
}
const named = (f) => (f.properties.name ?? '').toLowerCase().includes((onlyArg ?? '').toLowerCase());
const eligible = water.features.filter((f) => kinds.includes(f.properties.kind));
const targets = onlyArg
  ? eligible.filter(named)
  : eligible
      .filter((f) => f.properties.run_m >= 1500)
      .filter((f) => {
        // Very large, sprawling water bodies need tens of megapixels per scene at 10 m. They
        // are left out for now; reading them at a coarser resolution is on the roadmap.
        const mpx = megapixels(f);
        if (mpx > MAX_MEGAPIXELS) console.log(`${f.properties.name ?? f.properties.id}: ${mpx.toFixed(1)} megapixels per scene, skipped as too large`);
        return mpx <= MAX_MEGAPIXELS;
      })
      .slice(0, MAX);

const utm = (epsg) => `+proj=utm +zone=${epsg % 100} +datum=WGS84 +units=m +no_defs`;

/** One year of scenes over a box. The catalogue sometimes answers 502; retry before giving up on the year. */
async function search(bbox, year) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await searchOnce(bbox, year);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function searchOnce(bbox, year) {
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
  const full = [x0, y0, x1, y1];
  const [green, nir, scl, swir, blue, red] = await Promise.all([
    readWindow(g.href, full),
    readWindow(item.assets.nir.href, full),
    readWindow(item.assets.scl.href, half),
    readWindow(item.assets.swir16.href, half),
    readWindow(item.assets.blue.href, full),
    readWindow(item.assets.red.href, full),
  ]);
  // Since processing baseline 04.00 the digital numbers carry a +1000 offset unless the catalogue removed it.
  const offset = item.properties['earthsearch:boa_offset_applied'] === false && Number(item.properties['s2:processing_baseline']) >= 4 ? 1000 : 0;
  const mask = new Uint8Array(w * h);
  let nWater = 0, nBad = 0, nIce = 0;
  const w2 = w / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!inside[i]) continue;
      const gv = green[i], nv = nir[i];
      const j = (y >> 1) * w2 + (x >> 1);
      if (gv === 0 || nv === 0) { nBad++; continue; }
      const a = gv - offset, b = nv - offset, c = swir[j] - offset;
      const ndwi = a + b > 0 ? (a - b) / (a + b) : -1;
      const mndwi = a + c > 0 ? (a - c) / (a + c) : -1;
      // ice is tested before cloud, because frozen surfaces are usually labelled cloud
      const bluish = (blue[i] - offset) / Math.max(1, red[i] - offset);
      if (mndwi > NDSI_ICE && a / 10000 > ICE_MIN_GREEN && b / 10000 > ICE_MIN_NIR && bluish <= ICE_MAX_BLUE_OVER_RED) { nIce++; continue; }
      if (BAD_SCL.has(scl[j])) { nBad++; continue; }
      if (scl[j] === SCL_WATER || ndwi > NDWI_WATER || mndwi > MNDWI_WATER) { mask[i] = 1; nWater++; }
    }
  }
  if (nBad / nInside > MAX_BAD) return null;
  // The longest straight run at each clear width. One distance map serves them all.
  const distance = distanceToDry(fillGaps(mask, inside, w, h), w, h);
  const chords = PARAMS.corridorWidthsM.map((width) => longestChord(atLeast(distance, Math.round(width / 2 / PX)), w, h, PARAMS.directionStepDeg));
  const chord = chords[0];
  const inv = proj4('WGS84', utm(epsg)).inverse;
  const toLonLat = ([px, py]) => inv([ox + (px + x0 + 0.5) * PX, oy - (py + y0 + 0.5) * PX]).map((v) => Math.round(v * 1e5) / 1e5);
  return {
    run_m: chord ? Math.round(chord.lengthPx * PX) : 0,
    line: chord ? [...toLonLat(chord.a), ...toLonLat(chord.b)] : null,
    // One entry per clear width in meta.widths: [metres, lon, lat, lon, lat]; zeros where no run fits.
    runs_w: chords.map((c) => (c ? [Math.round(c.lengthPx * PX), ...toLonLat(c.a), ...toLonLat(c.b)] : [0, 0, 0, 0, 0])),
    water_share: Math.round((nWater / nInside) * 1000) / 1000,
    bad_share: Math.round((nBad / nInside) * 1000) / 1000,
    // share of the mapped outline that was ice or snow
    ice_share: Math.round((nIce / nInside) * 1000) / 1000,
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
        method: `Water = scene-classification water, or NDWI > ${NDWI_WATER}, or MNDWI > ${MNDWI_WATER}, inside the mapped outline at ${PX} m; single-pixel gaps filled; up to ${SCENES_PER_MONTH} clearest scenes per month (each with at most ${MAX_BAD * 100} % cloud, shadow or missing pixels), keeping the wettest; run = longest straight chord, measured at each clear corridor width listed in widths`,
        years: [Y0, Y1],
        widths: PARAMS.corridorWidthsM,
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
  // Very large, sprawling reservoirs need tens of megapixels per scene at 10 m. They are
  // skipped for now; reading them at a coarser resolution is on the roadmap.
  {
    const ps = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let w0 = Infinity, s0 = Infinity, e0 = -Infinity, n0 = -Infinity;
    for (const rings of ps) for (const [x, y] of rings[0]) { if (x < w0) w0 = x; if (x > e0) e0 = x; if (y < s0) s0 = y; if (y > n0) n0 = y; }
    const mpx = ((e0 - w0) * 111320 * Math.cos((s0 * Math.PI) / 180) * (n0 - s0) * 110540) / (PX * PX) / 1e6;
    if (mpx > MAX_MEGAPIXELS) { console.log(`${p.name ?? p.id}: ${mpx.toFixed(1)} megapixels per scene, skipped as too large`); continue; }
  }
  // A reservoir measured before runs were taken at several widths is measured again.
  // So is one named on the command line that was measured before ice was recorded.
  const current = (o) => Array.isArray(o.runs_w) && o.runs_w.length === PARAMS.corridorWidthsM.length && (!onlyArg || typeof o.ice_share === 'number');
  result = result.filter((r) => r.id !== p.id || r.series.every(current));
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
    let iceMost = 0; // the most ice seen on any clear image that month
    for (const it of candidates) {
      if (used >= SCENES_PER_MONTH) break;
      try {
        const r = await measure(polys, it);
        if (!r) continue;
        used++;
        iceMost = Math.max(iceMost, r.ice_share);
        if (!best || r.water_share > best.water_share) best = { date: it.properties.datetime.slice(0, 10), scene: it.id, ...r };
      } catch (err) {
        console.warn(`  ${it.id}: ${err.message}`);
      }
    }
    return best && { ...best, ice_share: iceMost, scenes: used };
  })).filter(Boolean);
  const runs = series.map((x) => x.run_m);
  console.log(`${(p.name ?? p.id).padEnd(34)} mapped ${String(p.run_m).padStart(5)} m | ${series.length} clear months | observed ${Math.min(...runs)} – ${Math.max(...runs)} m`);
  result.push({ id: p.id, name: p.name, mapped_run_m: p.run_m, series });
  save(result);
}

save(result);
console.log(`saved ${result.length} reservoirs`);
