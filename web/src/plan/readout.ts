// The card over the map: figures for a measured spot, or for a water body.
import { el, setHtml } from './dom.ts';
import { bearing, coord, fmt, html, monthYear, pct } from './format.ts';
import type { SafeHtml } from './format.ts';
import { REF, dropsPerHour, litresPerHour } from './model.ts';
import type { Nearest } from './model.ts';
import { sparkline } from './sparkline.ts';
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

export function showWater(props: WaterProps, record: ReservoirRecord | undefined, threshold: number, dry: boolean): void {
  const shownRun = dry ? props.run_dry : props.run_m;
  const longEnough = shownRun >= threshold;
  const history = record
    ? html`<p>
          <strong>Seen from space, ${record.series.length} clear months:</strong> run between ${fmt(record.driest.run_m)} m (${monthYear(record.driest.date)})
          and ${fmt(Math.max(...record.series.map((o) => o.run_m)))} m. Its water surface fell to ${pct(record.lowestSurface.water_share)} of the mapped outline
          (${monthYear(record.lowestSurface.date)}). The dashed line is the run required.
        </p>
        ${sparkline(record.series, props.run_m, threshold)}`
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
      <p>Depth is not known from open data.</p>`,
  );
}
