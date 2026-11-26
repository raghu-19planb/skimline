// The small charts in the reservoir card and list. Each returns finished SVG markup
// built only from numbers formatted here, so it is safe to insert.
import { raw } from './format.ts';
import type { SafeHtml } from './format.ts';
import type { Observation } from './types.ts';
import { deepRunAt, runAt } from './widths.ts';

const PAD = 4;
const n = (value: number) => value.toFixed(1);

/**
 * Usable run over time. The dashed line is the run an aircraft needs; months below it
 * get a red dot. Where a gauge exists, a second, darker line shows the run known to be
 * deep enough.
 */
export function sparkline(series: Observation[], mappedRunM: number, threshold: number, widthIndex: number, width = 300, height = 64): SafeHtml {
  const run = (o: Observation) => runAt(o, widthIndex);
  const deepRun = (o: Observation) => deepRunAt(o, widthIndex);
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return raw('');

  const t0 = Date.parse(first.date);
  const span = Math.max(1, Date.parse(last.date) - t0);
  const top = Math.max(mappedRunM, threshold, ...series.map(run)) * 1.08;
  const x = (date: string) => n(PAD + ((Date.parse(date) - t0) / span) * (width - 2 * PAD));
  const y = (metres: number) => n(height - PAD - (metres / top) * (height - 2 * PAD));

  const line = series.map((o) => `${x(o.date)},${y(run(o))}`).join(' ');
  const deep = series
    .filter((o) => typeof deepRun(o) === 'number')
    .map((o) => `${x(o.date)},${y(deepRun(o) as number)}`)
    .join(' ');
  const dots = series
    .filter((o) => run(o) < threshold)
    .map((o) => `<circle class="below" cx="${x(o.date)}" cy="${y(run(o))}" r="2.6"/>`)
    .join('');

  return raw(
    `<svg class="spark" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Usable run in each observed month">` +
      `<line class="need" x1="${PAD}" x2="${width - PAD}" y1="${y(threshold)}" y2="${y(threshold)}"/>` +
      `<polyline class="run" points="${line}"/>` +
      (deep ? `<polyline class="deep" points="${deep}"/>` : '') +
      `${dots}</svg>`,
  );
}

/**
 * Run against water level: one dot per gauged observation, level left to right. This is
 * the reservoir operator's view: it shows the level below which the run is lost.
 */
export function levelChart(series: Observation[], threshold: number, widthIndex: number, width = 300, height = 84): SafeHtml {
  const run = (o: Observation) => runAt(o, widthIndex);
  const gauged = series.filter((o): o is Observation & { level_m: number } => typeof o.level_m === 'number');
  if (gauged.length < 2) return raw('');

  const levels = gauged.map((o) => o.level_m);
  const low = Math.min(...levels);
  const range = Math.max(0.1, Math.max(...levels) - low);
  const top = Math.max(threshold, ...gauged.map(run)) * 1.08;
  const x = (level: number) => n(PAD + 3 + ((level - low) / range) * (width - 2 * PAD - 6));
  const y = (metres: number) => n(height - PAD - (metres / top) * (height - 2 * PAD));

  const dots = gauged.map((o) => `<circle class="${run(o) < threshold ? 'below' : 'ok'}" cx="${x(o.level_m)}" cy="${y(run(o))}" r="3"/>`).join('');
  return raw(
    `<svg class="spark level" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Usable run at each observed water level">` +
      `<line class="need" x1="${PAD}" x2="${width - PAD}" y1="${y(threshold)}" y2="${y(threshold)}"/>${dots}</svg>`,
  );
}

/** Percent of capacity, month by month, over the whole gauge record. */
export function fillChart(history: [month: string, percent: number][], width = 300, height = 56): SafeHtml {
  if (history.length < 2) return raw('');
  const step = (width - 2 * PAD) / (history.length - 1);
  const y = (percent: number) => n(height - PAD - (Math.min(100, Math.max(0, percent)) / 100) * (height - 2 * PAD));
  const points = history.map(([, percent], i) => `${n(PAD + i * step)},${y(percent)}`).join(' ');
  const floor = n(height - PAD);
  return raw(
    `<svg class="spark fill" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Percent of capacity each month">` +
      `<polygon class="area" points="${n(PAD)},${floor} ${points} ${n(width - PAD)},${floor}"/>` +
      `<polyline class="run" points="${points}"/></svg>`,
  );
}
