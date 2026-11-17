// Room hosting and joining. The host runs the simulation and sends the whole
// state to every guest ten times a second, through a WebSocket relay on the
// same origin (worker/index.js).
import { game, client } from './state.js';
import { newState, step, act } from './sim.js';
import { stepFloor, actFloor } from './three/sim3d.js';

const TICK_MS = 100;
const NO_HOST = 4404, CODE_TAKEN = 4409;   // close codes from the relay
const MAX_BACKLOG = 256 * 1024;            // bytes queued before the host skips a state
let ws = null;

// The 3D mode (S.mode === 'floor') has its own simulation; see three/sim3d.js.
const tick = () => game.S.mode === 'floor' && game.S.phase !== 'lobby' ? stepFloor() : step();
const apply = (id, a) => { if (game.S.mode !== 'floor' || !actFloor(id, a)) act(id, a); };

const roomUrl = (code, query) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/room/${code}?${query}`;
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
const parse = text => { try { return JSON.parse(text); } catch (e) { return null; } };

function broadcast() {
  const guests = Object.keys(game.players).length - 1;
  if (guests > 0 && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BACKLOG) ws.send(JSON.stringify({ t: 's', s: game.S }));
}

function openRoom() {
  game.netNote = 'Opening room…';
  let opened = false;
  ws = new WebSocket(roomUrl(game.code, 'role=host'));
  ws.onopen = () => { opened = true; game.netNote = ''; };
  ws.onmessage = e => {
    const m = parse(e.data), id = m?.from, d = m?.d;
    if (typeof id !== 'string' || id === 'host' || !d) return;
    if (d.t === 'join') game.players[id] = { id, name: 'Guard', view: 'office', cam: 0, sanity: 1 };
    else if (d.t === 'leave') delete game.players[id];
    else apply(id, d);
  };
  ws.onclose = e => {
    // Someone else is hosting under this code. Nobody has joined yet, so take another.
    if (e.code === CODE_TAKEN) { game.code = game.S.code = newCode(); return openRoom(); }
    for (const id in game.players) if (id !== 'host') delete game.players[id];
    game.netNote = opened ? 'Lost the connection to the room. You can keep playing solo.' : 'Multiplayer unavailable. You can still play solo.';
  };
}

export function host() {
  game.isHost = true;
  game.code = newCode();
  game.S = newState(game.code);
  game.myId = 'host';
  game.players = { host: { id: 'host', name: game.myName, view: 'office', cam: 0, sanity: 1 } };
  setInterval(() => { tick(); broadcast(); }, TICK_MS);
  openRoom();
}

export function join(code) {
  code = code.toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(code)) return;
  game.code = code;
  game.isHost = false;
  game.joining = true;
  game.myId = 'g' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  ws = new WebSocket(roomUrl(code, 'id=' + game.myId));
  ws.onopen = () => { send({ t: 'name', n: game.myName }); send({ t: 'view', v: client.view, cam: client.cam }); };
  ws.onmessage = e => { const d = parse(e.data); if (d?.t === 's') { game.S = d.s; game.joining = false; } };
  ws.onclose = e => {
    const wasIn = !!game.S;
    game.S = null;
    game.joining = false;
    game.error = wasIn ? { title: 'The host left', detail: 'Reload to start again.' }
      : { title: 'Could not join room ' + code, detail: e.code === NO_HOST ? 'Nobody is hosting a room with that code.' : 'The connection failed.' };
  };
}

// Route an action to the simulation, locally if we are the host.
export function send(a) {
  if (game.isHost) apply('host', a);
  else if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(a));
}
