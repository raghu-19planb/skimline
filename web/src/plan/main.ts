// The planning page. This file holds the page's state and wires the pieces together:
//   region.ts    loads data          analysis.ts  computes the numbers
//   map-view.ts  draws the map       panel.ts     draws the five steps
//   readout.ts   draws the card      tour.ts / demo.ts  guide and recorded tour
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/plan.css';
import { LARGE_FIRE_HA, measure, reservoirRows, slowestLargeFires, summarise } from './analysis.ts';
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
  showRegionInfo,
  showScenario,
  showThreshold,
  waterName,
} from './panel.ts';
import { hideReadout, onReadoutClose, showNoWater, showSpot, showWater } from './readout.ts';
import { loadManifest, loadRegion } from './region.ts';
import { initTour } from './tour.ts';
import type { Manifest, Region, Scenario } from './types.ts';

// ---------- state ----------
const view = new MapView('map');
let manifest: Manifest;
let region: Region;
const settings: Settings = { threshold: REF.defaultRunM, scenario: 'mapped' };
/** The spot being measured, if any. Kept so the card follows changes to the settings. */
let probe: { lon: number; lat: number } | null = null;

const hasObservations = () => region.observed.size > 0;
const activeRuns = () => (settings.scenario === 'dry' ? region.dryRuns : region.runs);

// ---------- actions ----------
/** Recomputes everything that depends on the settings and redraws it. */
function refresh(): void {
  const now = summarise(region, settings);
  const full = settings.scenario === 'dry' ? summarise(region, { ...settings, scenario: 'mapped' }) : null;

  view.update(region, now.cellClass, activeRuns(), settings.threshold, settings.scenario === 'dry');
  showThreshold(settings.threshold);
  showScenario(settings.scenario, hasObservations());
  renderSummary(now, full);
  if (hasObservations()) renderReservoirs(region, reservoirRows(region, settings.threshold), settings.threshold, openWaterBody);
  renderFires(region, slowestLargeFires(now.fires), LARGE_FIRE_HA, openFire);
  if (probe) measureSpot(probe.lon, probe.lat);
}

function setThreshold(metres: number): void {
  settings.threshold = metres;
  refresh();
}

function setScenario(scenario: Scenario): void {
  settings.scenario = scenario === 'dry' && hasObservations() ? 'dry' : 'mapped';
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
    driestMonth: settings.scenario === 'dry' && region.observed.has(access.run.body),
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
  showWater(props, region.observed.get(body), settings.threshold, settings.scenario === 'dry', region.minDepthM);
}

function openFire({ fire }: FireAccess): void {
  view.flyTo(fire.lon, fire.lat, 10.5);
  measureSpot(fire.lon, fire.lat);
}

async function showRegion(id: string, animate = true): Promise<void> {
  const info = manifest.regions.find((r) => r.id === id);
  if (!info) return;
  region = await loadRegion(info);
  if (!hasObservations()) settings.scenario = 'mapped';
  clearProbe();
  showRegionInfo(info, region);
  view.showRegion(region, animate);
  refresh();
  // Keep the address shareable: it always names the region on screen.
  const query = new URLSearchParams(location.search);
  query.set('region', id);
  history.replaceState(null, '', `?${query}`);
}

// ---------- wiring ----------
function wireControls(): void {
  renderLegend();
  renderPresets(setThreshold);
  renderRegionSelect(manifest, (id) => void showRegion(id));
  onReadoutClose(clearProbe);

  for (const btn of el('scenario').querySelectorAll<HTMLButtonElement>('button')) {
    btn.addEventListener('click', () => setScenario(btn.dataset.scenario === 'dry' ? 'dry' : 'mapped'));
  }

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
  await showRegion(first.id, false);

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

  const guide = {
    setThreshold,
    getThreshold: () => settings.threshold,
    setScenario,
    getScenario: () => settings.scenario,
    hasObserved: hasObservations,
    hasProbe: () => probe !== null,
    probeCentre: () => measureSpot(...demoPlace()),
    clearProbe,
  };
  initTour(guide);

  // plan.html?demo=1 plays the recorded tour. Loaded only when asked for.
  if (query.get('demo') === '1') {
    const { runDemo } = await import('./demo.ts');
    runDemo(
      { setThreshold, setScenario, hasObserved: hasObservations, demoPlace, screenOf: (lon, lat) => view.screenOf(lon, lat), probeAt: measureSpot, clearProbe },
      // Back to the opening state before each loop.
      async () => {
        settings.scenario = 'mapped';
        settings.threshold = REF.defaultRunM;
        clearProbe();
        refresh();
        el('panel').scrollTo({ top: 0 });
        view.fit(region.area, false);
        await new Promise((resolve) => setTimeout(resolve, 900));
      },
    );
  }
}

boot().catch((error: unknown) => {
  console.error(error);
  el('region-note').textContent = 'The map data could not be loaded. Please reload the page.';
});
