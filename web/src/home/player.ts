// The recorded tour: the live planning page, opened with ?demo=1, shown in a frame like a
// video. It is the real app playing itself, so it can never show an out-of-date screen.
// The frame tells this page which moment it is on; the caption is drawn here, above the
// screen, at a size that stays readable on a phone.
import { el, prefersReducedMotion } from '../plan/dom.ts';

/** The planning page is laid out for a window of this size and scaled to fit, like a video. */
const FRAME_W = 1280;
const FRAME_H = 800;
const DEMO_URL = '/plan.html?demo=1&region=es-northwest';
/** How long to wait for the frame's first sign of life before saying it failed. */
const LOAD_TIMEOUT_MS = 20000;

interface DemoMessage {
  source: 'skimline-demo';
  i: number;
  n: number;
  title: string;
  text: string;
}
const isDemoMessage = (data: unknown): data is DemoMessage =>
  typeof data === 'object' && data !== null && (data as { source?: unknown }).source === 'skimline-demo';

export function initPlayer(): void {
  const screen = el('screen');
  const poster = el<HTMLButtonElement>('poster');
  const pause = el<HTMLButtonElement>('btn-pause');
  const restart = el<HTMLButtonElement>('btn-restart');
  const progress = el('progress');
  const caption = el('caption');
  let frame: HTMLIFrameElement | null = null;
  let playing = false;

  const fit = () => {
    const scale = screen.clientWidth / FRAME_W;
    screen.style.height = `${FRAME_H * scale}px`;
    if (frame) frame.style.transform = `scale(${scale})`;
  };
  new ResizeObserver(fit).observe(screen);
  fit();

  const send = (cmd: 'play' | 'pause' | 'restart') => frame?.contentWindow?.postMessage({ source: 'skimline-host', cmd }, location.origin);

  // If the frame cannot load (the page was opened from a file, the network dropped, a
  // browser extension blocked it), say so plainly instead of leaving an empty box.
  let watchdog = 0;
  function giveUp(reason: string): void {
    frame?.remove();
    frame = null;
    playing = false;
    pause.disabled = true;
    restart.disabled = true;
    poster.classList.remove('gone');
    el('cap-step').textContent = 'Tour';
    el('cap-title').textContent = 'The tour could not start here';
    el('cap-text').textContent = reason;
  }

  function start(): void {
    if (frame) return;
    if (location.protocol === 'file:') {
      giveUp('This page was opened from a file on disk. The tour plays on the live site.');
      return;
    }
    clearTimeout(watchdog);
    watchdog = window.setTimeout(() => giveUp('The map took too long to load. Press play to try again, or open the planning page yourself.'), LOAD_TIMEOUT_MS);
    frame = document.createElement('iframe');
    frame.src = DEMO_URL;
    frame.title = 'Tour of the Skimline planning page';
    frame.width = String(FRAME_W);
    frame.height = String(FRAME_H);
    frame.tabIndex = -1;
    screen.append(frame);
    fit();
    poster.classList.add('gone');
    playing = true;
    pause.disabled = false;
    restart.disabled = false;
    el('cap-step').textContent = 'Loading the map…';
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

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || !isDemoMessage(event.data)) return;
    clearTimeout(watchdog); // the frame is alive
    const { i, n, title, text } = event.data;
    el('cap-step').textContent = `Tour · ${i + 1} of ${n}`;
    el('cap-title').textContent = title;
    el('cap-text').textContent = text;
    // fade the new caption in
    caption.classList.remove('swap');
    void caption.offsetWidth;
    caption.classList.add('swap');

    if (progress.children.length !== n) progress.replaceChildren(...Array.from({ length: n }, () => document.createElement('i')));
    [...progress.children].forEach((bar, k) => (bar.className = k < i ? 'past' : k === i ? 'now' : ''));
  });

  // Start by itself when the section scrolls into view, unless the visitor prefers less motion.
  if (prefersReducedMotion()) return;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      start();
      observer.disconnect();
    },
    { threshold: 0.45 },
  );
  observer.observe(screen);
}
