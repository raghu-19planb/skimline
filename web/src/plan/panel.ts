// The left-hand panel: the five steps. Rendering only; decisions live in main.ts.
import { FAR_MINUTES, NEAR_MINUTES } from './analysis.ts';
import type { FireAccess, ReservoirRow, Summary } from './analysis.ts';
import { button, el, setHtml } from './dom.ts';
import { fmt, html, monthYear, pct } from './format.ts';
import { CLASSES } from './model.ts';
import { sparkline } from './sparkline.ts';
import type { Manifest, Region, RegionInfo, Scenario } from './types.ts';

const COUNTRY: Record<string, string> = { ES: 'Spain', CA: 'Canada', PT: 'Portugal' };
const countryName = (code: string) => COUNTRY[code] ?? code;

/** Run lengths with a published source, offered as one-click choices. */
export const PRESETS = [
  { metres: 1609, label: '1 mile', source: 'US Forest Service, sea level' },
  { metres: 1852, label: '1 nautical mile', source: 'Natural Resources Canada screening' },
  { metres: 4023, label: '2.5 miles', source: 'US Forest Service, 8,000 ft' },
] as const;

/** Display name of a water body; unnamed ones are described by kind. */
export function waterName(region: Region, body: number): string {
  const props = region.water.features[body]?.properties;
  return props?.name ?? `unnamed ${props?.kind ?? 'water body'}`;
}

export function renderLegend(): void {
  setHtml(el('legend'), html`${CLASSES.map((c) => html`<li><i style="background:${c.color}"></i><span>${c.label}</span><small>${c.sub}</small></li>`)}`);
}

export function renderPresets(onPick: (metres: number) => void): void {
  const box = el('presets');
  for (const preset of PRESETS) {
    const btn = button(html`${preset.label}`, () => onPick(preset.metres));
    btn.dataset.metres = String(preset.metres);
    btn.title = preset.source;
    box.append(btn);
  }
}

/**
 * One list grouped by country, so it keeps working as regions are added. Planned
 * regions are shown, disabled, so visitors can see where coverage is heading.
 */
export function renderRegionSelect(manifest: Manifest, onPick: (id: string) => void): void {
  const select = el<HTMLSelectElement>('region-select');
  const planned = manifest.planned ?? [];
  const countries = [...new Set([...manifest.regions, ...planned].map((r) => r.country))];
  for (const code of countries) {
    const group = document.createElement('optgroup');
    group.label = countryName(code);
    for (const region of manifest.regions.filter((r) => r.country === code)) {
      group.append(new Option(region.name.replace(/, (Spain|Canada)$/, ''), region.id));
    }
    for (const region of planned.filter((r) => r.country === code)) {
      const option = new Option(`${region.name} (planned)`, '');
      option.disabled = true;
      group.append(option);
    }
    select.append(group);
  }
  select.addEventListener('change', () => {
    if (select.value) onPick(select.value);
  });
  el('coverage').textContent = `${manifest.regions.length} regions built, ${planned.length} planned.`;
}

export function showRegionInfo(info: RegionInfo, region: Region): void {
  el<HTMLSelectElement>('region-select').value = info.id;
  el('region-note').textContent = info.note;
  const day = (iso: string) => iso.slice(0, 10);
  const parts = [`Water: ${info.water.source}, fetched ${day(info.water.fetched)}.`];
  if (region.observedMeta) parts.push(`Observed water: ${region.observedMeta.source}.`);
  if (info.fires)
    parts.push(`Fires of ${info.fires.minHa} ha or more since ${info.fires.firstYear}: ${info.fires.source}, fetched ${day(info.fires.fetched)}.`);
  el('credits').textContent = parts.join(' ');
}

export function showThreshold(metres: number): void {
  el('run-out').textContent = `${fmt(metres)} m`;
  el<HTMLInputElement>('run').value = String(metres);
  for (const btn of el('presets').querySelectorAll<HTMLButtonElement>('button')) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.metres) === metres));
  }
}

export function showScenario(scenario: Scenario, available: boolean): void {
  el('scenario').hidden = !available;
  el('observed').hidden = !available;
  el('dry-none').hidden = available;
  for (const btn of el('scenario').querySelectorAll<HTMLButtonElement>('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.scenario === scenario));
  }
}

/**
 * The three headline numbers. In the dry scenario each is shown beside its
 * full-reservoir value, struck through, so the change is visible.
 */
export function renderSummary(now: Summary, full: Summary | null): void {
  const was = (value: string | null) => (value === null ? '' : html`<s>${value}</s> `);
  const far = (s: Summary) => (s.burnedFarShare === null ? null : pct(s.burnedFarShare));
  setHtml(
    el('stats'),
    html`<div class="stat">
        <b>${was(full && fmt(full.usableSites))}${fmt(now.usableSites)}</b>
        <span>usable refill sites, of ${fmt(now.measuredSites)} measured</span>
      </div>
      <div class="stat">
        <b>${was(full && pct(full.nearShare))}${pct(now.nearShare)}</b>
        <span>of the area within ${NEAR_MINUTES} min per load</span>
      </div>
      <div class="stat">
        <b>${was(full && far(full))}${far(now) ?? '–'}</b>
        <span>of burned area over ${FAR_MINUTES} min per load</span>
      </div>`,
  );
}

export function renderReservoirs(region: Region, rows: ReservoirRow[], threshold: number, onPick: (body: number) => void): void {
  const years = region.observedMeta?.years;
  const fellShort = rows.filter((row) => row.monthsBelow > 0).length;
  setHtml(
    el('observed-sum'),
    rows.length
      ? html`<strong>${fellShort} of ${rows.length}</strong> observed reservoirs fell below ${fmt(threshold)} m in at least one clear
          month${years ? `, ${years[0]}–${years[1]}` : ''}.`
      : html`No observed reservoir reaches ${fmt(threshold)} m even on its mapped outline.`,
  );

  const list = el('observed-list');
  list.replaceChildren();
  for (const row of rows) {
    const { record } = row;
    const item = document.createElement('li');
    item.append(
      button(
        html`<span class="t">${waterName(region, row.body)}</span>
          <span class="m ${row.monthsBelow ? '' : 'ok'}">${row.monthsBelow ? `${row.monthsBelow} of ${record.series.length} months` : 'never'}</span>
          ${sparkline(record.series, row.mappedRunM, threshold, 300, 44)}
          <span class="s"
            >Shortest run: ${fmt(record.driest.run_m)} m in ${monthYear(record.driest.date)} · mapped ${fmt(row.mappedRunM)} m · water down to
            ${pct(record.lowestSurface.water_share)} of its full area</span
          >`,
        () => onPick(row.body),
      ),
    );
    list.append(item);
  }
}

export function renderFires(region: Region, fires: FireAccess[], minHa: number, onPick: (fire: FireAccess) => void): void {
  const list = el('fire-list');
  list.replaceChildren();
  if (!fires.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = `No fires of ${fmt(minHa)} ha or more in the analysis area.`;
    list.append(empty);
    return;
  }
  for (const entry of fires) {
    const { fire, access } = entry;
    const item = document.createElement('li');
    item.append(
      button(
        html`<span class="t">${fire.props.place ?? 'Fire'} · ${fire.props.year}</span>
          <span class="m">${access ? `${fmt(access.minutes, 1)} min` : 'no water'}</span>
          <span class="s">${fmt(fire.props.ha)} ha burned${access ? ` · ${fmt(access.distKm, 1)} km from ${waterName(region, access.run.body)}` : ''}</span>`,
        () => onPick(entry),
      ),
    );
    list.append(item);
  }
}
