// Step 7 — join official water levels to the satellite observations, and work out how
// much of each run is known to be deep enough.
//
// For every observed reservoir that has a gauge listed in regions.mjs this adds, to each
// observation: the water surface elevation and percent of capacity on that day, and the
// run known to be at least MIN_DEPTH_M deep (see lib/depth.mjs). It also stores the
// reservoir's monthly fill since the gauge record begins.
//
// Usage: node 07-levels.mjs <region-id>
// Rewrites: ../web/public/data/<region-id>-observed.json
import { readFileSync, writeFileSync } from 'node:fs';
import { GAUGES } from './regions.mjs';
import { knownDeepRuns } from './lib/depth.mjs';

/** Minimum depth for multi-engine scoopers: 6 ft (NWCG PMS 518, 2026). */
const MIN_DEPTH_M = 1.8;
const UA = { 'User-Agent': 'open-water-research-pipeline/0.1' };

const id = process.argv[2];
const gauges = GAUGES[id];
if (!gauges) throw new Error(`No gauges are listed for region "${id}" in regions.mjs`);
const path = `../web/public/data/${id}-observed.json`;
const observed = JSON.parse(readFileSync(path, 'utf8'));

/** Daily readings for one station of the Catalan Water Agency's open dataset. */
async function acaDaily(station) {
  const where = encodeURIComponent(`estaci='${station.replace(/'/g, "''")}'`);
  const url = `https://analisi.transparenciacatalunya.cat/resource/gn9e-3qhr.json?$select=dia,nivell_absolut,percentatge_volum_embassat&$where=${where}&$order=dia&$limit=50000`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`gauge request failed: HTTP ${res.status}`);
  const rows = await res.json();
  return rows
    .map((r) => ({ date: r.dia.slice(0, 10), level_m: Number(r.nivell_absolut), fill_pct: Number(r.percentatge_volum_embassat) }))
    .filter((r) => Number.isFinite(r.level_m) && Number.isFinite(r.fill_pct));
}

/** Mean fill per calendar month: [['2000-01', 78.2], ...]. */
function monthlyFill(daily) {
  const months = new Map();
  for (const r of daily) {
    const key = r.date.slice(0, 7);
    const m = months.get(key) ?? { sum: 0, n: 0 };
    m.sum += r.fill_pct;
    m.n++;
    months.set(key, m);
  }
  return [...months].map(([month, m]) => [month, Math.round((m.sum / m.n) * 10) / 10]);
}

let joined = 0;
for (const reservoir of observed.reservoirs) {
  const gauge = gauges.find((g) => g.match.test(reservoir.name ?? ''));
  if (!gauge) continue;
  const daily = await acaDaily(gauge.station);
  const byDate = new Map(daily.map((r) => [r.date, r]));
  for (const o of reservoir.series) {
    const reading = byDate.get(o.date);
    o.level_m = reading ? reading.level_m : null;
    o.fill_pct = reading ? reading.fill_pct : null;
  }
  knownDeepRuns(reservoir.series, MIN_DEPTH_M).forEach((d, i) => Object.assign(reservoir.series[i], d));
  reservoir.gauge = { station: gauge.station, source: gauge.source, first: daily[0]?.date ?? null, last: daily.at(-1)?.date ?? null };
  reservoir.fill_history = monthlyFill(daily);
  joined++;
  const known = reservoir.series.filter((o) => o.deep_run_m !== null);
  console.log(
    `${reservoir.name}: ${reservoir.series.filter((o) => o.level_m !== null).length}/${reservoir.series.length} observations gauged, ` +
      `${known.length} with a known-deep run (${known.length ? Math.min(...known.map((o) => o.deep_run_m)) : '–'} m at least), ` +
      `${reservoir.fill_history.length} months of fill history`,
  );
}

observed.meta.depth = {
  min_depth_m: MIN_DEPTH_M,
  method:
    'Water still present when the gauge read at least the minimum depth lower is, on a later date, under at least that depth. ' +
    'The known-deep run is the longest run observed on any such lower date. Unknown where no lower observation exists.',
};
writeFileSync(path, JSON.stringify(observed));
console.log(`${id}: levels joined for ${joined} reservoirs`);
