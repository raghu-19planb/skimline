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
  params: { corridorWidthM: number; minRunKeptM: number };
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
}

/** The official water-level gauge of a reservoir. */
export interface Gauge {
  station: string;
  source: string;
  first: string | null;
  last: string | null;
}

export interface ObservedFile {
  meta: { source: string; years: [number, number]; depth?: { min_depth_m: number; method: string } };
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
  /** Run in the driest observed month. Added on load; equals run_m where the water body was not observed. */
  run_dry: number;
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
  features: Feature<P, G>[];
}

/** A reservoir's satellite record, with the two observations the interface quotes most. */
export interface ReservoirRecord {
  series: Observation[];
  /** Observation with the shortest usable run. */
  driest: Observation;
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
  /** One run per water body, in the order of `water.features`. */
  runs: Run[];
  /** The same, with each observed reservoir at its driest observed month. */
  dryRuns: Run[];
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

export type Scenario = 'mapped' | 'dry';
