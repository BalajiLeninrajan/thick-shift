// The heads-up display: HTML laid over the canvas. It is kept to
// the edges and kept small, because the thing to look at is the dark room.
// Top left: the hour, the building's power and the task list (the faults to
// fix, where, and how long before each burns). Top centre: a compass with the
// faults on it, and the events of the night under it. Top right:
// the other guards. Bottom left: the torch, and whether you have your Mini
// Biggs in hand. Everything else shows only while
// it matters (a prompt in reach, stamina while winded, the flat and pause
// states).

import { clockF, F, faultLeft, TOY } from '@thick-shift/sim';
import { defined, isNight, isNonEmpty, isPlaced } from '@thick-shift/sim/check';
import { FINAL_NIGHT, MASC } from '@thick-shift/sim/config';
import { BOXES, CHARGER, GENERATOR, ROOMS3, roomAt, route } from '@thick-shift/sim/map';
import type { Guard, NightState, NonEmpty, PerMascot, Point, State } from '@thick-shift/sim/types';
import { query } from '../dom';
import { game } from '../state';
import type { Me, PlayerHandle } from '../types';
import { prefs, savePrefs } from './player';
import { faultName } from './task';
import { canFullscreen, createTouch, toggleFullscreen } from './touch';

// A row of the pause screen's lists: what, the keys or buttons, and an optional note. A group: its title and rows.
type ControlRow = [what: string, how: string[], note?: string];
type ControlGroup = [title: string, rows: ControlRow[]];
// Something the compass points to this frame.
interface Mark {
  key: string;
  kind: string;
  x: number;
  z: number;
  hot?: boolean;
  name?: string;
  ping?: boolean;
}
// A mark once its route is known. dist: metres along the route. off: where it would sit on the strip, -1 to 1 at
// its ends.
interface Placed extends Mark {
  dist: number;
  off: number;
}
// The way to a mark: the next corner to walk to, and how much further the mark is from there.
interface Leg {
  x: number;
  z: number;
  far: number;
}
// An element that remembers what html() last put in it, or how far spread() moved it.
type Cached = HTMLElement & { _html?: string; _dx?: number };
// A mark's element on the strip, and its label (the <b> inside it).
interface MarkEl {
  e: HTMLElement;
  label: Cached;
}
// Compass labels laid side by side (spread): the label, where it sits unmoved and its width; mid: where the run
// wants its centre.
interface Run {
  ls: { b: Cached; x: number; w: number }[];
  mid: number;
  w: number;
}
// A toast on screen, and when it goes.
interface Toast {
  e: HTMLElement;
  until: number;
}

const HALF_SPAN = 1.3; // radians either side of straight ahead that fit on the compass
const LABEL_GAP = 6; // pixels kept between two compass labels
const NAV_MS = 150; // one compass mark has its walking route refreshed this often, in turn
const LOW_BAT = 0.25,
  LOW_POWER = 25,
  CRIT_POWER = 10;
const GEN_MARK = 40; // power, in percent, under which the compass points to the generator
const HURRY = 15; // seconds left before a fault burns when its row turns red
const MAX_TASKS = 6; // rows in the task list before the rest are counted, on a stage tall enough for them
const TASK_ROW = 28; // pixels a task row and its gap take
const TASK_TOP = 76; // pixels above the task list: the hour and the power
const TASK_FOOT = { touch: 160, keys: 100 }; // pixels kept clear under it: the stick, or the torch
const CELLS = 5; // bars in the torch battery
// What each mascot did to you, by MASC index.
const HOW: PerMascot<string> = ['sat on you', 'hugged you a bit too hard', 'landed on you', 'did not slow down'];

