// Dev menu. Loaded only when the URL has ?dev (see main.js). Toggle with ` or
// the Dev button (in the control bar, or beside pause in the 3D mode). On a
// floor night (S.mode 'floor') it shows the 3D mode's controls instead of the booth's.
//
// Cheats that change the simulation live in S.dev, so sim.js and rules.js can
// read them and guests see their effects. Only the host can set them.
import { MASC, ROOMS, DOORS, HOUR, FINAL_NIGHT } from './config.js';
import { game, client } from './state.js';
import { rotOf, dreadOf, threatOf, roomOf, hourOf, doorWait, isActive, maxAttacks, crankerOf } from './rules.js';
import { startNight } from './sim.js';
import { F, hourF, clockF, startFloorNight } from './three/sim3d.js';
import { REST } from './three/map.js';

const $ = id => document.getElementById(id);
const DEFAULTS = { god: false, power: false, freeze: false, wake: false, cold: false, speed: 1, rot: -1, dread: -1 };
const SWITCHES = ['god', 'power', 'freeze', 'wake', 'cold'];
const cheats = () => (game.S.dev ||= { ...DEFAULTS });
const playing = () => !!game.S && game.S.phase === 'play';
const STAGES = [[-1, 'Auto'], [0, 'Cute'], [1, 'Off'], [2, 'Rotten']];

const toggle = (id, label) => `<label class="choice"><input class="switch" type="checkbox" id="${id}">${label}</label>`;
const button = (id, label) => `<button class="btn btn-secondary is-sm" id="${id}">${label}</button>`;

const HTML = `
<header><h2>Dev menu</h2><div class="band-actions"><button class="btn btn-ghost is-sm" id="dv-close">Close</button></div></header>
<div class="cn-stack cn-gap-24 cn-p-24 ts-dev-body">
  <p class="cn-meta cn-m-0" id="dv-note"></p>
  <div class="cn-stack">
    ${toggle('dv-god', 'God mode: open doors count as shut')}
    ${toggle('dv-power', 'Infinite power')}
    ${toggle('dv-freeze', 'Freeze mascots')}
    ${toggle('dv-wake', 'Wake every mascot now')}
    ${toggle('dv-cold', 'Cold motors: doors and the generator never overheat')}
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
    ${button('dv-low', 'Power to 5%')}
    <span class="ts-dev-booth">${button('dv-sane', 'Sanity to 15%')}${button('dv-signal', 'Kill camera signal')}
    ${button('dv-hot', 'Door heat to 85%')}${button('dv-trip', 'Trip left door')}${button('dv-seize', 'Seize generator')}</span>
    <span class="ts-dev-floor">${button('dv-out', 'Power out')}${button('dv-bat', 'Fill every torch')}${button('dv-peel', 'Peel everyone up')}</span>
  </div>
  <div class="cn-stack cn-divide" id="dv-mascots"></div>
  <dl class="kv" id="dv-read"></dl>
</div>`;

/* ---------- actions ---------- */

const floor = S => S?.mode === 'floor';
const hourLen = S => floor(S) ? F.HOUR : HOUR;
const ACTIONS = {
  'dv-hour'(S) { S.t = Math.min(6 * hourLen(S) - 1, ((floor(S) ? hourF(S) : hourOf(S)) + 1) * hourLen(S)); },
  'dv-late'(S) { S.t = 6 * hourLen(S) - hourLen(S) / 6; },
  'dv-win'(S) { S.t = 6 * hourLen(S); },
  'dv-next'(S) { (floor(S) ? startFloorNight : startNight)(S.night + 1); },
  'dv-final'(S) { (floor(S) ? startFloorNight : startNight)(FINAL_NIGHT); },
  'dv-out'(S) { S.power = .01; },
  'dv-bat'(S) { for (const p of S.players) p.bat = 1; },
  'dv-peel'(S) { for (const p of S.players) p.flat = false; },
  'dv-low'(S) { S.power = 5; },
  'dv-sane'(S) { for (const id in game.players) game.players[id].sanity = .15; },
  // These set the heat and leave the tripping and seizing to sim.js, so the events and sounds are the real ones.
  // sim.js tests for a trip or a seize before it heats or cools, so they work with Cold motors on and nobody turning.
  'dv-hot'(S) { for (const k of DOORS) S.heat[k] = Math.max(S.heat[k], .85); },
  'dv-trip'(S) { S.doors.L = true; S.heat.L = 1; },
  'dv-seize'(S) { S.gen = 1; },
};

