// Running as a Discord Activity. Discord loads the page in an iframe at <client id>.discordsays.com and its
// proxy forwards every same-origin request, the room WebSocket included, to this app's Worker (the "/" URL
// mapping in the Developer Portal). Everyone who opens the Activity in one channel shares its instanceId, which
// becomes the room, so nobody types a code. Importing this module sets the game's platform hooks (the game's
// state.js) and starts talking to Discord. boot.js imports it only inside Discord, and the build gives it and the
// SDK their own chunk, so elsewhere the SDK is never fetched.
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { game, platform, type Platform } from '@thick-shift/game/state';
import { host } from '@thick-shift/game/net';
import { unlockAudio } from '@thick-shift/game/audio';
import { $, esc, card, messageScreen } from '@thick-shift/game/ui';

// The screens the platform hooks return. packages/game exports no ./types, so they come from Platform's hooks.
type OverlayScreen = ReturnType<NonNullable<Platform['title']>>;
type Invite = ReturnType<NonNullable<Platform['invite']>>;

let sdk: DiscordSDK | null = null;
const discord = { room: '', name: '' }; // both '' until Discord answers

async function connect(): Promise<void> {
  const { clientId } = await fetch('/api/discord/config').then(r => r.json() as Promise<{ clientId: string }>);
  if (!clientId) throw new Error('DISCORD_CLIENT_ID is not set on the Worker.');
  sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const room =
    'd-' +
    String(sdk.instanceId)
      .replace(/[^\w-]/g, '')
      .slice(0, 80);
  discord.name = await signIn(clientId);
  discord.room = room;
}

// The player's Discord display name. If they turn down the sign-in, or it fails, they play as Guard.
async function signIn(clientId: string): Promise<string> {
  try {
    const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
    const r = await fetch('/api/discord/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const { access_token } = (await r.json()) as { access_token: string };
    const { user } = await sdk.commands.authenticate({ access_token });
    return user.global_name || user.username || '';
  } catch {
    return '';
  }
}

// The room and the name come from Discord. The button is still needed, since sound can only start from a click.
function titleScreen(): OverlayScreen {
  if (!discord.room) return messageScreen('discord', 'Connecting to Discord…', '', false);
  const name = discord.name.slice(0, 12);
  return {
    key: 'discord-title',
    html: card(
      `
      <h1 class="ts-logo">Thick Shift 3D</h1>
      <p class="lede cn-m-0">Midnight at the Mascot Depot</p>
      <p class="cn-meta cn-m-0">Keep the power on until 6 AM. The retired mascots are enormous, and at night they wander.</p>
      <p class="cn-meta cn-m-0">Everyone who opens Thick Shift in this channel works the same night.</p>`,
      `<button class="btn btn-primary" id="hb">Clock in${name ? ' as ' + esc(name) : ''}</button>`
    ),
    wire() {
      $('hb').onclick = () => {
        unlockAudio();
        game.myName = name || 'Guard';
        host(discord.room);
      };
    },
  };
}

// Everyone in the channel is already in the room, so the lobby offers Discord's invite instead of a code.
const invite = (): Invite => ({
  html: '<p class="cn-meta cn-m-0">Everyone who opens Thick Shift in this channel joins this night.</p><div class="cn-cluster"><button class="btn btn-secondary" id="inv">Invite someone</button></div>',
  wire() {
    $('inv').onclick = () =>
      sdk?.commands.openInviteDialog().catch(() => {
        /* closed, or not allowed in this channel */
      });
  },
});

platform.fixedRoom = true;
platform.title = titleScreen;
platform.invite = invite;
connect().catch(err => {
  game.error = { title: 'Could not reach Discord', detail: String(err.message || err) };
});
