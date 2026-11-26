import { raw } from './format.ts';
import type { SafeHtml } from './format.ts';
import type { Observation } from './types.ts';

const PAD = 4;

/**
 * A small chart of a reservoir's observed run over time. The dashed line is the run
 * an aircraft needs; months below it are marked with a red dot.
 */
export function sparkline(series: Observation[], mappedRunM: number, threshold: number, width = 300, height = 64): SafeHtml {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return raw('');

  const t0 = Date.parse(first.date);
  const span = Math.max(1, Date.parse(last.date) - t0);
  const top = Math.max(mappedRunM, threshold, ...series.map((o) => o.run_m)) * 1.08;
  const x = (date: string) => (PAD + ((Date.parse(date) - t0) / span) * (width - 2 * PAD)).toFixed(1);
  const y = (metres: number) => (height - PAD - (metres / top) * (height - 2 * PAD)).toFixed(1);

  const line = series.map((o) => `${x(o.date)},${y(o.run_m)}`).join(' ');
  const dots = series
    .filter((o) => o.run_m < threshold)
    .map((o) => `<circle class="below" cx="${x(o.date)}" cy="${y(o.run_m)}" r="2.6"/>`)
    .join('');

  // Every value above is a number we formatted ourselves, so this markup is safe.
  return raw(
    `<svg class="spark" viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Usable run in each observed month">` +
      `<line class="need" x1="${PAD}" x2="${width - PAD}" y1="${y(threshold)}" y2="${y(threshold)}"/>` +
      `<polyline class="run" points="${line}"/>${dots}</svg>`,
  );
}
