// The recorded tour.
//
// Opened as plan.html?demo=1, the real map plays itself like a screen recording: a cursor
// moves, clicks, and the map responds, while captions explain each moment. It is the live
// app, not a video file, so it never shows an out-of-date screen.
//
// The home page embeds this in a frame and shows the captions beside it. Opened on its
// own, the page draws its own caption bar.
//
// To cover a new feature, add an act to ACTS.

import { setHtml } from './dom.ts';
import { html } from './format.ts';

export interface DemoApi {
  setThreshold(m: number): void;
  setScenario(s: 'mapped' | 'dry'): void;
  hasObserved(): boolean;
  /** A good place to measure, as lon/lat. */
  demoPlace(): [number, number];
  /** Screen position of a lon/lat on the map, in page pixels. */
  screenOf(lon: number, lat: number): { x: number; y: number };
  probeAt(lon: number, lat: number): void;
  clearProbe(): void;
}

interface Act {
  title: string;
  text: string;
  skip?: (api: DemoApi) => boolean;
  /** Performs the act. Resolves when its motion is finished; the caption then holds for `hold` ms. */
  play: (api: DemoApi, c: Cursor) => Promise<void>;
  hold: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class Cursor {
  el = document.createElement('div');
  constructor() {
    this.el.className = 'demo-cursor';
    this.el.innerHTML =
      '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2l15 9-7 1.6L8.6 20z" fill="#fff" stroke="#15232b" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(this.el);
    this.jump(window.innerWidth * 0.55, window.innerHeight * 0.5);
  }
  jump(x: number, y: number) {
    this.el.style.transitionDuration = '0s';
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  }
  /** Glide to a point. Slow enough to follow with the eye. */
  async to(x: number, y: number, ms = 1300) {
    this.el.style.transitionDuration = `${ms}ms`;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
    await wait(ms + 150);
  }
  /** Glide to the middle of an element, scrolling the panel to it first. */
  async toEl(sel: string, ms = 1300, at: [number, number] = [0.5, 0.5]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return;
    if (el.closest('#panel')) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await wait(700);
    }
    const r = el.getBoundingClientRect();
    await this.to(r.left + r.width * at[0], r.top + r.height * at[1], ms);
  }
  async click() {
    const ring = document.createElement('i');
    ring.className = 'demo-ring';
    this.el.append(ring);
    await wait(450);
    ring.remove();
  }
}

function focus(sel: string | null) {
  document.querySelectorAll('.tour-focus').forEach((el) => el.classList.remove('tour-focus'));
  if (sel) document.querySelector(sel)?.classList.add('tour-focus');
}

