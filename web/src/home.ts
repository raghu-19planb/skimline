import './home.css';

// A shared link such as /?region=es-catalonia or /?tour=1 used to open the map directly.
// Keep those working now that the map has its own page.
{
  const q = new URLSearchParams(location.search);
  if (q.has('region') || q.has('tour')) location.replace(`/plan.html?${q}`);
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const dateText = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// ---------- hero: real satellite stills, cross-faded, with a drawn aircraft ----------
interface ShotMeta { name: string; file: string; place: string; note: string; date: string }
/**
 * The story the hero tells, one line per image. Paths are in the image's own pixel
 * frame (1920 x 1080) so the aircraft stays over the water whatever the screen shape.
 */
const STORY: { name: string; line: string; from: [number, number]; to: [number, number]; trail: 'wake' | 'drop' | 'none' }[] = [
  { name: 'okanagan-clear', line: 'Scoopers refill by skimming a lake.', from: [1330, 40], to: [1040, 560], trail: 'wake' },
  { name: 'culebra-fire', line: 'The closer the water, the more loads an hour.', from: [330, 150], to: [760, 640], trail: 'drop' },
  { name: 'baells-full', line: 'But a reservoir is not always full.', from: [770, 60], to: [1000, 740], trail: 'wake' },
  { name: 'baells-low', line: 'In April 2023 this one was closed to scoopers.', from: [0, 0], to: [0, 0], trail: 'none' },
];
const SHOT_MS = 6800;

const PLANE = `<g class="plane-body">
  <rect x="-4.500" y="-36" width="9" height="66" rx="4.500"/>
  <rect x="-42" y="-12" width="84" height="10" rx="3"/>
  <rect x="-19" y="-19" width="6" height="13" rx="2"/><rect x="13" y="-19" width="6" height="13" rx="2"/>
  <rect x="-14" y="22" width="28" height="7" rx="2.500"/>
</g>`;

async function hero() {
  const meta: { shots: ShotMeta[] } = await fetch('/hero/shots.json').then((r) => r.json());
  const byName = new Map(meta.shots.map((s) => [s.name, s]));
  const shots = $('shots');
  const dots = $('shot-dots');
  const frames: HTMLElement[] = [];

  for (const s of STORY) {
    const m = byName.get(s.name);
    if (!m) continue;
    const dx = s.to[0] - s.from[0];
    const dy = s.to[1] - s.from[1];
    const rot = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // the drawing points up
    const el = document.createElement('div');
    el.className = 'shot';
    el.innerHTML = `<div class="frame">
        <img src="/hero/${m.file}" alt="" ${frames.length ? 'loading="lazy"' : ''} />
        ${s.trail === 'none' ? '' : `<svg viewBox="0 0 1920 1080" preserveAspectRatio="none">
          <g class="flight" style="--x0:${s.from[0]}px;--y0:${s.from[1]}px;--x1:${s.to[0]}px;--y1:${s.to[1]}px">
            <g transform="rotate(${rot.toFixed(1)})">
              <rect class="trail ${s.trail}" x="-7" y="30" width="14" height="${s.trail === 'wake' ? 170 : 120}" rx="7"/>
              <g class="shadow" transform="translate(10 14)">${PLANE}</g>
              ${PLANE}
            </g>
          </g>
        </svg>`}
      </div>`;
    el.dataset.line = s.line;
    el.dataset.credit = `${m.place} · ${dateText(m.date)} · ${m.note}`;
    shots.append(el);
    frames.push(el);
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Image ${frames.length}`);
    dot.addEventListener('click', () => show(frames.indexOf(el), true));
    dots.append(dot);
  }

  let i = -1;
  let timer = 0;
  function show(n: number, manual = false) {
    i = (n + frames.length) % frames.length;
    frames.forEach((f, k) => f.classList.toggle('on', k === i));
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    const line = $('hero-line');
    line.classList.remove('in');
    void line.offsetWidth; // restart the fade
    line.textContent = frames[i].dataset.line!;
    line.classList.add('in');
    $('shot-credit').textContent = frames[i].dataset.credit!;
    clearTimeout(timer);
    if (!reduced || manual) timer = window.setTimeout(() => show(i + 1), manual ? SHOT_MS * 1.6 : SHOT_MS);
    if (reduced) clearTimeout(timer);
  }
  show(0);

  // captions for the before-and-after pair come from the same metadata
  const full = byName.get('baells-full');
  const low = byName.get('baells-low');
  if (full) $('cap-full').innerHTML = `<b>${dateText(full.date)}</b> ${full.note}`;
  if (low) $('cap-low').innerHTML = `<b>${dateText(low.date)}</b> ${low.note}`;
}

// ---------- numbers and regions, from the same manifest the map reads ----------
async function coverage() {
  const m = await fetch('/data/manifest.json').then((r) => r.json());
  const fmt = (n: number) => n.toLocaleString('en-CA');
  $('n-regions').textContent = String(m.regions.length);
  $('n-water').textContent = fmt(m.regions.reduce((s: number, r: any) => s + r.water.count, 0));
  $('n-fires').textContent = fmt(m.regions.reduce((s: number, r: any) => s + (r.fires?.count ?? 0), 0));
  const cards = $('region-cards');
  for (const r of m.regions) {
    const a = document.createElement('a');
    a.className = 'region-card reveal';
    a.href = `/plan.html?region=${r.id}`;
    a.innerHTML = `<span class="where">${r.country === 'ES' ? 'Spain' : r.country === 'CA' ? 'Canada' : r.country}</span><h3>${r.name.replace(/, (Spain|Canada)$/, '')}</h3><p>${r.note}</p><span class="go">Start planning here →</span>`;
    cards.append(a);
    watch(a);
  }
  if (m.planned?.length) $('planned').innerHTML = `<b>Planned next:</b> ${m.planned.map((p: any) => p.name).join(' · ')}`;
}

// ---------- recorded tour: the live map, playing itself inside a frame ----------
function player() {
  const screen = $('screen');
  const poster = $<HTMLButtonElement>('poster');
  const pause = $<HTMLButtonElement>('btn-pause');
  const restart = $<HTMLButtonElement>('btn-restart');
  const progress = $('progress');
  let frame: HTMLIFrameElement | null = null;
  let playing = false;

  // The map is laid out for a 1280 x 800 window and scaled to fit, like a video.
  const W = 1280;
  const H = 800;
  const fit = () => {
    const k = screen.clientWidth / W;
    screen.style.height = `${H * k}px`;
    if (frame) frame.style.transform = `scale(${k})`;
  };
  new ResizeObserver(fit).observe(screen);
  fit();

  const send = (cmd: string) => frame?.contentWindow?.postMessage({ source: 'skimline-host', cmd }, location.origin);
  function start() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.src = '/plan.html?demo=1&region=es-northwest';
    frame.title = 'Recorded tour of the Skimline map';
    frame.width = String(W);
    frame.height = String(H);
    frame.setAttribute('tabindex', '-1');
    screen.append(frame);
    fit();
    poster.classList.add('gone');
    playing = true;
    pause.disabled = restart.disabled = false;
    $('cap-step').textContent = 'Loading the map…';
  }
  poster.addEventListener('click', start);
  pause.addEventListener('click', () => {
    playing = !playing;
    send(playing ? 'play' : 'pause');
    pause.textContent = playing ? 'Pause' : 'Play';
  });
  restart.addEventListener('click', () => {
    playing = true;
    pause.textContent = 'Pause';
    send('restart');
  });

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.source !== 'skimline-demo') return;
    const { i, n, title, text } = e.data;
    $('cap-step').textContent = `Recorded tour · ${i + 1} of ${n}`;
    $('cap-title').textContent = title;
    $('cap-text').textContent = text;
    if (progress.children.length !== n) progress.innerHTML = Array.from({ length: n }, () => '<i></i>').join('');
    [...progress.children].forEach((el, k) => (el.className = k < i ? 'past' : k === i ? 'now' : ''));
  });

  // Start by itself when the section scrolls into view, unless the visitor prefers less motion.
  if (!reduced) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          start();
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(screen);
  }
}

// ---------- gentle reveal on scroll ----------
const revealer = new IntersectionObserver(
  (entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('seen');
      revealer.unobserve(en.target);
    }
  },
  { threshold: 0.18, rootMargin: '0px 0px -6% 0px' },
);
function watch(el: Element) {
  if (reduced) el.classList.add('seen');
  else revealer.observe(el);
}
document.querySelectorAll('.reveal').forEach(watch);
// stagger the five steps
document.querySelectorAll<HTMLElement>('.steps li').forEach((li, k) => li.style.setProperty('--d', `${k * 140}ms`));

const nav = document.querySelector('.nav')!;
const onScroll = () => nav.classList.toggle('solid', window.scrollY > window.innerHeight * 0.6);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

hero().catch(console.error);
coverage().catch(console.error);
player();
