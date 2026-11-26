import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { CLASSES, REF, classOf, dropsPerHour, frameFor, litresPerHour, nearest, toLonLat, toXY, turnaroundMin } from './model';
import type { Frame, Run } from './model';
import { initTour } from './tour';

// ---------- types for the pipeline's output ----------
interface RegionInfo {
  id: string;
  name: string;
  country: string;
  bbox: [number, number, number, number];
  note: string;
  water: { file: string; count: number; inputPolygons: number; source: string; fetched: string };
  fires: { file: string; count: number; source: string; fetched: string; minHa: number; firstYear: number } | null;
  observed: string | null;
}
interface Obs {
  date: string;
  scene: string;
  run_m: number;
  line: [number, number, number, number] | null;
  water_share: number;
}
interface ObservedFile {
  meta: { source: string; years: [number, number] };
  reservoirs: { id: string; name: string | null; mapped_run_m: number; series: Obs[] }[];
}
interface Manifest {
  built: string;
  params: { corridorWidthM: number; minRunKeptM: number };
  regions: RegionInfo[];
  planned?: { name: string; country: string }[];
}
const COUNTRY: Record<string, string> = { ES: 'Spain', CA: 'Canada', PT: 'Portugal' };
interface WaterProps {
  id: string;
  name: string | null;
  kind: 'lake' | 'reservoir';
  area_km2: number;
  run_m: number;
  bearing: number;
  run: [number, number, number, number];
  /** Run in the driest observed month; equals run_m where the water body was not observed. */
  run_dry: number;
}
interface FireProps {
  year: number;
  ha: number;
  cause: string | null;
  place: string | null;
}
type FC<P> = { type: 'FeatureCollection'; features: { type: 'Feature'; properties: P; geometry: any }[] };

interface Loaded {
  info: RegionInfo;
  frame: Frame;
  water: FC<WaterProps>;
  fires: FC<FireProps> | null;
  runs: Run[]; // all runs, one per water body, same order as water.features
  dryRuns: Run[]; // same, with observed reservoirs at their driest observed month
  observed: Map<number, { series: Obs[]; driest: Obs }>; // by water-body index
  observedMeta: ObservedFile['meta'] | null;
  cells: { x: number; y: number }[];
  fireCentres: { x: number; y: number; lon: number; lat: number; props: FireProps }[];
  area: [number, number, number, number]; // analysis area (bbox inset), lon/lat
}

// ---------- constants ----------
const CELL_KM = 1.5;
/**
 * Water outside the downloaded box is unknown, so results near its edge would look
 * worse than they are. The analysis area is the box inset by this margin.
 */
const EDGE_MARGIN_KM = 20;
const PRESETS = [
  { m: 1609, label: '1 mile', why: 'US Forest Service, sea level' },
  { m: 1852, label: '1 nautical mile', why: 'Natural Resources Canada screening' },
  { m: 4023, label: '2.5 miles', why: 'US Forest Service, 8,000 ft' },
];
const fmt = (n: number, d = 0) => n.toLocaleString('en-CA', { maximumFractionDigits: d, minimumFractionDigits: d });
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** Latitude then longitude in decimal degrees, five places (about one metre), with hemisphere letters. */
const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;

// ---------- state ----------
let manifest: Manifest;
const cache = new Map<string, Promise<Loaded>>();
let current: Loaded;
let threshold = REF.defaultRunM;
let probe: { lon: number; lat: number } | null = null;
let scenario: 'mapped' | 'dry' = 'mapped';
const activeRuns = (L: Loaded) => (scenario === 'dry' ? L.dryRuns : L.runs);
const runField = () => (scenario === 'dry' ? 'run_dry' : 'run_m');

const map: MlMap = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-7, 42.1],
  zoom: 7,
  attributionControl: { compact: true },
});
// Registered immediately so the event cannot fire before anyone is listening.
const styleReady = new Promise<void>((res) => map.once('style.load', () => res()));
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

const empty = { type: 'FeatureCollection' as const, features: [] };

function loadRegion(info: RegionInfo): Promise<Loaded> {
  let hit = cache.get(info.id);
  if (!hit) cache.set(info.id, (hit = buildRegion(info)));
  return hit;
}

