// The planning page. This file holds the page's state and wires the pieces together:
//   region.ts    loads data          analysis.ts  computes the numbers
//   map-view.ts  draws the map       panel.ts     draws the five steps
//   readout.ts   draws the card      tour.ts / demo.ts  guide and recorded tour
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/plan.css';
import { LARGE_FIRE_HA, frozenBodies, measure, reservoirRows, runsFor, slowestLargeFires, summarise } from './analysis.ts';
import type { FireAccess, Settings } from './analysis.ts';
import { el } from './dom.ts';
import { MapView } from './map-view.ts';
import { REF, toLonLat } from './model.ts';
import {
  renderFires,
  renderLegend,
  renderPresets,
  renderRegionSelect,
  renderReservoirs,
  renderSummary,
  renderMonths,
  renderWidths,
  showIce,
  showRegionInfo,
  showScenario,
  showThreshold,
  showWidth,
  waterName,
} from './panel.ts';
import { hideReadout, onReadoutClose, showNoWater, showSpot, showWater } from './readout.ts';
import { loadManifest, loadRegion } from './region.ts';
import { initTour } from './tour.ts';
import type { Manifest, Region, Scenario } from './types.ts';

/** Below this window width the page is one column, with the map under the region step. */
const PHONE = window.matchMedia('(max-width: 820px)');

// ---------- state ----------
const view = new MapView('map');
let manifest: Manifest;
let region: Region;
const settings: Settings = { threshold: REF.defaultRunM, width: 0, scenario: 'mapped', month: null };
/** The spot being measured, if any. Kept so the card follows changes to the settings. */
let probe: { lon: number; lat: number } | null = null;
/** Counts region requests, so a slow download cannot overwrite a newer choice. */
let regionRequest = 0;

const hasObservations = () => region.observed.size > 0;
/** Prefix of the per-feature property the map filters by, for each scenario (see region.ts). */
const FIELD: Record<Scenario, string> = { mapped: 'r', latest: 'l', dry: 'd' };
const SCENARIOS: Scenario[] = ['mapped', 'latest', 'dry'];
const asScenario = (value: string | undefined): Scenario => SCENARIOS.find((s) => s === value) ?? 'mapped';

// ---------- actions ----------
/** Recomputes everything that depends on the settings and redraws it. */
function refresh(): void {
  const now = summarise(region, settings);
  // Outside the mapped state, the headline numbers are shown beside their mapped values.
  const full = settings.scenario === 'mapped' ? null : summarise(region, { ...settings, scenario: 'mapped' });

  const frozen = frozenBodies(region, settings.month);
  const frozenIds = [...frozen].map((body) => region.water.features[body]?.properties.id ?? '');
  view.update(region, now.cellClass, runsFor(region, settings), settings.threshold, `${FIELD[settings.scenario]}${settings.width}`, frozenIds);
  showIce(region, settings.month ?? null, frozen.size);
  showThreshold(settings.threshold);
  showWidth(settings.width);
  showScenario(settings.scenario, region);
  renderSummary(now, full);
  if (hasObservations()) {
    renderReservoirs(region, reservoirRows(region, settings.threshold, settings.width), settings.threshold, settings.width, openWaterBody);
  }
  renderFires(region, slowestLargeFires(now.fires), LARGE_FIRE_HA, openFire);
  if (probe) measureSpot(probe.lon, probe.lat);
}

function setThreshold(metres: number): void {
  settings.threshold = metres;
  refresh();
}

function setWidth(index: number): void {
  settings.width = Math.max(0, Math.min(region.widths.length - 1, index));
  refresh();
}

function setScenario(scenario: Scenario): void {
  settings.scenario = hasObservations() ? scenario : 'mapped';
  refresh();
}

function measureSpot(lon: number, lat: number): void {
  probe = { lon, lat };
  const access = measure(region, settings, lon, lat);
  if (!access) {
    view.setProbe([lon, lat], null);
    showNoWater(settings.threshold);
    return;
  }
  const waterPoint = toLonLat(region.frame, access.x, access.y);
  view.setProbe([lon, lat], waterPoint);
  showSpot({
    lon,
    lat,
    access,
    waterPoint,
    waterName: waterName(region, access.run.body),
    stateNote: !region.observed.has(access.run.body)
      ? ''
      : settings.scenario === 'dry'
        ? ' in its driest observed month'
        : settings.scenario === 'latest'
          ? ' in the latest image'
          : '',
  });
}

function clearProbe(): void {
  probe = null;
  view.clearProbe();
  hideReadout();
}

function openWaterBody(body: number, fly = true): void {
  const props = region.water.features[body]?.properties;
  if (!props) return;
  probe = null;
  view.clearProbe();
  if (fly) view.flyTo((props.run[0] + props.run[2]) / 2, (props.run[1] + props.run[3]) / 2, 11);
  showWater(props, region.observed.get(body), {
    threshold: settings.threshold,
    width: settings.width,
    widthM: region.widths[settings.width] ?? 0,
    scenario: settings.scenario,
    month: settings.month ?? null,
    minDepthM: region.minDepthM,
  });
}

function openFire({ fire }: FireAccess): void {
  view.flyTo(fire.lon, fire.lat, 10.5);
  measureSpot(fire.lon, fire.lat);
}

