import assert from 'node:assert/strict';
import test from 'node:test';
import { levelFinding, levelStatus, measure, reservoirRows, runsFor, slowestLargeFires, summarise, usableRuns } from '../src/plan/analysis.ts';
import { CLASSES } from '../src/plan/model.ts';
import { assembleRegion } from '../src/plan/region.ts';
import type { FeatureCollection, FireProps, MultiPolygonGeometry, ObservedFile, Observation, RegionInfo, WaterProps } from '../src/plan/types.ts';

// A one-degree box with two water bodies and two fires.
//   "Long"  : a 2,000 m run in the middle; observed from space, down to 900 m at its driest.
//   "Short" : a 1,000 m run; never usable at the default threshold.
//   Fire A  : 600 ha, on top of "Long".     Fire B: 400 ha, about 37 km away.
const info: RegionInfo = {
  id: 'test',
  name: 'Test region',
  country: 'ES',
  bbox: [0, 0, 1, 1],
  note: '',
  water: { file: '', count: 2, inputPolygons: 2, source: '', fetched: '2026-01-01T00:00:00Z' },
  fires: null,
  observed: null,
};

const square = (lon: number, lat: number, size = 0.01): MultiPolygonGeometry => ({
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [lon - size, lat - size],
        [lon + size, lat - size],
        [lon + size, lat + size],
        [lon - size, lat + size],
        [lon - size, lat - size],
      ],
    ],
  ],
});

const waterBody = (id: string, run_m: number, lon: number): FeatureCollection<WaterProps>['features'][number] => ({
  type: 'Feature',
  properties: { id, name: id, kind: 'reservoir', area_km2: 1, run_m, bearing: 90, run: [lon, 0.5, lon + 0.02, 0.5] },
  geometry: { type: 'Polygon', coordinates: [] },
});

const observation = (date: string, run_m: number, water_share: number): Observation => ({
  date,
  scene: date,
  run_m,
  line: [0.5, 0.5, 0.51, 0.5],
  water_share,
});

function build() {
  const water: FeatureCollection<WaterProps> = { type: 'FeatureCollection', features: [waterBody('Long', 2000, 0.5), waterBody('Short', 1000, 0.3)] };
  const fires: FeatureCollection<FireProps, MultiPolygonGeometry> = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { year: 2022, ha: 600, cause: null, place: 'A' }, geometry: square(0.5, 0.5) },
      { type: 'Feature', properties: { year: 2023, ha: 400, cause: null, place: 'B' }, geometry: square(0.75, 0.75) },
    ],
  };
  const observed: ObservedFile = {
    meta: { source: 'test', years: [2021, 2025] },
    reservoirs: [
      {
        id: 'Long',
        name: 'Long',
        mapped_run_m: 2000,
        series: [
          observation('2021-01-01', 2000, 0.95),
          observation('2021-02-01', 1900, 0.9),
          observation('2021-03-01', 1700, 0.3),
          observation('2021-04-01', 900, 0.4),
          observation('2021-05-01', 1950, 0.92),
          observation('2021-06-01', 2000, 0.96),
        ],
      },
    ],
  };
  return assembleRegion(info, water, fires, observed);
}

const mapped = { threshold: 1852, width: 0, scenario: 'mapped' } as const;
const dry = { threshold: 1852, width: 0, scenario: 'dry' } as const;

test('only runs at least as long as the threshold are usable', () => {
  const region = build();
  assert.deepEqual(
    usableRuns(region, mapped).map((r) => r.body),
    [0],
  );
  assert.equal(usableRuns(region, { threshold: 1000, width: 0, scenario: 'mapped' }).length, 2);
  assert.equal(usableRuns(region, { threshold: 2001, width: 0, scenario: 'mapped' }).length, 0);
});

test('the dry scenario puts an observed reservoir at its driest month', () => {
  const region = build();
  assert.equal(region.dryRuns[0]?.[0]?.lengthM, 900);
  assert.equal(region.dryRuns[0]?.[1]?.lengthM, 1000, 'an unobserved water body is unchanged');
  assert.equal(usableRuns(region, dry).length, 0);
  assert.equal(region.water.features[0]?.properties.d0, 900, 'the flat copy the map filters by');
  assert.equal(region.water.features[0]?.properties.r0, 2000);
});

