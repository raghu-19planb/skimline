// Home page entry.
import '../styles/home.css';
import { el, prefersReducedMotion, setHtml } from '../plan/dom.ts';
import { fmt, html } from '../plan/format.ts';
import type { Manifest } from '../plan/types.ts';
import { initCompare } from './compare.ts';
import type { RecordMeta } from './compare.ts';
import { initHero } from './hero.ts';
import type { ShotMeta } from './hero.ts';
import { initPlayer } from './player.ts';

// A shared link such as /?region=es-catalonia or /?tour=1 used to open the map directly.
// Keep those working now that planning has its own page.
{
  const query = new URLSearchParams(location.search);
  if (query.has('region') || query.has('tour')) location.replace(`/plan.html?${query}`);
}

const COUNTRY: Record<string, string> = { ES: 'Spain', CA: 'Canada', PT: 'Portugal' };

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

// ---------- content fades up as it scrolls into view ----------
const revealer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('seen');
      revealer.unobserve(entry.target);
    }
  },
  { threshold: 0.18, rootMargin: '0px 0px -6% 0px' },
);
function reveal(element: Element): void {
  if (prefersReducedMotion()) element.classList.add('seen');
  else revealer.observe(element);
}

// ---------- numbers and regions, from the same manifest the planning page reads ----------
function showCoverage(manifest: Manifest): void {
  el('n-regions').textContent = String(manifest.regions.length);
  el('n-water').textContent = fmt(manifest.regions.reduce((sum, r) => sum + r.water.count, 0));
  el('n-fires').textContent = fmt(manifest.regions.reduce((sum, r) => sum + (r.fires?.count ?? 0), 0));

  const cards = el('region-cards');
  manifest.regions.forEach((region, i) => {
    const card = document.createElement('a');
    card.className = 'region-card reveal';
    card.href = `/plan.html?region=${encodeURIComponent(region.id)}`;
    card.style.setProperty('--d', `${i * 110}ms`);
    setHtml(
      card,
      html`<span class="where">${COUNTRY[region.country] ?? region.country}</span>
        <h3>${region.name.replace(/, (Spain|Canada)$/, '')}</h3>
        <p>${region.note}</p>
        <span class="go">Start planning here →</span>`,
    );
    cards.append(card);
    reveal(card);
  });

  const planned = manifest.planned ?? [];
  showRegionMenu(manifest);
  if (planned.length) setHtml(el('planned'), html`<b>Planned next:</b> ${planned.map((p) => p.name).join(' · ')}`);
}

/** "Spain", "Spain and Canada", "Spain, Canada and Portugal". */
const listOf = (names: string[]): string => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * The drop-down in the hero: every region that is live, grouped by country, then the
 * ones in the queue, marked "coming soon" so a visitor can see their area is on the way.
 */
function showRegionMenu(manifest: Manifest): void {
  const planned = manifest.planned ?? [];
  const countries = [...new Set([...manifest.regions, ...planned].map((r) => r.country))];
  const liveCountries = [...new Set(manifest.regions.map((r) => r.country))].map((code) => COUNTRY[code] ?? code);
  el('hook-live').textContent = `Live now for ${listOf(liveCountries)}.`;

  const short = (name: string) => name.replace(/, (Spain|Canada)$/, '');
  setHtml(
    el('region-menu-list'),
    html`${countries.map(
      (code) =>
        html`<p class="country">${COUNTRY[code] ?? code}</p>
          ${manifest.regions
            .filter((r) => r.country === code)
            .map((r) => html`<a href="/plan.html?region=${encodeURIComponent(r.id)}"><span>${short(r.name)}</span><em class="live-tag">live</em></a>`)}
          ${planned.filter((r) => r.country === code).map((r) => html`<span class="soon"><span>${short(r.name)}</span><em>coming soon</em></span>`)}`,
    )}`,
  );

  // close the menu when the visitor clicks elsewhere or presses Escape
  const menu = el<HTMLDetailsElement>('region-menu');
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') menu.open = false;
  });
}

// ---------- boot ----------
document.querySelectorAll('.reveal').forEach(reveal);
// the five steps arrive one after another
document.querySelectorAll<HTMLElement>('.steps li').forEach((step, i) => step.style.setProperty('--d', `${i * 140}ms`));

// The bar is clear over the hero image and turns solid once the page scrolls past it.
const nav = document.querySelector('.nav');
const tintNav = () => nav?.classList.toggle('solid', window.scrollY > window.innerHeight * 0.6);
window.addEventListener('scroll', tintNav, { passive: true });
tintNav();

initPlayer();

getJson<{ shots: ShotMeta[]; record?: RecordMeta }>('/hero/shots.json')
  .then(({ shots, record }) => {
    initHero(shots);
    initCompare(
      shots.find((s) => s.name === 'baells-full'),
      shots.find((s) => s.name === 'baells-low'),
      record,
    );
  })
  .catch(console.error);

getJson<Manifest>('/data/manifest.json').then(showCoverage).catch(console.error);
