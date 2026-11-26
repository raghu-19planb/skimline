// Loading a region: fetch the pipeline's files and assemble them into something the
// analysis can work on. `assembleRegion` is pure so it can be tested without a network.
import { frameFor, toXY } from './model.ts';
import type { Run } from './model.ts';
import { lineAt, mappedRunAt, measuredAtAll, runAt } from './widths.ts';
import type {
  BBox,
  FeatureCollection,
  FireCentre,
  FireProps,
  Manifest,
  MultiPolygonGeometry,
  ObservedFile,
  Region,
  RegionInfo,
  ReservoirRecord,
  RunLine,
  WaterProps,
} from './types.ts';

/** Side of an analysis grid cell, km. */
export const CELL_KM = 1.5;
/**
 * Water outside the downloaded box is unknown, so results near its edge would look
 * worse than they are. The analysis area is the box drawn in by this margin.
 */
export const EDGE_MARGIN_KM = 20;
/** Clear width assumed for files that predate per-width runs, metres. */
export const DEFAULT_WIDTH_M = 100;
/** A reservoir needs at least this many clear months before its record is shown. */
export const MIN_CLEAR_MONTHS = 6;

const leastBy = <T>(items: T[], key: (item: T) => number): T => items.reduce((a, b) => (key(b) < key(a) ? b : a));

export function assembleRegion(
  info: RegionInfo,
  water: FeatureCollection<WaterProps>,
  fires: FeatureCollection<FireProps, MultiPolygonGeometry> | null,
  observedFile: ObservedFile | null,
): Region {
  const frame = frameFor(info.bbox);

  const widths = water.meta?.widths?.length ? water.meta.widths : [DEFAULT_WIDTH_M];
  const toRun = (line: RunLine, body: number, lengthM: number): Run => {
    const [ax, ay] = toXY(frame, line[0], line[1]);
    const [bx, by] = toXY(frame, line[2], line[3]);
    return { ax, ay, bx, by, body, lengthM };
  };

  // For each width: the run of every water body on its mapped outline.
  const runs: Run[][] = widths.map((_, k) =>
    water.features.map((feature, body) => {
      const mapped = mappedRunAt(feature.properties, k);
      return toRun(mapped.line, body, mapped.metres);
    }),
  );

  // Attach satellite records to their water bodies. A record is used only if it has
  // enough clear months and was measured at every width, so no width is ever compared
  // against a missing measurement.
  const indexById = new Map(water.features.map((feature, i) => [feature.properties.id, i]));
  const observed = new Map<number, ReservoirRecord>();
  for (const reservoir of observedFile?.reservoirs ?? []) {
    const body = indexById.get(reservoir.id);
    if (body === undefined || reservoir.series.length < MIN_CLEAR_MONTHS || !measuredAtAll(reservoir.series, widths.length)) continue;
    observed.set(body, {
      series: reservoir.series,
      driest: widths.map((_, k) => leastBy(reservoir.series, (o) => runAt(o, k))),
      latest: leastBy(reservoir.series, (o) => -Date.parse(o.date)),
      lowestSurface: leastBy(reservoir.series, (o) => o.water_share),
      gauge: reservoir.gauge ?? null,
      fillHistory: reservoir.fill_history ?? [],
    });
  }

  // The dry scenario, for each width: every observed reservoir at its driest observed month.
  const dryRuns: Run[][] = runs.map((atWidth, k) =>
    atWidth.map((run) => {
      const driest = observed.get(run.body)?.driest[k];
      if (!driest) return run;
      const line = lineAt(driest, k);
      return line ? toRun(line, run.body, runAt(driest, k)) : { ...run, lengthM: 0 };
    }),
  );
  // For each width: every observed reservoir as in its most recent image.
  const latestRuns: Run[][] = runs.map((atWidth, k) =>
    atWidth.map((run) => {
      const latest = observed.get(run.body)?.latest;
      if (!latest) return run;
      const line = lineAt(latest, k);
      return line ? toRun(line, run.body, runAt(latest, k)) : { ...run, lengthM: 0 };
    }),
  );
  // Flat copies on each feature, so the map can filter by them.
  water.features.forEach((feature, body) => {
    widths.forEach((_, k) => {
      feature.properties[`r${k}`] = runs[k]?.[body]?.lengthM ?? 0;
      feature.properties[`d${k}`] = dryRuns[k]?.[body]?.lengthM ?? 0;
      feature.properties[`l${k}`] = latestRuns[k]?.[body]?.lengthM ?? 0;
    });
  });

  const area: BBox = [
    info.bbox[0] + EDGE_MARGIN_KM / frame.kx,
    info.bbox[1] + EDGE_MARGIN_KM / frame.ky,
    info.bbox[2] - EDGE_MARGIN_KM / frame.kx,
    info.bbox[3] - EDGE_MARGIN_KM / frame.ky,
  ];
  const [x0, y0] = toXY(frame, area[0], area[1]);
  const [x1, y1] = toXY(frame, area[2], area[3]);
  const cells: Region['cells'] = [];
  for (let y = y0; y < y1; y += CELL_KM) {
    for (let x = x0; x < x1; x += CELL_KM) cells.push({ x: x + CELL_KM / 2, y: y + CELL_KM / 2 });
  }

  const fireCentres: FireCentre[] = [];
  for (const feature of fires?.features ?? []) {
    const centre = centreOfLargestPart(feature.geometry);
    if (!centre) continue;
    const [lon, lat] = centre;
    if (lon < area[0] || lon > area[2] || lat < area[1] || lat > area[3]) continue;
    const [x, y] = toXY(frame, lon, lat);
    fireCentres.push({ x, y, lon, lat, props: feature.properties });
  }

  return {
    info,
    frame,
    widths,
    water,
    fires,
    runs,
    dryRuns,
    latestRuns,
    observed,
    observedMeta: observedFile?.meta ?? null,
    minDepthM: observedFile?.meta.depth?.min_depth_m ?? null,
    cells,
    fireCentres,
    area,
  };
}

/**
 * Centre of the bounding box of a perimeter's largest part. Simple and stable, and
 * accurate enough to rank fires by distance to water.
 */
function centreOfLargestPart(geometry: MultiPolygonGeometry): [number, number] | null {
  let largest: [number, number][] | null = null;
  for (const polygon of geometry.coordinates) {
    const outer = polygon[0];
    if (outer && (!largest || outer.length > largest.length)) largest = outer;
  }
  if (!largest) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lon, lat] of largest) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [(west + east) / 2, (south + north) / 2];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export const loadManifest = (): Promise<Manifest> => getJson<Manifest>('/data/manifest.json');

const cache = new Map<string, Promise<Region>>();

/** Loads a region once; later calls return the same promise. */
export function loadRegion(info: RegionInfo): Promise<Region> {
  let pending = cache.get(info.id);
  if (!pending) {
    pending = Promise.all([
      getJson<FeatureCollection<WaterProps>>(`/data/${info.water.file}`),
      info.fires ? getJson<FeatureCollection<FireProps, MultiPolygonGeometry>>(`/data/${info.fires.file}`) : null,
      info.observed ? getJson<ObservedFile>(`/data/${info.observed}`) : null,
    ]).then(([water, fires, observed]) => assembleRegion(info, water, fires, observed));
    // A failed load must not be cached, or a reload could never recover.
    pending.catch(() => cache.delete(info.id));
    cache.set(info.id, pending);
  }
  return pending;
}