async function buildRegion(info: RegionInfo): Promise<Loaded> {
  const [water, fires, obsFile] = await Promise.all([
    fetch(`/data/${info.water.file}`).then((r) => r.json() as Promise<FC<WaterProps>>),
    info.fires ? fetch(`/data/${info.fires.file}`).then((r) => r.json() as Promise<FC<FireProps>>) : Promise.resolve(null),
    info.observed ? fetch(`/data/${info.observed}`).then((r) => r.json() as Promise<ObservedFile>) : Promise.resolve(null),
  ]);
  const frame = frameFor(info.bbox);
  const runs: Run[] = water.features.map((f, body) => {
    const [alon, alat, blon, blat] = f.properties.run;
    const [ax, ay] = toXY(frame, alon, alat);
    const [bx, by] = toXY(frame, blon, blat);
    return { ax, ay, bx, by, body, lengthM: f.properties.run_m };
  });
  // Satellite observations: attach to water bodies and build the "driest month seen" set of runs.
  const observed: Loaded['observed'] = new Map();
  const byId = new Map(water.features.map((f, i) => [f.properties.id, i]));
  for (const r of obsFile?.reservoirs ?? []) {
    const body = byId.get(r.id);
    if (body === undefined || r.series.length < 6) continue; // too few clear months to say anything
    const driest = r.series.reduce((a, b) => (b.run_m < a.run_m ? b : a));
    observed.set(body, { series: r.series, driest });
  }
  const dryRuns: Run[] = runs.map((r) => {
    const o = observed.get(r.body);
    if (!o) return r;
    if (!o.driest.line) return { ...r, lengthM: 0 };
    const [ax, ay] = toXY(frame, o.driest.line[0], o.driest.line[1]);
    const [bx, by] = toXY(frame, o.driest.line[2], o.driest.line[3]);
    return { ax, ay, bx, by, body: r.body, lengthM: o.driest.run_m };
  });
  water.features.forEach((f, i) => (f.properties.run_dry = dryRuns[i].lengthM));
  const dLon = EDGE_MARGIN_KM / frame.kx;
  const dLat = EDGE_MARGIN_KM / frame.ky;
  const area: Loaded['area'] = [info.bbox[0] + dLon, info.bbox[1] + dLat, info.bbox[2] - dLon, info.bbox[3] - dLat];
  const [x0, y0] = toXY(frame, area[0], area[1]);
  const [x1, y1] = toXY(frame, area[2], area[3]);
  const cells: Loaded['cells'] = [];
  for (let y = y0; y < y1; y += CELL_KM) for (let x = x0; x < x1; x += CELL_KM) cells.push({ x: x + CELL_KM / 2, y: y + CELL_KM / 2 });

  const fireCentres: Loaded['fireCentres'] = [];
  for (const f of fires?.features ?? []) {
    // Centre of the largest part's bounding box: simple, stable, and good enough to rank fires.
    let best: number[][] | null = null;
    for (const poly of f.geometry.coordinates as number[][][][]) if (!best || poly[0].length > best.length) best = poly[0];
    if (!best) continue;
    let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    for (const [lon, lat] of best) {
      if (lon < w) w = lon;
      if (lon > e) e = lon;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
    const lon = (w + e) / 2;
    const lat = (s + n) / 2;
    if (lon < area[0] || lon > area[2] || lat < area[1] || lat > area[3]) continue;
    const [x, y] = toXY(frame, lon, lat);
    fireCentres.push({ x, y, lon, lat, props: f.properties });
  }
  const loaded: Loaded = { info, frame, water, fires, runs, dryRuns, observed, observedMeta: obsFile?.meta ?? null, cells, fireCentres, area };
  return loaded;
}

// ---------- analysis for the current threshold ----------
function recompute() {
  const L = current;
  const usable = activeRuns(L).filter((r) => r.lengthM >= threshold);
  const mappedUsable = L.runs.filter((r) => r.lengthM >= threshold);

  // grid
  const half = CELL_KM / 2;
  const counts = new Array(CLASSES.length).fill(0);
  const features = L.cells.map((c) => {
    const hit = nearest(c.x, c.y, usable);
    const cls = hit ? classOf(hit.minutes) : CLASSES.length - 1;
    counts[cls]++;
    const [w, s] = toLonLat(L.frame, c.x - half, c.y - half);
    const [e, n] = toLonLat(L.frame, c.x + half, c.y + half);
    return { type: 'Feature' as const, properties: { cls }, geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } };
  });
  (map.getSource('grid') as GeoJSONSource).setData({ type: 'FeatureCollection', features });

  // layers that depend on the threshold
  map.setFilter('water-on', ['>=', ['get', runField()], threshold]);
  map.setFilter('water-on-line', ['>=', ['get', runField()], threshold]);
  map.setFilter('water-off', ['<', ['get', runField()], threshold]);
  map.setFilter('runs', ['>=', ['get', 'len'], threshold]);
  (map.getSource('runs') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: activeRuns(L).filter((r) => r.lengthM > 0).map((r) => ({
      type: 'Feature' as const,
      properties: { len: r.lengthM },
      geometry: { type: 'LineString' as const, coordinates: [toLonLat(L.frame, r.ax, r.ay), toLonLat(L.frame, r.bx, r.by)] },
    })),
  });

  // stats
  const within6 = (counts[0] + counts[1]) / Math.max(1, L.cells.length);
  const fires = L.fireCentres.map((f) => ({ f, hit: nearest(f.x, f.y, usable) }));
  const haAll = fires.reduce((s, x) => s + x.f.props.ha, 0);
  const haFar = fires.filter((x) => !x.hit || x.hit.minutes > 9).reduce((s, x) => s + x.f.props.ha, 0);
  // In the dry scenario, show the mapped value alongside so the change is visible.
  let was = { sites: '', within: '', far: '' };
  if (scenario === 'dry') {
    let w6 = 0;
    for (const c of L.cells) { const h = nearest(c.x, c.y, mappedUsable); if (h && h.minutes <= 6) w6++; }
    const farM = L.fireCentres.filter((f) => { const h = nearest(f.x, f.y, mappedUsable); return !h || h.minutes > 9; }).reduce((s, f) => s + f.props.ha, 0);
    was = { sites: `<s>${fmt(mappedUsable.length)}</s> `, within: `<s>${fmt((w6 / Math.max(1, L.cells.length)) * 100)}%</s> `, far: haAll ? `<s>${fmt((farM / haAll) * 100)}%</s> ` : '' };
  }
  $('stats').innerHTML = `
    <div class="stat"><b>${was.sites}${fmt(usable.length)}</b><span>usable refill sites, of ${fmt(L.runs.length)} measured</span></div>
    <div class="stat"><b>${was.within}${fmt(within6 * 100)}%</b><span>of the area within 6 min per load</span></div>
    <div class="stat"><b>${was.far}${haAll ? fmt((haFar / haAll) * 100) + '%' : '–'}</b><span>of burned area over 9 min per load</span></div>`;
  renderObserved();

  // ranked fires: large fires with the slowest loads
  const ranked = fires
    .filter((x) => x.f.props.ha >= 500)
    .sort((a, b) => (b.hit?.minutes ?? 99) - (a.hit?.minutes ?? 99))
    .slice(0, 6);
  const list = $('fire-list');
  list.innerHTML = '';
  if (!ranked.length) list.innerHTML = '<li class="empty">No fires of 500 ha or more in the analysis area.</li>';
  for (const { f, hit } of ranked) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<span class="t">${f.props.place ?? 'Fire'} · ${f.props.year}</span><span class="m">${hit ? fmt(hit.minutes, 1) + ' min' : 'no water'}</span><span class="s">${fmt(f.props.ha)} ha burned${hit ? ` · ${fmt(hit.distKm, 1)} km from ${nameOf(hit.run.body)}` : ''}</span>`;
    btn.addEventListener('click', () => {
      map.flyTo({ center: [f.lon, f.lat], zoom: 10.5 });
      setProbe(f.lon, f.lat);
    });
    li.append(btn);
    list.append(li);
  }

  $('run-out').textContent = `${fmt(threshold)} m`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#presets button')) b.setAttribute('aria-pressed', String(Number(b.dataset.m) === threshold));
  if (probe) setProbe(probe.lon, probe.lat);
}

const nameOf = (body: number) => current.water.features[body].properties.name ?? `unnamed ${current.water.features[body].properties.kind}`;

// ---------- point readout ----------
function setProbe(lon: number, lat: number) {
  probe = { lon, lat };
  const L = current;
  const [x, y] = toXY(L.frame, lon, lat);
  const hit = nearest(x, y, activeRuns(L).filter((r) => r.lengthM >= threshold));
  const box = $('readout');
  box.hidden = false;
  $('hint').hidden = true;
  const src = map.getSource('probe') as GeoJSONSource;
  if (!hit) {
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }] });
    box.innerHTML = `<button class="close" aria-label="Close">×</button><h3>No usable water in this region</h3><p>No water body here has a straight run of ${fmt(threshold)} m.</p>`;
  } else {
    const to = toLonLat(L.frame, hit.x, hit.y);
    src.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, lat], to] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } },
      ],
    });
    box.innerHTML = `<button class="close" aria-label="Close">×</button>
      <h3>From this spot</h3>
      <p>Nearest usable water is <strong>${nameOf(hit.run.body)}</strong>, ${fmt(hit.distKm, 1)} km away. Its longest straight run is ${fmt(hit.run.lengthM)} m${scenario === 'dry' && L.observed.has(hit.run.body) ? ' in its driest observed month' : ''}.</p>
      <div class="big">
        <div><b>${fmt(hit.minutes, 1)} min</b><span>per load</span></div>
        <div><b>${fmt(dropsPerHour(hit.minutes), 0)}</b><span>loads an hour</span></div>
        <div><b>${fmt(litresPerHour(hit.minutes) / 1000, 0)} k L</b><span>an hour, per aircraft</span></div>
      </div>
      <dl class="coords">
        <dt>Nearest point on that water's run</dt><dd>${coord(to[1], to[0])}</dd>
        <dt>This spot</dt><dd>${coord(lat, lon)}</dd>
      </dl>
      <p>Latitude, longitude (WGS 84). Flat-terrain rule of thumb. Assumes the water is deep enough and clear of obstacles.</p>`;
  }
  box.querySelector('.close')!.addEventListener('click', clearProbe);
}
function clearProbe() {
  probe = null;
  $('readout').hidden = true;
  (map.getSource('probe') as GeoJSONSource).setData(empty);
}
/** Small chart of observed run length over time, with the required run as a dashed line. */
function sparkline(series: Obs[], mapped: number, w = 300, h = 64): string {
  const t0 = Date.parse(series[0].date);
  const t1 = Date.parse(series[series.length - 1].date);
  const top = Math.max(mapped, threshold, ...series.map((s) => s.run_m)) * 1.08;
  const X = (d: string) => 4 + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (w - 8);
  const Y = (v: number) => h - 4 - (v / top) * (h - 8);
  const pts = series.map((s) => `${X(s.date).toFixed(1)},${Y(s.run_m).toFixed(1)}`).join(' ');
  const dots = series.filter((s) => s.run_m < threshold).map((s) => `<circle cx="${X(s.date).toFixed(1)}" cy="${Y(s.run_m).toFixed(1)}" r="2.6" fill="#bf4326"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Observed run length over time">
    <line x1="4" x2="${w - 4}" y1="${Y(threshold).toFixed(1)}" y2="${Y(threshold).toFixed(1)}" stroke="#15232b" stroke-width="1" stroke-dasharray="4 3"/>
    <polyline points="${pts}" fill="none" stroke="#17618f" stroke-width="1.8" stroke-linejoin="round"/>${dots}</svg>`;
}
/** The observation with the least water surface: the clearest sign of drawdown, independent of run length. */
const lowestShare = (series: Obs[]) => series.reduce((a, b) => (b.water_share < a.water_share ? b : a));
const monthYear = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function renderObserved() {
  const L = current;
  const sec = $('observed');
  sec.hidden = L.observed.size === 0;
  $('scenario').hidden = L.observed.size === 0;
  if (!L.observed.size) return;
  const rows = [...L.observed.entries()]
    .map(([body, o]) => ({ body, o, below: o.series.filter((s) => s.run_m < threshold).length, mapped: L.runs[body].lengthM }))
    .filter((r) => r.mapped >= threshold) // only reservoirs that count as usable on the map
    .sort((a, b) => b.below / b.o.series.length - a.below / a.o.series.length || a.o.driest.run_m - b.o.driest.run_m);
  const list = $('observed-list');
  list.innerHTML = '';
  const lost = rows.filter((r) => r.below > 0).length;
  $('observed-sum').innerHTML = rows.length
    ? `<strong>${lost} of ${rows.length}</strong> observed reservoirs fell below ${fmt(threshold)} m in at least one clear month, ${L.observedMeta!.years[0]}–${L.observedMeta!.years[1]}.`
    : `No observed reservoir reaches ${fmt(threshold)} m even on its mapped outline.`;
  for (const r of rows) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<span class="t">${nameOf(r.body)}</span><span class="m ${r.below ? '' : 'ok'}">${r.below ? `${r.below} of ${r.o.series.length} months` : 'never'}</span>
      ${sparkline(r.o.series, r.mapped, 300, 44)}
      <span class="s">Shortest run: ${fmt(r.o.driest.run_m)} m in ${monthYear(r.o.driest.date)} · mapped ${fmt(r.mapped)} m · water surface down to ${fmt(lowestShare(r.o.series).water_share * 100)}%</span>`;
    btn.addEventListener('click', () => {
      const p = L.water.features[r.body].properties;
      map.flyTo({ center: [(p.run[0] + p.run[2]) / 2, (p.run[1] + p.run[3]) / 2], zoom: 11 });
      (map.getSource('probe') as GeoJSONSource).setData(empty);
      probe = null;
      showWater(p);
    });
    li.append(btn);
    list.append(li);
  }
}

