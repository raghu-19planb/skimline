// The guided tour.
//
// It does not play past the visitor. It first asks what they want to find out, then walks
// them to that answer one step at a time. Where a step needs an action, the visitor does
// it themselves on the real map and the tour waits; "Show me" does it for them if they
// are stuck. Nothing advances on a timer, so each person sets their own pace.
//
// To cover a new feature, add a step to a path below, or add a new path.

import type { Scenario } from './types.ts';

export interface TourApi {
  setThreshold(m: number): void;
  getThreshold(): number;
  setScenario(s: Scenario): void;
  getScenario(): Scenario;
  hasObserved(): boolean;
  hasProbe(): boolean;
  probeCentre(): void;
  clearProbe(): void;
}

interface Task {
  /** What the visitor is asked to do, as an instruction. */
  prompt: string;
  /** True once they have done it. Checked a few times a second. */
  done: (api: TourApi) => boolean;
  /** Does it for them. */
  demo: (api: TourApi) => void;
  /** Shown once it is done: what they are now looking at. */
  after: string;
  /** Where the result appeared, highlighted once the task is done. */
  result?: string;
}
interface Step {
  target: string; // CSS selector of the control or panel this step is about
  title: string;
  text: string;
  task?: Task;
  /** Runs when the step opens, for a slow demonstration. May return a function that stops it. */
  enter?: (api: TourApi) => void | (() => void);
}
interface Path {
  id: string;
  question: string; // the outcome, in the visitor's words
  blurb: string;
  available?: (api: TourApi) => boolean;
  steps: Step[];
  outcome: { title: string; text: string };
}

const waterCardOpen = () => !!document.querySelector('#readout:not([hidden]) .tag');
const clickFirst = (sel: string) => document.querySelector<HTMLButtonElement>(sel)?.click();

