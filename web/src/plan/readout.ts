// The card over the map: figures for a measured spot, or for a water body.
import { el, setHtml } from './dom.ts';
import { bearing, coord, fmt, html, monthYear, pct } from './format.ts';
import type { SafeHtml } from './format.ts';
import { REF, dropsPerHour, litresPerHour } from './model.ts';
import type { Nearest } from './model.ts';
import { levelFinding } from './analysis.ts';
import type { Gauged, LevelFinding } from './analysis.ts';
import { fillChart, levelChart, sparkline } from './charts.ts';
import type { ReservoirRecord, WaterProps } from './types.ts';

const CLOSE = html`<button class="close" type="button" aria-label="Close">×</button>`;
let onClose: () => void = () => {};

/** Registers what happens when the visitor closes the card. */
export function onReadoutClose(handler: () => void): void {
  onClose = handler;
}

function show(body: SafeHtml): void {
  const card = el('readout');
  setHtml(card, html`${CLOSE}${body}`);
  card.hidden = false;
  // Restart the entrance animation each time the content changes.
  card.classList.remove('enter');
  void card.offsetWidth;
  card.classList.add('enter');
  el('hint').hidden = true;
  card.querySelector('.close')?.addEventListener('click', onClose);
}

export function hideReadout(): void {
  el('readout').hidden = true;
}

/** True while a water body's card, not a spot's, is on screen. */
export const waterCardOpen = (): boolean => !!document.querySelector('#readout:not([hidden]) .tag');

export interface SpotReading {
  lon: number;
  lat: number;
  access: Nearest;
  /** Lon/lat of the nearest point on the usable run. */
  waterPoint: [number, number];
  waterName: string;
  /** True if that water's run is its driest observed month, not its mapped outline. */
  driestMonth: boolean;
}

export function showSpot(reading: SpotReading): void {
  const { access, waterPoint } = reading;
  show(
    html`<h3>From this spot</h3>
      <p>
        Nearest usable water is <strong>${reading.waterName}</strong>, ${fmt(access.distKm, 1)} km away. Its longest straight run is ${fmt(access.run.lengthM)}
        m${reading.driestMonth ? ' in its driest observed month' : ''}.
      </p>
      <div class="big">
        <div><b>${fmt(access.minutes, 1)} min</b><span>per load</span></div>
        <div><b>${fmt(dropsPerHour(access.minutes))}</b><span>loads an hour</span></div>
        <div><b>${fmt(litresPerHour(access.minutes) / 1000)} k L</b><span>an hour, per aircraft</span></div>
      </div>
      <dl class="coords">
        <dt>Nearest point on that water's run</dt>
        <dd>${coord(waterPoint[1], waterPoint[0])}</dd>
        <dt>This spot</dt>
        <dd>${coord(reading.lat, reading.lon)}</dd>
      </dl>
      <p>
        Latitude, longitude (WGS 84). Flat-terrain rule of thumb for a ${fmt(REF.tankLitres)}-litre tank. Assumes the water is deep enough and clear of
        obstacles.
      </p>`,
  );
}

export function showNoWater(threshold: number): void {
  show(
    html`<h3>No usable water in this region</h3>
      <p>No water body here has a straight run of ${fmt(threshold)} m.</p>`,
  );
}

/** What the gauge record says about the level at which the run is lost, as a sentence. */
export function levelSentence(finding: LevelFinding, threshold: number): string {
  const at = (o: Gauged) => `${fmt(o.level_m, 1)} m above sea level (${fmt(o.fill_pct ?? 0)}% full)`;
  switch (finding.kind) {
    case 'ungauged':
      return '';
    case 'always':
      return `The run stayed at least ${fmt(threshold)} m at every level seen, down to ${at(finding.lowest)}.`;
    case 'never':
      return `The run was shorter than ${fmt(threshold)} m at every level seen, up to ${at(finding.highest)}.`;
    case 'threshold':
      return (
        `The run was too short at ${at(finding.shortAt)} and below.` +
        (finding.longFrom ? ` It was long enough from ${at(finding.longFrom)} up.` : ' No higher level was observed.')
      );
  }
}

/** The satellite record: usable run in each clear month. */
function satelliteSection(record: ReservoirRecord, mappedRunM: number, threshold: number, minDepthM: number | null): SafeHtml {
  const { series } = record;
  const hasDepth = series.some((o) => typeof o.deep_run_m === 'number');
  return html`<h4>Month by month, from satellite images</h4>
    <p>
      Its usable run ranged from ${fmt(record.driest.run_m)} m (${monthYear(record.driest.date)}) to ${fmt(Math.max(...series.map((o) => o.run_m)))} m. At its
      lowest, in ${monthYear(record.lowestSurface.date)}, water covered ${pct(record.lowestSurface.water_share)} of the area it covers when full.
    </p>
    ${sparkline(series, mappedRunM, threshold)}
    <p class="axis">
      <span>${monthYear(series[0]?.date ?? record.driest.date)}</span><span>${series.length} clear months</span
      ><span>${monthYear(series.at(-1)?.date ?? record.driest.date)}</span>
    </p>
    <p class="key">
      <i class="k-run"></i>usable run ${hasDepth && minDepthM !== null ? html`<i class="k-deep"></i>known ${minDepthM} m deep or more ` : ''}<i
        class="k-need"
      ></i
      >run required <i class="k-below"></i>month below it
    </p>`;
}