function showWater(p: WaterProps) {
  const body = current.water.features.findIndex((f) => f.properties.id === p.id);
  const o = current.observed.get(body);
  const shown = scenario === 'dry' ? Number(p.run_dry) : p.run_m;
  const ok = shown >= threshold;
  const box = $('readout');
  box.hidden = false;
  $('hint').hidden = true;
  box.innerHTML = `<button class="close" aria-label="Close">×</button>
    <h3>${p.name ?? `Unnamed ${p.kind}`}</h3>
    <p><span class="tag ${ok ? 'ok' : 'no'}">${ok ? 'Long enough' : 'Too short'} at ${fmt(threshold)} m${scenario === 'dry' && o ? ', driest month' : ''}</span></p>
    <div class="big">
      <div><b>${fmt(p.run_m)} m</b><span>longest straight run</span></div>
      <div><b>${String(p.bearing).padStart(3, '0')}°</b><span>run axis</span></div>
      <div><b>${fmt(p.area_km2, p.area_km2 < 10 ? 2 : 0)} km²</b><span>mapped area</span></div>
    </div>
    <dl class="coords">
      <dt>Run starts</dt><dd>${coord(p.run[1], p.run[0])}</dd>
      <dt>Run ends</dt><dd>${coord(p.run[3], p.run[2])}</dd>
    </dl>
    <p>Latitude, longitude (WGS 84), on the mapped outline.</p>
    ${o ? `<p><strong>Seen from space, ${o.series.length} clear months:</strong> run between ${fmt(o.driest.run_m)} m (${monthYear(o.driest.date)}) and ${fmt(Math.max(...o.series.map((s) => s.run_m)))} m. Its water surface fell to ${fmt(lowestShare(o.series).water_share * 100)}% of the mapped outline (${monthYear(lowestShare(o.series).date)}). Dashed line is the run required.</p>${sparkline(o.series, p.run_m)}` : `<p>${p.kind === 'reservoir' ? 'Reservoir: measured on its mapped outline, which is usually the full level. A drawn-down reservoir has a shorter run. Not yet observed by satellite here.' : 'Measured on its mapped outline.'}</p>`}
    <p>Depth is not known from open data.</p>`;
  box.querySelector('.close')!.addEventListener('click', clearProbe);
}

