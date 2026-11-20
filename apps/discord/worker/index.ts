// The Discord Activity's Worker. It relays rooms like the web game's, and also signs players in and carries the
// page's stylesheets and fonts, which Discord's sandbox will not fetch from their CDNs. Requests for / and
// /index.html reach it before the static files (run_worker_first in wrangler.jsonc), so it can rewrite those
// links; every other static file is served before this code runs.
import { type RelayEnv, relay } from '@thick-shift/game/worker';

export { Room } from '@thick-shift/game/worker';

// The Worker's bindings (wrangler.jsonc). DISCORD_CLIENT_SECRET is a secret, set with wrangler secret put.
interface Env extends RelayEnv {
  ASSETS: Fetcher;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
}

export default {
  fetch(req: Request, env: Env): Promise<Response> | Response {
    const path = new URL(req.url).pathname;
    if (path === '/api/discord/config') return Response.json({ clientId: env.DISCORD_CLIENT_ID || '' });
    if (path === '/api/discord/token' && req.method === 'POST') return discordToken(req, env);
    if (path === '/' || path === '/index.html') return discordPage(req, env);
    if (path.startsWith('/ext/')) return external(req, path.slice(5));
    return relay(req, env);
  },
} satisfies ExportedHandler<Env>;

// Trades the code Discord gave the Activity (commands.authorize) for an access token, which the page hands
// back to Discord (commands.authenticate) to learn who is playing. The client secret never leaves the Worker.
async function discordToken(req: Request, env: Env): Promise<Response> {
  const { code } = await req.json<{ code?: unknown }>().catch((): { code?: unknown } => ({}));
  if (typeof code !== 'string' || !code || code.length > 200) return Response.json({ error: 'bad code' }, { status: 400 });
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return Response.json({ error: 'not configured' }, { status: 503 });
  const r = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code }),
  });
  const d = await r.json<{ access_token?: unknown }>().catch((): { access_token?: unknown } => ({}));
  if (!r.ok || typeof d.access_token !== 'string') return Response.json({ error: 'exchange failed' }, { status: 502 });
  return Response.json({ access_token: d.access_token });
}

// Discord's sandbox only lets the page load from its own origin, so the page's CDN links become /ext/ paths
// that external() fetches. Only the pinned design system and Google's fonts go through.
const CDN: [prefix: string, origin: string, path: RegExp][] = [
  ['jsd/', 'https://cdn.jsdelivr.net/', /^gh\/BalajiLeninrajan\/catppuccin-neu@v[\d.]+\/css\/[\w-]+\.css$/],
  ['gfonts/', 'https://fonts.googleapis.com/', /^css2\?[\w&=;:@+%.-]+$/],
  ['gstatic/', 'https://fonts.gstatic.com/', /^s\/[\w/.-]+$|^l\/font\?[\w&=.-]+$/],
];

async function discordPage(req: Request, env: Env): Promise<Response> {
  const ext = {
    element(e: Element) {
      const h = e.getAttribute('href') || '',
        c = CDN.find(([, origin]) => h.startsWith(origin));
      if (c) e.setAttribute('href', `/ext/${c[0]}${h.slice(c[1].length)}`);
    },
  };
  return new HTMLRewriter()
    .on('link[rel=stylesheet]', ext)
    .on('link[rel=preconnect]', {
      element(e: Element) {
        e.remove();
      },
    })
    .transform(await env.ASSETS.fetch(req));
}

async function external(req: Request, rest: string): Promise<Response> {
  const c = CDN.find(([prefix]) => rest.startsWith(prefix));
  if (!c) return new Response('Not found', { status: 404 });
  const [prefix, origin, path] = c,
    tail = rest.slice(prefix.length) + new URL(req.url).search;
  if (!path.test(tail)) return new Response('Not found', { status: 404 });
  // Google picks the font format from the browser, so it gets the player's user agent.
  const r = await fetch(origin + tail, { headers: { 'User-Agent': req.headers.get('User-Agent') || '' }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (prefix !== 'gfonts/' || !r.ok) return new Response(r.body, r);
  const css = (await r.text()).replaceAll('https://fonts.gstatic.com/', '/ext/gstatic/');
  return new Response(css, { headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
}
