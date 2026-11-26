// Today's water level, read straight from the gauge operator's open data when the page
// is open. This is the one part of the site that is current to the day; everything else
// is as fresh as the last pipeline run.
//
// A failure here must never break the page: the readings are an addition, so any error
// simply leaves them out.

export interface LiveReading {
  /** Day of the reading, YYYY-MM-DD. */
  date: string;
  level_m: number;
  fill_pct: number;
}

/** Catalan Water Agency: the most recent rows across all stations (nine stations, so two days' worth). */
const ACA_LATEST = 'https://analisi.transparenciacatalunya.cat/resource/gn9e-3qhr.json?$order=dia%20DESC&$limit=18';
const TIMEOUT_MS = 8000;

interface AcaRow {
  dia: string;
  estaci: string;
  nivell_absolut: string;
  percentatge_volum_embassat: string;
}

let pending: Promise<Map<string, LiveReading>> | null = null;

/** Latest reading for each station, keyed by station name. Fetched once per page view. */
export function liveReadings(): Promise<Map<string, LiveReading>> {
  pending ??= fetch(ACA_LATEST, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then((response) => (response.ok ? (response.json() as Promise<AcaRow[]>) : []))
    .then((rows) => {
      const latest = new Map<string, LiveReading>();
      for (const row of rows) {
        const reading = { date: row.dia.slice(0, 10), level_m: Number(row.nivell_absolut), fill_pct: Number(row.percentatge_volum_embassat) };
        if (!Number.isFinite(reading.level_m) || !Number.isFinite(reading.fill_pct)) continue;
        // rows arrive newest first, so the first one seen for a station is its latest
        if (!latest.has(row.estaci)) latest.set(row.estaci, reading);
      }
      return latest;
    })
    .catch(() => new Map<string, LiveReading>());
  return pending;
}
