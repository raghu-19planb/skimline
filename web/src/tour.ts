// The quick tour: an animated walk-through that drives the real map, so it can never
// drift out of date the way a recorded video would. Each step points at one control,
// explains it in a sentence or two, and where useful performs the action itself.
//
// To add a step for a new feature, add an entry to STEPS.

export interface TourApi {
  setThreshold(m: number): void;
  getThreshold(): number;
  setScenario(s: 'mapped' | 'dry'): void;
  getScenario(): 'mapped' | 'dry';
  hasObserved(): boolean;
  probeCentre(): void;
  clearProbe(): void;
}

interface Step {
  target: string; // CSS selector of the element to point at
  title: string;
  text: string;
  skip?: (api: TourApi) => boolean;
  /** Runs when the step opens. May return a function that stops any animation it started. */
  enter?: (api: TourApi) => void | (() => void);
}

const STEP_MS = 8000;

/** Glide the run-length slider up and back so the map visibly recalculates. */
function sweepThreshold(api: TourApi): () => void {
  const from = 1852;
  const to = 3200;
  const start = performance.now();
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / 5000);
    const k = t < 0.5 ? t * 2 : (1 - t) * 2; // up, then back
    if (now - last > 90) {
      api.setThreshold(Math.round(from + (to - from) * k));
      last = now;
    }
    if (t < 1) raf = requestAnimationFrame(tick);
    else api.setThreshold(from);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    api.setThreshold(from);
  };
}

const STEPS: Step[] = [
  {
    target: '#panel header',
    title: 'What this map answers',
    text: 'Water bombers refill by skimming a lake or reservoir. This map shows where they can, how long each load takes from any point, and what a dry year takes away.',
  },
  {
    target: '#region-row',
    title: 'Choose a region',
    text: 'Each region is built by the same method from open data. Regions marked "planned" are next in line.',
  },
  {
    target: '#legend',
    title: 'Read the colours',
    text: 'Blue ground is within four minutes of usable water: fifteen or more loads an hour. Red ground is over twelve minutes away: fewer than five.',
  },
  {
    target: '.slider-row',
    title: 'Set the run the aircraft needs',
    text: 'A longer run is needed at altitude and in heat. Watch water bodies drop out and the map recalculate as the requirement grows.',
    enter: sweepThreshold,
  },
  {
    target: '#readout',
    title: 'Measure any spot',
    text: 'Click anywhere to get the nearest usable water, minutes per load, loads an hour and litres an hour for one aircraft.',
    enter: (api) => {
      api.probeCentre();
      return () => api.clearProbe();
    },
  },
  {
    target: '#stats',
    title: 'Three numbers to take away',
    text: 'How many water bodies are usable, how much of the area is within six minutes of one, and how much of what burned since 2016 was far from any.',
  },
  {
    target: '#scenario',
    title: 'Stress-test with a dry year',
    text: 'This puts each satellite-observed reservoir at its lowest month since 2021. The old values stay struck through beside the new ones.',
    skip: (api) => !api.hasObserved(),
    enter: (api) => {
      api.setScenario('dry');
      return () => api.setScenario('mapped');
    },
  },
  {
    target: '#observed',
    title: 'Reservoirs seen from space',
    text: 'Each chart is one reservoir\'s usable run, month by month, from satellite images. Red dots are months it fell below the run required.',
    skip: (api) => !api.hasObserved(),
  },
  {
    target: '#fires-section',
    title: 'Fires furthest from water',
    text: 'Large past fires where loads were slowest. These are the places where other aircraft, or a designated water point, would have mattered most.',
  },
  {
    target: '#panel footer',
    title: 'Go deeper',
    text: 'The planners page lists the decisions this supports. The guide explains every control, and the methods page gives every source and limit.',
  },
];

export function initTour(api: TourApi) {
  const card = document.getElementById('tour') as HTMLElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let steps: Step[] = [];
  let i = 0;
  let playing = false;
  let timer = 0;
  let leave: (() => void) | void;
  let saved: { threshold: number; scenario: 'mapped' | 'dry' } | null = null;

  const focusOff = () => document.querySelectorAll('.tour-focus').forEach((el) => el.classList.remove('tour-focus'));

  function render() {
    const s = steps[i];
    card.innerHTML = `
      <div class="tour-bar"><i style="animation-duration:${STEP_MS}ms" class="${playing ? 'run' : ''}"></i></div>
      <button class="close" type="button" aria-label="Close tour">×</button>
      <p class="tour-count">Quick tour · ${i + 1} of ${steps.length}</p>
      <h3>${s.title}</h3>
      <p>${s.text}</p>
      <div class="tour-nav">
        <button type="button" data-a="back" ${i === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" data-a="play">${playing ? 'Pause' : 'Play'}</button>
        <button type="button" data-a="next" class="primary">${i === steps.length - 1 ? 'Finish' : 'Next'}</button>
      </div>`;
    card.querySelector('.close')!.addEventListener('click', stop);
    card.querySelector('[data-a=back]')!.addEventListener('click', () => go(i - 1, false));
    card.querySelector('[data-a=next]')!.addEventListener('click', () => (i === steps.length - 1 ? stop() : go(i + 1, false)));
    card.querySelector('[data-a=play]')!.addEventListener('click', () => {
      playing = !playing;
      schedule();
      render();
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (playing) timer = window.setTimeout(() => (i === steps.length - 1 ? stop() : go(i + 1, true)), STEP_MS);
  }

  function go(n: number, keepPlaying: boolean) {
    if (leave) leave();
    leave = undefined;
    focusOff();
    i = Math.max(0, Math.min(steps.length - 1, n));
    playing = keepPlaying;
    const s = steps[i];
    leave = s.enter?.(api);
    // Highlight after the step's own action, which may have just created the target.
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(s.target);
      if (el && !el.hidden) {
        el.classList.add('tour-focus');
        if (el.closest('#panel')) el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
      }
    });
    render();
    schedule();
  }

  function start(autoplay: boolean) {
    saved = { threshold: api.getThreshold(), scenario: api.getScenario() };
    api.setThreshold(1852);
    api.setScenario('mapped');
    steps = STEPS.filter((s) => !s.skip?.(api));
    card.hidden = false;
    document.body.classList.add('touring');
    go(0, autoplay && !reduced);
    try {
      localStorage.setItem('skimline-tour-seen', '1');
    } catch {
      /* private browsing: the tour still works, it just is not remembered */
    }
  }

  function stop() {
    clearTimeout(timer);
    if (leave) leave();
    leave = undefined;
    focusOff();
    card.hidden = true;
    document.body.classList.remove('touring');
    if (saved) {
      api.setThreshold(saved.threshold);
      api.setScenario(saved.scenario);
    }
    saved = null;
  }

  document.getElementById('tour-start')!.addEventListener('click', () => start(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) stop();
  });

  // A link with ?tour=1 plays the tour straight away, so it can be shared as a demo.
  const query = new URLSearchParams(location.search);
  if (query.get('tour') === '1') {
    // Drop the flag from the address so a reload does not replay the tour.
    query.delete('tour');
    history.replaceState(null, '', `?${query}`);
    start(true);
    return;
  }
  // First visit: offer the tour once, without taking over the map.
  let seen = true;
  try {
    seen = localStorage.getItem('skimline-tour-seen') === '1';
  } catch {
    /* ignore */
  }
  if (!seen) document.getElementById('tour-start')!.classList.add('pulse');
}
