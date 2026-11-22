// Dev menu. Loaded only when the URL has ?dev (see main.ts). Toggle with ` or
// the Dev button beside pause and in the touch menu.
//
// Every control sends a dev command (devFloor in packages/sim/src/session.ts) to whoever runs the night, so anyone in
// the room can use it and everyone sees the effect. Switches live in S.dev, where the sim reads them.

import { clockF, DEV_OFF, dreadF, F } from '@thick-shift/sim';
import { MASC } from '@thick-shift/sim/config';
import type { Dev, DevCommand, DevDo } from '@thick-shift/sim/types';
import { byId } from './dom';
import { send } from './net';
import { game } from './state';

// The menu's sliders and switches.
const input = (id: string): HTMLInputElement => byId(id, HTMLInputElement);
const SWITCHES = [
  ['god', 'God mode: nothing can flatten you'],
  ['power', 'Infinite power'],
  ['freeze', 'Freeze mascots'],
  ['wake', 'Wake every mascot now'],
] as const;
// The buttons: the dev command each sends, and its label. Each does nothing outside a night.
const ACTIONS: [DevDo, string][] = [
  ['hour', '+1 hour'],
  ['late', 'Skip to 5:50'],
  ['win', 'Win night'],
  ['next', 'Next night'],
  ['final', 'Jump to last night'],
  ['low', 'Power to 5%'],
  ['out', 'Power out'],
  ['bat', 'Fill every torch'],
  ['peel', 'Peel everyone up'],
];
// The night's cheats as the last state had them, with a missing field off.
const cheats = (): Dev => ({ ...DEV_OFF, ...game.S?.dev });
const dev = (c: DevCommand): void => {
  if (game.S) send(c);
};
const STAGES: [number, string][] = [
  [-1, 'Auto'],
  [0, 'Cute'],
  [1, 'Off'],
  [2, 'Rotten'],
];

const toggle = (id: string, label: string): string => `<label class="choice"><input class="switch" type="checkbox" id="${id}">${label}</label>`;
const button = (id: string, label: string): string => `<button class="btn btn-secondary is-sm" id="${id}">${label}</button>`;

const HTML = `
<header><h2>Dev menu</h2><div class="band-actions"><button class="btn btn-ghost is-sm" id="dv-close">Close</button></div></header>
<div class="cn-stack cn-gap-24 cn-p-24 ts-dev-body">
  <p class="cn-meta cn-m-0" id="dv-note"></p>
  <div class="cn-stack">
    ${SWITCHES.map(([key, label]) => toggle(`dv-${key}`, label)).join('')}
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
  <div class="cn-cluster">${ACTIONS.map(([what, label]) => button(`dv-${what}`, label)).join('')}</div>
  <div class="cn-stack cn-divide" id="dv-mascots"></div>
  <dl class="kv" id="dv-read"></dl>
</div>`;

/* ---------- actions ---------- */

function bind(el: HTMLDialogElement): void {
  // The controls catch up with the change when the next state arrives (the timer in mountDev).
  const set = (c: Partial<Dev>): void => dev({ t: 'dev', set: c });
  for (const [key] of SWITCHES) {
    const box = input(`dv-${key}`);
    box.onchange = () => set({ [key]: box.checked });
  }
  byId('dv-rot').onclick = e => {
    const b = e.target instanceof Element && e.target.closest('button');
    if (b) set({ rot: Number(b.dataset.v) });
  };
  const speed = input('dv-speed');
  speed.oninput = () => set({ speed: Number(speed.value) });
  // Moving the slider overrides dread, so it does not read the switch, which the room may not have confirmed yet.
  const level = (): number => Number(input('dv-dread').value) / 100;
  input('dv-dread-on').onchange = () => set({ dread: input('dv-dread-on').checked ? level() : -1 });
  input('dv-dread').oninput = () => set({ dread: level() });
  for (const [what] of ACTIONS) byId(`dv-${what}`).onclick = () => dev({ t: 'dev', do: what });
  byId('dv-mascots').onclick = e => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    // sync builds every button in the list with data-act, 'near' or 'home', and data-i, the mascot's MASC index.
    const act = b?.dataset.act;
    if (b && (act === 'near' || act === 'home')) dev({ t: 'dev', do: act, i: Number(b.dataset.i) });
  };
  byId('dv-close').onclick = () => el.close();
}

