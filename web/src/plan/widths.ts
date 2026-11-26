// Runs are measured at several clear widths (how wide the open water must be along the
// run). The files store one entry per width; settings refer to a width by its index.
// These helpers read a run at a given width and fall back to the single-width fields of
// older files, so one code path serves both.
import type { Observation, RunLine, WaterProps } from './types.ts';

/** Usable run of an observation at width index `k`, metres. */
export const runAt = (o: Observation, k: number): number => o.runs_w?.[k]?.[0] ?? (k === 0 ? o.run_m : 0);

/** The two ends of that run, or null if no run fits. */
export function lineAt(o: Observation, k: number): RunLine | null {
  const entry = o.runs_w?.[k];
  if (entry) return entry[0] > 0 ? [entry[1], entry[2], entry[3], entry[4]] : null;
  return k === 0 ? o.line : null;
}

/** Run known to be deep enough at width index `k`: null if it cannot be known, undefined if there is no gauge. */
export const deepRunAt = (o: Observation, k: number): number | null | undefined => (o.deep_runs_w ? o.deep_runs_w[k] : k === 0 ? o.deep_run_m : undefined);

/** True if every observation was measured at all `count` widths. */
export const measuredAtAll = (series: Observation[], count: number): boolean => count === 1 || series.every((o) => o.runs_w?.length === count);

export interface MappedRun {
  metres: number;
  /** Compass bearing of the run's axis, 0–180. */
  bearing: number;
  line: RunLine;
}

/** A water body's run on its mapped outline at width index `k`. */
export function mappedRunAt(props: WaterProps, k: number): MappedRun {
  const entry = props.runs_w?.[k];
  if (entry) return { metres: entry[0], bearing: entry[1], line: [entry[2], entry[3], entry[4], entry[5]] };
  return k === 0 ? { metres: props.run_m, bearing: props.bearing, line: props.run } : { metres: 0, bearing: 0, line: props.run };
}

/** "100 m", "200 m": how a width is written. */
export const widthLabel = (metres: number): string => `${metres} m`;
