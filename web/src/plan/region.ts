// Loading a region: fetch the pipeline's files and assemble them into something the
// analysis can work on. `assembleRegion` is pure so it can be tested without a network.
import { frameFor, toXY } from './model.ts';
import type { Run } from './model.ts';
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
  WaterProps,
} from './types.ts';

/** Side of an analysis grid cell, km. */
export const CELL_KM = 1.5;
/**
 * Water outside the downloaded box is unknown, so results near its edge would look
 * worse than they are. The analysis area is the box drawn in by this margin.
 */
export const EDGE_MARGIN_KM = 20;
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

  const runs: Run[] = water.features.map((feature, body) => {
    const [alon, alat, blon, blat] = feature.properties.run;
    const [ax, ay] = toXY(frame, alon, alat);
    const [bx, by] = toXY(frame, blon, blat);
    return { ax, ay, bx, by, body, lengthM: feature.properties.run_m };
  });

  // Attach satellite records to their water bodies.
  const indexById = new Map(water.features.map((feature, i) => [feature.properties.id, i]));
  const observed = new Map<number, ReservoirRecord>();
  for (const reservoir of observedFile?.reservoirs ?? []) {
    const body = indexById.get(reservoir.id);
    if (body === undefined || reservoir.series.length < MIN_CLEAR_MONTHS) continue;
    observed.set(body, {
      series: reservoir.series,
      driest: leastBy(reservoir.series, (o) => o.run_m),
      lowestSurface: leastBy(reservoir.series, (o) => o.water_share),
      gauge: reservoir.gauge ?? null,
      fillHistory: reservoir.fill_history ?? [],
    });
  }

  // The dry scenario: each observed reservoir at its driest observed month.
  const dryRuns: Run[] = runs.map((run) => {
    const record = observed.get(run.body);
    if (!record) return run;
    const { line, run_m } = record.driest;
    if (!line) return { ...run, lengthM: 0 };
    const [ax, ay] = toXY(frame, line[0], line[1]);
    const [bx, by] = toXY(frame, line[2], line[3]);
    return { ax, ay, bx, by, body: run.body, lengthM: run_m };
  });
  water.features.forEach((feature, i) => {
    feature.properties.run_dry = dryRuns[i]?.lengthM ?? feature.properties.run_m;
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
    water,
    fires,
    runs,
    dryRuns,
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