// ---------- region switching ----------
async function showRegion(id: string) {
  const info = manifest.regions.find((r) => r.id === id)!;
  $<HTMLSelectElement>('region-select').value = id;
  $('region-note').textContent = info.note;
  // Keep the address shareable: it always names the region on screen.
  const query = new URLSearchParams(location.search);
  query.set('region', id);
  history.replaceState(null, '', `?${query}`);
  current = await loadRegion(info);
  clearProbe();
  (map.getSource('water') as GeoJSONSource).setData(current.water as any);
  (map.getSource('fires') as GeoJSONSource).setData((current.fires ?? empty) as any);
  if (!current.observed.size) scenario = 'mapped';
  for (const b of document.querySelectorAll<HTMLButtonElement>('#scenario button')) b.setAttribute('aria-pressed', String(b.dataset.s === scenario));
  const [w, s, e, n] = current.area;
  (map.getSource('area') as GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } });
  map.fitBounds([[w, s], [e, n]], { padding: 30, duration: 600 });
  recompute();
  const day = (iso: string) => iso.slice(0, 10);
  $('credits').textContent = `Water: ${info.water.source}, fetched ${day(info.water.fetched)}. ${current.observedMeta ? `Observed water: ${current.observedMeta.source}. ` : ''}${info.fires ? `Fires of ${info.fires.minHa} ha or more since ${info.fires.firstYear}: ${info.fires.source}, fetched ${day(info.fires.fetched)}.` : ''}`;
}

