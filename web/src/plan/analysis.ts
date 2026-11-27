// What the page computes from a loaded region. Pure functions: no DOM, no map, no network,
// so every number shown to a planner can be unit-tested.
import { CLASSES, classOf, nearest, toXY } from './model.ts';
import type { Nearest, Run } from './model.ts';
import type { FireCentre, Observation, Region, ReservoirRecord, Scenario } from './types.ts';
import { frozenIn } from './ice.ts';
import { runAt } from './widths.ts';

/** "Close to water": ten or more loads an hour. */
export const NEAR_MINUTES = 6;
/** "Far from water": fewer than about seven loads an hour. */
export const FAR_MINUTES = 9;
/**
 * Fewest fires for which a share of burned area is reported. With a handful of fires one
 * large perimeter decides the figure, and it swings wildly with small changes.
 */
export const MIN_FIRES_FOR_SHARE = 10;
/** Fires this size or larger are listed individually. */
export const LARGE_FIRE_HA = 500;

export interface Settings {
  /** Straight run the aircraft needs, metres. */
  threshold: number;
  /** Clear width of water the aircraft needs, as an index into `region.widths`. */
  width: number;
  scenario: Scenario;
  /** Calendar month being planned for, January = 0; null for any time of year. Water seen frozen in that month is skipped. */
  month?: number | null;
}

/** Every water body's run for the scenario and width in the settings. */
export function runsFor(region: Region, settings: Pick<Settings, 'scenario' | 'width'>): Run[] {
  const byWidth = settings.scenario === 'dry' ? region.dryRuns : settings.scenario === 'latest' ? region.latestRuns : region.runs;
  return byWidth[settings.width] ?? [];
}

/** Indexes of the water bodies seen frozen in a calendar month. Empty for "any time of year". */
export function frozenBodies(region: Region, month: number | null | undefined): Set<number> {
  const frozen = new Set<number>();
  if (month === null || month === undefined) return frozen;
  for (const [body, record] of region.observed) if (frozenIn(record.ice, month) === true) frozen.add(body);
  return frozen;
}

/** Runs that are long enough under the given settings, leaving out water that is frozen in the planning month. */
export function usableRuns(region: Region, settings: Settings): Run[] {
  const frozen = frozenBodies(region, settings.month);
  return runsFor(region, settings).filter((run) => run.lengthM >= settings.threshold && !frozen.has(run.body));
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
  /** Share of burned area beyond FAR_MINUTES per load, 0–1; null where too few fires are mapped to say. */
  burnedFarShare: number | null;
  /** Fires of the mapped size inside the analysis area. */
  fireCount: number;
  fires: FireAccess[];
}

export function summarise(region: Region, settings: Settings, minFires = MIN_FIRES_FOR_SHARE): Summary {
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
    measuredSites: region.water.features.length,
    cellClass,
    nearShare: region.cells.length ? near / region.cells.length : 0,
    burnedFarShare: burned && fires.length >= minFires ? burnedFar / burned : null,
    fireCount: fires.length,
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
  /** Run measured on the mapped outline at the chosen width, metres. */
  mappedRunM: number;
  /** Observed months in which the run was shorter than the threshold. */
  monthsBelow: number;
  /** The observation with the shortest run at the chosen width. */
  driest: Observation;
}

/**
 * Observed reservoirs that count as usable on their mapped outline, with the ones that
 * fell short most often first. Reservoirs too short even when full are left out: they
 * were never a refill site at this threshold, so they have nothing to lose.
 */
export function reservoirRows(region: Region, threshold: number, width = 0): ReservoirRow[] {
  const rows: ReservoirRow[] = [];
  for (const [body, record] of region.observed) {
    const mappedRunM = region.runs[width]?.[body]?.lengthM ?? 0;
    const driest = record.driest[width];
    if (mappedRunM < threshold || !driest) continue;
    rows.push({ body, record, mappedRunM, driest, monthsBelow: record.series.filter((o) => runAt(o, width) < threshold).length });
  }
  const share = (row: ReservoirRow) => row.monthsBelow / row.record.series.length;
  return rows.sort((a, b) => share(b) - share(a) || runAt(a.driest, width) - runAt(b.driest, width));
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
export function levelFinding(series: Observation[], threshold: number, width = 0): LevelFinding {
  const gauged = series.filter((o): o is Gauged => typeof o.level_m === 'number');
  if (!gauged.length) return { kind: 'ungauged' };
  const byLevel = (a: Gauged, b: Gauged) => a.level_m - b.level_m;
  const short = gauged.filter((o) => runAt(o, width) < threshold).sort(byLevel);
  const long = gauged.filter((o) => runAt(o, width) >= threshold).sort(byLevel);
  const shortAt = short.at(-1);
  if (!shortAt) return { kind: 'always', lowest: long[0] as Gauged };
  const highest = [...gauged].sort(byLevel).at(-1) as Gauged;
  if (!long.length) return { kind: 'never', highest };
  return { kind: 'threshold', shortAt, longFrom: long.find((o) => o.level_m > shortAt.level_m) ?? null };
}

/**
 * What a water level means for the run, judged against the record:
 *  long          at this level the run has been long enough
 *  short         at this level the run has been too short
 *  between       between the highest "too short" and the lowest "long enough": not known
 *  below-record  lower than any level observed: not known
 *  unknown       no gauge record, or a level above anything observed for a run never seen long enough
 */
export type LevelStatus = 'long' | 'short' | 'between' | 'below-record' | 'unknown';

export function levelStatus(finding: LevelFinding, level_m: number): LevelStatus {
  switch (finding.kind) {
    case 'ungauged':
      return 'unknown';
    case 'always':
      return level_m >= finding.lowest.level_m ? 'long' : 'below-record';
    case 'never':
      return level_m <= finding.highest.level_m ? 'short' : 'unknown';
    case 'threshold':
      if (level_m <= finding.shortAt.level_m) return 'short';
      return finding.longFrom && level_m >= finding.longFrom.level_m ? 'long' : 'between';
  }
}
