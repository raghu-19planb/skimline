// What the page computes from a loaded region. Pure functions: no DOM, no map, no network,
// so every number shown to a planner can be unit-tested.
import { CLASSES, classOf, nearest, toXY } from './model.ts';
import type { Nearest, Run } from './model.ts';
import type { FireCentre, Observation, Region, ReservoirRecord, Scenario } from './types.ts';

/** "Close to water": ten or more loads an hour. */
export const NEAR_MINUTES = 6;
/** "Far from water": fewer than about seven loads an hour. */
export const FAR_MINUTES = 9;
/** Fires this size or larger are listed individually. */
export const LARGE_FIRE_HA = 500;

export interface Settings {
  /** Straight run the aircraft needs, metres. */
  threshold: number;
  scenario: Scenario;
}

/** Runs that are long enough under the given settings. */
export function usableRuns(region: Region, settings: Settings): Run[] {
  const runs = settings.scenario === 'dry' ? region.dryRuns : region.runs;
  return runs.filter((run) => run.lengthM >= settings.threshold);
}

/** Nearest usable water to a point given in degrees. */
export function measure(region: Region, settings: Settings, lon: number, lat: number): Nearest | null {
  const [x, y] = toXY(region.frame, lon, lat);
  return nearest(x, y, usableRuns(region, settings));
}

export interface FireAccess {
  fire: FireCentre;
  /** Nearest usable water, or null if the region has none. */
  access: Nearest | null;
}

export interface Summary {
  usableSites: number;
  measuredSites: number;
  /** Minutes-per-load class of each grid cell, in the order of `region.cells`. */
  cellClass: Uint8Array;
  /** Share of the analysis area within NEAR_MINUTES per load, 0–1. */
  nearShare: number;
  /** Share of burned area beyond FAR_MINUTES per load, 0–1; null where no fires are mapped. */
  burnedFarShare: number | null;
  fires: FireAccess[];
}

export function summarise(region: Region, settings: Settings): Summary {
  const usable = usableRuns(region, settings);
  const slowest = CLASSES.length - 1;

  const cellClass = new Uint8Array(region.cells.length);
  let near = 0;
  region.cells.forEach((cell, i) => {
    const access = nearest(cell.x, cell.y, usable);
    cellClass[i] = access ? classOf(access.minutes) : slowest;
    if (access && access.minutes <= NEAR_MINUTES) near++;
  });

  const fires = region.fireCentres.map((fire) => ({ fire, access: nearest(fire.x, fire.y, usable) }));
  const burned = fires.reduce((sum, f) => sum + f.fire.props.ha, 0);
  const burnedFar = fires.filter((f) => !f.access || f.access.minutes > FAR_MINUTES).reduce((sum, f) => sum + f.fire.props.ha, 0);

  return {
    usableSites: usable.length,
    measuredSites: region.runs.length,
    cellClass,
    nearShare: region.cells.length ? near / region.cells.length : 0,
    burnedFarShare: burned ? burnedFar / burned : null,
    fires,
  };
}

/** Large fires with the slowest loads first. A fire with no usable water at all ranks slowest. */
export function slowestLargeFires(fires: FireAccess[], limit = 6): FireAccess[] {
  const minutes = (f: FireAccess) => f.access?.minutes ?? Infinity;
  return fires
    .filter((f) => f.fire.props.ha >= LARGE_FIRE_HA)
    .sort((a, b) => minutes(b) - minutes(a))
    .slice(0, limit);
}

export interface ReservoirRow {
  /** Index into `region.water.features`. */
  body: number;
  record: ReservoirRecord;
  /** Run measured on the mapped outline, metres. */
  mappedRunM: number;
  /** Observed months in which the run was shorter than the threshold. */
  monthsBelow: number;
}

/**
 * Observed reservoirs that count as usable on their mapped outline, with the ones that
 * fell short most often first. Reservoirs too short even when full are left out: they
 * were never a refill site at this threshold, so they have nothing to lose.
 */
export function reservoirRows(region: Region, threshold: number): ReservoirRow[] {
  const rows: ReservoirRow[] = [];
  for (const [body, record] of region.observed) {
    const mappedRunM = region.runs[body]?.lengthM ?? 0;
    if (mappedRunM < threshold) continue;
    rows.push({ body, record, mappedRunM, monthsBelow: record.series.filter((o) => o.run_m < threshold).length });
  }
  const share = (row: ReservoirRow) => row.monthsBelow / row.record.series.length;
  return rows.sort((a, b) => share(b) - share(a) || a.record.driest.run_m - b.record.driest.run_m);
}

/** An observation that has a gauge reading. */
export type Gauged = Observation & { level_m: number };

/**
 * What the gauge record says about run length and water level.
 *  - always:    long enough at every gauged observation; `lowest` is the lowest level seen
 *  - never:     too short at every gauged observation; `highest` is the highest level seen
 *  - threshold: too short at `shortAt` and below; long enough from `longFrom` up
 *               (`longFrom` is null if nothing higher was observed)
 */
export type LevelFinding =
  | { kind: 'ungauged' }
  | { kind: 'always'; lowest: Gauged }
  | { kind: 'never'; highest: Gauged }
  | { kind: 'threshold'; shortAt: Gauged; longFrom: Gauged | null };

/**
 * The level below which a reservoir loses its run. Deliberately cautious: the dividing
 * line is the HIGHEST level at which the run was ever seen too short, so one clear image
 * of a short run outweighs noisier ones at lower levels that happened to look longer.
 */
export function levelFinding(series: Observation[], threshold: number): LevelFinding {
  const gauged = series.filter((o): o is Gauged => typeof o.level_m === 'number');
  if (!gauged.length) return { kind: 'ungauged' };
  const byLevel = (a: Gauged, b: Gauged) => a.level_m - b.level_m;
  const short = gauged.filter((o) => o.run_m < threshold).sort(byLevel);
  const long = gauged.filter((o) => o.run_m >= threshold).sort(byLevel);
  const shortAt = short.at(-1);
  if (!shortAt) return { kind: 'always', lowest: long[0] as Gauged };
  const highest = [...gauged].sort(byLevel).at(-1) as Gauged;
  if (!long.length) return { kind: 'never', highest };
  return { kind: 'threshold', shortAt, longFrom: long.find((o) => o.level_m > shortAt.level_m) ?? null };
}