// ---------- boot ----------
function buildStaticUi() {
  $('legend').innerHTML = CLASSES.map((c) => `<li><i style="background:${c.color}"></i><span>${c.label}</span><small>${c.sub}</small></li>`).join('');
  const presets = $('presets');
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.m = String(p.m);
    b.title = p.why;
    b.textContent = p.label;
    b.addEventListener('click', () => setThreshold(p.m));
    presets.append(b);
  }
  // One list grouped by country, so it keeps working as regions are added.
  // Planned regions are shown, disabled, so visitors can see where coverage is heading.
  const select = $<HTMLSelectElement>('region-select');
  const countries = [...new Set([...manifest.regions, ...(manifest.planned ?? [])].map((r) => r.country))];
  for (const c of countries) {
    const group = document.createElement('optgroup');
    group.label = COUNTRY[c] ?? c;
    for (const r of manifest.regions.filter((x) => x.country === c)) group.append(new Option(r.name.replace(/, (Spain|Canada)$/, ''), r.id));
    for (const p of (manifest.planned ?? []).filter((x) => x.country === c)) {
      const o = new Option(`${p.name} (planned)`, '');
      o.disabled = true;
      group.append(o);
    }
    select.append(group);
  }
  select.addEventListener('change', () => select.value && showRegion(select.value));
  $('coverage').textContent = `${manifest.regions.length} regions built, ${manifest.planned?.length ?? 0} planned.`;
  for (const b of document.querySelectorAll<HTMLButtonElement>('#scenario button')) b.addEventListener('click', () => setScenario(b.dataset.s as typeof scenario));
  let raf = 0;
  $<HTMLInputElement>('run').addEventListener('input', (ev) => {
    threshold = Number((ev.target as HTMLInputElement).value);
    $('run-out').textContent = `${fmt(threshold)} m`;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(recompute);
  });
  const vis = (on: boolean) => (on ? 'visible' : 'none');
  $<HTMLInputElement>('t-grid').addEventListener('change', (e) => map.setLayoutProperty('grid', 'visibility', vis((e.target as HTMLInputElement).checked)));
  $<HTMLInputElement>('t-fires').addEventListener('change', (e) => {
    for (const l of ['fires', 'fires-line']) map.setLayoutProperty(l, 'visibility', vis((e.target as HTMLInputElement).checked));
  });
  $<HTMLInputElement>('t-off').addEventListener('change', (e) => map.setLayoutProperty('water-off', 'visibility', vis((e.target as HTMLInputElement).checked)));
}
function setThreshold(m: number) {
  threshold = m;
  $<HTMLInputElement>('run').value = String(m);
  recompute();
}
function setScenario(s: typeof scenario) {
  scenario = s === 'dry' && current.observed.size ? 'dry' : 'mapped';
  for (const b of document.querySelectorAll<HTMLButtonElement>('#scenario button')) b.setAttribute('aria-pressed', String(b.dataset.s === scenario));
  recompute();
}