const ACTS: Act[] = [
  {
    title: 'A map of how fast water bombers can work',
    text: 'Blue ground is close to water a scooper aircraft can use. Red ground is far from it. The dark outlines are fires since 2016.',
    hold: 6500,
    play: async (_api, c) => {
      await c.toEl('#legend', 1500, [0.3, 0.5]);
      focus('#legend');
    },
  },
  {
    title: "First, the aircraft's needs",
    text: 'A scooper needs a long, straight stretch of water. Ask for a longer run and fewer lakes qualify, so the map turns redder.',
    hold: 3500,
    play: async (api, c) => {
      await c.toEl('#run', 1300, [0.32, 0.5]);
      focus('.slider-row');
      await c.click();
      // drag right, pause, drag back
      const slider = document.querySelector<HTMLElement>('#run')!.getBoundingClientRect();
      const xAt = (m: number) => slider.left + ((m - 800) / (4100 - 800)) * slider.width;
      const y = slider.top + slider.height / 2;
      const drag = async (from: number, to: number, ms: number) => {
        const t0 = performance.now();
        c.el.style.transitionDuration = '0s';
        while (true) {
          const t = Math.min(1, (performance.now() - t0) / ms);
          const m = Math.round(from + (to - from) * t);
          api.setThreshold(m);
          c.el.style.transform = `translate(${xAt(m)}px, ${y}px)`;
          if (t >= 1) break;
          await wait(140);
        }
      };
      await drag(1852, 3200, 3200);
      await wait(1800);
      await drag(3200, 1852, 2600);
    },
  },
  {
    title: 'Click any place to measure it',
    text: 'A line runs to the nearest usable water. The card gives minutes per load, loads an hour, litres an hour, and the coordinates.',
    hold: 8000,
    play: async (api, c) => {
      focus(null);
      const [lon, lat] = api.demoPlace();
      const p = api.screenOf(lon, lat);
      await c.to(p.x, p.y, 1500);
      await c.click();
      api.probeAt(lon, lat);
      await wait(900);
      await c.toEl('#readout .big', 1300, [0.2, 0.6]);
      focus('#readout');
    },
  },
  {
    title: 'Now test a dry year',
    text: 'One click puts each satellite-measured reservoir at its lowest month since 2021. The crossed-out figures are the full-reservoir values.',
    skip: (api) => !api.hasObserved(),
    hold: 7500,
    play: async (api, c) => {
      focus(null);
      api.clearProbe();
      await c.toEl('#scenario button[data-scenario="dry"]', 1400);
      await c.click();
      api.setScenario('dry');
      await wait(900);
      await c.toEl('#stats', 1300, [0.5, 0.75]);
      focus('#stats');
    },
  },
  {
    title: 'See each reservoir, month by month',
    text: 'Every chart is a reservoir seen from space. The line is its usable run. Red dots are months it fell below what an aircraft needs.',
    skip: (api) => !api.hasObserved(),
    hold: 8500,
    play: async (_api, c) => {
      focus(null);
      await c.toEl('#observed-list li:first-child button', 1500, [0.4, 0.5]);
      focus('#observed');
      await c.click();
      document.querySelector<HTMLButtonElement>('#observed-list li:first-child button')?.click();
      await wait(1600);
      focus('#readout');
    },
  },
  {
    title: 'Find the fires that were far from water',
    text: 'The list ranks large past fires by how slow the loads were. One click goes to the fire and shows its nearest usable water.',
    hold: 8500,
    play: async (api, c) => {
      focus(null);
      api.setScenario('mapped');
      await c.toEl('#fire-list li:first-child button', 1500, [0.4, 0.5]);
      focus('#fires-section');
      await c.click();
      document.querySelector<HTMLButtonElement>('#fire-list li:first-child button')?.click();
      await wait(2200);
      focus('#readout');
    },
  },
  {
    title: 'That is the whole idea',
    text: 'Where scoopers are slow, which reservoirs fail in a dry year, and which fires were out of reach. Press Start planning and try your own place.',
    hold: 6000,
    play: async (_api, c) => {
      focus(null);
      await c.to(window.innerWidth * 0.6, window.innerHeight * 0.45, 1200);
    },
  },
];

export function runDemo(api: DemoApi, reset: () => Promise<void>) {
  document.body.classList.add('demo');
  const embedded = window.parent !== window;
  const cursor = new Cursor();
  let paused = false;
  let generation = 0; // bumped on restart so a superseded run stops itself

  // Captions: sent to the host page when embedded, drawn here otherwise.
  let bar: HTMLElement | null = null;
  if (!embedded) {
    bar = document.createElement('div');
    bar.className = 'demo-caption';
    document.body.append(bar);
  }
  const say = (i: number, n: number, act: Act) => {
    if (embedded) window.parent.postMessage({ source: 'skimline-demo', i, n, title: act.title, text: act.text }, location.origin);
    else if (bar) setHtml(bar, html`<small>Tour · ${i + 1} of ${n}</small><b>${act.title}</b><span>${act.text}</span>`);
  };
  const whilePaused = async () => {
    while (paused) await wait(200);
  };

  async function run() {
    const mine = ++generation;
    const acts = ACTS.filter((a) => !a.skip?.(api));
    while (mine === generation) {
      await reset();
      for (let i = 0; i < acts.length && mine === generation; i++) {
        await whilePaused();
        say(i, acts.length, acts[i]);
        await acts[i].play(api, cursor);
        // hold the caption, in small slices so pause and restart respond quickly
        for (let t = 0; t < acts[i].hold && mine === generation; t += 200) {
          await whilePaused();
          await wait(200);
        }
      }
      focus(null);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.data?.source !== 'skimline-host') return;
    if (e.data.cmd === 'pause') paused = true;
    if (e.data.cmd === 'play') paused = false;
    if (e.data.cmd === 'restart') {
      paused = false;
      void run();
    }
  });
  void run();
}
