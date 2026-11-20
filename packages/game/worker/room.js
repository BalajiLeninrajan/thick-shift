// The room relay, shared by every app's Worker: /room/CODE is a WebSocket that passes messages between one host
// and that room's guests. An app's Worker hands requests to relay() and exports Room as its Durable Object.
import { DurableObject } from 'cloudflare:workers';

const NO_HOST = 4404, CODE_TAKEN = 4409;
const MAX_GUEST_MESSAGE = 2000;   // characters. Guest actions are tiny.

// A room is a four-letter code someone typed, or a lowercase letter, a dash and an id that an app gets from its
// platform, such as d- and a Discord Activity's instance id (apps/discord). Matches ROOM in src/net.js.
const ROOM = /^\/room\/([A-Z]{4}|[a-z]-[\w-]{1,80})$/;

export function relay(req, env) {
  const m = new URL(req.url).pathname.match(ROOM);
  if (!m || req.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
  return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
}

// One instance per room code. The host's messages go to every guest as they
// are. A guest's message goes to the host wrapped as {"from": id, "d": message}.
// The host also gets {"from": id, "d": {"t": "join" | "leave"}}.
//
// When the host leaves, the guest who joined first becomes the host, passing
// over any whose tab is in the background, where its timers crawl. It gets
// {"t": "host", "guests": [the other guests' ids]} and the others get
// {"t": "rehost"}. The room only closes when nobody is left in it.
//
// Who is host lives in each socket's attachment ({ id, host, at, hidden }), not in its
// tag, because a hibernated socket's tags cannot change.
const att = ws => ws.deserializeAttachment() || {};
const OPEN = 1;

export class Room extends DurableObject {
  // Sockets still in the room. A closing one can still be listed while its close is handled, so it is left out by id.
  open(except) { return this.ctx.getWebSockets().filter(s => s.readyState === OPEN && !att(s).left && att(s).id !== except); }
  host(except) { return this.open(except).find(s => att(s).host); }

  toHost(id, json) {
    try { this.host(id)?.send(`{"from":${JSON.stringify(id)},"d":${json}}`); } catch { /* host is closing */ }
  }

  fetch(req) {
    const q = new URL(req.url).searchParams;
    const isHost = q.get('role') === 'host', id = isHost ? 'host' : q.get('id') || '';
    const [client, server] = Object.values(new WebSocketPair());
    // A refused socket is still accepted first, so the browser sees the close code.
    const refuse = (code, why) => { server.accept(); server.close(code, why); return new Response(null, { status: 101, webSocket: client }); };
    if (isHost && this.host()) return refuse(CODE_TAKEN, 'room code in use');
    if (!isHost && !this.host()) return refuse(NO_HOST, 'no such room');
    // 'host' is the first host's id, and guests tell players apart by id.
    if (!isHost && (!/^[\w-]{1,40}$/.test(id) || id === 'host')) return refuse(1008, 'bad id');

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, host: isHost, at: Date.now() });
    if (!isHost) this.toHost(id, '{"t":"join"}');
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    // A tab saying it went to the background or came back (net.js).
    if (msg === 'hidden' || msg === 'shown') { ws.serializeAttachment({ ...att(ws), hidden: msg === 'hidden' }); return; }
    const { id, host } = att(ws);
    if (!host) { if (msg.length <= MAX_GUEST_MESSAGE) this.toHost(id, msg); return; }
    for (const g of this.open(id)) try { g.send(msg); } catch { /* guest is closing */ }
  }

  webSocketClose(ws) { this.left(ws); }
  webSocketError(ws) { this.left(ws); }

  left(ws) {
    const a = att(ws);
    if (a.left) return;   // an error and a close can both arrive for one socket
    ws.serializeAttachment({ ...a, host: false, left: true });
    try { ws.close(); } catch { /* already closed */ }
    if (!a.host) return this.toHost(a.id, '{"t":"leave"}');
    // Hand the room to whoever has been in it longest, a tab someone is looking at before one in the background.
    const hid = s => att(s).hidden ? 1 : 0;
    const rest = this.open(a.id).sort((x, y) => hid(x) - hid(y) || att(x).at - att(y).at || (att(x).id < att(y).id ? -1 : 1));
    const next = rest.shift();
    if (!next) return;
    next.serializeAttachment({ ...att(next), host: true });
    try { next.send(JSON.stringify({ t: 'host', guests: rest.map(g => att(g).id) })); } catch { /* closing too: its own close hands the room on */ }
    for (const g of rest) try { g.send('{"t":"rehost"}'); } catch { /* guest is closing */ }
  }
}
