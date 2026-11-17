// The Worker in front of the static files. It only handles /room/CODE, a
// WebSocket that relays between one host and that room's guests. Everything
// else is served from public/ before this code runs.
import { DurableObject } from 'cloudflare:workers';

const NO_HOST = 4404, CODE_TAKEN = 4409;
const MAX_GUEST_MESSAGE = 2000;   // characters. Guest actions are tiny.

export default {
  fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m || req.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

// One instance per room code. The host's messages go to every guest as they
// are. A guest's message goes to the host wrapped as {"from": id, "d": message}.
// The host also gets {"from": id, "d": {"t": "join" | "leave"}}.
export class Room extends DurableObject {
  host() { return this.ctx.getWebSockets('host')[0]; }

  toHost(id, json) {
    try { this.host()?.send(`{"from":${JSON.stringify(id)},"d":${json}}`); } catch (e) { /* host is closing */ }
  }

  fetch(req) {
    const q = new URL(req.url).searchParams;
    const isHost = q.get('role') === 'host', id = isHost ? 'host' : q.get('id') || '';
    const [client, server] = Object.values(new WebSocketPair());
    // A refused socket is still accepted first, so the browser sees the close code.
    const refuse = (code, why) => { server.accept(); server.close(code, why); return new Response(null, { status: 101, webSocket: client }); };
    if (isHost && this.host()) return refuse(CODE_TAKEN, 'room code in use');
    if (!isHost && !this.host()) return refuse(NO_HOST, 'no such room');
    if (!isHost && !/^[\w-]{1,40}$/.test(id)) return refuse(1008, 'bad id');

    this.ctx.acceptWebSocket(server, [isHost ? 'host' : 'guest']);
    server.serializeAttachment({ id });
    if (!isHost) this.toHost(id, '{"t":"join"}');
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, msg) {
    if (typeof msg !== 'string') return;
    const { id } = ws.deserializeAttachment();
    if (id !== 'host') { if (msg.length <= MAX_GUEST_MESSAGE) this.toHost(id, msg); return; }
    for (const g of this.ctx.getWebSockets('guest')) try { g.send(msg); } catch (e) { /* guest is closing */ }
  }

  webSocketClose(ws) { this.left(ws); }
  webSocketError(ws) { this.left(ws); }

  left(ws) {
    const { id } = ws.deserializeAttachment();
    try { ws.close(); } catch (e) { /* already closed */ }
    if (id !== 'host') return this.toHost(id, '{"t":"leave"}');
    for (const g of this.ctx.getWebSockets('guest')) try { g.close(1000, 'host left'); } catch (e) { /* already closed */ }
  }
}
