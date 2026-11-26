// Depth from water level, without a bathymetric survey.
//
// The idea: water does not move sideways when a reservoir falls. Whatever was still
// under water when the surface stood D metres lower than it does today is, today, under
// at least D metres of water. So if a satellite image taken at that lower level shows a
// straight run of water, then today that same run is at least D deep.
//
// For each observation this gives a run that is KNOWN to be at least `minDepthM` deep:
// the longest run seen on any date when the gauge read at least `minDepthM` lower.
// It is a guaranteed minimum, not an estimate of the true depth, and it says nothing
// for dates within `minDepthM` of the lowest level on record: there the answer is
// "not known", which is different from "too shallow".

/**
 * @param {{date: string, run_m: number, level_m?: number | null}[]} series observations of one reservoir
 * @param {number} minDepthM depth an aircraft needs
 * @returns {{deep_run_m: number | null, deep_ref: string | null}[]} one entry per observation, in order.
 *   deep_run_m is null where no observation exists at a level low enough to say anything.
 */
export function knownDeepRuns(series, minDepthM) {
  const gauged = series.filter((o) => typeof o.level_m === 'number');
  return series.map((today) => {
    if (typeof today.level_m !== 'number') return { deep_run_m: null, deep_ref: null };
    let best = null;
    for (const earlier of gauged) {
      if (earlier.level_m > today.level_m - minDepthM) continue; // not low enough to prove the depth
      if (!best || earlier.run_m > best.run_m) best = earlier;
    }
    // The run cannot be longer than the water present today.
    return best ? { deep_run_m: Math.min(best.run_m, today.run_m), deep_ref: best.date } : { deep_run_m: null, deep_ref: null };
  });
}