function addLayers() {
  // Put our layers under the basemap's labels so place names stay readable.
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  for (const id of ['grid', 'water', 'fires', 'runs', 'probe', 'area']) map.addSource(id, { type: 'geojson', data: empty });
  map.addLayer({ id: 'grid', type: 'fill', source: 'grid', paint: { 'fill-color': ['match', ['get', 'cls'], ...CLASSES.flatMap((c, i) => [i, c.color]), '#ccc'] as any, 'fill-opacity': 0.5, 'fill-antialias': false } }, firstSymbol);
  map.addLayer({ id: 'area', type: 'line', source: 'area', paint: { 'line-color': '#15232b', 'line-width': 1, 'line-dasharray': [3, 3] } }, firstSymbol);
  map.addLayer({ id: 'fires', type: 'fill', source: 'fires', paint: { 'fill-color': '#7a1f0c', 'fill-opacity': 0.14 } }, firstSymbol);
  map.addLayer({ id: 'fires-line', type: 'line', source: 'fires', paint: { 'line-color': '#7a1f0c', 'line-width': 0.8, 'line-opacity': 0.65 } }, firstSymbol);
  map.addLayer({ id: 'water-off', type: 'fill', source: 'water', paint: { 'fill-color': '#9fb3bd', 'fill-opacity': 0.75 } }, firstSymbol);
  map.addLayer({ id: 'water-on', type: 'fill', source: 'water', paint: { 'fill-color': '#0c3f63' } }, firstSymbol);
  map.addLayer({ id: 'water-on-line', type: 'line', source: 'water', paint: { 'line-color': '#ffffff', 'line-width': 1 } }, firstSymbol);
  map.addLayer({ id: 'runs', type: 'line', source: 'runs', minzoom: 8.5, paint: { 'line-color': '#ffd24a', 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'probe-line', type: 'line', source: 'probe', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#15232b', 'line-width': 2 } });
  map.addLayer({ id: 'probe-pt', type: 'circle', source: 'probe', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': '#15232b', 'circle-stroke-width': 3 } });

  map.on('click', (e) => {
    const water = map.queryRenderedFeatures(e.point, { layers: ['water-on', 'water-off'] })[0];
    if (water) {
      (map.getSource('probe') as GeoJSONSource).setData(empty);
      probe = null;
      showWater(current.water.features.find((f) => f.properties.id === water.properties.id)!.properties);
      return;
    }
    const { lng, lat } = e.lngLat;
    const [w, s, en, n] = current.info.bbox;
    if (lng < w || lng > en || lat < s || lat > n) return;
    setProbe(lng, lat);
  });
  for (const l of ['water-on', 'water-off']) {
    map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', l, () => (map.getCanvas().style.cursor = ''));
  }
}

async function boot() {
  manifest = await fetch('/data/manifest.json').then((r) => r.json());
  buildStaticUi();
  const wanted = new URLSearchParams(location.search).get('region');
  const first = manifest.regions.find((r) => r.id === wanted) ?? manifest.regions[0];
  void loadRegion(first); // start the data download while the basemap style loads
  // Wait only for the style, not for every basemap tile: our layers do not depend on them.
  await styleReady;
  addLayers();
  await showRegion(first.id);
  initTour({
    setThreshold,
    getThreshold: () => threshold,
    setScenario,
    getScenario: () => scenario,
    hasObserved: () => current.observed.size > 0,
    hasProbe: () => probe !== null,
    // A point a third of the way across the analysis area: usually land with a clear answer.
    probeCentre: () => setProbe(current.area[0] + (current.area[2] - current.area[0]) * 0.36, current.area[1] + (current.area[3] - current.area[1]) * 0.5),
    clearProbe,
  });
  // map.html?demo=1 plays the recorded tour (see demo.ts). Loaded only when asked for.
  if (new URLSearchParams(location.search).get('demo') === '1') {
    const { runDemo } = await import('./demo');
    const mapBox = () => map.getContainer().getBoundingClientRect();
    runDemo(
      {
        setThreshold,
        setScenario,
        hasObserved: () => current.observed.size > 0,
        demoPlace: () => [current.area[0] + (current.area[2] - current.area[0]) * 0.36, current.area[1] + (current.area[3] - current.area[1]) * 0.5],
        screenOf: (lon, lat) => {
          const p = map.project([lon, lat]);
          return { x: mapBox().left + p.x, y: mapBox().top + p.y };
        },
        probeAt: setProbe,
        clearProbe,
      },
      // Back to the opening state before each loop.
      async () => {
        setScenario('mapped');
        setThreshold(REF.defaultRunM);
        clearProbe();
        $('panel').scrollTo({ top: 0 });
        const [w, s, e, n] = current.area;
        map.fitBounds([[w, s], [e, n]], { padding: 30, duration: 0 });
        await new Promise((r) => setTimeout(r, 900));
      },
    );
  }
}
boot().catch((err) => {
  console.error(err);
  $('region-note').textContent = 'The map data could not be loaded. Please reload the page.';
});

// exported for tests and the browser console
Object.assign(window, { __skimline: { turnaroundMin } });
