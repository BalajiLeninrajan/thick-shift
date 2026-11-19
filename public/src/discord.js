// Running as a Discord Activity. Discord loads the page in an iframe at <client id>.discordsays.com and its
// proxy forwards every same-origin request, the room WebSocket included, to this Worker (the "/" URL mapping
// in the Developer Portal). Everyone who opens the Activity in one channel shares its instanceId, which
// becomes the room, so nobody types a code. Loaded only inside Discord (main.js), so the web game never
// fetches the SDK.
import { DiscordSDK } from '../vendor/discord-sdk/index.mjs';

let sdk = null;

export async function startDiscord() {
  const { clientId } = await fetch('/api/discord/config').then(r => r.json());
  if (!clientId) throw new Error('DISCORD_CLIENT_ID is not set on the Worker.');
  sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const room = 'd-' + String(sdk.instanceId).replace(/[^\w-]/g, '').slice(0, 80);
  return { room, name: await signIn(clientId) };
}

// The player's Discord display name. If they turn down the sign-in, or it fails, they play as Guard.
async function signIn(clientId) {
  try {
    const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
    const r = await fetch('/api/discord/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const { access_token } = await r.json();
    const { user } = await sdk.commands.authenticate({ access_token });
    return user.global_name || user.username || '';
  } catch (e) {
    return '';
  }
}

export function invite() {
  sdk?.commands.openInviteDialog().catch(() => { /* closed, or not allowed in this channel */ });
}
