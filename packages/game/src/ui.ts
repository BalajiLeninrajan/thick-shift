// The overlay screens around a night: title, lobby, and the cards between nights.
// Everything here is derived from game/client state once per frame.

import { clockF } from '@thick-shift/sim';
import { defined } from '@thick-shift/sim/check';
import { DEFAULT_NAME, FINAL_NIGHT, MASC, NAME_MAX } from '@thick-shift/sim/config';
import type { State, Tally } from '@thick-shift/sim/types';
import { unlockAudio } from './audio';
import { byId } from './dom';
import { host, join, send } from './net';
import { client, game, myPlayer, platform } from './state';
import type { OverlayScreen } from './types';

const q = new URLSearchParams(location.search);
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

export const card = (body: string, footer = '', cls = ''): string =>
  `<div class="panel ts-card ${cls}"><div class="panel-body cn-stack cn-gap-16">${body}</div>${footer && `<div class="panel-footer cn-cluster">${footer}</div>`}</div>`;
// What net.ts has to say about the connection, on the cards and, during a night, over the game (syncOverlay).
const netBanner = (): string => (game.netNote ? `<div class="banner cn-tone-warning">${esc(game.netNote)}</div>` : '');

// The next night starts once everyone in the room has pressed for it (readyFloor in packages/sim/src/session.ts).
// Alone, the one press starts it, so the button says so. In a crew it says ready, and once pressed it takes that back.
function goButton(S: State, alone: string, crew: string): string {
  if (S.players.length < 2) return `<button class="btn btn-primary" id="go">${alone}</button>`;
  return myPlayer(S)?.ready ? '<button class="btn btn-secondary" id="wait">Not ready</button>' : `<button class="btn btn-primary" id="go">${crew}</button>`;
}
// The mark on a ready guard's chip in the lobby.
const CHECK =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
// Who a crew is still waiting on, for the cards between nights.
function waiting(S: State): string {
  if (S.players.length < 2) return '';
  const names = S.players.filter(p => !p.ready).map(p => (p.id === game.myId ? 'you' : esc(p.name)));
  return `<p class="cn-meta cn-m-0">The night starts when everyone is ready. Waiting on ${names.join(', ')}.</p>`;
}

// The name a guard plays under, as the sim will keep it: Guard for none, and no longer than NAME_MAX.
export const guardName = (name: string): string => (name || DEFAULT_NAME).slice(0, NAME_MAX);
// What the title screen opens with, here and in an app's own (platform.title).
export const INTRO = `
      <h1 class="ts-logo">Thick Shift 3D</h1>
      <p class="lede cn-m-0">Midnight at the Mascot Depot</p>
      <p class="cn-meta cn-m-0">Keep the power on until 6 AM. The retired mascots are enormous, and at night they wander.</p>`;

/* ---------- screens ---------- */
// Each returns { key, html, wire }. The overlay only re-renders when key changes. An app can swap in its own title
// screen and lobby invite through platform (state.ts), built from the exported helpers here.

function titleScreen(): OverlayScreen {
  let savedName = '';
  try {
    savedName = localStorage.getItem('tsName') || '';
  } catch {
    /* storage blocked */
  }
  return {
    key: 'title',
    html: card(
      `${INTRO}
      <div class="field"><label for="nm">Your name</label><input id="nm" maxlength="${NAME_MAX}" placeholder="${DEFAULT_NAME}" value="${esc(savedName)}"></div>
      <div class="field"><label for="rc">Room code</label><input id="rc" maxlength="4" placeholder="To join a friend" autocapitalize="characters" value="${esc((q.get('room') || '').slice(0, 4))}"></div>`,
      '<button class="btn btn-primary" id="hb">Host a night</button><button class="btn btn-secondary" id="jb">Join room</button>'
    ),
    wire() {
      const begin = (then: () => void) => (): void => {
        unlockAudio();
        game.myName = guardName(byId('nm', HTMLInputElement).value);
        try {
          localStorage.setItem('tsName', game.myName);
        } catch {
          /* storage blocked */
        }
        then();
      };
      byId('hb').onclick = begin(host);
      byId('jb').onclick = begin(() => join(byId('rc', HTMLInputElement).value));
    },
  };
}