test('the record keeps the shortest run and the least water surface separately', () => {
  const record = build().observed.get(0);
  assert.equal(record?.driest[0]?.date, '2021-04-01');
  assert.equal(record?.lowestSurface.date, '2021-03-01');
});

test('a reservoir with too few clear months is not treated as observed', () => {
  const water: FeatureCollection<WaterProps> = { type: 'FeatureCollection', features: [waterBody('Long', 2000, 0.5)] };
  const few: ObservedFile = {
    meta: { source: 'test', years: [2021, 2021] },
    reservoirs: [{ id: 'Long', name: 'Long', mapped_run_m: 2000, series: [observation('2021-01-01', 500, 0.2)] }],
  };
  const region = assembleRegion(info, water, null, few);
  assert.equal(region.observed.size, 0);
  assert.equal(region.dryRuns[0]?.[0]?.lengthM, 2000);
});

test('measuring a spot on the run gives the minimum turnaround', () => {
  const region = build();
  const access = measure(region, mapped, 0.51, 0.5);
  assert.ok(access);
  assert.ok(access.distKm < 0.01);
  assert.ok(Math.abs(access.minutes - 1.5) < 0.01);
  assert.equal(measure(region, dry, 0.51, 0.5), null, 'no usable water in the dry scenario');
});

test('summary counts sites, classifies every cell, and weights fires by area burned', () => {
  const region = build();
  const summary = summarise(region, mapped, 1);
  assert.equal(summary.usableSites, 1);
  assert.equal(summary.fireCount, 2);
  assert.equal(summary.measuredSites, 2);
  assert.equal(summary.cellClass.length, region.cells.length);
  assert.ok(region.cells.length > 100);
  assert.ok(summary.nearShare > 0 && summary.nearShare < 1);
  // Fire A (600 ha) sits on the water; fire B (400 ha) is about 37 km away.
  assert.ok(Math.abs((summary.burnedFarShare ?? NaN) - 0.4) < 1e-9);
});

test('with no usable water every cell is in the slowest class and all burned area is far', () => {
  const summary = summarise(build(), dry, 1);
  assert.equal(summary.usableSites, 0);
  assert.equal(summary.nearShare, 0);
  assert.equal(summary.burnedFarShare, 1);
  assert.ok(summary.cellClass.every((c) => c === CLASSES.length - 1));
});

test('a region without mapped fires reports no burned-area share', () => {
  const water: FeatureCollection<WaterProps> = { type: 'FeatureCollection', features: [waterBody('Long', 2000, 0.5)] };
  assert.equal(summarise(assembleRegion(info, water, null, null), mapped).burnedFarShare, null);
});

test('only large fires are listed, slowest first', () => {
  const region = build();
  const listed = slowestLargeFires(summarise(region, mapped).fires);
  assert.deepEqual(
    listed.map((f) => f.fire.props.place),
    ['A'],
    'the 400 ha fire is below the listing size',
  );
  const all = slowestLargeFires(summarise(region, dry).fires);
  assert.equal(all[0]?.access, null, 'a fire with no usable water still appears');
});

test('fires outside the analysis area are left out', () => {
  const water: FeatureCollection<WaterProps> = { type: 'FeatureCollection', features: [waterBody('Long', 2000, 0.5)] };
  const edge: FeatureCollection<FireProps, MultiPolygonGeometry> = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { year: 2022, ha: 900, cause: null, place: 'edge' }, geometry: square(0.02, 0.02) }],
  };
  assert.equal(assembleRegion(info, water, edge, null).fireCentres.length, 0);
});

test('reservoir rows count months below the threshold and drop reservoirs too short when full', () => {
  const region = build();
  const [row] = reservoirRows(region, 1852);
  assert.equal(row?.monthsBelow, 2); // 1,700 m and 900 m
  assert.equal(row?.mappedRunM, 2000);
  assert.equal(reservoirRows(region, 2500).length, 0);
});

const gauged = (level_m: number, run_m: number): Observation => ({ ...observation(`level-${level_m}`, run_m, 0.5), level_m, fill_pct: level_m - 500 });

