// Room hosting and joining. The host runs the simulation and sends the whole
// state to every guest ten times a second, through a WebSocket relay on the
// same origin (worker/room.js). If the host leaves, the relay makes the guest
// who has been there longest the host, and the night carries on (takeOver).
// When an app fixes the room (platform.fixedRoom, as the Discord Activity does), nobody
// chooses to host: everyone tries to, and whoever finds it taken joins instead (becomeGuest).
import { game, platform } from './state.js';
import { newSim, newState, stepFloor, actFloor, adoptFloor } from '@thick-shift/sim';

const TICK_MS = 100;
const NO_HOST = 4404,
  CODE_TAKEN = 4409; // close codes from the relay
const MAX_BACKLOG = 256 * 1024; // bytes queued before the host skips a state

// The host's side of the night, which S does not carry: the guards in the room (sim.players, peer id -> that guard's
// record in S.players) and what the mascots are thinking. Made at import, so the first step measures its time from
// when the page loaded. A guest's stays empty until a takeover makes it the host. The game's draws are not seeded.
export const sim = newSim({ rng: Math.random, now: performance.now() });
let ws = null,
  loop = 0;

const roomUrl = (code, query) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/room/${code}?${query}`;
const ROOM = /^([A-Z]{4}|[a-z]-[\w-]{1,80})$/; // a typed code, or a fixed one from an app's platform (worker/room.js)
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
const parse = text => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const guard = (id, name = 'Guard') => ({ id, name });

function broadcast() {
  const guests = Object.keys(sim.players).length - 1;
  if (guests > 0 && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BACKLOG) ws.send(JSON.stringify({ t: 's', s: game.S }));
}

// Tell the relay when this tab goes to the background, where timers crawl, so it hands the room to a guest who
// is looking. Plain words, not JSON, so the relay can pick them out without parsing every message.
const showing = () => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(document.hidden ? 'hidden' : 'shown');
};
document.addEventListener('visibilitychange', showing);

const run = () => {
  loop ||= setInterval(() => {
    stepFloor(sim, game.S, performance.now());
    broadcast();
  }, TICK_MS);
};

// The host's end of the socket: one it opened, or a guest's that the relay handed the room to.
function hostRoom(sock, opened) {
  ws = sock;
  ws.onopen = () => {
    opened = true;
    game.netNote = '';
  };
  ws.onmessage = e => {
    const m = parse(e.data),
      id = m?.from,
      d = m?.d;
    if (typeof id !== 'string' || id === game.myId || !d) return;
    if (d.t === 'join') sim.players[id] = guard(id);
    else if (d.t === 'leave') delete sim.players[id];
    else actFloor(sim, game.S, id, d);
  };
  ws.onclose = e => {
    // Someone else is hosting under this code. In a fixed room that is everyone else, so go and join them.
    // Otherwise nobody has joined yet, so take another code.
    if (e.code === CODE_TAKEN && platform.fixedRoom) return becomeGuest();
    if (e.code === CODE_TAKEN) {
      game.code = game.S.code = newCode();
      return openRoom();
    }
    for (const id in sim.players) if (id !== game.myId) delete sim.players[id];
    game.netNote = opened ? 'Lost the connection to the room. You can keep playing solo.' : 'Multiplayer unavailable. You can still play solo.';
  };
}

function openRoom() {
  game.netNote = 'Opening room…';
  hostRoom(new WebSocket(roomUrl(game.code, 'role=host')), false);
}

export function host(code = newCode()) {
  game.isHost = true;
  game.code = code;
  game.S = newState(game.code);
  game.myId = 'host';
  sim.players = { host: guard('host', game.myName) };
  run();
  openRoom();
}

// Drop the night we were about to host and join the one already running under our code.
function becomeGuest() {
  clearInterval(loop);
  loop = 0;
  game.S = null;
  sim.players = {};
  join(game.code);
}

// The host left and the relay picked us. Carry on from the last state it sent, with the guards still in the
// room: the old host is dropped, and so is anyone whose leaving it had not passed on yet.
function takeOver(guests) {
  game.isHost = true;
  game.joining = false;
  game.S ||= newState(game.code); // the old host left before it sent us anything
  const was = Object.fromEntries((game.S.players || []).map(p => [p.id, p]));
  sim.players = {};
  for (const id of [game.myId, ...guests.filter(g => typeof g === 'string')]) sim.players[id] = was[id] || guard(id);
  sim.players[game.myId].name = game.myName;
  game.S.players = Object.values(sim.players);
  game.netNote = 'The host left, so you are hosting now.';
  if (game.S.phase !== 'lobby') adoptFloor(sim, game.S, performance.now()); // rebuild the mascots' thinking, which the old host kept to itself
  hostRoom(ws, true);
  run();
}

let rehosts = 0; // fixed rooms only: times a join found nobody hosting and went back to hosting
export function join(code) {
  if (!/^[a-z]-/.test(code)) code = code.toUpperCase().trim();
  if (!ROOM.test(code)) return;
  game.code = code;
  game.isHost = false;
  game.joining = true;
  game.myId = 'g' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  ws = new WebSocket(roomUrl(code, 'id=' + game.myId));
  // Who we are. Sent again to a new host, who may have missed the first time.
  const hello = () => send({ t: 'name', n: game.myName });
  ws.onopen = () => {
    if (document.hidden) showing();
    hello();
  };
  ws.onmessage = e => {
    const d = parse(e.data);
    if (d?.t === 's') {
      game.S = d.s;
      game.joining = false;
    } else if (d?.t === 'host' && Array.isArray(d.guests)) takeOver(d.guests);
    else if (d?.t === 'rehost') hello();
  };
  ws.onclose = e => {
    const wasIn = !!game.S;
    game.S = null;
    game.joining = false;
    // The fixed room's host left between our try at hosting and our try at joining. Host after all.
    if (!wasIn && e.code === NO_HOST && platform.fixedRoom && rehosts++ < 3) return host(code);
    // A host leaving hands the room on (takeOver), so a close here is the connection failing.
    game.error = wasIn
      ? { title: 'Lost the connection to the room', detail: 'Reload to start again.' }
      : { title: 'Could not join room ' + code, detail: e.code === NO_HOST ? 'Nobody is hosting a room with that code.' : 'The connection failed.' };
  };
}

// Route an action to the simulation, locally if we are the host.
export function send(a) {
  if (game.isHost) actFloor(sim, game.S, game.myId, a);
  else if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(a));
}