// The 3D mode's mascots walk the building: bring one to stand in front of the host, or send it back to its mark.
const FLOOR_MASCOT_ACTIONS = {
  near(S, m) {
    const me = S.players.find(p => p.id === game.myId); if (!me || me.x == null) return;
    m.x = me.x + Math.sin(me.yaw) * 4; m.z = me.z + Math.cos(me.yaw) * 4; m.st = 'roam'; cheats().wake = true;
  },
  home(S, m) { Object.assign(m, { x: REST[m.i].x, z: REST[m.i].z, yaw: REST[m.i].yaw, st: 'rest' }); },
};
const MASCOT_ACTIONS = {
  door(S, m) { const path = MASC[m.i].paths[m.side]; m.pos = path.length - 1; m.wait = doorWait(S.night); cheats().wake = true; },
  home(S, m) { m.pos = 0; m.timer = 8; },
  scare(S, m) { S.phase = 'dead'; S.killer = m.i; S.evs.push({ id: ++S.evId, type: 'scare' }); },
};

function bind(el) {
  const host = fn => () => { if (game.isHost && playing()) { fn(game.S); sync(el); } };
  for (const key of SWITCHES) $('dv-' + key).onchange = e => { if (game.isHost && game.S) cheats()[key] = e.target.checked; sync(el); };
  $('dv-rot').onclick = e => { const b = e.target.closest('button'); if (b && game.isHost && game.S) { cheats().rot = +b.dataset.v; sync(el); } };
  $('dv-speed').oninput = e => { if (game.isHost && game.S) cheats().speed = +e.target.value; sync(el); };
  const dread = () => { if (game.isHost && game.S) cheats().dread = $('dv-dread-on').checked ? $('dv-dread').value / 100 : -1; sync(el); };
  $('dv-dread-on').onchange = dread; $('dv-dread').oninput = dread;
  for (const id in ACTIONS) $(id).onclick = host(ACTIONS[id]);
  $('dv-signal').onclick = () => { client.signal = 0; };   // per player, so guests can use it too
  $('dv-mascots').onclick = e => {
    const b = e.target.closest('button');
    if (b && game.isHost && playing()) { (floor(game.S) ? FLOOR_MASCOT_ACTIONS : MASCOT_ACTIONS)[b.dataset.act](game.S, game.S.m[+b.dataset.i]); sync(el); }
  };
  $('dv-close').onclick = () => el.close();
}

/* ---------- display ---------- */

// Bring every control in line with the state. Runs on a timer while the menu is open.
function sync(el) {
  const S = game.S, on = !!S && game.isHost;
  $('dv-note').textContent = !S ? 'Host a night to use these.' : game.isHost ? 'Changes apply to everyone in the room.' : 'Only the host can change the night. You can still kill your own camera signal.';
  for (const input of el.querySelectorAll('input, button')) if (input.id !== 'dv-close' && input.id !== 'dv-signal') input.disabled = !on;
  if (!S) return;
  const dv = cheats(), fl = floor(S);
  el.dataset.mode = fl ? 'floor' : 'booth';
  $('dv-god').parentElement.lastChild.textContent = fl ? 'God mode: nothing can flatten you' : 'God mode: open doors count as shut';
  for (const key of SWITCHES) $('dv-' + key).checked = dv[key];
  for (const b of $('dv-rot').children) b.setAttribute('aria-pressed', String(+b.dataset.v === dv.rot));
  $('dv-speed').value = dv.speed; $('dv-speed-out').textContent = dv.speed;
  $('dv-dread-on').checked = dv.dread >= 0;
  if (dv.dread >= 0) $('dv-dread').value = Math.round(dv.dread * 100);
  $('dv-dread-out').textContent = Math.round(dreadOf(S) * 100);
  if (fl) { syncFloor(S, on); return; }
  $('dv-mascots').innerHTML = S.m.map(m => {
    const where = isActive(S, m) ? ROOMS[roomOf(m)] : 'asleep';
    return `<div class="cn-row cn-between cn-wrap cn-py-8"><span><b class="cn-name">${MASC[m.i].name}</b><br><span class="cn-meta">${where}, stage ${rotOf(S, m)}, ${m.bangs || 0} slams</span></span>
      <span class="cn-cluster">${['door', 'home', 'scare'].map(a => `<button class="btn btn-ghost is-sm" data-act="${a}" data-i="${m.i}"${on ? '' : ' disabled'}>${{ door: 'To door', home: 'Send home', scare: 'Jumpscare' }[a]}</button>`).join('')}</span></div>`;
  }).join('');
  const row = (k, v) => `<dt>${k}</dt><dd class="cn-tabular">${v}</dd>`;
  $('dv-read').innerHTML = row('Phase', S.phase) + row('Night time', (S.t / HOUR).toFixed(2) + ' h') + row('Threat', threatOf(S).toFixed(2)) + row('Quiet for', Math.max(0, (S.calmUntil || 0) - S.t).toFixed(0) + ' s' + (S.pair ? ', then a pair' : '')) + row('Camera signal', Math.round(client.signal * 100) + '%') + row('Sanity', S.players.map(p => Math.round((p.sanity ?? 1) * 100) + '%').join(', ')) + row('Guards', S.players.length)
    + row('Attacks', `${S.attacks} of ${maxAttacks(S)}`)
    + row('Door heat', DOORS.map(k => `${k} ${Math.round((S.heat?.[k] || 0) * 100)}%${S.trip?.[k] ? ' tripped' : ''}`).join(', '))
    + row('Generator heat', Math.round((S.gen || 0) * 100) + '%' + (S.seized ? ' seized' : '') + (crankerOf(S) ? ', handle taken' : ''));
}

