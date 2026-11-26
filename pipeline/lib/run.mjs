// Longest straight scooping run inside a water polygon.
//
// A "run" is the longest straight segment that stays inside the water with a clear
// corridor of a given width around it. Method: for each compass direction, rotate the
// polygon so that direction lies along the x axis, slice it with horizontal scanlines,
// and intersect each scanline's in-water intervals with its neighbours' so the whole
// corridor width is water. Islands are handled because every ring (outer and holes)
// contributes crossings and the even-odd rule sorts water from land.

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

/** Project a GeoJSON Polygon's rings to local metres around (lon0, lat0). */
export function projectRings(rings, lon0, lat0) {
  const kx = M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);
  return rings.map((ring) => ring.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_PER_DEG_LAT]));
}

export function unproject([x, y], lon0, lat0) {
  const kx = M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180);
  return [lon0 + x / kx, lat0 + y / M_PER_DEG_LAT];
}

/** Planar area of projected rings (outer minus holes), m². */
export function ringsArea(rings) {
  let total = 0;
  rings.forEach((ring, i) => {
    let a = 0;
    for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) a += ring[k][0] * ring[j][1] - ring[j][0] * ring[k][1];
    total += (i === 0 ? 1 : -1) * Math.abs(a / 2);
  });
  return total;
}

function intersectIntervals(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi > lo) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/**
 * @param rings projected rings in metres
 * @param corridorM required clear width
 * @param stepDeg direction resolution
 * @returns {{length:number, a:[number,number], b:[number,number], bearing:number}|null}
 */
export function longestRun(rings, corridorM = 100, stepDeg = 3) {
  const half = corridorM / 2;
  // Scanline spacing: half the corridor, so three adjacent lines span the full width.
  const s = half;
  let best = null;

  for (let deg = 0; deg < 180; deg += stepDeg) {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    // Rotate by -t: the run direction becomes +x.
    let ymin = Infinity;
    let ymax = -Infinity;
    const rot = rings.map((ring) =>
      ring.map(([x, y]) => {
        const ry = -x * sn + y * c;
        if (ry < ymin) ymin = ry;
        if (ry > ymax) ymax = ry;
        return [x * c + y * sn, ry];
      }),
    );
    const n = Math.floor((ymax - ymin) / s) + 1;
    if (n < 3) continue; // narrower than the corridor in this orientation
    const crossings = Array.from({ length: n }, () => []);
    for (const ring of rot) {
      for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
        const [x1, y1] = ring[k];
        const [x2, y2] = ring[j];
        if (y1 === y2) continue;
        const lo = Math.min(y1, y2);
        const hi = Math.max(y1, y2);
        // half-open [lo, hi) so a vertex shared by two edges is counted once
        const k0 = Math.max(0, Math.ceil((lo - ymin) / s));
        const k1 = Math.min(n - 1, Math.ceil((hi - ymin) / s) - 1);
        for (let q = k0; q <= k1; q++) {
          const y = ymin + q * s;
          if (y < lo || y >= hi) continue;
          crossings[q].push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
    }
    const intervals = crossings.map((xs) => {
      xs.sort((p, q) => p - q);
      const out = [];
      for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
      return out;
    });
    for (let q = 1; q < n - 1; q++) {
      if (!intervals[q].length) continue;
      const corridor = intersectIntervals(intersectIntervals(intervals[q - 1], intervals[q]), intervals[q + 1]);
      for (const [lo, hi] of corridor) {
        const len = hi - lo;
        if (!best || len > best.length) {
          const y = ymin + q * s;
          // rotate endpoints back by +t
          best = {
            length: len,
            a: [lo * c - y * sn, lo * sn + y * c],
            b: [hi * c - y * sn, hi * sn + y * c],
            bearing: (90 - deg + 360) % 180, // compass bearing of the run axis, 0–180
          };
        }
      }
    }
  }
  return best;
}
