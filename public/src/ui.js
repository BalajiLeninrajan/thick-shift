// HTML chrome: the overlay screens and the control bar under the canvas.
// Everything here is derived from game/client state once per frame.
import { MASC, DOORS, FINAL_NIGHT } from './config.js';
import { game, client } from './state.js';
import { clock, tripLeft, maxAttacks, pairFromNight } from './rules.js';
import { startFloorNight, restartFloor, clockF } from './three/sim3d.js';
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
      <p class="cn-meta cn-m-0">The retired theme-park mascots are enormous, and at night they wander. Shut a door when one is outside it, watch the cameras, and keep the power on until 6 AM. Door motors overheat if you hold a door shut through a quiet spell, and a whine means one is about to trip. The generator has one handle. Last five nights and you can go home. Works on a phone. Share a room code to play together.</p>
      <p class="cn-meta cn-m-0">Or walk the floor in 3D. Do the watchman's rounds with a torch whose battery runs down. Touch a mascot and you are flat until a teammate peels you up. The host picks the mode in the lobby.</p>
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

// The two ways to play. The host picks one in the lobby; S.mode carries it to the guests.
const MODES = {
  booth: ['The booth', 'Sit in the security booth. Watch the cameras, shut the doors, keep the power on.'],
  floor: ['The floor (3D)', 'Walk the building with a torch and do the watchman\'s rounds. It plays nothing like the booth:'],
};
// The floor's whole loop. Everyone reads it in the lobby while the others join.
const FLOOR_RULES = [
  '<b>The job.</b> Every hour a few clocks around the building come due. Yellow marks on the compass lead to them. Hold E at each one to punch it before the hour is up. A missed clock costs power.',
  '<b>Power.</b> Doors, lights and the torch charger run on it. Hold E at the generator crank in the booth to put some back. At zero every door opens and the lights go out.',
  '<b>Your torch.</b> The beam holds a mascot back while it is on it. A full battery lasts about a minute: charge it at the dock in the booth, or pick up spare batteries.',
  '<b>Your phone.</b> C holds up a map of the building, R zooms it. It eats the torch battery four times as fast as the torch, and while it is up you walk slowly and the torch points at the floor. Glance, then put it away.',
  '<b>The mascots.</b> They stand still, then wander in waves. Touch one and you are flat until a friend stands over you and holds E. While flat, Q calls for help and Space watches a friend. Everyone flat at once ends the night.',
  '<b>Lockers.</b> Hold E at a locker out on the floor to step inside and out of sight. Get out of sight first: one that sees you get in, or was right behind you, opens the door, and so does one that stands outside it too long. The doors clank, so mind who is near.',
  '<b>The booth</b> is where you start: the generator, the charger, a wall map of what is due, and three doors you can shut. Shut doors drain power fast and the clocks do not wait, so it is no place to hide.',
  '<b>Controls.</b> W A S D walk, mouse or arrow keys look, Shift runs, F is the torch, C is the phone, E uses things, Esc pauses.',
];
function modePicker(S) {
  const mode = S.mode || 'booth';
  const about = `<p class="cn-meta cn-m-0">${game.isHost ? '' : `<strong>${MODES[mode][0]}.</strong> `}${MODES[mode][1]}</p>${mode === 'floor' ? `<ul class="cn-meta cn-m-0 ts-rules">${FLOOR_RULES.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}`;
  if (!game.isHost) return about;
  return `<div class="segmented">${Object.keys(MODES).map(m => `<button id="mode-${m}" aria-pressed="${m === mode}"><b>${MODES[m][0]}</b></button>`).join('')}</div>${about}`;
}

// The floor's tallies as a list: S.tally for one night, S.total for the run (see three/sim3d.js).
// Flats are grouped by guard, with who did it for a night and a count for the run.
function floorStats(t, run) {
  const group = (list, key, val) => { const by = {}; for (const e of list) (by[key(e)] ||= []).push(val(e)); return Object.entries(by); };
  const flats = group(t.flats, e => e[0], e => MASC[e[1]].name).map(([name, by]) => `${esc(name)} ${run ? by.length : `(${by.map(esc).join(', ')})`}`).join(', ');
  const peels = group(t.peels, e => e, () => 1).map(([name, n]) => `${esc(name)}${n.length > 1 || run ? ' ' + n.length : ''}`).join(', ');
  return `<dl class="kv"><dt>Clocks punched</dt><dd class="cn-tabular">${t.punched}</dd><dt>Clocks missed</dt><dd class="cn-tabular">${t.missed}</dd>
    <dt>Flattened</dt><dd>${flats || 'Nobody'}</dd><dt>Peeled a friend up</dt><dd>${peels || 'Nobody'}</dd></dl>`;
}

function nightScreen(S) {
  const names = S.players.map(p => p.name), who = names.map(esc).join(', ') || esc(game.myName);
  const floor = S.mode === 'floor';
  // More guards draw more visits (crowdOf in rules.js). Said where a crew reads it: the lobby and between nights.
  const crowd = !floor && names.length > 1 ? `<p class="cn-meta cn-m-0">${names.length} guards on shift. A crowd draws them: up to ${maxAttacks(S)} visits a night, pairs from night ${pairFromNight(S)}.</p>` : '';
  const key =[S.phase, S.night, names.join(','), game.netNote, client.scareT > 0, S.mode].join('|');
  const next = () => S.phase === 'won' ? (floor ? restartFloor : restart)() : (floor ? startFloorNight : startNight)(S.phase === 'win' ? S.night + 1 : S.night);
  const wire = () => {
    const go = $('go'); if (go) go.onclick = () => { unlockAudio(); next(); };
    for (const m in MODES) { const b = $('mode-' + m); if (b) b.onclick = () => { S.mode = m; }; }   // lobby, host only
  };
  if (S.phase === 'lobby') {
    const link = `${location.origin}${location.pathname}?room=${S.code}`;
    return {
      key, wire, html: card(`
        <div class="stat is-lg"><span>Room code</span><strong>${esc(S.code)}</strong></div>
        <p class="cn-meta cn-m-0">Friends join at<br><span class="cn-code ts-selectable">${esc(link)}</span></p>
        <div class="cn-cluster">${names.map(n => `<span class="chip">${esc(n)}</span>`).join('')}</div>
        ${modePicker(S)}
        ${crowd}
        ${game.netNote ? `<div class="banner cn-tone-warning">${esc(game.netNote)}</div>` : ''}`, hostAction('Start night 1')),
    };
  }
  if (S.phase === 'win' && floor) {
    const note = S.players.some(p => p.flat) ? 'The day shift will peel up whoever is still on the floor.' : S.tally.flats.length ? 'Everyone is the right shape again.' : 'Nobody was flattened. They are saving it up.';
    return { key, wire, html: card(`<h1 class="ts-logo">6 AM</h1><p class="lede cn-m-0">Night ${S.night} of ${FINAL_NIGHT} survived</p><p class="cn-meta cn-m-0">${note} Guards: ${who}</p>${floorStats(S.tally)}`, hostAction('Start night ' + (S.night + 1))) };
  }
  if (S.phase === 'win') return {
    key, wire, html: card(`<h1 class="ts-logo">6 AM</h1><p class="lede cn-m-0">Night ${S.night} of ${FINAL_NIGHT} survived</p><p class="cn-meta cn-m-0">Everyone is un-squished. Guards: ${who}</p>${crowd}`, hostAction('Start night ' + (S.night + 1))),
  };
  if (S.phase === 'won' && floor) return {
    key, wire, html: card(`
      <h1 class="ts-logo">Shift over</h1>
      <p class="lede cn-m-0">You walked all ${FINAL_NIGHT} nights at the Mascot Depot.</p>
      <p class="cn-meta cn-m-0">The sun is up, every clock card is punched or near enough, and the mascots are back on their stage exactly as they were. Guards: ${who}</p>
      ${floorStats(S.total, true)}
      <p class="cn-meta cn-m-0">${S.deaths ? `The whole crew went down ${S.deaths === 1 ? 'once' : S.deaths + ' times'} along the way.` : 'The whole crew never went down at once.'}</p>`, hostAction('Start over from night 1')),
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
  if (S.phase === 'dead' && client.scareT <= 0 && floor) return {
    key, wire, html: card(`<h1 class="ts-logo ts-logo-bad">Flattened</h1><p class="lede cn-m-0">Everyone is on the floor. ${esc(MASC[S.killer].name)} got the last of you.</p><p class="cn-meta cn-m-0">Night ${S.night}, ${clockF(S)}. Nobody is left to do the peeling.</p>${floorStats(S.tally)}`, hostAction('Retry night ' + S.night)),
  };
  if (S.phase === 'dead' && client.scareT <= 0) {
    const d = MASC[S.killer];
    // The sim stops at the death, so the door it came through is still marked tripped if that is why it was open.
    const tripped = S.trip?.[S.killDoor] ? '<p class="cn-meta cn-m-0">Its breaker had tripped. The door was held shut until the motor cut out.</p>' : '';
    return {
      key, wire, html: card(`<h1 class="ts-logo ts-logo-bad">Flattened</h1><p class="lede cn-m-0">${esc(d.name)} ${esc(d.how)}.</p><p class="cn-meta cn-m-0">It came through ${{ L: 'the left door', R: 'the right door', V: 'the vent' }[S.killDoor] || 'a door'}.</p>${tripped}<p class="cn-meta cn-m-0">Night ${S.night}, ${clock(S)}.</p>`, hostAction('Retry night ' + S.night)),
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

const flag = (b, name, on) => { const v = String(!!on); if (b.getAttribute(name) !== v) b.setAttribute(name, v); };

export function syncControls() {
  const S = game.S, playing = !!S && S.phase === 'play';
  // A door button says its state in words and carries its motor's heat as a
  // bar along the bottom edge (--heat, see styles.css), so the gauge is under
  // the thumb that is holding the door shut. A tripped one counts down. It
  // says "out", not "tripped", because the button has no room for more.
  for (const k of DOORS) {
    const b = $(DOOR_BTN[k]), word = b.querySelector('span');
    const shut = playing && S.doors[k], heat = playing ? S.heat?.[k] || 0 : 0, wait = playing ? Math.ceil(tripLeft(S, k)) : 0;
    const label = wait ? `out ${wait}s` : shut ? 'shut' : 'open', level = heat.toFixed(2);
    press(DOOR_BTN[k], shut);
    if (word.textContent !== label) word.textContent = label;
    if (b.style.getPropertyValue('--heat') !== level) b.style.setProperty('--heat', level);
    flag(b, 'data-hot', heat > .8);
    flag(b, 'data-tripped', wait > 0);
  }
  press('bCam', client.view === 'cams');
  press('bGen', client.view === 'crank');
  press('bTilt', client.tilt);
  press('bLight', playing && S.lights !== false && S.power > 0);
}