test('a reservoir with no gauge readings has no level finding', () => {
  assert.deepEqual(levelFinding([observation('2021-01-01', 2000, 0.9)], 1852), { kind: 'ungauged' });
});

test('long enough at every level seen: reports the lowest level observed', () => {
  const finding = levelFinding([gauged(600, 2100), gauged(591, 2050), gauged(620, 2500)], 1852);
  assert.equal(finding.kind, 'always');
  assert.equal(finding.kind === 'always' && finding.lowest.level_m, 591);
});

test('too short at every level seen: reports the highest level observed', () => {
  const finding = levelFinding([gauged(770, 900), gauged(803, 1630)], 1852);
  assert.equal(finding.kind, 'never');
  assert.equal(finding.kind === 'never' && finding.highest.level_m, 803);
});

test('the dividing level is the highest at which the run was seen too short', () => {
  // 1,900 m at 580 looks long, but the run was seen too short higher up, at 590: be cautious.
  const finding = levelFinding([gauged(580, 1900), gauged(590, 1500), gauged(596, 1900), gauged(610, 2400)], 1852);
  assert.equal(finding.kind, 'threshold');
  if (finding.kind !== 'threshold') return;
  assert.equal(finding.shortAt.level_m, 590);
  assert.equal(finding.longFrom?.level_m, 596);
});

// ---- clear width ----
// One reservoir measured at two widths. On its mapped outline it is 2,400 m at 100 m wide
// and 2,000 m at 200 m wide. Drawn down, it stays long at 100 m but narrows at 200 m.
function buildWide() {
  const water: FeatureCollection<WaterProps> = {
    type: 'FeatureCollection',
    meta: { widths: [100, 200] },
    features: [
      {
        type: 'Feature',
        properties: {
          id: 'Wide',
          name: 'Wide',
          kind: 'reservoir',
          area_km2: 3,
          run_m: 2400,
          bearing: 90,
          run: [0.5, 0.5, 0.53, 0.5],
          runs_w: [
            [2400, 90, 0.5, 0.5, 0.53, 0.5],
            [2000, 90, 0.5, 0.5, 0.525, 0.5],
          ],
        },
        geometry: { type: 'Polygon', coordinates: [] },
      },
    ],
  };
  const at = (date: string, narrow: number, wide: number, level_m: number): Observation => ({
    date,
    scene: date,
    run_m: narrow,
    line: [0.5, 0.5, 0.52, 0.5],
    water_share: 0.5,
    level_m,
    fill_pct: 50,
    runs_w: [
      [narrow, 0.5, 0.5, 0.52, 0.5],
      [wide, 0.5, 0.5, 0.51, 0.5],
    ],
  });
  const observed: ObservedFile = {
    meta: { source: 'test', years: [2021, 2021], widths: [100, 200] },
    reservoirs: [
      {
        id: 'Wide',
        name: 'Wide',
        mapped_run_m: 2400,
        series: [
          at('2021-01-01', 2400, 2000, 620),
          at('2021-02-01', 2300, 1900, 612),
          at('2021-03-01', 2200, 1600, 604),
          at('2021-04-01', 2150, 1300, 598),
          at('2021-05-01', 2100, 1200, 594),
          at('2021-06-01', 2350, 1950, 616),
        ],
      },
    ],
  };
  return assembleRegion(info, water, null, observed);
}

test('a region carries one set of runs for each clear width', () => {
  const region = buildWide();
  assert.deepEqual(region.widths, [100, 200]);
  assert.equal(region.runs[0]?.[0]?.lengthM, 2400);
  assert.equal(region.runs[1]?.[0]?.lengthM, 2000);
  assert.equal(region.water.features[0]?.properties.r1, 2000);
});

test('a drawn-down reservoir can stay long enough at one width and fail at a wider one', () => {
  const region = buildWide();
  const narrow = { threshold: 1852, width: 0, scenario: 'dry' } as const;
  const wide = { threshold: 1852, width: 1, scenario: 'dry' } as const;
  assert.equal(usableRuns(region, narrow).length, 1, 'still 2,100 m at 100 m wide');
  assert.equal(usableRuns(region, wide).length, 0, 'only 1,200 m at 200 m wide');
  assert.equal(usableRuns(region, { ...wide, scenario: 'mapped' }).length, 1, 'usable at 200 m wide when full');
});

