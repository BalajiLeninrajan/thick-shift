// Room hosting and joining over PeerJS. The host runs the simulation and
// sends the whole state to every guest ten times a second.
import { PREFIX } from './config.js';
import { game, client } from './state.js';
import { newState, step, act } from './sim.js';

const q = new URLSearchParams(location.search);
const TICK_MS = 100;
let peer = null, conn = null;
const conns = {};

// ?sig=host:port points at a self-hosted PeerJS signalling server.
function peerOpts() {
  const sig = q.get('sig');
  if (!sig) return {};
  const [host, port] = sig.split(':');
  return { host, port: +port || 9000, path: '/', secure: false };
}

function broadcast() {
  for (const id in conns) if (conns[id].open) conns[id].send({ t: 's', s: game.S });
}

export function host() {
  game.isHost = true;
  game.code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
  game.S = newState(game.code);
  game.myId = 'host';
  game.players = { host: { id: 'host', name: game.myName, view: 'office', cam: 0, sanity: 1 } };
  setInterval(() => { step(); broadcast(); }, TICK_MS);
  if (!window.Peer) { game.netNote = 'Multiplayer library missing. Solo only.'; return; }
  game.netNote = 'Opening room…';
  peer = new Peer(PREFIX + game.code, peerOpts());
  peer.on('open', () => { game.netNote = ''; });
  peer.on('error', e => { game.netNote = `Multiplayer unavailable (${e.type}). You can still play solo.`; });
  peer.on('connection', k => {
    k.on('open', () => { conns[k.peer] = k; game.players[k.peer] = { id: k.peer, name: 'Guard', view: 'office', cam: 0, sanity: 1 }; });
    k.on('data', d => act(k.peer, d));
    k.on('close', () => { delete conns[k.peer]; delete game.players[k.peer]; });
  });
}

export function join(code) {
  code = code.toUpperCase().trim();
  if (code.length !== 4) return;
  game.code = code;
  game.isHost = false;
  if (!window.Peer) { game.error = { title: 'Multiplayer library missing', detail: 'peerjs.min.js did not load.' }; return; }
  game.joining = true;
  peer = new Peer(undefined, peerOpts());
  peer.on('open', id => {
    game.myId = id;
    conn = peer.connect(PREFIX + code, { reliable: true });
    conn.on('open', () => { conn.send({ t: 'name', n: game.myName }); conn.send({ t: 'view', v: client.view, cam: client.cam }); });
    conn.on('data', d => { if (d.t === 's') { game.S = d.s; game.joining = false; } });
    conn.on('close', () => { game.S = null; game.error = { title: 'The host left', detail: 'Reload to start again.' }; });
  });
  peer.on('error', e => { game.joining = false; game.error = { title: 'Could not join room ' + code, detail: e.type }; });
}

// Route an action to the simulation, locally if we are the host.
export function send(a) {
  if (game.isHost) act('host', a);
  else if (conn && conn.open) conn.send(a);
}
