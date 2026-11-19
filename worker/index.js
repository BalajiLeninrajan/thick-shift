// The Worker in front of the static files. It handles /room/CODE, a WebSocket
// that relays between one host and that room's guests. As the Discord Activity
// (env.discord in wrangler.jsonc) it also signs players in and carries the
// page's stylesheets and fonts, which Discord's sandbox will not fetch from
// their CDNs. Everything else is served from public/ before this code runs.
import { DurableObject } from 'cloudflare:workers';

const NO_HOST = 4404, CODE_TAKEN = 4409;
const MAX_GUEST_MESSAGE = 2000;   // characters. Guest actions are tiny.

// A room is a four-letter code someone typed, or d- and a Discord Activity's instance id (src/discord.js).
const ROOM = /^\/room\/([A-Z]{4}|d-[\w-]{1,80})$/;

export default {
  fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path === '/api/discord/config') return Response.json({ clientId: env.DISCORD_CLIENT_ID || '' });
    if (path === '/api/discord/token' && req.method === 'POST') return discordToken(req, env);
    if (env.ASSETS && (path === '/' || path === '/index.html')) return discordPage(req, env);
    if (env.ASSETS && path.startsWith('/ext/')) return external(req, path.slice(5));
    const m = path.match(ROOM);
    if (!m || req.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
  },
};

// Trades the code Discord gave the Activity (commands.authorize) for an access token, which the page hands
// back to Discord (commands.authenticate) to learn who is playing. The client secret never leaves the Worker.
async function discordToken(req, env) {
  const { code } = await req.json().catch(() => ({}));
  if (typeof code !== 'string' || !code || code.length > 200) return Response.json({ error: 'bad code' }, { status: 400 });
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return Response.json({ error: 'not configured' }, { status: 503 });
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || typeof d.access_token !== 'string') return Response.json({ error: 'exchange failed' }, { status: 502 });
  return Response.json({ access_token: d.access_token });
}

// Discord's sandbox only lets the page load from its own origin, so the page's CDN links become /ext/ paths
// that external() fetches. Only the pinned design system and Google's fonts go through.
const CDN = [
  ['jsd/', 'https://cdn.jsdelivr.net/', /^gh\/BalajiLeninrajan\/catppuccin-neu@v[\d.]+\/css\/[\w-]+\.css$/],
  ['gfonts/', 'https://fonts.googleapis.com/', /^css2\?[\w&=;:@+%.-]+$/],
  ['gstatic/', 'https://fonts.gstatic.com/', /^s\/[\w/.-]+$|^l\/font\?[\w&=.-]+$/],
];

async function discordPage(req, env) {
  const ext = { element(e) { const h = e.getAttribute('href') || '', c = CDN.find(([, origin]) => h.startsWith(origin)); if (c) e.setAttribute('href', '/ext/' + c[0] + h.slice(c[1].length)); } };
  return new HTMLRewriter().on('link[rel=stylesheet]', ext).on('link[rel=preconnect]', { element(e) { e.remove(); } }).transform(await env.ASSETS.fetch(req));
}

async function external(req, rest) {
  const c = CDN.find(([prefix]) => rest.startsWith(prefix)), tail = c && rest.slice(c[0].length) + new URL(req.url).search;
  if (!c || !c[2].test(tail)) return new Response('Not found', { status: 404 });
  // Google picks the font format from the browser, so it gets the player's user agent.
  const r = await fetch(c[1] + tail, { headers: { 'User-Agent': req.headers.get('User-Agent') || '' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (c[0] !== 'gfonts/' || !r.ok) return new Response(r.body, r);
  const css = (await r.text()).replaceAll('https://fonts.gstatic.com/', '/ext/gstatic/');
  return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
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
    try { this.host(id)?.send(`{"from":${JSON.stringify(id)},"d":${json}}`); } catch (e) { /* host is closing */ }
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
    for (const g of this.open(id)) try { g.send(msg); } catch (e) { /* guest is closing */ }
  }

  webSocketClose(ws) { this.left(ws); }
  webSocketError(ws) { this.left(ws); }

  left(ws) {
    const a = att(ws);
    if (a.left) return;   // an error and a close can both arrive for one socket
    ws.serializeAttachment({ ...a, host: false, left: true });
    try { ws.close(); } catch (e) { /* already closed */ }
    if (!a.host) return this.toHost(a.id, '{"t":"leave"}');
    // Hand the room to whoever has been in it longest, a tab someone is looking at before one in the background.
    const hid = s => att(s).hidden ? 1 : 0;
    const rest = this.open(a.id).sort((x, y) => hid(x) - hid(y) || att(x).at - att(y).at || (att(x).id < att(y).id ? -1 : 1));
    const next = rest.shift();
    if (!next) return;
    next.serializeAttachment({ ...att(next), host: true });
    try { next.send(JSON.stringify({ t: 'host', guests: rest.map(g => att(g).id) })); } catch (e) { /* closing too: its own close hands the room on */ }
    for (const g of rest) try { g.send('{"t":"rehost"}'); } catch (e) { /* guest is closing */ }
  }
}
