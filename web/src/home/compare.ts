// Drag-to-compare: the same reservoir on two dates. The control is a real range input
// laid over the picture, so it works with a mouse, a finger and the arrow keys alike.
import { el, prefersReducedMotion, setHtml } from '../plan/dom.ts';
import { html, longDate, monthYear } from '../plan/format.ts';
import type { ShotMeta } from './hero.ts';

/** How long the reservoir's satellite record is, as written by the pipeline. */
export interface RecordMeta {
  reservoir: string;
  months: number;
  first: string;
  last: string;
}

export function initCompare(full: ShotMeta | undefined, low: ShotMeta | undefined, record?: RecordMeta): void {
  if (record) {
    el('record-note').textContent =
      `Skimline has measured this reservoir in ${record.months} clear months, from ${monthYear(record.first)} to ${monthYear(record.last)}.`;
  }
  const box = el('compare');
  const slider = box.querySelector<HTMLInputElement>('input');
  if (!slider) return;

  const set = (percent: number) => box.style.setProperty('--pos', `${percent}%`);
  slider.addEventListener('input', () => set(Number(slider.value)));

  if (full) setHtml(el('cap-full'), html`<b>${longDate(full.date)}</b>${full.note}`);
  if (low) setHtml(el('cap-low'), html`<b>${longDate(low.date)}</b>${low.note}`);

  // The first time it scrolls into view, sweep once so it is obvious the picture can be dragged.
  if (prefersReducedMotion()) return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const duration = 2200;
      let touched = false;
      slider.addEventListener('pointerdown', () => (touched = true), { once: true });
      const tick = (now: number) => {
        if (touched) return;
        const t = Math.min(1, (now - start) / duration);
        const position = 50 + 26 * Math.sin(t * 2 * Math.PI) * (1 - t * 0.35);
        slider.value = String(position);
        set(position);
        if (t < 1) requestAnimationFrame(tick);
        else {
          slider.value = '50';
          set(50);
        }
      };
      requestAnimationFrame(tick);
    },
    { threshold: 0.55 },
  );
  observer.observe(box);
}
