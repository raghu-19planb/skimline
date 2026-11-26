// Home page entry.
import '../styles/home.css';
import { el, prefersReducedMotion, setHtml } from '../plan/dom.ts';
import { fmt, html } from '../plan/format.ts';
import type { Manifest } from '../plan/types.ts';
import { initCompare } from './compare.ts';
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
  if (planned.length) setHtml(el('planned'), html`<b>Planned next:</b> ${planned.map((p) => p.name).join(' · ')}`);
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

getJson<{ shots: ShotMeta[] }>('/hero/shots.json')
  .then(({ shots }) => {
    initHero(shots);
    initCompare(
      shots.find((s) => s.name === 'baells-full'),
      shots.find((s) => s.name === 'baells-low'),
    );
  })
  .catch(console.error);

getJson<Manifest>('/data/manifest.json').then(showCoverage).catch(console.error);
