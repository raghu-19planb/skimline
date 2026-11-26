// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { knownDeepRuns } from '../lib/depth.mjs';

const series = [
  { date: '2023-01-01', run_m: 2500, level_m: 620 },
  { date: '2023-06-01', run_m: 2200, level_m: 605 },
  { date: '2023-09-01', run_m: 2100, level_m: 598 },
  { date: '2024-03-01', run_m: 2050, level_m: 591 }, // lowest on record
];

test('the run seen at a level at least the required depth lower is known to be that deep today', () => {
  const [high, mid, low] = knownDeepRuns(series, 1.8);
  assert.deepEqual(high, { deep_run_m: 2200, deep_ref: '2023-06-01' }); // best of the three lower dates
  assert.deepEqual(mid, { deep_run_m: 2100, deep_ref: '2023-09-01' });
  assert.deepEqual(low, { deep_run_m: 2050, deep_ref: '2024-03-01' });
});

test('at the lowest level on record nothing is known, which is not the same as too shallow', () => {
  const result = knownDeepRuns(series, 1.8);
  assert.deepEqual(result[3], { deep_run_m: null, deep_ref: null });
});

test('a date less than the required depth above another proves nothing from it', () => {
  const close = [
    { date: 'a', run_m: 900, level_m: 100 },
    { date: 'b', run_m: 1000, level_m: 101 }, // only 1 m above 'a'
    { date: 'c', run_m: 1100, level_m: 102 }, // 2 m above 'a', 1 m above 'b'
  ];
  const result = knownDeepRuns(close, 1.8);
  assert.equal(result[1].deep_run_m, null);
  assert.deepEqual(result[2], { deep_run_m: 900, deep_ref: 'a' });
});

test('the known-deep run never exceeds the water present today', () => {
  // A noisy image on the higher date measured a shorter run than a lower date did.
  const noisy = [
    { date: 'low', run_m: 2000, level_m: 590 },
    { date: 'high', run_m: 1500, level_m: 600 },
  ];
  assert.equal(knownDeepRuns(noisy, 1.8)[1].deep_run_m, 1500);
});

test('observations without a gauge reading are left unknown and never used as evidence', () => {
  const mixed = [
    { date: 'a', run_m: 3000 },
    { date: 'b', run_m: 2000, level_m: 590 },
    { date: 'c', run_m: 2400, level_m: 600 },
  ];
  const result = knownDeepRuns(mixed, 1.8);
  assert.equal(result[0].deep_run_m, null);
  assert.deepEqual(result[2], { deep_run_m: 2000, deep_ref: 'b' });
});
