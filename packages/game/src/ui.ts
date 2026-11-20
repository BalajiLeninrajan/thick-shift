// The overlay screens around a night: title, lobby, and the cards between nights.
// Everything here is derived from game/client state once per frame.
import { MASC, FINAL_NIGHT } from '@thick-shift/sim/config';
import { game, client, platform } from './state';
import { startFloorNight, restartFloor, clockF } from '@thick-shift/sim';
import { host, join, sim } from './net';
import { unlockAudio } from './audio';
import type { State, Tally } from '@thick-shift/sim/types';
import type { OverlayScreen } from './types';

export const $ = (id: string): HTMLElement => document.getElementById(id);
const q = new URLSearchParams(location.search);
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

export const card = (body: string, footer = '', cls = ''): string =>
  `<div class="panel ts-card ${cls}"><div class="panel-body cn-stack cn-gap-16">${body}</div>${footer && `<div class="panel-footer cn-cluster">${footer}</div>`}</div>`;
const hostAction = (label: string): string =>
  game.isHost ? `<button class="btn btn-primary" id="go">${label}</button>` : '<span class="cn-meta">Waiting for the host…</span>';

/* ---------- screens ---------- */
// Each returns { key, html, wire }. The overlay only re-renders when key changes. An app can swap in its own title
// screen and lobby invite through platform (state.ts), built from the exported helpers here.

function titleScreen(): OverlayScreen {
  let savedName = '';
  try {
    savedName = localStorage.tsName || '';
  } catch {
    /* storage blocked */
  }
  return {
    key: 'title',
    html: card(
      `
      <h1 class="ts-logo">Thick Shift 3D</h1>
      <p class="lede cn-m-0">Midnight at the Mascot Depot</p>
      <p class="cn-meta cn-m-0">Keep the power on until 6 AM. The retired mascots are enormous, and at night they wander.</p>
      <div class="field"><label for="nm">Your name</label><input id="nm" maxlength="12" placeholder="Guard" value="${esc(savedName)}"></div>
      <div class="field"><label for="rc">Room code</label><input id="rc" maxlength="4" placeholder="To join a friend" autocapitalize="characters" value="${esc((q.get('room') || '').slice(0, 4))}"></div>`,
      '<button class="btn btn-primary" id="hb">Host a night</button><button class="btn btn-secondary" id="jb">Join room</button>'
    ),
    wire() {
      const begin = (then: () => void) => (): void => {
        unlockAudio();
        const name = ($('nm') as HTMLInputElement).value;
        game.myName = (name || 'Guard').slice(0, 12);
        try {
          localStorage.tsName = game.myName;
        } catch {
          /* storage blocked */
        }
        then();
      };
      $('hb').onclick = begin(host);
      $('jb').onclick = begin(() => join(($('rc') as HTMLInputElement).value));
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
      if (back) $('back').onclick = () => location.reload();
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
  const group = <T, V>(list: T[], key: (e: T) => string, val: (e: T) => V): [string, V[]][] => {
    const by: Record<string, V[]> = {};
    for (const e of list) (by[key(e)] ||= []).push(val(e));
    return Object.entries(by);
  };
  const flats = group(
    t.flats,
    e => e[0],
    e => MASC[e[1]].name
  )
    .map(([name, by]) => `${esc(name)} ${run ? by.length : `(${by.map(esc).join(', ')})`}`)
    .join(', ');
  const peels = group(
    t.peels,
    e => e,
    () => 1
  )
    .map(([name, n]) => `${esc(name)}${n.length > 1 || run ? ` ${n.length}` : ''}`)
    .join(', ');
  return `<dl class="kv"><dt>Faults fixed</dt><dd class="cn-tabular">${t.fixed ?? 0}</dd><dt>Left to burn</dt><dd class="cn-tabular">${t.burnt ?? 0}</dd>
    <dt>Flattened</dt><dd>${flats || 'Nobody'}</dd><dt>Peeled a friend up</dt><dd>${peels || 'Nobody'}</dd></dl>`;
}

function nightScreen(S: State): OverlayScreen {
  const names = S.players.map(p => p.name),
    who = names.map(esc).join(', ') || esc(game.myName);
  // The catch has the screen until client.holdUntil (see main.ts).
  const scaring = performance.now() < client.holdUntil;
  const key = [S.phase, S.night, names.join(','), game.netNote, scaring].join('|');
  const next = (): void => (S.phase === 'won' ? restartFloor(sim, S) : startFloorNight(sim, S, S.phase === 'win' ? S.night + 1 : S.night));
  const wire = (): void => {
    const go = $('go');
    if (go)
      go.onclick = () => {
        unlockAudio();
        next();
      };
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
        <div class="cn-cluster">${names.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div>
        <ul class="cn-meta cn-m-0 ts-rules">${RULES.map(r => `<li>${r}</li>`).join('')}</ul>
        ${game.netNote ? `<div class="banner cn-tone-warning">${esc(game.netNote)}</div>` : ''}`,
        hostAction('Start night 1')
      ),
    };
  }
  if (S.phase === 'win') {
    const note = S.players.some(p => p.flat)
      ? 'Anyone still down gets back up at dawn.'
      : S.tally.flats.length
        ? 'Everyone made it back up.'
        : 'Nobody got flattened.';
    return {
      key,
      wire,
      html: card(
        `<h1 class="ts-logo">6 AM</h1><p class="lede cn-m-0">Night ${S.night} of ${FINAL_NIGHT} survived</p><p class="cn-meta cn-m-0">${note} Guards: ${who}</p>${floorStats(S.tally)}`,
        hostAction(`Start night ${S.night + 1}`)
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
      ${floorStats(S.total, true)}
      <p class="cn-meta cn-m-0">${S.deaths ? `The whole crew went down ${S.deaths === 1 ? 'once' : `${S.deaths} times`} along the way.` : 'The whole crew never went down at once.'}</p>`,
        hostAction('Start over from night 1')
      ),
    };
  if (S.phase === 'dead' && !scaring)
    return {
      key,
      wire,
      html: card(
        `<h1 class="ts-logo ts-logo-bad">Flattened</h1><p class="lede cn-m-0">Everyone is on the floor. ${esc(MASC[S.killer]?.name || 'Something')} got the last of you.</p><p class="cn-meta cn-m-0">Night ${S.night}, ${clockF(S)}.</p>${floorStats(S.tally)}`,
        hostAction(`Retry night ${S.night}`),
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

let shownKey: string | null = null;
export function syncOverlay(): void {
  const s = currentScreen();
  if (s.key === shownKey) return;
  shownKey = s.key;
  const ui = $('ui');
  ui.hidden = !s.html;
  ui.innerHTML = s.html;
  if (s.html && s.wire) s.wire();
}
