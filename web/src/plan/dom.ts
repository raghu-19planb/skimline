import type { SafeHtml } from './format.ts';

/** An element that the page's markup guarantees. Throws a clear error if the markup changes. */
export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

/** The only place markup is assigned to the page; it accepts nothing but escaped markup. */
export function setHtml(target: Element, markup: SafeHtml): void {
  target.innerHTML = markup.value;
}

/** A button built from escaped markup. */
export function button(markup: SafeHtml, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  setHtml(btn, markup);
  btn.addEventListener('click', onClick);
  return btn;
}

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