/** What the official gauge adds: the level at which the run is lost, and how much of it is known to be deep enough. */
function gaugeSection(record: ReservoirRecord, threshold: number, minDepthM: number | null): SafeHtml {
  const gauged = record.series.filter((o): o is Gauged => typeof o.level_m === 'number');
  if (!record.gauge || gauged.length < 2) return html``;
  const levels = gauged.map((o) => o.level_m);
  const known = gauged.filter((o) => typeof o.deep_run_m === 'number');
  const shortestKnown = Math.min(...known.map((o) => o.deep_run_m as number));
  const depth =
    minDepthM === null
      ? ''
      : known.length
        ? `Depth: in ${known.length} of ${gauged.length} gauged months, a run of at least ${fmt(shortestKnown)} m was known to be under ${minDepthM} m or more of water. In the other ${gauged.length - known.length}, near the lowest level on record, depth cannot be known this way.`
        : `Depth cannot be checked here yet: the record does not span ${minDepthM} m of level change.`;
  return html`<h4>Run against water level</h4>
    <p>${levelSentence(levelFinding(record.series, threshold), threshold)}</p>
    ${levelChart(record.series, threshold)}
    <p class="axis"><span>${fmt(Math.min(...levels), 1)} m</span><span>water level, official gauge</span><span>${fmt(Math.max(...levels), 1)} m</span></p>
    <p class="key"><i class="k-ok"></i>long enough <i class="k-below"></i>too short <i class="k-need"></i>run required</p>
    <p>${depth}</p>`;
}

/** The gauge's whole record: percent of capacity each month. */
function fillSection(record: ReservoirRecord): SafeHtml {
  const history = record.fillHistory;
  const first = history[0];
  const last = history.at(-1);
  if (!record.gauge || !first || !last) return html``;
  const lowest = history.reduce((a, b) => (b[1] < a[1] ? b : a));
  const month = (key: string) => monthYear(`${key}-01`);
  return html`<h4>How full, since ${first[0].slice(0, 4)}</h4>
    ${fillChart(history)}
    <p class="axis"><span>${month(first[0])}</span><span>percent of capacity</span><span>${month(last[0])}</span></p>
    <p>Lowest month on record: ${fmt(lowest[1])}% full, ${month(lowest[0])}. Latest: ${fmt(last[1])}%. Source: ${record.gauge.source}.</p>`;
}

export function showWater(props: WaterProps, record: ReservoirRecord | undefined, threshold: number, dry: boolean, minDepthM: number | null): void {
  const shownRun = dry ? props.run_dry : props.run_m;
  const longEnough = shownRun >= threshold;
  const history = record
    ? html`${satelliteSection(record, props.run_m, threshold, minDepthM)}${gaugeSection(record, threshold, minDepthM)}${fillSection(record)}`
    : html`<p>
        ${
          props.kind === 'reservoir'
            ? 'Reservoir: measured on its mapped outline, which is usually the full level. A drawn-down reservoir has a shorter run. Not yet observed by satellite here.'
            : 'Measured on its mapped outline.'
        }
      </p>`;

  show(
    html`<h3>${props.name ?? `Unnamed ${props.kind}`}</h3>
      <p>
        <span class="tag ${longEnough ? 'ok' : 'no'}"
          >${longEnough ? 'Long enough' : 'Too short'} at ${fmt(threshold)} m${dry && record ? ', driest month' : ''}</span
        >
      </p>
      <div class="big">
        <div><b>${fmt(props.run_m)} m</b><span>longest straight run</span></div>
        <div><b>${bearing(props.bearing)}</b><span>run axis</span></div>
        <div><b>${fmt(props.area_km2, props.area_km2 < 10 ? 2 : 0)} km²</b><span>mapped area</span></div>
      </div>
      <dl class="coords">
        <dt>Run starts</dt>
        <dd>${coord(props.run[1], props.run[0])}</dd>
        <dt>Run ends</dt>
        <dd>${coord(props.run[3], props.run[2])}</dd>
      </dl>
      <p>Latitude, longitude (WGS 84), on the mapped outline.</p>
      ${history}
      ${record?.gauge ? '' : html`<p>Depth is not known here: no open water-level record is connected for this water body.</p>`}`,
  );
}
