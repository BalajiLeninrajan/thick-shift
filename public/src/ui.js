// HTML chrome: the overlay screens and the control bar under the canvas.
// Everything here is derived from game/client state once per frame.
import { MASC, DOORS, FINAL_NIGHT } from './config.js';
import { game, client } from './state.js';
import { clock } from './rules.js';
import { startNight, restart } from './sim.js';
import { host, join } from './net.js';
import { unlockAudio } from './audio.js';

const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const esc = s => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);

const card = (body, footer = '') => `<div class="panel ts-card"><div class="panel-body cn-stack cn-gap-16">${body}</div>${footer && `<div class="panel-footer cn-cluster">${footer}</div>`}</div>`;
const hostAction = label => game.isHost ? `<button class="btn btn-primary" id="go">${label}</button>` : '<span class="cn-meta">Waiting for the host…</span>';

/* ---------- screens ---------- */
// Each returns { key, html, wire }. The overlay only re-renders when key changes.

function titleScreen() {
  let savedName = '';
  try { savedName = localStorage.tsName || ''; } catch (e) { /* storage blocked */ }
  return {
    key: 'title',
    html: card(`
      <h1 class="ts-logo">Thick Shift</h1>
      <p class="lede cn-m-0">Midnight at the Mascot Depot</p>
      <p class="cn-meta cn-m-0">The retired theme-park mascots are enormous, and at night they wander. Shut a door when one is outside it, watch the cameras, and keep the power on until 6 AM. Last five nights and you can go home. Works on a phone. Share a room code to play together.</p>
      <div class="field"><label for="nm">Your name</label><input id="nm" maxlength="12" placeholder="Guard" value="${esc(savedName)}"></div>
      <div class="field"><label for="rc">Room code</label><input id="rc" maxlength="4" placeholder="ABCD" autocapitalize="characters" value="${esc((q.get('room') || '').slice(0, 4))}"><small>Only needed to join a friend's night.</small></div>`,
      '<button class="btn btn-primary" id="hb">Host a night</button><button class="btn btn-secondary" id="jb">Join room</button>'),
    wire() {
      const begin = then => () => {
        unlockAudio();
        game.myName = ($('nm').value || 'Guard').slice(0, 12);
        try { localStorage.tsName = game.myName; } catch (e) { /* storage blocked */ }
        then();
      };
      $('hb').onclick = begin(host);
      $('jb').onclick = begin(() => join($('rc').value));
    },
  };
}

function messageScreen(key, title, detail, back) {
  return {
    key,
    html: card(`<h2 class="cn-title cn-m-0">${esc(title)}</h2>${detail ? `<p class="cn-meta cn-m-0">${esc(detail)}</p>` : ''}`, back ? '<button class="btn btn-secondary" id="back">Back</button>' : ''),
    wire() { if (back) $('back').onclick = () => location.reload(); },
  };
}

function nightScreen(S) {
  const names = S.players.map(p => p.name), who = names.map(esc).join(', ') || esc(game.myName);
  const key = [S.phase, S.night, names.join(','), game.netNote, client.scareT > 0].join('|');
  const next = () => S.phase === 'won' ? restart() : startNight(S.phase === 'win' ? S.night + 1 : S.night);
  const wire = () => { const go = $('go'); if (go) go.onclick = () => { unlockAudio(); next(); }; };
  if (S.phase === 'lobby') {
    const link = `${location.origin}${location.pathname}?room=${S.code}`;
    return {
      key, wire, html: card(`
        <div class="stat is-lg"><span>Room code</span><strong>${esc(S.code)}</strong></div>
        <p class="cn-meta cn-m-0">Friends join at<br><span class="cn-code ts-selectable">${esc(link)}</span></p>
        <div class="cn-cluster">${names.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div>
        ${game.netNote ? `<div class="banner cn-tone-warning">${esc(game.netNote)}</div>` : ''}`, hostAction('Start night 1')),
    };
  }
  if (S.phase === 'win') return {
    key, wire, html: card(`<h1 class="ts-logo">6 AM</h1><p class="lede cn-m-0">Night ${S.night} of ${FINAL_NIGHT} survived</p><p class="cn-meta cn-m-0">Everyone is un-squished. Guards: ${who}</p>`, hostAction('Start night ' + (S.night + 1))),
  };
  if (S.phase === 'won') {
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    return {
      key, wire, html: card(`
        <h1 class="ts-logo">Shift over</h1>
        <p class="lede cn-m-0">You survived all ${FINAL_NIGHT} nights at the Mascot Depot.</p>
        <p class="cn-meta cn-m-0">The sun is up and the mascots are back on their stage, exactly as they were. Nobody will believe you. Guards: ${who}</p>
        <dl class="kv"><dt>Doors slammed on them</dt><dd class="cn-tabular">${S.slams || 0}</dd><dt>Times flattened</dt><dd class="cn-tabular">${S.deaths || 0}</dd></dl>
        <p class="cn-meta cn-m-0">${S.deaths ? `It took ${plural(S.deaths, 'retry').replace('retrys', 'retries')}.` : 'Not flattened once.'}</p>`, hostAction('Start over from night 1')),
    };
  }
  if (S.phase === 'dead' && client.scareT <= 0) {
    const d = MASC[S.killer];
    return {
      key, wire, html: card(`<h1 class="ts-logo ts-logo-bad">Flattened</h1><p class="lede cn-m-0">${esc(d.name)} ${esc(d.how)}.</p><p class="cn-meta cn-m-0">It came through ${{ L: 'the left door', R: 'the right door', V: 'the vent' }[S.killDoor] || 'a door'}.</p><p class="cn-meta cn-m-0">Night ${S.night}, ${clock(S)}.</p>`, hostAction('Retry night ' + S.night)),
    };
  }
  return { key, html: '' };
}

function currentScreen() {
  if (game.error) return messageScreen('error:' + game.error.title, game.error.title, game.error.detail, true);
  if (game.S) return nightScreen(game.S);
  if (game.joining) return messageScreen('joining', `Connecting to room ${game.code}…`, '', false);
  return titleScreen();
}

let shownKey = null;
export function syncOverlay() {
  const s = currentScreen();
  if (s.key === shownKey) return;
  shownKey = s.key;
  const ui = $('ui');
  ui.hidden = !s.html;
  ui.innerHTML = s.html;
  if (s.html && s.wire) s.wire();
}

/* ---------- control bar ---------- */

const DOOR_BTN = { L: 'bL', V: 'bV', R: 'bR' };
function press(id, on) {
  const b = $(id), v = String(!!on);
  if (b.getAttribute('aria-pressed') !== v) b.setAttribute('aria-pressed', v);
}

export function syncControls() {
  const S = game.S, playing = !!S && S.phase === 'play';
  for (const k of DOORS) {
    const shut = playing && S.doors[k], word = $(DOOR_BTN[k]).querySelector('span');
    press(DOOR_BTN[k], shut);
    if (word.textContent !== (shut ? 'shut' : 'open')) word.textContent = shut ? 'shut' : 'open';
  }
  press('bCam', client.view === 'cams');
  press('bGen', client.view === 'crank');
  press('bTilt', client.tilt);
  press('bLight', playing && S.lights !== false && S.power > 0);
}
