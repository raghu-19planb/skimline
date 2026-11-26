// Shapes of the files the pipeline writes, and of a region once it is loaded.
// Type-only: nothing here runs.
import type { Frame, Run } from './model.ts';

/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];
/** [lon, lat, lon, lat]: the two ends of a straight run. */
export type RunLine = [number, number, number, number];

export interface RegionInfo {
  id: string;
  name: string;
  country: string;
  bbox: BBox;
  note: string;
  water: { file: string; count: number; inputPolygons: number; source: string; fetched: string };
  fires: { file: string; count: number; source: string; fetched: string; minHa: number; firstYear: number } | null;
  observed: string | null;
}

export interface Manifest {
  built: string;
  params: { corridorWidthsM?: number[]; minRunKeptM: number };
  regions: RegionInfo[];
  planned?: { name: string; country: string }[];
}

/** One satellite observation of a reservoir. */
export interface Observation {
  date: string;
  scene: string;
  run_m: number;
  line: RunLine | null;
  /** Share of the mapped outline that was water, 0–1. */
  water_share: number;
  /** Water surface elevation from the official gauge that day, metres above sea level. Absent where there is no gauge. */
  level_m?: number | null;
  /** Percent of capacity from the official gauge that day. */
  fill_pct?: number | null;
  /** Run known to be at least the minimum depth deep; null where that cannot be known. */
  deep_run_m?: number | null;
  /** The run at each clear width in the file's `widths`: [metres, lon, lat, lon, lat]. */
  runs_w?: [number, number, number, number, number][];
  /** The known-deep run at each clear width. */
  deep_runs_w?: (number | null)[];
}

/** The official water-level gauge of a reservoir. */
export interface Gauge {
  /** Which open-data service publishes it; decides whether today's level can be read live. */
  api?: 'aca';
  station: string;
  source: string;
  first: string | null;
  last: string | null;
}

export interface ObservedFile {
  meta: { source: string; years: [number, number]; widths?: number[]; depth?: { min_depth_m: number; method: string } };
  reservoirs: {
    id: string;
    name: string | null;
    mapped_run_m: number;
    series: Observation[];
    gauge?: Gauge;
    /** Mean percent of capacity per month over the gauge record: [['2000-01', 78.2], ...]. */
    fill_history?: [string, number][];
  }[];
}

export interface WaterProps {
  id: string;
  name: string | null;
  kind: 'lake' | 'reservoir';
  area_km2: number;
  run_m: number;
  bearing: number;
  run: RunLine;
  /** The run at each clear width in the file's `widths`: [metres, bearing, lon, lat, lon, lat]. */
  runs_w?: [number, number, number, number, number, number][];
  /** Added on load for the map's filters: the mapped run at width index N, metres. */
  [mapped: `r${number}`]: number | undefined;
  /** Added on load: the run at width index N in the reservoir's driest observed month. */
  [driest: `d${number}`]: number | undefined;
  /** Added on load: the run at width index N in the reservoir's most recent image. */
  [latest: `l${number}`]: number | undefined;
}

export interface FireProps {
  year: number;
  ha: number;
  cause: string | null;
  place: string | null;
}

type Ring = [number, number][];
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Ring[];
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Ring[][];
}
export interface Feature<P, G = PolygonGeometry | MultiPolygonGeometry> {
  type: 'Feature';
  properties: P;
  geometry: G;
}
export interface FeatureCollection<P, G = PolygonGeometry | MultiPolygonGeometry> {
  type: 'FeatureCollection';
  meta?: { widths?: number[] };
  features: Feature<P, G>[];
}

/** A reservoir's satellite record. */
export interface ReservoirRecord {
  series: Observation[];
  /** Observation with the shortest usable run, at each clear width. */
  driest: Observation[];
  /** The most recent observation. */
  latest: Observation;
  /** Observation with the least water surface: the clearest sign of drawdown, independent of run length. */
  lowestSurface: Observation;
  gauge: Gauge | null;
  fillHistory: [string, number][];
}

/** A mapped fire, reduced to a point for ranking. Position is in the region's local frame (km) and in degrees. */
export interface FireCentre {
  x: number;
  y: number;
  lon: number;
  lat: number;
  props: FireProps;
}

/** A region ready for analysis. */
export interface Region {
  info: RegionInfo;
  frame: Frame;
  water: FeatureCollection<WaterProps>;
  fires: FeatureCollection<FireProps, MultiPolygonGeometry> | null;
  /** Clear widths the runs were measured at, metres. Settings refer to these by index. */
  widths: number[];
  /** For each width: one run per water body, in the order of `water.features`. */
  runs: Run[][];
  /** The same, with each observed reservoir at its driest observed month for that width. */
  dryRuns: Run[][];
  /** The same, with each observed reservoir as in its most recent satellite image. */
  latestRuns: Run[][];
  /** Satellite records, keyed by index into `water.features`. */
  observed: Map<number, ReservoirRecord>;
  observedMeta: ObservedFile['meta'] | null;
  /** Depth used for the known-deep runs, metres; null where the region has no gauges. */
  minDepthM: number | null;
  /** Centres of the analysis grid cells, in the local frame (km). */
  cells: { x: number; y: number }[];
  fireCentres: FireCentre[];
  /** The analysis area: the data box drawn in from its edges. */
  area: BBox;
}

/**
 * Which state of the water the page shows:
 *  mapped  every water body as drawn on the map, usually full
 *  latest  each observed reservoir as in its most recent satellite image
 *  dry     each observed reservoir at its own driest observed month
 */
export type Scenario = 'mapped' | 'latest' | 'dry';
