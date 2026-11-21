// Rooms. A room's Durable Object (worker/room.ts) runs the night and sends everyone in it the whole state ten times a
// second, through a WebSocket on the same origin. This page only sends what its own guard does (send). With no room to
// reach, the page runs the night itself and plays solo, with the same code the room runs (packages/sim/src/session.ts).
// When an app fixes the room (platform.fixedRoom, as the Discord Activity does), everyone opens the same one, and the
// first to arrive starts it.

import { adoptFloor, commandFloor, joinFloor, newSim, newState, type Sim, stepFloor } from '@thick-shift/sim';
import type { Command, State, StateMessage } from '@thick-shift/sim/types';
import { CLOSE, type Mode, PROTOCOL, parse, TICK_MS } from './protocol';
import { game, platform } from './state';

const RETRY_MS = [500, 1000, 2000, 4000, 8000]; // waits between tries to get back into a room we lost, 15 s in all
const QUIET_MS = 4000; // a night in play that has sent nothing for this long has lost its connection

let ws: WebSocket | null = null;
let retries = 0, // tries so far to get back into the room
  heard = 0; // performance.now() of the last state
// A night this page runs itself, with no room, until the page reloads.
let solo: { sim: Sim; S: State } | null = null;

const roomUrl = (code: string, query: string): string => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/room/${code}?${query}`;
const newCode = (): string => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Math.random() * 24) | 0]).join('');
const newId = (): string => `g${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
const isState = (m: unknown): m is StateMessage => typeof m === 'object' && m !== null && 't' in m && m.t === 's' && 's' in m;

// Start a room, from the title screen, or open the app's fixed one. Without a room to reach, play solo.
export function host(code = newCode()): void {
  open(code, platform.fixedRoom ? 'either' : 'make');
}

// Join a friend's room by the code they typed.
export function join(code: string): void {
  code = code.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(code)) open(code, 'join');
  else fail('That is not a room code', 'Room codes are four letters.');
}

// back: trying to get back into a room this page was in.
function open(code: string, mode: Mode, back = false): void {
  game.code = code;
  game.joining = true;
  game.myId ||= newId();
  const sock = new WebSocket(roomUrl(code, `v=${PROTOCOL}&mode=${mode}&id=${game.myId}`));
  ws = sock;
  let opened = false;
  sock.onopen = () => {
    opened = true;
    retries = 0;
    heard = performance.now();
    game.netNote = '';
    send({ t: 'name', n: game.myName });
  };
  // The room sends JSON text, and only states.
  sock.onmessage = (e: MessageEvent<string>) => {
    const m = parse(e.data);
    if (!isState(m)) return;
    heard = performance.now();
    game.S = m.s;
    game.joining = false;
  };
  sock.onclose = e => {
    if (ws !== sock) return;
    ws = null;
    // Someone is already in a room under the code we drew. Draw another.
    if (e.code === CLOSE.CODE_TAKEN && mode === 'make') return open(newCode(), 'make');
    game.joining = false;
    if (e.code === CLOSE.OUTDATED) return fail('The game has been updated', 'Reload to play the new version.');
    if (e.code === CLOSE.NO_ROOM) return fail(`Could not join room ${code}`, 'Nobody is playing in a room with that code.');
    if (opened || back) return retry(code);
    if (mode === 'join') return fail(`Could not join room ${code}`, 'The connection failed.');
    // No room to reach: play alone.
    playSolo(code, 'Multiplayer unavailable. You can still play solo.');
  };
}

// The room's connection dropped, or a deploy restarted it. Go back in as the same guard, which keeps their place in
// the night (worker/room.ts), a few times before carrying on alone from where the night was.
function retry(code: string): void {
  const wait = RETRY_MS[retries++];
  if (wait === undefined) {
    const lost = 'Lost the connection to the room. You are playing solo now.';
    playSolo(code, lost);
    // Over the game this is news, not a state to keep showing.
    setTimeout(() => {
      if (game.netNote === lost) game.netNote = '';
    }, 10_000);
  } else {
    game.netNote = 'Reconnecting to the room…';
    setTimeout(() => open(code, 'either', true), wait);
  }
}

// A connection can die without closing, and the page would wait on it for good. During a night the room sends ten
// states a second, so a long silence means it has gone: drop it and go back in.
setInterval(() => {
  const sock = ws;
  if (sock?.readyState !== WebSocket.OPEN || game.S?.phase !== 'play' || performance.now() - heard < QUIET_MS) return;
  ws = null;
  sock.close();
  retry(game.code);
}, 1000);

function fail(title: string, detail: string): void {
  game.S = null;
  game.error = { title, detail };
}

// Run the night here: a new one, or the last state the room sent, with only this guard in it. The mascots' thinking
// stayed with the room, so it is made up from S (adoptFloor).
function playSolo(code: string, note: string): void {
  const S = game.S ?? newState(code),
    now = performance.now(),
    sim = newSim({ rng: Math.random, now });
  const me = S.players.find(p => p.id === game.myId);
  S.players = [];
  joinFloor(sim, S, game.myId, me);
  commandFloor(sim, S, game.myId, { t: 'name', n: game.myName });
  if (S.phase === 'play') adoptFloor(sim, S, now);
  game.S = S;
  game.netNote = note;
  solo = { sim, S };
  setInterval(() => stepFloor(sim, S, performance.now()), TICK_MS);
}

// What this guard does, to whoever runs the night: the room, or this page.
export function send(c: Command): void {
  if (solo) commandFloor(solo.sim, solo.S, game.myId, c);
  else if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(c));
}
