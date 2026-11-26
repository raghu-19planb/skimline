import assert from 'node:assert/strict';
import test from 'node:test';
import { CLASSES, classOf, distToRun, dropsPerHour, frameFor, litresPerHour, nearest, toLonLat, toXY, turnaroundMin } from '../src/plan/model.ts';
import type { Run } from '../src/plan/model.ts';

const KM_PER_MILE = 1.609344;
const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

test('turnaround reproduces every row of the published table', () => {
  const table: [miles: number, minutes: number][] = [
    [0, 1.5],
    [1, 3],
    [3, 4],
    [6, 6],
    [10, 9],
    [15, 12],
  ];
  for (const [miles, minutes] of table) close(turnaroundMin(miles * KM_PER_MILE), minutes);
});

test('turnaround interpolates between rows and continues the last slope beyond them', () => {
  close(turnaroundMin(2 * KM_PER_MILE), 3.5); // half-way between the 1- and 3-mile rows
  close(turnaroundMin(20 * KM_PER_MILE), 15); // 12 min at 15 miles, then 0.6 min per mile
});

test('turnaround never decreases with distance', () => {
  let previous = 0;
  for (let km = 0; km <= 60; km += 0.5) {
    const minutes = turnaroundMin(km);
    assert.ok(minutes >= previous, `dropped at ${km} km`);
    previous = minutes;
  }
});

test('loads and litres per hour follow from minutes per load', () => {
  close(dropsPerHour(6), 10);
  close(litresPerHour(6), 61370);
});

test('classes cover every duration and their bounds are inclusive', () => {
  assert.equal(classOf(0), 0);
  assert.equal(classOf(4), 0);
  assert.equal(classOf(4.01), 1);
  assert.equal(classOf(12), 3);
  assert.equal(classOf(500), CLASSES.length - 1);
});

test('local frame round-trips and measures a degree of latitude correctly', () => {
  const frame = frameFor([-8, 41, -6, 43]);
  const [x, y] = toXY(frame, -7.25, 42.4);
  const [lon, lat] = toLonLat(frame, x, y);
  close(lon, -7.25, 1e-9);
  close(lat, 42.4, 1e-9);
  const [, oneDegreeNorth] = toXY(frame, -8, 42);
  close(oneDegreeNorth, 110.54, 1e-9);
});

test('distance to a run is to its nearest point, clamped to its ends', () => {
  const run: Run = { ax: 0, ay: 0, bx: 10, by: 0, body: 0, lengthM: 10000 };
  assert.deepEqual(distToRun(5, 3, run), { d: 3, x: 5, y: 0 }); // beside the middle
  assert.deepEqual(distToRun(-4, 3, run), { d: 5, x: 0, y: 0 }); // past the start
  assert.deepEqual(distToRun(13, 4, run), { d: 5, x: 10, y: 0 }); // past the end
});

test('nearest picks the closest run and reports none for an empty list', () => {
  const far: Run = { ax: 100, ay: 100, bx: 110, by: 100, body: 0, lengthM: 10000 };
  const near: Run = { ax: 0, ay: 2, bx: 10, by: 2, body: 1, lengthM: 10000 };
  const hit = nearest(5, 0, [far, near]);
  assert.equal(hit?.run.body, 1);
  close(hit?.distKm ?? NaN, 2);
  assert.equal(nearest(5, 0, []), null);
});
