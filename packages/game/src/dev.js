// Dev menu. Loaded only when the URL has ?dev (see main.js). Toggle with ` or
// the Dev button beside pause and in the touch menu.
//
// Cheats that change the simulation live in S.dev, so packages/sim/src/sim.ts can read
// them and guests see their effects. Only the host can set them.
import { MASC, FINAL_NIGHT } from '@thick-shift/sim/config';
import { game } from './state.js';
import { F, hourF, clockF, dreadF, startFloorNight } from '@thick-shift/sim';
import { REST } from '@thick-shift/sim/map';
import { sim } from './net.js';

// The menu's controls are inputs and buttons. Typed as inputs, so .value and .checked check.
const $ = id => /** @type {HTMLInputElement} */ (document.getElementById(id));
const DEFAULTS = { god: false, power: false, freeze: false, wake: false, speed: 1, rot: -1, dread: -1 };
const SWITCHES = ['god', 'power', 'freeze', 'wake'];
const cheats = () => (game.S.dev ||= { ...DEFAULTS });
const playing = () => !!game.S && game.S.phase === 'play';
const STAGES = [
  [-1, 'Auto'],
  [0, 'Cute'],
  [1, 'Off'],
  [2, 'Rotten'],
];

const toggle = (id, label) => `<label class="choice"><input class="switch" type="checkbox" id="${id}">${label}</label>`;
const button = (id, label) => `<button class="btn btn-secondary is-sm" id="${id}">${label}</button>`;

const HTML = `
<header><h2>Dev menu</h2><div class="band-actions"><button class="btn btn-ghost is-sm" id="dv-close">Close</button></div></header>
<div class="cn-stack cn-gap-24 cn-p-24 ts-dev-body">
  <p class="cn-meta cn-m-0" id="dv-note"></p>
  <div class="cn-stack">
    ${toggle('dv-god', 'God mode: nothing can flatten you')}
    ${toggle('dv-power', 'Infinite power')}
    ${toggle('dv-freeze', 'Freeze mascots')}
    ${toggle('dv-wake', 'Wake every mascot now')}
  </div>
  <div class="cn-stack">
    <span class="cn-label">Rot stage</span>
    <div class="segmented" id="dv-rot">${STAGES.map(([v, l]) => `<button data-v="${v}" aria-pressed="false"><b>${l}</b></button>`).join('')}</div>
  </div>
  <div class="field"><label for="dv-speed">Game speed: <output id="dv-speed-out">1</output>x</label><input class="slider" type="range" id="dv-speed" min="1" max="12" step="1" value="1"></div>
  <div class="cn-stack">
    ${toggle('dv-dread-on', 'Override dread')}
    <div class="field"><label for="dv-dread">Dread: <output id="dv-dread-out">0</output>%</label><input class="slider" type="range" id="dv-dread" min="0" max="100" step="5" value="0"></div>
  </div>
  <div class="cn-cluster">
    ${button('dv-hour', '+1 hour')}${button('dv-late', 'Skip to 5:50')}${button('dv-win', 'Win night')}${button('dv-next', 'Next night')}${button('dv-final', 'Jump to last night')}
    ${button('dv-low', 'Power to 5%')}${button('dv-out', 'Power out')}${button('dv-bat', 'Fill every torch')}${button('dv-peel', 'Peel everyone up')}
  </div>
  <div class="cn-stack cn-divide" id="dv-mascots"></div>
  <dl class="kv" id="dv-read"></dl>
</div>`;

/* ---------- actions ---------- */

const ACTIONS = {
  'dv-hour'(S) {
    S.t = Math.min(6 * F.HOUR - 1, (hourF(S) + 1) * F.HOUR);
  },
  'dv-late'(S) {
    S.t = 6 * F.HOUR - F.HOUR / 6;
  },
  'dv-win'(S) {
    S.t = 6 * F.HOUR;
  },
  'dv-next'(S) {
    startFloorNight(sim, S, S.night + 1);
  },
  'dv-final'(S) {
    startFloorNight(sim, S, FINAL_NIGHT);
  },
  'dv-out'(S) {
    S.power = 0.01;
  },
  'dv-bat'(S) {
    for (const p of S.players) p.bat = 1;
  },
  'dv-peel'(S) {
    for (const p of S.players) p.flat = false;
  },
  'dv-low'(S) {
    S.power = 5;
  },
};

// Bring a mascot to stand in front of the host, or send it back to its mark.
const MASCOT_ACTIONS = {
  near(S, m) {
    const me = S.players.find(p => p.id === game.myId);
    if (!me || me.x == null) return;
    m.x = me.x + Math.sin(me.yaw) * 4;
    m.z = me.z + Math.cos(me.yaw) * 4;
    m.st = 'roam';
    cheats().wake = true;
  },
  home(S, m) {
    Object.assign(m, { x: REST[m.i].x, z: REST[m.i].z, yaw: REST[m.i].yaw, st: 'rest' });
  },
};

