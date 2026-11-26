// The hero: real satellite stills, cross-faded, each with one line of the story.
// A drawn aircraft crosses the water or the fire; the page states that it is an illustration.
import { el, prefersReducedMotion } from '../plan/dom.ts';
import { longDate } from '../plan/format.ts';

export interface ShotMeta {
  name: string;
  file: string;
  place: string;
  note: string;
  date: string;
}

interface StoryBeat {
  /** Which still, by name in shots.json. */
  shot: string;
  line: string;
  /** Where the aircraft enters and leaves, in the image's own 1920 x 1080 pixel frame, so it stays over the water whatever the screen shape. */
  flight?: { from: [number, number]; to: [number, number]; trail: 'wake' | 'drop' };
}

const STORY: StoryBeat[] = [
  { shot: 'okanagan-clear', line: 'Scoopers refill by skimming a lake.', flight: { from: [1330, 40], to: [1040, 560], trail: 'wake' } },
  { shot: 'culebra-fire', line: 'The closer the water, the more loads an hour.', flight: { from: [330, 150], to: [760, 640], trail: 'drop' } },
  { shot: 'baells-full', line: 'But a reservoir is not always full.', flight: { from: [770, 60], to: [1000, 740], trail: 'wake' } },
  { shot: 'baells-low', line: 'In April 2023 this one was closed to scoopers.' },
];

const SHOT_MS = 6800;
const NS = 'http://www.w3.org/2000/svg';

/** A scooper seen from above, pointing up: fuselage, high wing, two engines, tailplane. */
function planeShape(): SVGGElement {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'plane-body');
  const parts: [x: number, y: number, w: number, h: number, r: number][] = [
    [-4.5, -36, 9, 66, 4.5],
    [-42, -12, 84, 10, 3],
    [-19, -19, 6, 13, 2],
    [13, -19, 6, 13, 2],
    [-14, 22, 28, 7, 2.5],
  ];
  for (const [x, y, w, h, r] of parts) {
    const rect = document.createElementNS(NS, 'rect');
    for (const [name, value] of Object.entries({ x, y, width: w, height: h, rx: r })) rect.setAttribute(name, String(value));
    g.append(rect);
  }
  return g;
}

function flightOverlay({ from, to, trail }: NonNullable<StoryBeat['flight']>): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1920 1080');
  svg.setAttribute('preserveAspectRatio', 'none');

  const flight = document.createElementNS(NS, 'g');
  flight.setAttribute('class', 'flight');
  flight.style.setProperty('--x0', `${from[0]}px`);
  flight.style.setProperty('--y0', `${from[1]}px`);
  flight.style.setProperty('--x1', `${to[0]}px`);
  flight.style.setProperty('--y1', `${to[1]}px`);

  // The drawing points up, so add a quarter turn to the direction of travel.
  const heading = (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI + 90;
  const turned = document.createElementNS(NS, 'g');
  turned.setAttribute('transform', `rotate(${heading.toFixed(1)})`);

  const tail = document.createElementNS(NS, 'rect');
  tail.setAttribute('class', `trail ${trail}`);
  for (const [name, value] of Object.entries({ x: -7, y: 30, width: 14, height: trail === 'wake' ? 170 : 120, rx: 7 })) tail.setAttribute(name, String(value));

  const shadow = document.createElementNS(NS, 'g');
  shadow.setAttribute('class', 'shadow');
  shadow.setAttribute('transform', 'translate(10 14)');
  shadow.append(planeShape());

  turned.append(tail, shadow, planeShape());
  flight.append(turned);
  svg.append(flight);
  return svg;
}

export function initHero(shots: ShotMeta[]): void {
  const byName = new Map(shots.map((s) => [s.name, s]));
  const stage = el('shots');
  const dots = el('shot-dots');
  const line = el('hero-line');
  const credit = el('shot-credit');
  const reduced = prefersReducedMotion();

  const frames: { element: HTMLElement; line: string; credit: string }[] = [];
  for (const beat of STORY) {
    const meta = byName.get(beat.shot);
    if (!meta) continue;
    const shot = document.createElement('div');
    shot.className = 'shot';
    const frame = document.createElement('div');
    frame.className = 'frame';
    const image = new Image();
    image.src = `/hero/${meta.file}`;
    image.alt = '';
    if (frames.length) image.loading = 'lazy';
    frame.append(image);
    if (beat.flight) frame.append(flightOverlay(beat.flight));
    shot.append(frame);
    stage.append(shot);
    frames.push({ element: shot, line: beat.line, credit: `${meta.place} · ${longDate(meta.date)} · ${meta.note}` });

    const index = frames.length - 1;
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Image ${index + 1} of ${STORY.length}: ${meta.place}`);
    dot.addEventListener('click', () => show(index, true));
    dots.append(dot);
  }
  if (!frames.length) return;

  let timer = 0;
  function show(index: number, chosenByVisitor = false): void {
    const current = ((index % frames.length) + frames.length) % frames.length;
    frames.forEach((f, k) => f.element.classList.toggle('on', k === current));
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === current));
    const frame = frames[current];
    if (!frame) return;

    line.classList.remove('in');
    void line.offsetWidth; // restart the fade for the new line
    line.textContent = frame.line;
    line.classList.add('in');
    credit.textContent = frame.credit;

    clearTimeout(timer);
    // With reduced motion the images change only when the visitor asks.
    if (!reduced) timer = window.setTimeout(() => show(current + 1), chosenByVisitor ? SHOT_MS * 1.6 : SHOT_MS);
  }
  show(0);
}
