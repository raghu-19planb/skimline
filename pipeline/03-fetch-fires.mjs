// Step 3 — download mapped wildfire perimeters (2016 onward, ≥ 100 ha) for a region.
// Canada: National Burned Area Composite (Natural Resources Canada) via CWFIS WFS.
// Spain:  EFFIS burnt areas (European Commission, Copernicus) via EFFIS WFS.
// Usage: node 03-fetch-fires.mjs <region-id>
// Output: ../web/public/data/<region-id>-fires.geojson
import { writeFileSync } from 'node:fs';
import { REGIONS } from './regions.mjs';

const UA = { 'User-Agent': 'open-water-research-pipeline/0.1' };
const MIN_HA = 100;
const FIRST_YEAR = 2016;
const id = process.argv[2];
const region = REGIONS[id];
if (!region) throw new Error(`Unknown region "${id}"`);
const [W, S, E, N] = region.bbox;

async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300000) });
      if (res.ok) return await res.json();
      console.warn(`HTTP ${res.status} ${url.slice(0, 90)}`);
    } catch (err) {
      console.warn(`${err.message} ${url.slice(0, 90)}`);
    }
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  return null;
}

// Douglas–Peucker in degrees; ~30 m tolerance is far below the perimeter mapping error.
function simplify(ring, tol = 0.0003) {
  if (ring.length < 6) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0, at = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      // A closed ring starts and ends on the same point: measure from that point instead of a zero-length chord.
      const d = len < 1e-12 ? Math.hypot(ring[i][0] - ax, ring[i][1] - ay) : Math.abs(dy * (ring[i][0] - ax) - dx * (ring[i][1] - ay)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
  return out.length >= 4 ? out : null;
}
function polygonsOf(g) {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf);
  return [];
}
function simplifyGeom(g) {
  const polys = polygonsOf(g);
  const out = [];
  for (const rings of polys) {
    const outer = simplify(rings[0]);
    if (!outer) continue;
    out.push([outer, ...rings.slice(1).map((r) => simplify(r)).filter(Boolean)]);
  }
  return out.length ? { type: 'MultiPolygon', coordinates: out } : null;
}
function touchesRegion(g) {
  const polys = polygonsOf(g);
  return polys.some((rings) => rings[0].some(([x, y]) => x >= W && x <= E && y >= S && y <= N));
}

const features = [];
let source;
if (region.country === 'CA') {
  source = 'National Burned Area Composite (NBAC), Natural Resources Canada — Open Government Licence – Canada';
  const cql = encodeURIComponent(`BBOX(geometry,${W},${S},${E},${N},'EPSG:4326') AND year>=${FIRST_YEAR} AND poly_ha>=${MIN_HA}`);
  const url = `https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=public:nbac&outputFormat=application/json&srsName=EPSG:4326&propertyName=year,poly_ha,firecaus,geometry&cql_filter=${cql}`;
  const json = await getJson(url);
  if (!json) throw new Error('NBAC request failed');
  for (const f of json.features) {
    const geometry = f.geometry && simplifyGeom(f.geometry);
    if (!geometry) continue;
    features.push({ type: 'Feature', properties: { year: f.properties.year, ha: Math.round(f.properties.poly_ha), cause: f.properties.firecaus || null, place: null }, geometry });
  }
} else {
  source = 'EFFIS burnt areas, European Commission / Copernicus EMS — CC BY 4.0';
  const lastYear = new Date().getUTCFullYear() - 1;
  for (let year = FIRST_YEAR; year <= lastYear; year++) {
    const url = `https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.1.0&request=GetFeature&typeName=ms:modis.ba.poly.${year}&outputFormat=geojson`;
    const json = await getJson(url);
    if (!json) { console.warn(`  ${year}: not available, skipped`); continue; }
    let n = 0;
    for (const f of json.features) {
      const ha = Number(f.properties.AREA_HA);
      if (!f.geometry || !(ha >= MIN_HA) || !touchesRegion(f.geometry)) continue;
      const geometry = simplifyGeom(f.geometry);
      if (!geometry) continue;
      features.push({ type: 'Feature', properties: { year, ha: Math.round(ha), cause: null, place: [f.properties.COMMUNE, f.properties.PROVINCE].filter(Boolean).join(', ') || null }, geometry });
      n++;
    }
    console.log(`  ${year}: ${json.features.length} European fires, ${n} in region`);
  }
}

writeFileSync(`../web/public/data/${id}-fires.geojson`, JSON.stringify({ type: 'FeatureCollection', meta: { region: id, source, fetched: new Date().toISOString(), minHa: MIN_HA, firstYear: FIRST_YEAR }, features }));
console.log(`${id}: ${features.length} fire perimeters saved`);
