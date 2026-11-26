// The analytical model. Every constant here carries its source; the Methods page
// repeats them for readers. Nothing in this file touches the map or the DOM.

/** Sourced reference values. */
export const REF = {
  /** Tank volume of a CL-415 / DHC-515, litres. De Havilland Canada DHC-515 spec sheet. */
  tankLitres: 6137,
  /**
   * Minimum water-body length used by Natural Resources Canada authors when screening
   * lakes for CL-415 use: 1 nautical mile. (Wotton & Jurko, report for the Swiss FOEN, 2025.)
   */
  defaultRunM: 1852,
  /** Minimum width from the same source: 300 ft. The pipeline's corridor (100 m) is slightly stricter. */
  minWidthM: 91,
  /** Minimum depth for multi-engine scoopers: 6 ft. NWCG PMS 518 (2026). Not testable from open outlines. */
  minDepthM: 1.8,
};

/**
 * Turnaround rule of thumb for CL-415 / CL-215T in flat terrain:
 * distance from water to fire (statute miles) → minutes per load.
 * US Forest Service, Standards for Multi-Engine Water Scooper Operations (2026), section 7.1.
 * "90 seconds if the water is next to the fire" is the zero-distance anchor.
 */
const TURNAROUND: [miles: number, minutes: number][] = [
  [0, 1.5],
  [1, 3],
  [3, 4],
  [6, 6],
  [10, 9],
  [15, 12],
];
const KM_PER_MILE = 1.609344;

/** Minutes per load at a given water-to-fire distance. Linear between table rows; the last slope continues beyond 15 miles. */
export function turnaroundMin(distKm: number): number {
  const mi = distKm / KM_PER_MILE;
  for (let i = 1; i < TURNAROUND.length; i++) {
    const [m0, t0] = TURNAROUND[i - 1];
    const [m1, t1] = TURNAROUND[i];
    if (mi <= m1) return t0 + ((mi - m0) / (m1 - m0)) * (t1 - t0);
  }
  const [m0, t0] = TURNAROUND[TURNAROUND.length - 2];
  const [m1, t1] = TURNAROUND[TURNAROUND.length - 1];
  return t1 + ((mi - m1) * (t1 - t0)) / (m1 - m0);
}

export const dropsPerHour = (minutes: number) => 60 / minutes;
export const litresPerHour = (minutes: number) => dropsPerHour(minutes) * REF.tankLitres;

/** Map classes for minutes per load. Upper bounds follow the source table's rows. */
export const CLASSES = [
  { max: 4, label: '4 min or less', sub: '15+ loads an hour', color: '#17618f' },
  { max: 6, label: '4 – 6 min', sub: '10 – 15 loads', color: '#58a6c4' },
  { max: 9, label: '6 – 9 min', sub: '7 – 10 loads', color: '#d9d39a' },
  { max: 12, label: '9 – 12 min', sub: '5 – 7 loads', color: '#e39a3b' },
  { max: Infinity, label: 'Over 12 min', sub: 'under 5 loads', color: '#bf4326' },
] as const;
export const classOf = (minutes: number) => CLASSES.findIndex((c) => minutes <= c.max);

// ---------- planar geometry in a local kilometre frame ----------

export interface Frame {
  lon0: number;
  lat0: number;
  kx: number;
  ky: number;
}
export function frameFor(bbox: [number, number, number, number]): Frame {
  const lat0 = (bbox[1] + bbox[3]) / 2;
  return { lon0: bbox[0], lat0: bbox[1], kx: 111.32 * Math.cos((lat0 * Math.PI) / 180), ky: 110.54 };
}
export const toXY = (f: Frame, lon: number, lat: number): [number, number] => [(lon - f.lon0) * f.kx, (lat - f.lat0) * f.ky];
export const toLonLat = (f: Frame, x: number, y: number): [number, number] => [f.lon0 + x / f.kx, f.lat0 + y / f.ky];

/** A scooping run as a segment in the local frame, with the index of its water body. */
export interface Run {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  body: number;
  lengthM: number;
}

/** Distance (km) from a point to a segment, and the closest point on it. */
export function distToRun(px: number, py: number, r: Run): { d: number; x: number; y: number } {
  const dx = r.bx - r.ax;
  const dy = r.by - r.ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - r.ax) * dx + (py - r.ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = r.ax + t * dx;
  const y = r.ay + t * dy;
  return { d: Math.hypot(px - x, py - y), x, y };
}

export interface Nearest {
  distKm: number;
  minutes: number;
  run: Run;
  x: number;
  y: number;
}
export function nearest(px: number, py: number, runs: Run[]): Nearest | null {
  let best: Nearest | null = null;
  for (const r of runs) {
    const hit = distToRun(px, py, r);
    if (!best || hit.d < best.distKm) best = { distKm: hit.d, minutes: 0, run: r, x: hit.x, y: hit.y };
  }
  if (best) best.minutes = turnaroundMin(best.distKm);
  return best;
}