const PATHS = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  fault: '<path d="M10 2 4 13h6l-2 9 10-13h-6l2-7z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  torch: '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><path d="M6 6h12M12 12v2"/>',
  battery: '<rect x="2" y="7" width="16" height="10" rx="2"/><path d="M22 11v2M6 11v2"/>',
  down: '<path d="M3 19h18"/><rect x="5" y="13" width="14" height="3" rx="1.5"/><path d="M12 3v6m-3-3 3 3 3-3"/>',
  up: '<path d="M3 19h18"/><path d="M12 15V5m-4 4 4-4 4 4"/>',
  call: '<path d="m3 11 18-5v12L3 14z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  full: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
  locker: '<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M12 2v20M8 6h2M8 8h2M14 6h2M14 8h2"/>',
  rotate: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M2 9a10 10 0 0 0 3 9m17-3a10 10 0 0 0-3-9"/>',
  toy: '<circle cx="12" cy="13.5" r="7"/><circle cx="6.5" cy="6.5" r="2.2"/><circle cx="17.5" cy="6.5" r="2.2"/><path d="M9.5 11v.01M14.5 11v.01M10 16.5h.01M14 16.5h.01"/>',
};
type IconName = keyof typeof PATHS;
const icon = (name: IconName): string =>
  `<svg class="cn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
// Each kind of toast has its own icon and colour (in styles.css), so a low
// torch, low power, a fault burning and a guard going down do not look alike.
const TOAST_ICON = {
  info: 'info',
  fault: 'fault',
  fixed: 'fault',
  burnt: 'fault',
  power: 'bolt',
  out: 'bolt',
  back: 'bolt',
  torch: 'battery',
  down: 'down',
  up: 'up',
  call: 'call',
  hide: 'locker',
  toy: 'toy',
} satisfies Record<string, IconName>;
type ToastKind = keyof typeof TOAST_ICON;
const MAX_TOASTS = 3,
  SHORT = 480; // a stage under SHORT pixels tall shows one toast fewer

// The pause screen's lists, in groups. Each row is what, then the keys or buttons as keycaps, then an
// optional note under the action.
const DRAINS = 'Drains the battery fast';
const TOSS = 'Costs a battery bar';
const CONTROLS: Record<'keys' | 'touch' | 'pad', ControlGroup[]> = {
  keys: [
    [
      'Moving',
      [
        ['Walk', ['W A S D']],
        ['Run', ['Shift']],
        ['Look', ['Mouse', '← → ↑ ↓']],
      ],
    ],
    [
      'Working',
      [
        ['Use, fix', ['E']],
        ['Peel a friend up, hide', ['Hold E']],
        ['Torch', ['F', 'Click']],
        ['Phone map', ['C'], DRAINS],
        ['Zoom the map', ['R']],
        ['Throw a Mini Biggs', ['G', 'Right click'], TOSS],
      ],
    ],
    [
      'At a breaker box',
      [
        ['Choose', ['W A S D', '1–5']],
        ['Act', ['E']],
        ['Let go', ['X']],
      ],
    ],
    [
      'When you are flat',
      [
        ['Call out', ['Q']],
        ['Watch a teammate', ['Space']],
      ],
    ],
  ],
  touch: [
    [
      'Moving',
      [
        ['Walk', ['Left thumb'], 'Anywhere on the left'],
        ['Look', ['Drag right']],
        ['Run', ['Run'], 'Lift to stop'],
      ],
    ],
    [
      'Working',
      [
        ['Use, fix', ['Use']],
        ['Peel a friend up, hide', ['Hold Use']],
        ['Torch', ['Torch']],
        ['Phone map', ['Phone'], DRAINS],
        ['Zoom the map', ['Map']],
        ['Throw a Mini Biggs', ['Biggs'], TOSS],
      ],
    ],
    ['At a breaker box', [['Choose and act', ['Tap the parts']]]],
  ],
  pad: [
    [
      'Moving',
      [
        ['Walk', ['Left stick']],
        ['Look', ['Right stick']],
        ['Run', ['LB']],
      ],
    ],
    [
      'Working',
      [
        ['Use, fix', ['A']],
        ['Torch', ['X']],
        ['Phone map', ['B'], DRAINS],
        ['Zoom the map', ['D-pad up']],
        ['Throw a Mini Biggs', ['RT'], TOSS],
        ['Pause', ['Start']],
      ],
    ],
    [
      'When you are flat',
      [
        ['Call out', ['Y']],
        ['Watch a teammate', ['RB']],
      ],
    ],
  ],
};
const controlGroups = (groups: ControlGroup[]): string =>
  groups
    .map(
      ([title, rows]) =>
        `<section><h3 class="ts-f-group">${title}</h3><dl class="kv ts-f-keys">${rows
          .map(
            ([what, how, note]) =>
              `<dt>${what}${note ? `<span class="cn-meta">${note}</span>` : ''}</dt><dd>${how.map(k => `<kbd class="ts-key">${k}</kbd>`).join('')}</dd>`
          )
          .join('')}</dl></section>`
    )
    .join('');

const el = (tag: string, cls: string, parent: Element): HTMLElement => {
  const e = document.createElement(tag);
  e.className = cls;
  parent.append(e);
  return e;
};
const set = (e: Node, text: string): void => {
  if (e.textContent !== text) e.textContent = text;
};
const html = (e: Cached, markup: string): void => {
  if (e._html !== markup) e.innerHTML = e._html = markup;
};
const data = (e: HTMLElement, key: string, v: string | boolean): void => {
  v = String(v);
  if (e.dataset[key] !== v) e.dataset[key] = v;
};
const esc = (s: string): string => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const angDiff = (a: number, b: number): number => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const metres = (d: number): string => `${Math.max(1, Math.round(d))} m`;
// "in the Kitchen", for a sentence.
export function where(p: Point): string {
  const name = ROOMS3[roomAt(p.x, p.z)]?.name;
  return !name ? 'somewhere' : name === 'Backstage' ? 'backstage' : `in the ${name}`;
}
const roomName = (p: Point): string => ROOMS3[roomAt(p.x, p.z)]?.name || '';

export function createHud(stage: Element, player: PlayerHandle) {
  const root = el('div', 'ts-fhud', stage);
  root.innerHTML = `
    <div class="ts-f-vignette"></div>
    <div class="ts-f-status">
      <div class="ts-f-time"><b></b><span></span></div>
      <div class="ts-f-power">${icon('bolt')}<div class="ts-f-bar"><i></i></div><span class="cn-tabular"></span></div>
      <ol class="ts-f-tasks" aria-label="Faults to fix"></ol>
    </div>
    <div class="ts-f-nav">
      <div class="ts-f-compass"></div>
      <div class="ts-f-toasts" role="status" aria-live="polite"></div>
    </div>
    <div class="ts-f-crew"></div>
    <div class="ts-f-dot"></div>
    <div class="ts-f-prompt">
      <div class="ts-f-prompt-row"><kbd class="ts-key"></kbd><span></span></div>
      <div class="ts-f-hold"><i></i></div>
    </div>
    <div class="ts-f-torch">
      <div class="ts-f-stam"><i></i></div>
      <div class="ts-f-torch-row">${icon('torch')}<div class="ts-f-cells">${'<i></i>'.repeat(CELLS)}</div><span></span></div>
      <div class="ts-f-toy" title="Mini Biggs: a throw costs one bar">${icon('toy')}<span></span><kbd class="ts-key">G</kbd></div>
    </div>
    <div class="ts-f-start"><b>Click, or press a key, to play</b><span><kbd class="ts-key">W A S D</kbd> walk <kbd class="ts-key">← → ↑ ↓</kbd> look <kbd class="ts-key">Shift</kbd> run <kbd class="ts-key">F</kbd> torch <kbd class="ts-key">E</kbd> use <kbd class="ts-key">C</kbd> phone <kbd class="ts-key">G</kbd> Mini Biggs <kbd class="ts-key">Esc</kbd> pause</span></div>
    <div class="ts-f-flat">
      <span class="tag cn-tone-danger">Flat</span>
      <b></b>
      <span></span>
      <div class="cn-cluster">
        <button class="btn btn-secondary is-sm" data-do="call"><kbd class="ts-key">Q</kbd><span>Call out</span></button>
        <button class="btn btn-secondary is-sm" data-do="watch"><kbd class="ts-key">Space</kbd><span></span></button>
      </div>
    </div>
    <div class="ts-f-menu">
      <button class="btn btn-ghost is-icon" data-do="pause" aria-label="Pause and settings">${icon('pause')}</button>
      ${canFullscreen ? `<button class="btn btn-ghost is-icon" data-do="full" aria-label="Fullscreen">${icon('full')}</button>` : ''}
    </div>
    <div class="ts-f-pause">
      <div class="ts-f-pause-in">
        <div class="ts-f-pause-side">
          <div class="ts-f-pause-head">
            <h2 class="ts-logo">Paused</h2>
            <p class="ts-f-pause-sub">The night is not.</p>
            <p class="cn-meta cn-m-0 ts-f-pause-when"></p>
          </div>
          <div class="ts-f-pause-go">
            <button class="btn btn-primary is-lg" data-do="resume">Back to work</button>
            ${canFullscreen ? '<button class="btn btn-ghost" data-do="full">Fullscreen</button>' : ''}
          </div>
          <p class="cn-meta cn-m-0 ts-f-pause-keys"><kbd class="ts-key">Enter</kbd> back to work <kbd class="ts-key">Esc</kbd> pause</p>
        </div>
        <div class="panel ts-f-pause-main" data-density="compact">
          <div class="segmented ts-f-tabs" role="tablist" aria-label="Pause menu">
            <button role="tab" data-tab="controls"><b>Controls</b></button>
            <button role="tab" data-tab="settings"><b>Settings</b></button>
            <button role="tab" data-tab="pad"><b>Gamepad</b></button>
          </div>
          <div class="ts-f-panes">
          <div class="ts-f-pane ts-f-groups" role="tabpanel" data-pane="controls"></div>
          <div class="ts-f-pane cn-stack cn-gap-16" role="tabpanel" data-pane="settings">
            <div class="field"><label for="ts-sens">Look sensitivity</label><input class="slider" id="ts-sens" type="range" min=".3" max="2.5" step=".1"><small></small></div>
            <label class="choice"><input class="switch" type="checkbox" id="ts-invert">Invert looking up and down</label>
            <label class="choice"><input class="switch" type="checkbox" id="ts-outline">Highlight things you can use</label>
            <label class="choice"><input class="switch" type="checkbox" id="ts-third">Watch teammates from behind when you are flat</label>
          </div>
          <div class="ts-f-pane ts-f-groups" role="tabpanel" data-pane="pad">${controlGroups(CONTROLS.pad)}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="ts-f-rotate"><div class="empty-state">${icon('rotate')}<strong>Turn your phone sideways</strong><span>The floor is walked in landscape.</span></div></div>`;
  const $ = (sel: string): HTMLElement => query(root, sel);
  const input = (sel: string): HTMLInputElement => query(root, sel, HTMLInputElement);
  const time = $('.ts-f-time > b'),
    night = $('.ts-f-time > span'),
    power = $('.ts-f-power'),
    powerBar = $('.ts-f-power i'),
    powerText = $('.ts-f-power > span');
  const compass = $('.ts-f-compass'),
    tasks = $('.ts-f-tasks'),
    toasts = $('.ts-f-toasts');
  const crew = $('.ts-f-crew'),
    dot = $('.ts-f-dot');
  const prompt = $('.ts-f-prompt'),
    promptKey = $('.ts-f-prompt-row > kbd'),
    promptText = $('.ts-f-prompt-row > span'),
    hold = $('.ts-f-hold'),
    holdBar = $('.ts-f-hold > i');
  const torch = $('.ts-f-torch'),
    stam = $('.ts-f-stam'),
    stamBar = $('.ts-f-stam > i'),
    cells = [...$('.ts-f-cells').children],
    torchText = $('.ts-f-torch-row > span');
  const toy = $('.ts-f-toy'),
    toyText = $('.ts-f-toy > span');
  const start = $('.ts-f-start'),
    flat = $('.ts-f-flat'),
    flatHow = $('.ts-f-flat > b'),
    flatSub = $('.ts-f-flat > b + span'),
    callText = $('[data-do="call"] span'),
    watchBtn = $('[data-do="watch"]'),
    watchText = $('[data-do="watch"] span');
  const pause = $('.ts-f-pause'),
    pauseIn = $('.ts-f-pause-in'),
    pauseWhen = $('.ts-f-pause-when'),
    keyList = $('[data-pane="controls"]'),
    padTab = $('[data-tab="pad"]'),
    sens = input('#ts-sens'),
    sensText = $('#ts-sens + small'),
    invert = input('#ts-invert'),
    outline = input('#ts-outline'),
    third = input('#ts-third');
  const touch = createTouch(root, player);
  // Compass ticks, by bearing. Yaw 0 faces south and grows toward east, as in player.ts.
  const ticks = (
    [
      ['S', 0],
      ['', Math.PI / 4],
      ['E', Math.PI / 2],
      ['', Math.PI * 0.75],
      ['N', Math.PI],
      ['', -Math.PI * 0.75],
      ['W', -Math.PI / 2],
      ['', -Math.PI / 4],
    ] satisfies [string, number][]
  ).map(([letter, b]) => {
    const e = el('span', 'ts-f-tick', compass);
    e.textContent = letter;
    return { e, b };
  });

  const actions: Record<string, () => void> = {
    resume: player.resume,
    pause: player.pause,
    call: player.call,
    watch: player.watchNext,
    full: toggleFullscreen,
  };
  // The pause screen opens on Controls. Touch has no gamepad tab. The panes share one cell and the others are
  // only made invisible, so the panel keeps the tallest one's size and the tabs stay put.
  const tabs = [...pause.querySelectorAll<HTMLElement>('[data-tab]')],
    panes = [...pause.querySelectorAll<HTMLElement>('[data-pane]')];
  const showTab = (name: string): void => {
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    }
    for (const p of panes) {
      const off = p.dataset.pane !== name;
      p.classList.toggle('is-off', off);
      p.inert = off;
    }
  };
  showTab('controls');
  root.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const name = e.target.closest<HTMLElement>('[data-do]')?.dataset.do,
      tab = e.target.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    // Every data-do in the markup is a key of actions.
    if (name) defined(actions[name], `HUD action ${name}`)();
    else if (tab) showTab(tab);
    else if (e.target === pause || e.target === pauseIn) player.resume(); // a click beside the panel
  });
  const showPrefs = (): void => {
    sens.value = String(prefs.sens);
    invert.checked = prefs.invert;
    outline.checked = prefs.outline;
    third.checked = prefs.third;
    set(sensText, `${Math.round(prefs.sens * 100)}% of normal`);
  };
  sens.oninput = () => {
    prefs.sens = +sens.value;
    savePrefs();
    showPrefs();
  };
  invert.onchange = () => {
    prefs.invert = invert.checked;
    savePrefs();
  };
  outline.onchange = () => {
    prefs.outline = outline.checked;
    savePrefs();
  };
  third.onchange = () => {
    prefs.third = third.checked;
    savePrefs();
  };

  /* ---------- toasts ---------- */

  let live: Toast[] = [];
  function drop(t: Toast): void {
    t.e.classList.add('is-gone');
    setTimeout(() => t.e.remove(), 400);
  }
  function say(text: string, kind: ToastKind = 'info', seconds = 4.5): void {
    const e = el('div', `ts-f-toast is-${kind}`, toasts),
      words = document.createElement('span');
    words.textContent = text;
    e.innerHTML = icon(TOAST_ICON[kind]);
    e.append(words);
    live.push({ e, until: performance.now() + seconds * 1000 });
    // Past the most the stage has room for, the oldest go.
    const room = MAX_TOASTS - +(root.clientHeight < SHORT);
    for (const t of live.splice(0, Math.max(0, live.length - room))) drop(t);
  }

  /* ---------- the compass ---------- */

  // Marks point along the walking route, not through the walls: nobody knows
  // the building on their first night. routes: key -> the leg to walk next.
  const routes = new Map<string, Leg>(),
    marks = new Map<string, MarkEl>(),
    pings = new Map<string, number>();
  let navAt = 0,
    navTurn = 0;
  function findRoute(S: State, me: Me, t: Mark): Leg {
    const r = route(me.x, me.z, t.x, t.z, { doors: S.doors }),
      path: NonEmpty<Point> = isNonEmpty(r.path) && !r.blocked ? r.path : [t];
    let far = 0,
      prev = path[0];
    for (const p of path.slice(1)) {
      far += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    const leg = { x: path[0].x, z: path[0].z, far };
    routes.set(t.key, leg);
    return leg;
  }
  // bat: this guard's torch battery, 0 to 1.
  function drawCompass(S: NightState, me: Me, bat: number, now: number): void {
    const list: Mark[] = [];
    // A breaker box hangs on a wall. Aim at the floor in front of it. S.faults has one entry per box.
    for (const [i, box] of BOXES.entries()) {
      const f = S.faults[i];
      if (f)
        list.push({
          key: `f${i}@${f.at}`,
          kind: 'fault',
          x: box.x + Math.sin(box.face) * 0.9,
          z: box.z + Math.cos(box.face) * 0.9,
          hot: faultLeft(S, f) < HURRY,
        });
    }
    // A guard who has not called has no ping.
    for (const p of S.players)
      if (p.flat && p.id !== game.myId && isPlaced(p))
        list.push({ key: `p${p.id}`, kind: 'flat', x: p.x, z: p.z, name: p.name, ping: (pings.get(p.id) ?? 0) > now });
    if (bat < LOW_BAT && S.power > 0) list.push({ key: 'dock', kind: 'dock', x: CHARGER.x, z: CHARGER.z - 0.9, name: 'charger' });
    if (S.power < GEN_MARK)
      list.push({ key: 'gen', kind: 'gen', x: GENERATOR.x + Math.sin(GENERATOR.face) * 0.9, z: GENERATOR.z + Math.cos(GENERATOR.face) * 0.9, name: 'crank' });
    // One mark's route is refreshed at a time, in turn.
    if (now - navAt > NAV_MS && list.length) {
      navAt = now;
      findRoute(S, me, defined(list[navTurn++ % list.length], 'compass mark'));
    }

    for (const t of ticks) {
      const off = -angDiff(t.b, me.yaw) / HALF_SPAN;
      t.e.hidden = Math.abs(off) > 1;
      t.e.style.left = `${50 + off * 50}%`;
    }
    let nearest: Placed | null = null;
    const shown: Placed[] = [];
    for (const t of list) {
      let r = routes.get(t.key) ?? findRoute(S, me, t);
      if (r.far && Math.hypot(r.x - me.x, r.z - me.z) < 1.2) r = findRoute(S, me, t); // reached the corner it pointed at
      const p: Placed = {
        ...t,
        dist: Math.hypot(r.x - me.x, r.z - me.z) + r.far,
        off: -angDiff(Math.atan2(r.x - me.x, r.z - me.z), me.yaw) / HALF_SPAN,
      };
      if (p.kind === 'fault' && (!nearest || p.dist < nearest.dist)) nearest = p;
      shown.push(p);
    }
    for (const t of shown) {
      const at = Math.max(-1, Math.min(1, t.off));
      let m = marks.get(t.key);
      if (!m) {
        const e = el('div', `ts-f-mark is-${t.kind}`, compass);
        e.innerHTML = '<i></i><b></b>';
        m = { e, label: query(e, 'b') };
        marks.set(t.key, m);
      }
      m.e.style.left = `${50 + at * 50}%`;
      // Off the end of the strip: it is that way, further round.
      data(m.e, 'side', t.off < -1 ? 'left' : t.off > 1 ? 'right' : '');
      m.e.classList.toggle('is-near', t === nearest);
      m.e.classList.toggle('is-ping', !!t.ping);
      m.e.classList.toggle('is-hot', !!t.hot);
      set(m.label, (t.name ? `${t.name} ` : '') + metres(t.dist));
    }
    for (const [key, m] of marks)
      if (!shown.some(t => t.key === key)) {
        m.e.remove();
        marks.delete(key);
        routes.delete(key);
      }
    spread(shown);
  }
  // Where labels would overlap, lay them side by side instead, centred on
  // where they wanted to be and kept inside the strip, so all stay readable.
  // The marks stay on their bearings. b._dx: how far a label is moved now,
  // so where it would sit unmoved can be measured.
  // Labels that would not fit in the strip side by side are hidden, furthest first, keeping their dots.
  // Every mark in list has its element in marks (drawCompass).
  function spread(list: Placed[]): void {
    const strip = compass.getBoundingClientRect(),
      W = strip.width,
      runs: Run[] = [];
    const place = (run: Run): number => Math.max(0, Math.min(W - run.w, run.mid - run.w / 2));
    const rank = (t: Mark): number => (t.kind === 'flat' || t.ping ? 0 : t.hot || t.kind === 'gen' || t.kind === 'dock' ? 1 : 2);
    let room = W + LABEL_GAP;
    const row = list
      .slice()
      .sort((a, c) => rank(a) - rank(c) || a.dist - c.dist)
      .flatMap(t => {
        const { e, label: b } = defined(marks.get(t.key), `compass mark ${t.key}`),
          r = b.getBoundingClientRect();
        room -= r.width + LABEL_GAP;
        e.classList.toggle('is-quiet', room < 0);
        return room < 0 ? [] : [{ b, x: r.left - (b._dx || 0) - strip.left, w: r.width }];
      })
      .sort((a, c) => a.x - c.x);
    for (const l of row) {
      let run: Run = { ls: [l], mid: l.x + l.w / 2, w: l.w };
      for (let last = runs.at(-1); last && place(last) + last.w + LABEL_GAP > place(run); last = runs.at(-1)) {
        runs.pop();
        const n = last.ls.length + run.ls.length;
        run = { ls: [...last.ls, ...run.ls], mid: (last.mid * last.ls.length + run.mid * run.ls.length) / n, w: last.w + LABEL_GAP + run.w };
      }
      runs.push(run);
    }
    for (const run of runs) {
      let x = place(run);
      for (const l of run.ls) {
        const dx = Math.round(x - l.x);
        if (dx !== (l.b._dx || 0)) {
          l.b._dx = dx;
          l.b.style.translate = dx ? `${dx}px 0` : '';
        }
        x += l.w + LABEL_GAP;
      }
    }
  }

  /* ---------- the task list ---------- */

  // Every open fault, nearest first: the room, the job, and the seconds before it starts to burn the building's ceiling.
  // A short stage shows fewer rows, so the list stops above the stick and the torch.
  function drawTasks(S: NightState, me: Me): void {
    // S.faults has one slot per box.
    const ours = BOXES.flatMap((box, i) => {
      const f = S.faults[i];
      return f ? [{ f, i, box, d: Math.hypot(box.x - me.x, box.z - me.z) }] : [];
    }).sort((a, b) => a.d - b.d);
    const fit = Math.max(2, Math.floor((root.clientHeight - TASK_TOP - TASK_FOOT[me.touch ? 'touch' : 'keys']) / TASK_ROW));
    const max = ours.length <= Math.min(fit, MAX_TASKS) ? ours.length : Math.max(1, Math.min(MAX_TASKS, fit - 1)); // the rest counted on one more row
    const rows = ours.slice(0, max).map(({ f, i, box }) => {
      const left = faultLeft(S, f),
        state = left <= 0 ? 'burn' : left < HURRY ? 'hot' : '';
      return `<li data-state="${state}"${me.task?.i === i ? ' class="is-here"' : ''}>${icon('fault')}<b>${esc(ROOMS3[box.room]?.name || '')}</b><span>${faultName(f.k)}</span><em class="cn-tabular">${left <= 0 ? 'burning' : `${Math.ceil(left)}s`}</em></li>`;
    });
    if (ours.length > max) rows.push(`<li class="is-more">${ours.length - max} more</li>`);
    if (!ours.length) rows.push(`<li class="is-clear">${icon('fault')}<span>No faults. Listen for the next one.</span></li>`);
    html(tasks, rows.join(''));
  }

  /* ---------- once a frame ---------- */

  let was = { bat: 1, power: 100, dry: 0, empty: 0 },
    calledAt = -1e9;
  return {
    root,
    say,
    // A night began (app.ts): the warnings about the torch and the power can be given again.
    reset(): void {
      was = { bat: 1, power: 100, dry: player.me.dry, empty: player.me.empty };
    },
    // Someone flat called out: their compass mark pulses for a few seconds.
    ping(id: string): void {
      if (id === game.myId) calledAt = performance.now();
      else pings.set(id, performance.now() + 4000);
    },
    // scared: the catch has the camera (actors/scare.ts), and the face fills the screen with nothing over it.
    update(S: State, me: Me, scared: boolean): void {
      // mine is undefined until this guard has joined the state.
      const now = performance.now(),
        mine = S.players.find(p => p.id === game.myId),
        bat = mine?.bat ?? 1;
      const mates: Guard[] = S.players.filter(isPlaced).filter(p => p.id !== game.myId);
      root.hidden = S.phase !== 'play' || !!scared;

      for (const t of live) if (now > t.until) drop(t);
      live = live.filter(t => !(now > t.until));
      if (root.hidden) return;
      data(root, 'flat', me.flat);
      data(root, 'hid', me.hid >= 0 && !me.flat);

      set(time, clockF(S));
      set(night, `Night ${S.night}`);
      powerBar.style.width = `${S.power}%`;
      set(powerText, S.power > 0 ? `${Math.ceil(S.power)}%` : 'Power out');
      data(power, 'level', S.power <= 0 ? 'out' : S.power < CRIT_POWER ? 'crit' : S.power < LOW_POWER ? 'low' : S.crank ? 'crank' : 'ok');
      if (S.power > 0 && S.power < LOW_POWER && was.power >= LOW_POWER) say('Power below 25%.', 'power', 7);
      was.power = S.power;

      // A night in play has its faults (startFloorNight sets them with the rest of the night).
      if (isNight(S)) {
        drawTasks(S, me);
        compass.hidden = me.flat;
        if (!me.flat) drawCompass(S, me, bat, now);
      }

      html(
        crew,
        mates
          .map(p =>
            p.flat
              ? `<div class="ts-f-mate is-flat"><span class="tag cn-tone-danger">flat</span><b>${esc(p.name)}</b><span>${esc(roomName(p))}</span></div>`
              : `<div class="ts-f-mate">${p.hid >= 0 ? '<span class="tag">locker</span>' : ''}<b>${esc(p.name)}</b><span>${esc(roomName(p))}</span></div>`
          )
          .join('')
      );

      // The torch: lit bars for charge, yellow while it is on, red and blinking when nearly out.
      const lit = Math.ceil(bat * CELLS - 0.001),
        state = bat <= 0 ? 'dead' : me.act === 'charge' ? 'charging' : bat < LOW_BAT ? 'low' : 'ok';
      torch.hidden = me.flat;
      cells.forEach((c, i) => {
        c.classList.toggle('is-full', i < lit);
      });
      // The phone draws on the same battery, four times as fast, so the bars count as on while it is up.
      data(torch, 'state', state);
      data(torch, 'on', me.on || me.ph);
      set(
        torchText,
        state === 'dead'
          ? 'Torch dead'
          : state === 'charging'
            ? 'Charging'
            : me.ph
              ? me.on
                ? 'Torch and phone'
                : 'Phone'
              : state === 'low'
                ? me.on
                  ? 'Torch low'
                  : 'Torch low, off'
                : me.on
                  ? ''
                  : 'Off'
      );
      if (bat < LOW_BAT && was.bat >= LOW_BAT) say('Torch low.', 'torch', 7);
      if (bat <= 0 && was.bat > 0) say('Torch dead.', 'torch', 6);
      was.bat = bat;
      // The Mini Biggs: in hand or on the floor somewhere, greyed out without it or the bar a throw costs, and a word
      // when they try anyway.
      set(toyText, mine?.toy ? 'Mini Biggs, 1 bar' : 'Mini Biggs on the floor');
      data(toy, 'ok', !!mine?.toy && bat >= TOY.cost);
      toy.classList.toggle('is-fresh', now - me.threw < 600);
      if (me.dry > was.dry) say('Not enough battery to throw.', 'toy', 4);
      if (me.empty > was.empty) say('No Mini Biggs in hand.', 'toy', 4);
      was.empty = me.empty;
      was.dry = me.dry;
      stam.hidden = me.stam >= 1;
      stamBar.style.width = `${me.stam * 100}%`;

      const t = me.target;
      dot.hidden = me.flat || me.paused;
      prompt.hidden = !t || !!me.task;
      if (t) {
        set(promptKey, me.touch ? 'Use' : 'E');
        set(promptText, (t.hold === 0 ? '' : 'Hold to ') + (t.hold === 0 ? t.label : t.label.charAt(0).toLowerCase() + t.label.slice(1)));
        hold.hidden = !(t.hold > 0);
        holdBar.style.width = `${Math.min(1, me.hold / t.hold) * 100}%`;
        prompt.classList.toggle('is-busy', me.hold > 0 || !!me.act);
      }

      flat.hidden = !me.flat || me.paused;
      if (me.flat) {
        const up = mates.filter(p => !p.flat),
          near = up.reduce<Guard | null>((a, p) => (!a || Math.hypot(p.x - me.x, p.z - me.z) < Math.hypot(a.x - me.x, a.z - me.z) ? p : a), null);
        // Watching nobody offers the first.
        const watched = up.find(p => p.id === me.watch),
          next = up[(watched ? up.indexOf(watched) : -1) + 1];
        // A flat guard has flatBy. One without it, or with -1, reads as flattened by something unnamed.
        const by = mine?.flatBy ?? -1;
        set(flatHow, by === -1 ? 'Something got you.' : `${MASC[by].name} ${HOW[by]}.`);
        set(
          flatSub,
          watched
            ? `Watching ${watched.name}, ${where(watched)}.`
            : near
              ? `You stay flat until someone peels you up. ${near.name} is ${metres(Math.hypot(near.x - me.x, near.z - me.z))} away.`
              : 'Nobody is left standing.'
        );
        set(callText, now - calledAt < F.CALL_GAP * 1000 ? 'Called' : 'Call out');
        watchBtn.hidden = !up.length;
        set(watchText, next ? `Watch ${next.name}` : 'Back to the floor');
      }

      start.hidden = me.locked || me.paused || me.flat;
      if (pause.hidden === me.paused) {
        pause.hidden = !me.paused;
        html(keyList, controlGroups(CONTROLS[me.touch ? 'touch' : 'keys']));
        padTab.hidden = me.touch;
        if (me.paused) set(pauseWhen, `Night ${S.night} of ${FINAL_NIGHT}, ${clockF(S)}`);
        showPrefs();
      }
      touch.sync();
    },
  };
}
