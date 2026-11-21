// Running as a Discord Activity. Discord loads the page in an iframe at <client id>.discordsays.com and its
// proxy forwards every same-origin request, the room WebSocket included, to this app's Worker (the "/" URL
// mapping in the Developer Portal). Everyone who opens the Activity in one channel shares its instanceId, which
// becomes the room, so nobody types a code. Importing this module sets the game's platform hooks (the game's
// state.ts) and starts talking to Discord. boot.ts imports it only inside Discord, and the build gives it and the
// SDK their own chunk, so elsewhere the SDK is never fetched.
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { unlockAudio } from '@thick-shift/game/audio';
import { byId, errorText } from '@thick-shift/game/dom';
import { host } from '@thick-shift/game/net';
import { game, platform } from '@thick-shift/game/state';
import type { Invite, OverlayScreen } from '@thick-shift/game/types';
import { card, esc, guardName, INTRO, messageScreen } from '@thick-shift/game/ui';

let sdk: DiscordSDK | null = null;
const discord = { room: '', name: '' }; // both '' until Discord answers

async function connect(): Promise<void> {
  const { clientId } = await fetch('/api/discord/config').then(r => r.json() as Promise<{ clientId: string }>);
  if (!clientId) throw new Error('DISCORD_CLIENT_ID is not set on the Worker.');
  const ds = new DiscordSDK(clientId);
  sdk = ds;
  await ds.ready();
  const room = `d-${ds.instanceId.replace(/[^\w-]/g, '').slice(0, 80)}`;
  discord.name = await signIn(ds, clientId);
  discord.room = room;
}

// The player's Discord display name. If they turn down the sign-in, or it fails, they play as Guard.
async function signIn(ds: DiscordSDK, clientId: string): Promise<string> {
  try {
    const { code } = await ds.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
    const r = await fetch('/api/discord/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    // The Worker answers { access_token } or, with an error status, { error }.
    const d = (await r.json()) as { access_token?: unknown; error?: unknown };
    if (!r.ok || typeof d.access_token !== 'string') throw new Error(`token exchange: ${String(d.error ?? r.status)}`);
    const { user } = await ds.commands.authenticate({ access_token: d.access_token });
    return user.global_name || user.username || '';
  } catch (e) {
    console.warn('Discord sign-in failed, playing as Guard:', e);
    return '';
  }
}

// The room and the name come from Discord. The button is still needed, since sound can only start from a click.
function titleScreen(): OverlayScreen {
  if (!discord.room) return messageScreen('discord', 'Connecting to Discord…', '', false);
  const name = discord.name && guardName(discord.name); // as the room will show it, or '' if Discord gave none
  return {
    key: 'discord-title',
    html: card(
      `${INTRO}
      <p class="cn-meta cn-m-0">Everyone who opens Thick Shift in this channel works the same night.</p>`,
      `<button class="btn btn-primary" id="hb">Clock in${name ? ` as ${esc(name)}` : ''}</button>`
    ),
    wire() {
      byId('hb').onclick = () => {
        unlockAudio();
        game.myName = guardName(name);
        host(discord.room);
      };
    },
  };
}

// Everyone in the channel is already in the room, so the lobby offers Discord's invite instead of a code.
const invite = (): Invite => ({
  html: '<p class="cn-meta cn-m-0">Everyone who opens Thick Shift in this channel joins this night.</p><div class="cn-cluster"><button class="btn btn-secondary" id="inv">Invite someone</button></div>',
  wire() {
    byId('inv').onclick = () =>
      sdk?.commands.openInviteDialog().catch(() => {
        /* closed, or not allowed in this channel */
      });
  },
});

platform.fixedRoom = true;
platform.title = titleScreen;
platform.invite = invite;
connect().catch((err: unknown) => {
  game.error = { title: 'Could not reach Discord', detail: errorText(err) };
});
