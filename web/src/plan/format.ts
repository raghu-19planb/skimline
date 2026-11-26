// Text formatting and safe HTML building. No DOM access, so it can be unit-tested.

const LOCALE = 'en-CA';

/** A number with thousands separators and a fixed count of decimals. */
export const fmt = (n: number, decimals = 0): string => n.toLocaleString(LOCALE, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });

/** A share (0–1) as a whole-number percentage, e.g. "42%". */
export const pct = (share: number): string => `${fmt(share * 100)}%`;

/** Latitude then longitude in decimal degrees, five places (about one metre), with hemisphere letters. */
export const coord = (lat: number, lon: number): string =>
  `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;

/** "2023-04-02" → "Apr 2023". Dates from the pipeline are UTC calendar days. */
export const monthYear = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2023-04-02" → "April 2, 2023". */
export const longDate = (isoDate: string): string =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A compass bearing as three digits, e.g. 7 → "007°". */
export const bearing = (degrees: number): string => `${String(Math.round(degrees)).padStart(3, '0')}°`;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);

/** Markup that is already safe to insert. Only `html` and `raw` create one. */
export class SafeHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString(): string {
    return this.value;
  }
}

/** Marks markup written in this codebase as safe. Never pass it text that came from data. */
export const raw = (markup: string): SafeHtml => new SafeHtml(markup);

type Part = string | number | SafeHtml | null | undefined | false | Part[];
const render = (part: Part): string => {
  if (part === null || part === undefined || part === false) return '';
  if (part instanceof SafeHtml) return part.value;
  if (Array.isArray(part)) return part.map(render).join('');
  return escapeHtml(String(part));
};

/**
 * Template tag for building markup. Every interpolated value is escaped unless it is
 * itself the result of `html` or `raw`, so names that come from open data (place names,
 * water-body names) can never inject markup.
 */
export function html(strings: TemplateStringsArray, ...values: Part[]): SafeHtml {
  let out = strings[0] ?? '';
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? '');
  });
  return new SafeHtml(out);
}