/* ---------- display ---------- */

// Bring every control in line with the state. Runs on a timer while the menu is open.
function sync(el: HTMLDialogElement): void {
  const S = game.S,
    on = !!S;
  byId('dv-note').textContent = S ? 'Changes apply to everyone in the room.' : 'Host or join a night to use these.';
  for (const control of el.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')) if (control.id !== 'dv-close') control.disabled = !on;
  if (!S) return;
  const dv = cheats();
  for (const [key] of SWITCHES) input(`dv-${key}`).checked = dv[key];
  for (const b of byId('dv-rot').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === dv.rot));
  input('dv-speed').value = String(dv.speed);
  byId('dv-speed-out').textContent = String(dv.speed);
  input('dv-dread-on').checked = dv.dread >= 0;
  if (dv.dread >= 0) input('dv-dread').value = String(Math.round(dv.dread * 100));
  byId('dv-dread-out').textContent = String(Math.round(dreadF(S) * 100));
  byId('dv-mascots').innerHTML = S.m
    .map(
      m => `<div class="cn-row cn-between cn-wrap cn-py-8"><span><b class="cn-name">${MASC[m.i].name}</b><br><span class="cn-meta">${m.st}, stage ${m.rot}, ire ${m.ire.toFixed(2)}</span></span>
    <span class="cn-cluster">${[
      ['near', 'In front of me'],
      ['home', 'Send home'],
    ]
      .map(([a, l]) => `<button class="btn btn-ghost is-sm" data-act="${a}" data-i="${m.i}"${on ? '' : ' disabled'}>${l}</button>`)
      .join('')}</span></div>`
    )
    .join('');
  const row = (k: string, v: string | number): string => `<dt>${k}</dt><dd class="cn-tabular">${v}</dd>`;
  byId('dv-read').innerHTML =
    row('Phase', S.phase) +
    row('Night', `${S.night}, ${clockF(S)} (${(S.t / F.HOUR).toFixed(2)} h)`) +
    row('Power', `${Math.round(S.power)}% of ${Math.round(S.cap ?? 100)}%${S.out ? ', out' : ''}${S.crank ? ', cranking' : ''}`) +
    row('Faults open', (S.faults || []).filter(Boolean).length) +
    row('Mascots stirring', S.stir ? 'yes' : 'no') +
    row('Guards', S.players.map(p => `${p.name} ${Math.round((p.bat ?? 1) * 100)}%${p.flat ? ' flat' : ''}`).join(', '));
}

export function mountDev(): void {
  const el = document.createElement('dialog');
  el.className = 'drawer ts-dev';
  el.id = 'dev';
  el.innerHTML = HTML;
  document.body.append(el);
  bind(el);
  // show(), not showModal(): the game stays playable. Opening it lets go of the mouse, so the game pauses behind it.
  const flip = (): void => {
    if (el.open) el.close();
    else {
      if (document.pointerLockElement) document.exitPointerLock();
      el.show();
      sync(el);
    }
  };
  const devButton = (): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = 'Dev';
    btn.onclick = flip;
    return btn;
  };
  // Once the HUD exists, add Dev buttons to the touch menu and the pause panel.
  const watch = setInterval(() => {
    const menu = document.querySelector('.ts-f-menu');
    if (!menu) return;
    clearInterval(watch);
    menu.append(devButton());
    document.querySelector('.ts-f-pause-go')?.append(devButton());
  }, 1000);
  addEventListener('keydown', e => {
    if (e.key === '`' && !(e.target instanceof HTMLInputElement)) flip();
  });
  // Skip the mascot list while the pointer is on it, or the buttons get rebuilt mid-click.
  setInterval(() => {
    if (el.open && !byId('dv-mascots').matches(':hover')) sync(el);
  }, 400);
}