/**
 * Shows a region. The map says "loading" at once, so the choice is acknowledged before
 * the data arrives, and on a phone the map is scrolled into view.
 */
async function showRegion(id: string, { animate = true, chosenByVisitor = false } = {}): Promise<void> {
  const info = manifest.regions.find((r) => r.id === id);
  if (!info) return;
  const request = ++regionRequest;
  const loading = el('loading');
  loading.textContent = `Loading ${info.name}…`;
  loading.hidden = false;
  if (chosenByVisitor && PHONE.matches) el('map').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const loaded = await loadRegion(info);
    if (request !== regionRequest) return; // the visitor has already picked another region
    region = loaded;
    if (!hasObservations()) settings.scenario = 'mapped';
    settings.width = Math.min(settings.width, region.widths.length - 1);
    clearProbe();
    showRegionInfo(info, region);
    renderWidths(region.widths, setWidth);
    view.showRegion(region, animate);
    refresh();
    // Keep the address shareable: it always names the region on screen.
    const query = new URLSearchParams(location.search);
    query.set('region', id);
    history.replaceState(null, '', `?${query}`);
  } finally {
    if (request === regionRequest) loading.hidden = true;
  }
}

// ---------- wiring ----------
function wireControls(): void {
  renderLegend();
  renderPresets(setThreshold);
  renderRegionSelect(manifest, (id) => {
    showRegion(id, { chosenByVisitor: true }).catch(reportLoadFailure);
  });
  onReadoutClose(clearProbe);

  for (const btn of el('scenario').querySelectorAll<HTMLButtonElement>('button')) {
    btn.addEventListener('click', () => setScenario(asScenario(btn.dataset.scenario)));
  }

  renderMonths((month) => {
    settings.month = month;
    refresh();
  });

  // Dragging the slider fires many events; recompute at most once per frame.
  let frame = 0;
  el<HTMLInputElement>('run').addEventListener('input', (event) => {
    settings.threshold = Number((event.target as HTMLInputElement).value);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  });

  const toggle = (id: string, layers: string[]) =>
    el<HTMLInputElement>(id).addEventListener('change', (event) => view.setLayerVisible(layers, (event.target as HTMLInputElement).checked));
  toggle('t-grid', ['grid']);
  toggle('t-fires', ['fires', 'fires-line']);
  toggle('t-off', ['water-off']);

  view.onClick((hit) => {
    if ('waterId' in hit) {
      const body = region.water.features.findIndex((f) => f.properties.id === hit.waterId);
      if (body >= 0) openWaterBody(body, false);
      return;
    }
    const [w, s, e, n] = region.info.bbox;
    if (hit.lon >= w && hit.lon <= e && hit.lat >= s && hit.lat <= n) measureSpot(hit.lon, hit.lat);
  });
}

function reportLoadFailure(error: unknown): void {
  console.error(error);
  el('region-note').textContent = 'The map data could not be loaded. Please reload the page.';
}

/** A good place to measure in a demonstration: a third of the way across, half-way up. */
const demoPlace = (): [number, number] => [region.area[0] + (region.area[2] - region.area[0]) * 0.36, region.area[1] + (region.area[3] - region.area[1]) * 0.5];

async function boot(): Promise<void> {
  manifest = await loadManifest();
  wireControls();

  const query = new URLSearchParams(location.search);
  const first = manifest.regions.find((r) => r.id === query.get('region')) ?? manifest.regions[0];
  if (!first) throw new Error('The manifest lists no regions.');
  void loadRegion(first).catch(() => {}); // start the download while the basemap style loads; errors surface below
  await view.ready;
  await showRegion(first.id, { animate: false });

  // A link can name a water body (?water=<id>) to open its card on arrival, for example
  // from the home page to a reservoir's month-by-month record.
  const wanted = query.get('water');
  if (wanted) {
    const body = region.water.features.findIndex((f) => f.properties.id === wanted);
    if (body >= 0) openWaterBody(body);
    // Drop it from the address so it does not linger once the visitor moves on.
    const address = new URLSearchParams(location.search);
    address.delete('water');
    history.replaceState(null, '', `?${address}`);
  }

  initTour({
    setThreshold,
    getThreshold: () => settings.threshold,
    setScenario,
    getScenario: () => settings.scenario,
    hasObserved: hasObservations,
    hasProbe: () => probe !== null,
    probeCentre: () => measureSpot(...demoPlace()),
    clearProbe,
  });

  // plan.html?demo=1 plays the recorded tour. Loaded only when asked for.
  if (query.get('demo') === '1') {
    const { runDemo } = await import('./demo.ts');
    runDemo(
      { setThreshold, setScenario, hasObserved: hasObservations, demoPlace, screenOf: (lon, lat) => view.screenOf(lon, lat), probeAt: measureSpot, clearProbe },
      // Back to the opening state before each loop.
      async () => {
        settings.scenario = 'mapped';
        settings.threshold = REF.defaultRunM;
        settings.width = 0;
        settings.month = null;
        clearProbe();
        refresh();
        el('panel').scrollTo({ top: 0 });
        view.fit(region.area, false);
        await new Promise((resolve) => setTimeout(resolve, 900));
      },
    );
  }
}

boot().catch(reportLoadFailure);
