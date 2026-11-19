// Room hosting and joining. The host runs the simulation and sends the whole
// state to every guest ten times a second, through a WebSocket relay on the
// same origin (worker/index.js). If the host leaves, the relay makes the guest
// who has been there longest the host, and the night carries on (takeOver).
import { game } from './state.js';
import { newState, stepFloor, actFloor, adoptFloor } from './three/sim3d.js';

const TICK_MS = 100;
const NO_HOST = 4404, CODE_TAKEN = 4409;   // close codes from the relay
const MAX_BACKLOG = 256 * 1024;            // bytes queued before the host skips a state
let ws = null, loop = 0;

const roomUrl = (code, query) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/room/${code}?${query}`;
const newCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
const parse = text => { try { return JSON.parse(text); } catch (e) { return null; } };
const guard = (id, name = 'Guard') => ({ id, name });

function broadcast() {
  const guests = Object.keys(game.players).length - 1;
  if (guests > 0 && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BACKLOG) ws.send(JSON.stringify({ t: 's', s: game.S }));
}

// Tell the relay when this tab goes to the background, where timers crawl, so it hands the room to a guest who
// is looking. Plain words, not JSON, so the relay can pick them out without parsing every message.
const showing = () => { if (ws?.readyState === WebSocket.OPEN) ws.send(document.hidden ? 'hidden' : 'shown'); };
document.addEventListener('visibilitychange', showing);

const run = () => { loop ||= setInterval(() => { stepFloor(); broadcast(); }, TICK_MS); };

// The host's end of the socket: one it opened, or a guest's that the relay handed the room to.
function hostRoom(sock, opened) {
  ws = sock;
  ws.onopen = () => { opened = true; game.netNote = ''; };
  ws.onmessage = e => {
    const m = parse(e.data), id = m?.from, d = m?.d;
    if (typeof id !== 'string' || id === game.myId || !d) return;
    if (d.t === 'join') game.players[id] = guard(id);
    else if (d.t === 'leave') delete game.players[id];
    else actFloor(id, d);
  };
  ws.onclose = e => {
    // Someone else is hosting under this code. Nobody has joined yet, so take another.
    if (e.code === CODE_TAKEN) { game.code = game.S.code = newCode(); return openRoom(); }
    for (const id in game.players) if (id !== game.myId) delete game.players[id];
    game.netNote = opened ? 'Lost the connection to the room. You can keep playing solo.' : 'Multiplayer unavailable. You can still play solo.';
  };
}

function openRoom() {
  game.netNote = 'Opening room…';
  hostRoom(new WebSocket(roomUrl(game.code, 'role=host')), false);
}

export function host() {
  game.isHost = true;
  game.code = newCode();
  game.S = newState(game.code);
  game.myId = 'host';
  game.players = { host: guard('host', game.myName) };
  run();
  openRoom();
}

// The host left and the relay picked us. Carry on from the last state it sent, with the guards still in the
// room: the old host is dropped, and so is anyone whose leaving it had not passed on yet.
function takeOver(guests) {
  game.isHost = true;
  game.joining = false;
  game.S ||= newState(game.code);   // the old host left before it sent us anything
  const was = Object.fromEntries((game.S.players || []).map(p => [p.id, p]));
  game.players = {};
  for (const id of [game.myId, ...guests.filter(g => typeof g === 'string')]) game.players[id] = was[id] || guard(id);
  game.players[game.myId].name = game.myName;
  game.S.players = Object.values(game.players);
  game.netNote = 'The host left, so you are hosting now.';
  if (game.S.phase !== 'lobby') adoptFloor();   // rebuild the mascots' thinking, which the old host kept to itself
  hostRoom(ws, true);
  run();
}

export function join(code) {
  code = code.toUpperCase().trim();
  if (!/^[A-Z]{4}$/.test(code)) return;
  game.code = code;
  game.isHost = false;
  game.joining = true;
  game.myId = 'g' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  ws = new WebSocket(roomUrl(code, 'id=' + game.myId));
  // Who we are. Sent again to a new host, who may have missed the first time.
  const hello = () => send({ t: 'name', n: game.myName });
  ws.onopen = () => { if (document.hidden) showing(); hello(); };
  ws.onmessage = e => {
    const d = parse(e.data);
    if (d?.t === 's') { game.S = d.s; game.joining = false; }
    else if (d?.t === 'host' && Array.isArray(d.guests)) takeOver(d.guests);
    else if (d?.t === 'rehost') hello();
  };
  ws.onclose = e => {
    const wasIn = !!game.S;
    game.S = null;
    game.joining = false;
    // A host leaving hands the room on (takeOver), so a close here is the connection failing.
    game.error = wasIn ? { title: 'Lost the connection to the room', detail: 'Reload to start again.' }
      : { title: 'Could not join room ' + code, detail: e.code === NO_HOST ? 'Nobody is hosting a room with that code.' : 'The connection failed.' };
  };
}

// Route an action to the simulation, locally if we are the host.
export function send(a) {
  if (game.isHost) actFloor(game.myId, a);
  else if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(a));
}
