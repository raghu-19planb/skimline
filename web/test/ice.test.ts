import assert from 'node:assert/strict';
import test from 'node:test';
import { frozenBodies, summarise, usableRuns } from '../src/plan/analysis.ts';
import { FROZEN_SHARE, frozenIn, frozenMonths, isFrozen, monthRanges } from '../src/plan/ice.ts';
import { assembleRegion } from '../src/plan/region.ts';
import type { FeatureCollection, IceRecord, ObservedFile, Observation, RegionInfo, WaterProps } from '../src/plan/types.ts';

const tally = (pairs: Record<number, [seen: number, frozen: number]>): IceRecord => ({
  months: Array.from({ length: 12 }, (_, m) => ({ seen: pairs[m]?.[0] ?? 0, frozen: pairs[m]?.[1] ?? 0 })),
});

test('an image counts as frozen once ice covers the set share of the outline', () => {
  const image = (ice_share?: number): Observation => ({ date: '2024-01-15', scene: 's', run_m: 0, line: null, water_share: 0, ice_share });
  assert.equal(isFrozen(image(FROZEN_SHARE)), true);
  assert.equal(isFrozen(image(FROZEN_SHARE - 0.01)), false);
  assert.equal(isFrozen(image()), false, 'ice not checked is not the same as frozen');
});

test('a month is frozen if it was in at least half the years seen, and unknown if never seen', () => {
  const ice = tally({ 0: [4, 4], 4: [4, 2], 5: [4, 1], 10: [3, 0] });
  assert.equal(frozenIn(ice, 0), true);
  assert.equal(frozenIn(ice, 4), true, 'frozen in two of four Mays');
  assert.equal(frozenIn(ice, 5), false, 'frozen in one of four Junes');
  assert.equal(frozenIn(ice, 10), false);
  assert.equal(frozenIn(ice, 7), null, 'no clear image in any August');
  assert.equal(frozenIn(null, 0), null, 'ice not checked');
  assert.deepEqual(frozenMonths(ice), [0, 4]);
});

test('frozen months read as ranges, with a winter kept in one piece across the new year', () => {
  assert.equal(monthRanges([11, 0, 1, 2, 3, 4]), 'Dec to May');
  assert.equal(monthRanges([0, 1, 2, 3, 4, 11]), 'Dec to May');
  assert.equal(monthRanges([0, 1, 6]), 'Jul, Jan to Feb');
  assert.equal(monthRanges([2]), 'Mar');
  assert.equal(monthRanges([]), '');
  assert.equal(monthRanges([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 'all year');
});

// A region with one mountain lake, long enough to use, frozen every January and open every July.
const info: RegionInfo = {
  id: 'test',
  name: 'Test region',
  country: 'CA',
  bbox: [0, 0, 1, 1],
  note: '',
  water: { file: '', count: 2, inputPolygons: 2, source: '', fetched: '2026-01-01T00:00:00Z' },
  fires: null,
  observed: null,
};
const lake = (id: string, lon: number): FeatureCollection<WaterProps>['features'][number] => ({
  type: 'Feature',
  properties: { id, name: id, kind: 'lake', area_km2: 2, run_m: 2500, bearing: 90, run: [lon, 0.5, lon + 0.025, 0.5] },
  geometry: { type: 'Polygon', coordinates: [] },
});
function build() {
  const water: FeatureCollection<WaterProps> = { type: 'FeatureCollection', features: [lake('Mountain', 0.5), lake('Unchecked', 0.3)] };
  const image = (date: string, ice_share: number): Observation => ({
    date,
    scene: date,
    run_m: ice_share > 0.5 ? 0 : 2500,
    line: [0.5, 0.5, 0.525, 0.5],
    water_share: 1 - ice_share,
    ice_share,
  });
  const observed: ObservedFile = {
    meta: { source: 'test', years: [2022, 2024] },
    reservoirs: [
      {
        id: 'Mountain',
        name: 'Mountain',
        mapped_run_m: 2500,
        series: [
          image('2022-01-10', 0.99),
          image('2022-07-10', 0),
          image('2023-01-12', 1),
          image('2023-07-08', 0),
          image('2024-01-09', 0.98),
          image('2024-07-11', 0),
        ],
      },
    ],
  };
  return assembleRegion(info, water, null, observed);
}
const settings = { threshold: 1852, width: 0, scenario: 'mapped' } as const;

test('the record tallies ice by calendar month', () => {
  const ice = build().observed.get(0)?.ice;
  assert.deepEqual(ice?.months[0], { seen: 3, frozen: 3 });
  assert.deepEqual(ice?.months[6], { seen: 3, frozen: 0 });
  assert.deepEqual(ice?.months[3], { seen: 0, frozen: 0 });
});

test('planning for a month skips water seen frozen in it, and only that water', () => {
  const region = build();
  assert.equal(usableRuns(region, settings).length, 2, 'any time of year: nothing is skipped');
  assert.deepEqual([...frozenBodies(region, 0)], [0]);
  assert.deepEqual(
    usableRuns(region, { ...settings, month: 0 }).map((run) => run.body),
    [1],
    'January: the mountain lake is skipped; the unchecked lake stays, because unknown is not frozen',
  );
  assert.equal(usableRuns(region, { ...settings, month: 6 }).length, 2, 'July: open');
  assert.equal(usableRuns(region, { ...settings, month: 3 }).length, 2, 'April: never seen, so not skipped');
});

test('skipping frozen water changes the headline numbers', () => {
  const region = build();
  assert.equal(summarise(region, settings).usableSites, 2);
  assert.equal(summarise(region, { ...settings, month: 0 }).usableSites, 1);
});

test('a water body measured before ice was recorded has no ice record', () => {
  const water: FeatureCollection<WaterProps> = { type: 'FeatureCollection', features: [lake('Old', 0.5)] };
  const old: ObservedFile = {
    meta: { source: 'test', years: [2022, 2022] },
    reservoirs: [
      {
        id: 'Old',
        name: 'Old',
        mapped_run_m: 2500,
        series: ['01', '02', '03', '04', '05', '06'].map((m) => ({ date: `2022-${m}-10`, scene: m, run_m: 2500, line: null, water_share: 0.9 })),
      },
    ],
  };
  const region = assembleRegion(info, water, null, old);
  assert.equal(region.observed.get(0)?.ice, null);
  assert.equal(frozenBodies(region, 0).size, 0);
});