function bind(el) {
  const host = fn => () => {
    if (game.isHost && playing()) {
      fn(game.S);
      sync(el);
    }
  };
  for (const key of SWITCHES)
    $('dv-' + key).onchange = e => {
      if (game.isHost && game.S) cheats()[key] = /** @type {HTMLInputElement} */ (e.target).checked;
      sync(el);
    };
  $('dv-rot').onclick = e => {
    const b = /** @type {Element} */ (e.target).closest('button');
    if (b && game.isHost && game.S) {
      cheats().rot = +b.dataset.v;
      sync(el);
    }
  };
  $('dv-speed').oninput = e => {
    if (game.isHost && game.S) cheats().speed = +(/** @type {HTMLInputElement} */ (e.target).value);
    sync(el);
  };
  const dread = () => {
    if (game.isHost && game.S) cheats().dread = $('dv-dread-on').checked ? +$('dv-dread').value / 100 : -1;
    sync(el);
  };
  $('dv-dread-on').onchange = dread;
  $('dv-dread').oninput = dread;
  for (const id in ACTIONS) $(id).onclick = host(ACTIONS[id]);
  $('dv-mascots').onclick = e => {
    const b = /** @type {Element} */ (e.target).closest('button');
    if (b && game.isHost && playing()) {
      MASCOT_ACTIONS[b.dataset.act](game.S, game.S.m[+b.dataset.i]);
      sync(el);
    }
  };
  $('dv-close').onclick = () => el.close();
}

/* ---------- display ---------- */

// Bring every control in line with the state. Runs on a timer while the menu is open.
function sync(el) {
  const S = game.S,
    on = !!S && game.isHost;
  $('dv-note').textContent = !S ? 'Host a night to use these.' : game.isHost ? 'Changes apply to everyone in the room.' : 'Only the host can change the night.';
  for (const input of el.querySelectorAll('input, button')) if (input.id !== 'dv-close') input.disabled = !on;
  if (!S) return;
  const dv = cheats();
  for (const key of SWITCHES) $('dv-' + key).checked = dv[key];
  for (const b of /** @type {HTMLCollectionOf<HTMLElement>} */ ($('dv-rot').children)) b.setAttribute('aria-pressed', String(+b.dataset.v === dv.rot));
  $('dv-speed').value = String(dv.speed);
  $('dv-speed-out').textContent = dv.speed;
  $('dv-dread-on').checked = dv.dread >= 0;
  if (dv.dread >= 0) $('dv-dread').value = String(Math.round(dv.dread * 100));
  $('dv-dread-out').textContent = String(Math.round(dreadF(S) * 100));
  $('dv-mascots').innerHTML = S.m
    .map(
      m => `<div class="cn-row cn-between cn-wrap cn-py-8"><span><b class="cn-name">${MASC[m.i].name}</b><br><span class="cn-meta">${m.st}, stage ${m.rot || 0}, ${Math.round((m.ire || 0) * 18)} s in a beam</span></span>
    <span class="cn-cluster">${[
      ['near', 'In front of me'],
      ['home', 'Send home'],
    ]
      .map(([a, l]) => `<button class="btn btn-ghost is-sm" data-act="${a}" data-i="${m.i}"${on ? '' : ' disabled'}>${l}</button>`)
      .join('')}</span></div>`
    )
    .join('');
  const row = (k, v) => `<dt>${k}</dt><dd class="cn-tabular">${v}</dd>`;
  $('dv-read').innerHTML =
    row('Phase', S.phase) +
    row('Night', `${S.night}, ${clockF(S)} (${(S.t / F.HOUR).toFixed(2)} h)`) +
    row('Power', `${Math.round(S.power)}% of ${Math.round(S.cap ?? 100)}%${S.out ? ', out' : ''}${S.crank ? ', cranking' : ''}`) +
    row('Faults open', (S.faults || []).filter(Boolean).length) +
    row('Mascots stirring', S.stir ? 'yes' : 'no') +
    row('Guards', S.players.map(p => `${p.name} ${Math.round((p.bat ?? 1) * 100)}%${p.flat ? ' flat' : ''}`).join(', '));
}

export function mountDev() {
  const el = document.createElement('dialog');
  el.className = 'drawer ts-dev';
  el.id = 'dev';
  el.innerHTML = HTML;
  document.body.append(el);
  bind(el);
  // show(), not showModal(): the game stays playable. Opening it lets go of the mouse, so the game pauses behind it.
  const flip = () => {
    if (el.open) el.close();
    else {
      if (document.pointerLockElement) document.exitPointerLock();
      el.show();
      sync(el);
    }
  };
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost';
  btn.textContent = 'Dev';
  btn.onclick = flip;
  // Once the HUD exists, add Dev buttons to the touch menu and the pause panel.
  const watch = setInterval(() => {
    const spots = [document.querySelector('.ts-f-menu'), document.querySelector('.ts-f-pause-go')];
    if (!spots[0]) return;
    clearInterval(watch);
    for (const spot of spots)
      if (spot) {
        const b2 = /** @type {HTMLElement} */ (btn.cloneNode(true));
        b2.onclick = flip;
        spot.append(b2);
      }
  }, 1000);
  addEventListener('keydown', e => {
    if (e.key === '`' && /** @type {Element} */ (e.target).tagName !== 'INPUT') flip();
  });
  // Skip the mascot list while the pointer is on it, or the buttons get rebuilt mid-click.
  setInterval(() => {
    if (el.open && !$('dv-mascots').matches(':hover')) sync(el);
  }, 400);
}