export function messageScreen(key: string, title: string, detail: string, back: boolean): OverlayScreen {
  return {
    key,
    html: card(
      `<h2 class="cn-title cn-m-0">${esc(title)}</h2>${detail ? `<p class="cn-meta cn-m-0">${esc(detail)}</p>` : ''}`,
      back ? '<button class="btn btn-secondary" id="back">Back</button>' : ''
    ),
    wire() {
      if (back) byId('back').onclick = () => location.reload();
    },
  };
}

// The whole loop, read in the lobby while the others join. The controls are on the click-to-play panel and the pause screen.
const RULES = [
  '<b>Fix faults.</b> Follow the yellow marks to the breaker box and press E.',
  '<b>Keep the power up.</b> Crank the generator in the booth. At zero, every door opens.',
  '<b>Torch the mascots.</b> The beam holds them back while the battery lasts.',
  "<b>Don't get touched.</b> A friend can peel you up. Everyone flat ends the night.",
];
// The night's tallies as a list: S.tally for one night, S.total for the run (see packages/sim/src/sim.ts).
// Flats are grouped by guard, with who did it for a night and a count for the run.
function floorStats(t: Tally, run?: boolean): string {
  const flats = Object.entries(Object.groupBy(t.flats, ([name]) => name))
    .map(([name, by = []]) => `${esc(name)} ${run ? by.length : `(${by.map(([, i]) => esc(MASC[i].name)).join(', ')})`}`)
    .join(', ');
  const peels = Object.entries(Object.groupBy(t.peels, name => name))
    .map(([name, by = []]) => `${esc(name)}${by.length > 1 || run ? ` ${by.length}` : ''}`)
    .join(', ');
  return `<dl class="kv"><dt>Faults fixed</dt><dd class="cn-tabular">${t.fixed}</dd><dt>Left to burn</dt><dd class="cn-tabular">${t.burnt}</dd>
    <dt>Flattened</dt><dd>${flats || 'Nobody'}</dd><dt>Peeled a friend up</dt><dd>${peels || 'Nobody'}</dd></dl>`;
}