/** Glide the run-length slider up and back, slowly, with a pause at the top. */
function sweepThreshold(api: TourApi): () => void {
  const from = 1852;
  const to = 3200;
  const start = performance.now();
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / 11000);
    // rise for 4 s, hold for 3 s, fall for 4 s
    const k = t < 0.36 ? t / 0.36 : t < 0.64 ? 1 : (1 - t) / 0.36;
    if (now - last > 160) {
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

const PATHS: Path[] = [
  {
    id: 'spot',
    question: 'How fast could water bombers work at a place I care about?',
    blurb: 'Pick a place and get minutes per load, loads an hour and the nearest usable water.',
    steps: [
      {
        target: '#region-row',
        title: 'First, check the region',
        text: 'This list holds every region built so far. Make sure it shows the one you want. You can change it now, then press Next.',
      },
      {
        target: '.slider-row',
        title: 'Tell the map what the aircraft needs',
        text: 'A scooper needs a long, straight stretch of water. One nautical mile is the usual planning figure and is already set; choose "2.5 miles" for high lakes or very hot days. Below it, the clear width says how wide that water must be. Leave both as they are for now and press Next.',
      },
      {
        target: '#map',
        title: 'Now choose your place',
        text: 'The dashed box on the map is the area that has been analysed.',
        task: {
          prompt: 'Click the place you care about, anywhere inside the dashed box.',
          done: (api) => api.hasProbe(),
          demo: (api) => api.probeCentre(),
          after: 'A line now runs from your place to the nearest water a scooper can use, and a card has opened with the figures.',
          result: '#readout',
        },
      },
      {
        target: '#readout .big',
        title: 'Read the three figures',
        text: 'Minutes per load is the round trip to the water and back. Loads an hour follows from it. Litres an hour is for one aircraft with a 6,137-litre tank. Under four minutes is fast; over twelve is slow.',
      },
      {
        target: '#readout .coords',
        title: 'The position to pass on',
        text: "These are the latitude and longitude of the nearest point on that water's usable run, and of your place. Click a coordinate to select it for copying.",
      },
    ],
    outcome: {
      title: 'You have your answer',
      text: 'You know how fast scoopers could work at that place and where their water is. Click other places to compare them. Blue ground is fast; red ground is slow.',
    },
  },
  {
    id: 'dry',
    question: 'Which reservoirs let us down in a dry year?',
    blurb: 'See which reservoirs lose their usable water, and how much ground depends on them.',
    available: (api) => api.hasObserved(),
    steps: [
      {
        target: '#observed',
        title: 'These reservoirs were measured from space',
        text: 'Each chart is one reservoir. The line is its usable run in every clear month since 2021, from satellite images. The dashed line is the run an aircraft needs. A red dot is a month the reservoir fell short.',
      },
      {
        target: '#scenario',
        title: 'Put every reservoir at its lowest',
        text: "The map normally uses each reservoir's mapped outline, which is its full level. 'Latest image' shows each as it last looked from space; 'Driest month' is the stress test.",
        task: {
          prompt: 'Click "Driest month".',
          done: (api) => api.getScenario() === 'dry',
          demo: (api) => api.setScenario('dry'),
          after: 'The map has recalculated. In the three boxes, the struck-through figure is the full-reservoir value and the bold figure is the dry one.',
          result: '#stats',
        },
      },
      {
        target: '#observed-list',
        title: 'Look at the worst case',
        text: 'The list is ordered with the reservoirs that fell short most often at the top.',
        task: {
          prompt: 'Click the first reservoir in the list.',
          done: () => waterCardOpen(),
          demo: () => clickFirst('#observed-list button'),
          after: 'The map has moved to that reservoir. Its card shows the shortest run measured, the month it happened, and the full history.',
          result: '#readout',
        },
      },
    ],
    outcome: {
      title: 'You have your answer',
      text: 'You know which reservoirs lost their usable run, when, and what it cost in covered ground. Switch back to "As mapped" at any time to compare.',
    },
  },
  {
    id: 'fires',
    question: 'Where did past fires burn far from usable water?',
    blurb: 'Go to the large fires where loads were slowest, and see what was nearest.',
    steps: [
      {
        target: '#stats',
        title: 'Start with the headline',
        text: "The third box is the share of everything burned since 2016 that lay more than nine minutes per load from usable water. The higher it is, the more this region's fires were out of easy reach of scoopers.",
      },
      {
        target: '#fires-section',
        title: 'Go to the slowest large fire',
        text: 'This list holds fires of 500 hectares or more, with the slowest loads at the top.',
        task: {
          prompt: 'Click the first fire in the list.',
          done: (api) => api.hasProbe(),
          demo: () => clickFirst('#fire-list button'),
          after: 'The map has moved to that fire. The card shows the nearest usable water, how far away it was, and the minutes per load.',
          result: '#readout',
        },
      },
      {
        target: '#presets',
        title: 'Would a shorter run have helped?',
        text: 'Some aircraft, and cooler low-altitude conditions, need less water.',
        task: {
          prompt: 'Click "1 mile".',
          done: (api) => api.getThreshold() === 1609,
          demo: (api) => api.setThreshold(1609),
          after: 'More water bodies now count as usable. Check the card: if the minutes per load dropped, closer water exists for a shorter-run aircraft.',
          result: '#readout',
        },
      },
    ],
    outcome: {
      title: 'You have your answer',
      text: 'You have seen where a large fire burned far from scooper water and whether a shorter run changes that. These are the places where other aircraft or a designated water point matter most.',
    },
  },
  {
    id: 'around',
    question: 'Just show me around',
    blurb: 'A walk through every part of the page, at your pace.',
    steps: [
      {
        target: '#panel > header',
        title: 'What this map answers',
        text: 'Water bombers refill by skimming a lake or reservoir. This map shows where they can, how long each load takes from any point, and what a dry year takes away.',
      },
      {
        target: '#region-row',
        title: 'The region list',
        text: 'Each region is built by the same method from open data. Regions marked "planned" are next in line.',
      },
      {
        target: '#legend',
        title: 'The colours',
        text: 'Blue ground is within four minutes of usable water: fifteen or more loads an hour. Red ground is over twelve minutes away: fewer than five.',
      },
      {
        target: '.slider-row',
        title: 'The run the aircraft needs',
        text: 'Watch the slider move. As the required run grows, water bodies turn grey and drop out, and the colours change. It will return to where it started.',
        enter: sweepThreshold,
      },
      {
        target: '#stats',
        title: 'Three numbers to take away',
        text: 'How many water bodies are usable, how much of the area is within six minutes of one, and how much of what burned since 2016 was far from any.',
      },
      { target: '#fires-section', title: 'Fires furthest from water', text: 'Large past fires where loads were slowest. Click one to go to it.' },
      {
        target: '.panel-foot',
        title: 'Where to read more',
        text: 'The planners page lists the decisions this supports. The guide explains every control. The methods page gives every source and limit.',
      },
    ],
    outcome: { title: 'That is the whole page', text: 'Now try a real question. Choosing one will walk you to its answer.' },
  },
];

/** On a phone the map stays at the top of the screen, so a target is scrolled to just below it, not to the middle. */
const PHONE = window.matchMedia('(max-width: 820px)');

export function initTour(api: TourApi) {
  const card = document.getElementById('tour') as HTMLElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let path: Path | null = null;
  let i = 0;
  let taskDone = false;
  let poll = 0;
  let leave: (() => void) | void;

  const focusOff = () => document.querySelectorAll('.tour-focus').forEach((el) => el.classList.remove('tour-focus'));
  function focus(sel: string) {
    focusOff();
    const el = document.querySelector<HTMLElement>(sel);
    if (!el || el.hidden) return;
    el.classList.add('tour-focus');
    if (el.closest('#panel')) el.scrollIntoView({ block: PHONE.matches ? 'start' : 'center', behavior: reduced ? 'auto' : 'smooth' });
  }
  function cleanup() {
    clearInterval(poll);
    if (leave) leave();
    leave = undefined;
    focusOff();
  }
  const closeButton = '<button class="close" type="button" aria-label="Close tour">×</button>';

  function open() {
    card.hidden = false;
    document.body.classList.add('touring');
    try {
      localStorage.setItem('skimline-tour-seen', '1');
    } catch {
      /* private browsing: the tour still works, it just is not remembered */
    }
    chooser();
  }

  /** Step zero: what do you want to find out? */
  function chooser() {
    cleanup();
    path = null;
    const options = PATHS.map((p) => {
      const ok = p.available ? p.available(api) : true;
      return `<button type="button" data-path="${p.id}" ${ok ? '' : 'disabled'}><strong>${p.question}</strong><span>${ok ? p.blurb : 'Not available in this region yet: no reservoirs have been measured here.'}</span></button>`;
    }).join('');
    card.innerHTML = `${closeButton}
      <p class="tour-count">Guided tour</p>
      <h3>What would you like to find out?</h3>
      <p>Choose one. You will be walked to the answer one step at a time, and nothing moves on until you are ready.</p>
      <div class="tour-paths">${options}</div>`;
    card.querySelector('.close')!.addEventListener('click', stop);
    for (const b of card.querySelectorAll<HTMLButtonElement>('[data-path]')) {
      b.addEventListener('click', () => {
        path = PATHS.find((p) => p.id === b.dataset.path)!;
        // Start each path from a known state so the instructions match what is on screen.
        api.setScenario('mapped');
        api.setThreshold(1852);
        api.clearProbe();
        go(0);
      });
    }
  }

  function go(n: number) {
    cleanup();
    if (!path) return;
    if (n >= path.steps.length) return outcome();
    i = Math.max(0, n);
    const s = path.steps[i];
    taskDone = s.task ? s.task.done(api) : true;
    leave = s.enter?.(api);
    render();
    requestAnimationFrame(() => focus(taskDone && s.task?.result ? s.task.result : s.target));
    if (s.task && !taskDone) {
      poll = window.setInterval(() => {
        if (!s.task!.done(api)) return;
        clearInterval(poll);
        taskDone = true;
        render();
        // Give the page a moment to show the result before pointing at it.
        setTimeout(() => focus(s.task!.result ?? s.target), 350);
      }, 300);
    }
  }

  function render() {
    if (!path) return;
    const s = path.steps[i];
    const task = s.task
      ? taskDone
        ? `<div class="tour-task done"><b>✓ Done.</b> ${s.task.after}</div>`
        : `<div class="tour-task"><b>Your turn.</b> ${s.task.prompt}<button type="button" data-a="demo">Show me</button></div>`
      : '';
    const waiting = !!s.task && !taskDone;
    card.innerHTML = `${closeButton}
      <p class="tour-count">${path.question} · step ${i + 1} of ${path.steps.length}</p>
      <div class="tour-dots">${path.steps.map((_, k) => `<i class="${k < i ? 'past' : k === i ? 'now' : ''}"></i>`).join('')}</div>
      <h3>${s.title}</h3>
      <p>${s.text}</p>
      ${task}
      <div class="tour-nav">
        <button type="button" data-a="back">${i === 0 ? 'Change question' : 'Back'}</button>
        <button type="button" data-a="next" class="${waiting ? '' : 'primary'}">${waiting ? 'Skip this step' : i === path.steps.length - 1 ? 'See the result' : 'Next'}</button>
      </div>`;
    card.querySelector('.close')!.addEventListener('click', stop);
    card.querySelector('[data-a=back]')!.addEventListener('click', () => (i === 0 ? chooser() : go(i - 1)));
    card.querySelector('[data-a=next]')!.addEventListener('click', () => go(i + 1));
    card.querySelector('[data-a=demo]')?.addEventListener('click', () => s.task!.demo(api));
  }

  function outcome() {
    cleanup();
    if (!path) return;
    card.innerHTML = `${closeButton}
      <p class="tour-count">${path.question}</p>
      <h3>${path.outcome.title}</h3>
      <p>${path.outcome.text}</p>
      <div class="tour-nav">
        <button type="button" data-a="again">Ask another question</button>
        <button type="button" data-a="finish" class="primary">Finish and explore</button>
      </div>`;
    card.querySelector('.close')!.addEventListener('click', stop);
    card.querySelector('[data-a=again]')!.addEventListener('click', chooser);
    card.querySelector('[data-a=finish]')!.addEventListener('click', stop);
  }

  /** Closing leaves the map as the visitor has it: the result they reached is theirs to keep. */
  function stop() {
    cleanup();
    card.hidden = true;
    document.body.classList.remove('touring');
  }

  document.getElementById('tour-start')!.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !card.hidden) stop();
  });

  // A link with ?tour=1 opens the tour on arrival, so it can be shared.
  const query = new URLSearchParams(location.search);
  if (query.get('tour') === '1') {
    query.delete('tour'); // so a reload does not reopen it
    history.replaceState(null, '', `?${query}`);
    open();
    return;
  }
  // First visit: draw the eye to the tour button once, without taking over the page.
  let seen = true;
  try {
    seen = localStorage.getItem('skimline-tour-seen') === '1';
  } catch {
    /* ignore */
  }
  if (!seen) document.getElementById('tour-start')!.classList.add('pulse');
}
