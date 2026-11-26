// Raster helpers for the satellite step. Masks are Uint8Array, row-major, 1 = water.

/** Fill polygons (arrays of rings in pixel coordinates) into a mask with the even-odd rule. */
export function rasterise(polys, w, h) {
  const mask = new Uint8Array(w * h);
  for (const rings of polys) {
    for (let row = 0; row < h; row++) {
      const y = row + 0.5;
      const xs = [];
      for (const ring of rings) {
        for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
          const [x1, y1] = ring[k];
          const [x2, y2] = ring[j];
          if (y1 === y2) continue;
          if (y >= Math.min(y1, y2) && y < Math.max(y1, y2)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.ceil(xs[i] - 0.5));
        const to = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = from; x <= to; x++) mask[row * w + x] = 1;
      }
    }
  }
  return mask;
}

/**
 * Keep only pixels at least `r` pixels from any non-water pixel (and from the edge).
 * Two-pass chamfer distance transform (3-4 weights, i.e. distances in thirds of a pixel).
 */
export function erode(mask, w, h, r) {
  const INF = 1e9;
  const d = new Int32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  const out = new Uint8Array(w * h);
  const limit = r * 3;
  for (let i = 0; i < d.length; i++) out[i] = d[i] >= limit ? 1 : 0;
  return out;
}

/** Longest straight line of set pixels, over all directions. Returns pixel endpoints and length. */
export function longestChord(mask, w, h, stepDeg = 3) {
  const cx = w / 2;
  const cy = h / 2;
  const D = Math.ceil(Math.hypot(w, h) / 2) + 1;
  let best = null;
  for (let deg = 0; deg < 180; deg += stepDeg) {
    const t = (deg * Math.PI) / 180;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    for (let o = -D; o <= D; o++) {
      const bx = cx - o * dy;
      const by = cy + o * dx;
      let run = 0;
      for (let s = -D; s <= D; s++) {
        const x = Math.round(bx + s * dx);
        const y = Math.round(by + s * dy);
        if (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x]) {
          run++;
          if (!best || run > best.lengthPx) best = { lengthPx: run, a: [bx + (s - run + 1) * dx, by + (s - run + 1) * dy], b: [bx + s * dx, by + s * dy] };
        } else run = 0;
      }
    }
  }
  return best;
}

/**
 * Fill isolated dry pixels: a non-water pixel inside the outline with at least 6 of its
 * 8 neighbours water is treated as water. Removes salt-and-pepper misses (boats, glint,
 * mixed pixels) without bridging real gaps such as exposed bars or islands.
 */
export function fillGaps(mask, inside, w, h) {
  const out = Uint8Array.from(mask);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i] || !inside[i]) continue;
      const n = mask[i - 1] + mask[i + 1] + mask[i - w] + mask[i + w] + mask[i - w - 1] + mask[i - w + 1] + mask[i + w - 1] + mask[i + w + 1];
      if (n >= 6) out[i] = 1;
    }
  return out;
}