test('months below the threshold and the driest month are counted at the chosen width', () => {
  const region = buildWide();
  assert.equal(reservoirRows(region, 1852, 0)[0]?.monthsBelow, 0);
  const [row] = reservoirRows(region, 1852, 1);
  assert.equal(row?.monthsBelow, 3); // 1,600, 1,300 and 1,200 m
  assert.equal(row?.driest.date, '2021-05-01');
  assert.equal(row?.mappedRunM, 2000);
});

test('the level at which the run is lost depends on the width', () => {
  const { series } = buildWide().observed.get(0) ?? { series: [] };
  assert.equal(levelFinding(series, 1852, 0).kind, 'always');
  const finding = levelFinding(series, 1852, 1);
  assert.equal(finding.kind, 'threshold');
  if (finding.kind !== 'threshold') return;
  assert.equal(finding.shortAt.level_m, 604);
  assert.equal(finding.longFrom?.level_m, 612);
});

test('a reservoir not measured at every width is not treated as observed', () => {
  const water: FeatureCollection<WaterProps> = {
    type: 'FeatureCollection',
    meta: { widths: [100, 200] },
    features: [
      {
        type: 'Feature',
        properties: {
          id: 'Long',
          name: 'Long',
          kind: 'reservoir',
          area_km2: 1,
          run_m: 2000,
          bearing: 90,
          run: [0.5, 0.5, 0.52, 0.5],
          runs_w: [
            [2000, 90, 0.5, 0.5, 0.52, 0.5],
            [1500, 90, 0.5, 0.5, 0.51, 0.5],
          ],
        },
        geometry: { type: 'Polygon', coordinates: [] },
      },
    ],
  };
  // six clear months, but measured before runs were taken at several widths
  const old: ObservedFile = {
    meta: { source: 'test', years: [2021, 2021] },
    reservoirs: [
      { id: 'Long', name: 'Long', mapped_run_m: 2000, series: ['01', '02', '03', '04', '05', '06'].map((m) => observation(`2021-${m}-01`, 900, 0.4)) },
    ],
  };
  const region = assembleRegion(info, water, null, old);
  assert.equal(region.observed.size, 0);
  assert.equal(region.dryRuns[1]?.[0]?.lengthM, 1500, 'falls back to the mapped run');
});

test('the latest state puts an observed reservoir at its most recent image', () => {
  const region = build();
  assert.equal(region.observed.get(0)?.latest.date, '2021-06-01');
  assert.equal(region.latestRuns[0]?.[0]?.lengthM, 2000);
  assert.equal(region.water.features[0]?.properties.l0, 2000);
  assert.equal(usableRuns(region, { threshold: 1852, width: 0, scenario: 'latest' }).length, 1);
  assert.equal(runsFor(region, { scenario: 'dry', width: 0 })[0]?.lengthM, 900);
});

test('a level is judged against the record, and "not known" is kept apart from "too short"', () => {
  const always = levelFinding([gauged(600, 2100), gauged(591, 2050)], 1852);
  assert.equal(levelStatus(always, 605), 'long');
  assert.equal(levelStatus(always, 585), 'below-record');

  const threshold = levelFinding([gauged(590, 1500), gauged(596, 1900), gauged(610, 2400)], 1852);
  assert.equal(levelStatus(threshold, 588), 'short');
  assert.equal(levelStatus(threshold, 593), 'between');
  assert.equal(levelStatus(threshold, 600), 'long');

  const never = levelFinding([gauged(770, 900), gauged(803, 1630)], 1852);
  assert.equal(levelStatus(never, 790), 'short');
  assert.equal(levelStatus(never, 810), 'unknown', 'higher than anything observed');
  assert.equal(levelStatus({ kind: 'ungauged' }, 500), 'unknown');
});

test('with only a handful of fires the burned-area share is withheld, not guessed', () => {
  const summary = summarise(build(), mapped);
  assert.equal(summary.fireCount, 2);
  assert.equal(summary.burnedFarShare, null);
});
