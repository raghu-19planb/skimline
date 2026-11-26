// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { longestRun, ringsArea } from '../lib/run.mjs';

const rect = (w, h, x = 0, y = 0) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
const rotate = (ring, deg) => {
  const t = (deg * Math.PI) / 180;
  return ring.map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)]);
};

test('rectangle: run equals its length', () => {
  const run = longestRun([rect(2000, 300)], 100, 3);
  assert.ok(Math.abs(run.length - 2000) < 5, `got ${run.length}`);
  assert.equal(run.bearing, 90); // east–west
});

test('rotated rectangle: found at the right bearing', () => {
  const run = longestRun([rotate(rect(2000, 300), 30)], 100, 3);
  assert.ok(run.length > 1990, `got ${run.length}`);
  assert.equal(run.bearing, 60);
});

test('too narrow for the corridor: no long run', () => {
  // A 3 km channel only 60 m wide cannot hold a 100 m corridor along its length;
  // the only "run" left is the trivial one across it.
  const run = longestRun([rect(3000, 60)], 100, 3);
  assert.ok(run === null || run.length <= 61, `got ${run && run.length}`);
});

test('island in the middle blocks the run', () => {
  // 2000 x 300 lake with a 200 m wide island spanning its full usable width at the centre
  const run = longestRun([rect(2000, 300), rect(200, 280, 900, 10)], 100, 3);
  assert.ok(run.length < 1200, `island ignored, got ${run.length}`);
  assert.ok(run.length > 850, `got ${run.length}`);
});

test('L-shaped reservoir: run is the longer arm, not the bounding diagonal', () => {
  const L = [[0, 0], [1500, 0], [1500, 200], [200, 200], [200, 1000], [0, 1000], [0, 0]];
  const run = longestRun([L], 100, 3);
  assert.ok(run.length > 1450 && run.length < 1560, `got ${run.length}`);
});

test('area subtracts holes', () => {
  assert.equal(ringsArea([rect(100, 100), rect(10, 10, 5, 5)]), 9900);
});