function nightScreen(S: State): OverlayScreen {
  const names = S.players.map(p => p.name),
    who = names.map(esc).join(', ') || esc(game.myName);
  // The catch has the screen until client.holdUntil (see main.ts).
  const scaring = performance.now() < client.holdUntil;
  const ready = S.players.map(p => (p.ready ? 1 : 0)).join('');
  const key = [S.phase, S.night, names.join(','), ready, game.netNote, scaring].join('|');
  const wire = (): void => {
    const go = document.getElementById('go'),
      wait = document.getElementById('wait');
    if (go)
      go.onclick = () => {
        unlockAudio();
        send({ t: 'go' });
      };
    if (wait) wait.onclick = () => send({ t: 'wait' });
  };
  if (S.phase === 'lobby') {
    const link = `${location.origin}${location.pathname}?room=${S.code}`;
    // An app with its own way in (platform.invite) has no use for the code.
    const invite = platform.invite?.();
    const where = invite
      ? invite.html
      : `<div class="stat is-lg"><span>Room code</span><strong>${esc(S.code)}</strong></div>
        <p class="cn-meta cn-m-0">Friends join at<br><span class="cn-code ts-selectable">${esc(link)}</span></p>`;
    const wireLobby = (): void => {
      wire();
      invite?.wire?.();
    };
    return {
      key,
      wire: wireLobby,
      html: card(
        `
        ${where}
        <div class="cn-cluster">${S.players
          .map(p => (p.ready ? `<span class="chip cn-text-green">${CHECK}${esc(p.name)}, ready</span>` : `<span class="chip">${esc(p.name)}</span>`))
          .join('')}</div>
        ${waiting(S)}
        <ul class="cn-meta cn-m-0 ts-rules">${RULES.map(r => `<li>${r}</li>`).join('')}</ul>
        ${netBanner()}`,
        goButton(S, 'Start night 1', 'Ready for night 1')
      ),
    };
  }
  if (S.phase === 'win') {
    // S.tally is optional only for a lobby state, and from here on S is a night's.
    const tally = defined(S.tally, "the night's tally");
    const note = S.players.some(p => p.flat)
      ? 'Anyone still down gets back up at dawn.'
      : tally.flats.length
        ? 'Everyone made it back up.'
        : 'Nobody got flattened.';
    return {
      key,
      wire,
      html: card(
        `<h1 class="ts-logo">6 AM</h1><p class="lede cn-m-0">Night ${S.night} of ${FINAL_NIGHT} survived</p><p class="cn-meta cn-m-0">${note} Guards: ${who}</p>${floorStats(tally)}${waiting(S)}${netBanner()}`,
        goButton(S, `Start night ${S.night + 1}`, `Ready for night ${S.night + 1}`)
      ),
    };
  }
  if (S.phase === 'won')
    return {
      key,
      wire,
      html: card(
        `
      <h1 class="ts-logo">Shift over</h1>
      <p class="lede cn-m-0">You walked all ${FINAL_NIGHT} nights at the Mascot Depot.</p>
      <p class="cn-meta cn-m-0">The sun is up and the mascots are back on their stage. Guards: ${who}</p>
      ${floorStats(defined(S.total, "the run's tally"), true)}
      <p class="cn-meta cn-m-0">${S.deaths ? `The whole crew went down ${S.deaths === 1 ? 'once' : `${S.deaths} times`} along the way.` : 'The whole crew never went down at once.'}</p>
      ${waiting(S)}
      ${netBanner()}`,
        goButton(S, 'Start over from night 1', 'Ready to start over')
      ),
    };
  if (S.phase === 'dead' && !scaring)
    return {
      key,
      wire,
      html: card(
        `<h1 class="ts-logo ts-logo-bad">Flattened</h1><p class="lede cn-m-0">Everyone is on the floor. ${esc(S.killer === -1 ? 'Something' : MASC[S.killer].name)} got the last of you.</p><p class="cn-meta cn-m-0">Night ${S.night}, ${clockF(S)}.</p>${floorStats(defined(S.tally, "the night's tally"))}${waiting(S)}${netBanner()}`,
        goButton(S, `Retry night ${S.night}`, `Ready to retry night ${S.night}`),
        'ts-card-slow'
      ),
    };
  return { key, html: '' };
}

function currentScreen(): OverlayScreen {
  if (game.error) return messageScreen(`error:${game.error.title}`, game.error.title, game.error.detail, true);
  if (game.S) return nightScreen(game.S);
  if (game.joining) return messageScreen('joining', platform.fixedRoom ? 'Joining the night…' : `Connecting to room ${game.code}…`, '', false);
  return platform.title ? platform.title() : titleScreen();
}

// During a night the overlay is empty, so a note about the connection goes in a strip over the game instead.
let strip: HTMLElement | null = null;
function syncStrip(): void {
  const text = game.S?.phase === 'play' ? game.netNote : '';
  if (!strip) {
    if (!text) return;
    strip = document.createElement('div');
    strip.className = 'banner cn-tone-warning ts-net';
    document.body.append(strip);
  }
  strip.hidden = !text;
  if (strip.textContent !== text) strip.textContent = text;
}

let shownKey: string | null = null;
export function syncOverlay(): void {
  syncStrip();
  const s = currentScreen();
  if (s.key === shownKey) return;
  shownKey = s.key;
  const ui = byId('ui'); // the page's overlay, in index.html
  ui.hidden = !s.html;
  ui.innerHTML = s.html;
  if (s.html && s.wire) s.wire();
}
