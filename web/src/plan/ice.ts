// Ice. A scooper cannot refill from a frozen surface, so a water body seen frozen in the
// month being planned for is left out of the planning.
//
// What this can and cannot say: the satellite step records ice only for the water bodies
// it measures, and only on clear images. "Frozen" here means seen frozen; a water body
// that was not measured, or a month with no clear image, is unknown, not open.
import type { IceRecord, Observation } from './types.ts';

/**
 * Share of the mapped outline that must be ice or snow for an image to count as frozen.
 * An assumption, set low on purpose: partial ice and broken ice are hazards too.
 */
export const FROZEN_SHARE = 0.1;
/** A water body counts as frozen in a calendar month if it was in at least this share of the years seen. */
export const FROZEN_YEARS_SHARE = 0.5;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const MONTHS_SHORT = MONTHS.map((name) => name.slice(0, 3));

/** True if this image showed enough ice to rule out scooping. */
export const isFrozen = (o: Observation): boolean => typeof o.ice_share === 'number' && o.ice_share >= FROZEN_SHARE;

/**
 * Whether a water body is frozen in a calendar month (January = 0), judged over the
 * years observed. Null means it cannot be said: ice was not checked, or no clear image
 * exists for that month.
 */
export function frozenIn(ice: IceRecord | null, month: number): boolean | null {
  const tally = ice?.months[month];
  if (!tally || tally.seen === 0) return null;
  return tally.frozen / tally.seen >= FROZEN_YEARS_SHARE;
}

/** The calendar months in which a water body is frozen, as indexes. */
export const frozenMonths = (ice: IceRecord | null): number[] => MONTHS.map((_, month) => month).filter((month) => frozenIn(ice, month) === true);

/**
 * Month indexes as text, with consecutive months joined as a range, wrapping the year:
 * [11, 0, 1, 2] → "Dec to Mar"; [0, 1, 6] → "Jan to Feb, Jul".
 */
export function monthRanges(months: number[]): string {
  if (!months.length) return '';
  if (months.length === 12) return 'all year';
  const frozen = new Set(months);
  // start each run at a month whose predecessor is not in the set
  const starts = months.filter((m) => !frozen.has((m + 11) % 12)).sort((a, b) => a - b);
  // order the runs by their position in a year that begins in July, so a winter reads "Dec to Mar"
  starts.sort((a, b) => ((a + 6) % 12) - ((b + 6) % 12));
  return starts
    .map((start) => {
      let end = start;
      while (frozen.has((end + 1) % 12) && (end + 1) % 12 !== start) end = (end + 1) % 12;
      return end === start ? MONTHS_SHORT[start] : `${MONTHS_SHORT[start]} to ${MONTHS_SHORT[end]}`;
    })
    .join(', ');
}
