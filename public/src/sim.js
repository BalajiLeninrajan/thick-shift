// Host-side simulation. Only the host calls step() and act().
import { MASC, DOORKEY, DOORS, HOUR } from './config.js';
import { game, rnd } from './state.js';
import { isActive, doorWait } from './rules.js';

const OPEN = () => ({ L: false, V: false, R: false });

export function newState(code) {
  return { phase: 'lobby', night: 1, t: 0, power: 100, doors: OPEN(), m: [], players: [], killer: -1, evs: [], evId: 0, code };
}

// Events are how the host tells clients to play a sound or shake the screen.
function emit(type, x) {
  const S = game.S;
  S.evs.push({ id: ++S.evId, type, x });
  if (S.evs.length > 8) S.evs.shift();
}

export function startNight(n) {
  const S = game.S;
  Object.assign(S, { phase: 'play', night: n, t: 0, power: 100, doors: OPEN(), killer: -1 });
  S.m = MASC.map((d, i) => ({ i, pos: 0, side: 0, timer: rnd(6, 12), wait: 0, bangs: 0 }));
  for (const id in game.players) game.players[id].view = 'office';
}

function drainPower(S, dt) {
  const closed = DOORS.filter(k => S.doors[k]).length;
  const count = v => S.players.filter(p => p.view === v).length;
  const was = S.power;
  const drain = .11 + .2 * closed + .07 * count('cams');
  S.power = Math.max(0, Math.min(100, S.power - drain * dt + .5 * count('crank') * dt));
  if (S.dev?.power) S.power = 100;
  if (S.power <= 0) {
    if (was > 0) emit('out');
    S.doors = OPEN();
  }
}

// Returns false when the mascot got in and the night is over.
function moveMascot(S, m, dt, hour) {
  const d = MASC[m.i], path = d.paths[m.side], last = path.length - 1;
  if (m.pos === last) {
    m.wait -= dt;
    if (m.wait > 0) return true;
    const k = DOORKEY[path[m.pos]];
    // In god mode an open door turns it away like a shut one.
    if (!S.doors[k] && !S.dev?.god) { S.phase = 'dead'; S.killer = m.i; emit('scare'); return false; }
    emit('bang', k);
    m.bangs++;   // being shut out makes it worse (see rotOf)
    m.pos = path.length > 2 ? 1 : 0;
    m.timer = rnd(5, 9);
    return true;
  }
  m.timer -= dt;
  if (m.timer > 0) return true;
  m.timer = rnd(3, 6);
  const guards = S.players.length || 1;
  const cranking = S.players.some(p => p.view === 'crank');
  const chance = (.24 + .07 * S.night + .04 * hour) * d.ag * (1 + .2 * (guards - 1)) * (cranking ? 1.25 : 1);
  if (Math.random() >= chance) return true;
  if (m.pos === 0 && d.paths.length > 1) m.side = Math.random() < .5 ? 0 : 1;
  m.pos++;
  if (m.pos === d.paths[m.side].length - 1) { m.wait = doorWait(S.night); emit('arrive'); }
  else emit('step');
  return true;
}

let lastStep = performance.now();
export function step() {
  const S = game.S, now = performance.now();
  const dt = Math.min(1.5, (now - lastStep) / 1000) * (S.dev?.speed || 1);   // S.dev: cheats from the dev menu (dev.js)
  lastStep = now;
  S.players = Object.values(game.players);
  if (S.phase !== 'play') return;
  const hourBefore = Math.floor(S.t / HOUR);
  S.t += dt;
  const hour = Math.floor(S.t / HOUR);
  if (hour > hourBefore) emit('hour');
  if (hour >= 6) { S.phase = 'win'; emit('win'); return; }
  drainPower(S, dt);
  if (S.dev?.freeze) return;
  for (const m of S.m) if (isActive(S, m) && !moveMascot(S, m, dt, hour)) return;
}

// Apply one player's action. Guests send these to the host over the wire.
export function act(pid, a) {
  const S = game.S, p = game.players[pid];
  if (a.t === 'view') { if (p) p.view = a.v; return; }
  if (a.t === 'name') { if (p) p.name = String(a.n || 'Guard').slice(0, 12); return; }
  if (a.t === 'door' && S.phase === 'play' && S.power > 0 && DOORS.includes(a.k)) { S.doors[a.k] = !S.doors[a.k]; emit('door'); }
}