// The floor's mascot list and readout.
function syncFloor(S, on) {
  $('dv-mascots').innerHTML = S.m.map(m => `<div class="cn-row cn-between cn-wrap cn-py-8"><span><b class="cn-name">${MASC[m.i].name}</b><br><span class="cn-meta">${m.st}, stage ${m.rot || 0}, ${Math.round((m.ire || 0) * 18)} s in a beam</span></span>
    <span class="cn-cluster">${[['near', 'In front of me'], ['home', 'Send home']].map(([a, l]) => `<button class="btn btn-ghost is-sm" data-act="${a}" data-i="${m.i}"${on ? '' : ' disabled'}>${l}</button>`).join('')}</span></div>`).join('');
  const row = (k, v) => `<dt>${k}</dt><dd class="cn-tabular">${v}</dd>`;
  $('dv-read').innerHTML = row('Phase', S.phase) + row('Night', `${S.night}, ${clockF(S)} (${(S.t / F.HOUR).toFixed(2)} h)`)
    + row('Power', `${Math.round(S.power)}% of ${Math.round(S.cap ?? 100)}%${S.out ? ', out' : ''}${S.crank ? ', cranking' : ''}`)
    + row('Faults open', (S.faults || []).filter(Boolean).length) + row('Mascots stirring', S.stir ? 'yes' : 'no')
    + row('Guards', S.players.map(p => `${p.name} ${Math.round((p.bat ?? 1) * 100)}%${p.flat ? ' flat' : ''}`).join(', '));
}

export function mountDev() {
  const el = document.createElement('dialog');
  el.className = 'drawer ts-dev';
  el.id = 'dev';
  el.innerHTML = HTML;
  document.body.append(el);
  bind(el);
  // show(), not showModal(): the game stays playable. Opening it lets go of the mouse, so the 3D mode pauses behind it.
  const flip = () => { if (el.open) el.close(); else { if (document.pointerLockElement) document.exitPointerLock(); el.show(); sync(el); } };
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost';
  btn.textContent = 'Dev';
  btn.onclick = flip;
  $('hud').append(btn);
  // The 3D mode hides the control bar: once its HUD exists, add Dev buttons to the touch menu and the pause panel.
  const watch = setInterval(() => {
    const spots = [document.querySelector('.ts-f-menu'), document.querySelector('.ts-f-pause .panel-footer')];
    if (!spots[0]) return;
    clearInterval(watch);
    for (const spot of spots) if (spot) { const b2 = btn.cloneNode(true); b2.onclick = flip; spot.append(b2); }
  }, 1000);
  addEventListener('keydown', e => { if (e.key === '`' && e.target.tagName !== 'INPUT') flip(); });
  // Skip the mascot list while the pointer is on it, or the buttons get rebuilt mid-click.
  setInterval(() => { if (el.open && !$('dv-mascots').matches(':hover')) sync(el); }, 400);
}
