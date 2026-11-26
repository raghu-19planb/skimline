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
}

export interface ObservedFile {
  meta: { source: string; years: [number, number] };
  reservoirs: { id: string; name: string | null; mapped_run_m: number; series: Observation[] }[];
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
  /** Centres of the analysis grid cells, in the local frame (km). */
  cells: { x: number; y: number }[];
  fireCentres: FireCentre[];
  /** The analysis area: the data box drawn in from its edges. */
  area: BBox;
}

export type Scenario = 'mapped' | 'dry';
