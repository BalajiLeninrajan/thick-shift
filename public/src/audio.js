// Sound. Physical events (doors, bangs, footsteps, growls) are recordings from
// public/sfx; things that change as you play (the hum, the heartbeat) are
// synthesised. If a recording has not loaded yet, a synthesised stand-in plays.
// The 3D mode's positioned sound (three/sound.js) is built from the same
// pieces: it plays them into its own nodes with into().
let ac = null, master = null, ears = null;
const OPEN_HZ = 20000;

// Browsers only allow audio after a user gesture, so call this from handlers.
export function unlockAudio() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    // Everything goes through one limiter, so a growl over a bass hit does not clip.
    master = ac.createDynamicsCompressor();
    master.threshold.value = -8; master.ratio.value = 12; master.attack.value = .003; master.release.value = .2;
    // After the limiter, one filter over the whole mix. muffle() closes it.
    ears = ac.createBiquadFilter(); ears.type = 'lowpass'; ears.frequency.value = OPEN_HZ;
    master.connect(ears).connect(ac.destination);
    loadSamples();
  }
  if (ac.state === 'suspended') ac.resume();
}

// The context, but only while it can make sound: null before the first
// gesture and while the browser has it suspended.
export const ctx = () => ac && ac.state === 'running' ? ac : null;
export const bus = () => master;

// Everything, heard from under something heavy. No argument opens it again.
export function muffle(hz = OPEN_HZ, at = 0) {
  if (ac) ears.frequency.setTargetAtTime(hz, ac.currentTime + at, .12);
}

// Sounds made inside fn go to this node, not straight to the limiter, and
// skip their own reverb send: the node is expected to have one.
let dest = null;
export function into(node, fn) {
  const was = dest;
  dest = node;
  try { fn(); } finally { dest = was; }
}
const out = () => dest || master;

// Every one-shot is counted until the time it is due to end, and cut out of
// the graph when it does, so a long night cannot pile up nodes. Past
// MAX_VOICES new ones are dropped. The count goes by the clock and not by
// `ended` events, because a source the browser collects before it starts never sends one.
const MAX_VOICES = 32;
let ends = [];
export function voices() {
  if (ends.length) ends = ends.filter(t => t > ac.currentTime);
  return ends.length;
}
const full = () => !ac || voices() >= MAX_VOICES;
// tail: the last node of this sound's own chain. end: when it will have
// finished. slice: [offset, seconds] of a buffer to play, in place of all of it.
function play(src, tail, t0, end, slice) {
  ends.push(end);
  src.onended = () => { src.disconnect(); tail.disconnect(); };
  if (slice) src.start(t0, ...slice); else { src.start(t0); src.stop(end); }
}

/* ---------- recordings ---------- */

// All CC0. Sources are listed in the README.
const FILES = ['door_shut', 'door_open', 'slam1', 'slam2', 'slam3', 'sheet1', 'sheet2', 'sheet3', 'thud', 'hit_low', 'hit_long',
  'knock1', 'knock2', 'steps1', 'steps2', 'creak1', 'creak2', 'wind', 'scare_growl', 'far_growl1', 'far_growl2', 'far_growl3', 'far_growl4'];
const buffers = {};

function loadSamples() {
  for (const name of FILES) {
    fetch(`sfx/${name}.mp3`).then(r => r.arrayBuffer()).then(b => ac.decodeAudioData(b)).then(buf => { buffers[name] = buf; }).catch(() => { /* the stand-in plays */ });
  }
}

// A generated room: a second and a half of decaying noise, used as a reverb.
let roomNode = null;
export function room() {
  if (roomNode) return roomNode;
  const len = ac.sampleRate * 1.5, ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += (Math.random() * 2 - 1 - lp) * .35; d[i] = lp * Math.pow(1 - i / len, 2.6); }
  }
  roomNode = ac.createConvolver();
  roomNode.buffer = ir;
  roomNode.connect(master);
  return roomNode;
}

// Play a recording. Returns false if it has not loaded.
//   rate     below 1 is slower, lower and heavier
//   lowpass  Hz; makes it sound like it is in another room
//   at       seconds from now
//   wet      how much of it goes through the reverb, 0 to 1
//   from, len  play only this slice of it, in seconds of the recording
export function sample(name, { gain = 1, rate = 1, lowpass = 0, at = 0, wet = 0, from = 0, len = 0 } = {}) {
  if (!ac || !buffers[name]) return false;
  if (full()) return true;
  const src = ac.createBufferSource(), g = ac.createGain(), t = ac.currentTime + at;
  src.buffer = buffers[name]; src.playbackRate.value = rate; g.gain.value = gain;
  let node = src;
  if (lowpass) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; node.connect(lp); node = lp; }
  node.connect(g).connect(out());
  if (wet && !dest) { const send = ac.createGain(); send.gain.value = wet; g.connect(send).connect(room()); }
  // A slice ends mid-sound, so fade its last 40 ms.
  const end = t + (len || src.buffer.duration) / rate;
  if (len) { g.gain.setValueAtTime(gain, Math.max(t, end - .04)); g.gain.linearRampToValueAtTime(0, end); }
  play(src, g, t, end, len ? [from, len] : null);
  return true;
}
export const pick = (...names) => names[Math.random() * names.length | 0];

/* ---------- synthesis ---------- */

export function tone(f, d, type = 'sine', v = .2, f2, at = 0) {
  if (full()) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g).connect(out());
  play(o, g, t, t + d);
}

// Two seconds of white noise, made once. Every burst and hiss plays from it.
let white = null;
export function whiteNoise() {
  if (white) return white;
  white = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const a = white.getChannelData(0);
  for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
  return white;
}

// A burst of noise that dies away over d seconds.
//   band, band2  band-pass it at this many Hz, sweeping to band2 if given
//   q            how narrow the band is
//   attack       seconds to fade in; 0 is a hit
export function noise(d, v = .3, { at = 0, band = 0, band2 = 0, q = 1, attack = 0 } = {}) {
  if (full()) return;
  const s = ac.createBufferSource(), g = ac.createGain(), t = ac.currentTime + at;
  s.buffer = whiteNoise(); s.loop = true;
  g.gain.setValueAtTime(attack ? 0 : v, t);
  if (attack) g.gain.linearRampToValueAtTime(v, t + attack);
  g.gain.linearRampToValueAtTime(0, t + d);
  let node = s;
  if (band) {
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(band, t);
    if (band2) bp.frequency.exponentialRampToValueAtTime(band2, t + d);
    node.connect(bp); node = bp;
  }
  node.connect(g).connect(out());
  play(s, g, t, t + d, [Math.random(), d]);
}

// A piercing scream: two voices a semitone apart (so they beat against each
// other), sweeping from about 2.6 kHz up past 6 kHz and cracking on the way
// down. Everything below 2.8 kHz is cut, so there is no body to it, only edge.
function shriek(level = .7) {
  if (!ac) return;
  const t0 = ac.currentTime + .06, dur = 1.5, t1 = t0 + dur, mix = ac.createGain();
  for (const ratio of [1, 1.06]) {
    const voice = ac.createOscillator(), rough = ac.createOscillator(), depth = ac.createGain();
    voice.type = rough.type = 'sawtooth';
    voice.frequency.setValueAtTime(2600 * ratio, t0);
    voice.frequency.exponentialRampToValueAtTime(6500 * ratio, t0 + .25);
    voice.frequency.exponentialRampToValueAtTime(5400 * ratio, t0 + .9);
    voice.frequency.exponentialRampToValueAtTime(2300 * ratio, t1);
    rough.frequency.value = 91 * ratio; depth.gain.value = 700;       // fast pitch wobble: the crack in the voice
    rough.connect(depth).connect(voice.frequency);
    voice.connect(mix);
    for (const o of [voice, rough]) { o.start(t0); o.stop(t1); }
  }
  const amp = ac.createGain(), rasp = ac.createOscillator(), raspDepth = ac.createGain(), chop = ac.createGain();
  rasp.type = 'square'; rasp.frequency.value = 47; raspDepth.gain.value = .25; chop.gain.value = .75;
  rasp.connect(raspDepth).connect(chop.gain); rasp.start(t0); rasp.stop(t1);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(level, t0 + .03);
  amp.gain.setValueAtTime(level, t0 + dur * .75);
  amp.gain.linearRampToValueAtTime(0, t1);
  // Two high-pass filters in a row for a steep cut, then a peak where ears are most sensitive.
  const cut1 = ac.createBiquadFilter(), cut2 = ac.createBiquadFilter(), bite = ac.createBiquadFilter();
  cut1.type = cut2.type = 'highpass'; cut1.frequency.value = cut2.frequency.value = 2800;
  bite.type = 'peaking'; bite.frequency.value = 4200; bite.Q.value = 1.2; bite.gain.value = 9;
  mix.connect(cut1).connect(cut2).connect(bite).connect(chop).connect(amp).connect(master);
}

// The part of a heavy impact you feel more than hear.
export function boom({ from = 72, to = 30, level = .9, at = 0 } = {}) {
  if (full()) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + .45);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .006); g.gain.exponentialRampToValueAtTime(.001, t + .6);
  o.connect(g).connect(out()); play(o, g, t, t + .65);
}

// Something very heavy hitting a shut door. Each is several recordings at
// about half speed over a boom, in a room. One is picked at random per hit.
const BANGS = [
  // body against a shutter
  () => { boom(); sample('slam2', { rate: .5, wet: .5 }); sample('sheet3', { rate: .55, gain: .6, at: .01, wet: .5 }); },
  // two fists
  () => {
    boom({ level: .6 }); sample('slam3', { rate: .5, gain: .8, wet: .5 });
    boom({ at: .17 }); sample('slam1', { rate: .45, at: .17, wet: .5 });
    sample('sheet2', { rate: .5, gain: .5, at: .2, wet: .5 });
  },
  // mostly boom, as if the door is very thick
  () => { boom({ from: 60, to: 26, level: 1 }); sample('thud', { rate: .45, gain: .9, lowpass: 500, wet: .5 }); sample('hit_long', { gain: .7, wet: .2 }); sample('sheet1', { rate: .5, gain: .3, at: .02, wet: .5 }); },
  // three, fast, getting louder
  () => {
    [0, .14, .3].forEach((at, i) => { boom({ at, level: .5 + i * .2 }); sample(['slam1', 'slam3', 'slam2'][i], { rate: .55, gain: .6 + i * .2, at, wet: .5 }); });
    sample('sheet2', { rate: .5, gain: .5, at: .32, wet: .5 });
  },
];

/* ---------- event sounds ---------- */

const STEP_GAP = 20;
let lastSteps = -STEP_GAP;

// Keyed by simulation event type. Each gets the event, for the few that need it.
export const SFX = {
  // e.x is true when the door just shut.
  door(e) { sample(e && e.x ? 'door_shut' : 'door_open', { gain: .9, rate: .9, wet: .2 }) || tone(90, .25, 'square', .15, 40); },
  bang() {
    if (!buffers.slam1) { noise(.35, .5); tone(55, .4, 'sine', .5, 30); return; }
    BANGS[Math.random() * BANGS.length | 0]();
  },
  // It moved, somewhere else in the building.
  // Mascots move every few seconds; you only hear some of it. At most one set
  // of footsteps per STEP_GAP seconds, and then only about half the time.
  step() {
    if (!ac || ac.currentTime - lastSteps < STEP_GAP || Math.random() < .5) return;
    lastSteps = ac.currentTime;
    sample(pick('steps1', 'steps2'), { gain: .6, rate: .8, lowpass: 650, wet: .4 }) || tone(48, .3, 'sine', .35, 30);
  },
  // It is outside one of your doors. The creak says so, but not which door.
  arrive() { sample(pick('creak1', 'creak2'), { gain: .7, rate: .8, wet: .3 }); tone(70, .6, 'sawtooth', .05, 50); },
  scare() {
    // The growl leads. The shriek is quieter than it sounds like it should be,
    // because everything shares one limiter and a loud shriek ducks the growl.
    sample('hit_low', { gain: .8 });
    if (!sample('scare_growl', { gain: 1.7, wet: .25 })) noise(1.2, .6);
    sample('scare_growl', { gain: .9, rate: .5, lowpass: 900 });   // the same growl an octave down, for body
    shriek(.42);
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .5, 'triangle', .2), i * 160)); },
  out() { sample('hit_low', { gain: .9, rate: .7 }); tone(200, 1.2, 'sawtooth', .12, 30); },
  hour() { tone(880, .15, 'triangle', .08); },
  lights(e) { tone(e && e.x ? 1400 : 900, .04, 'square', .06); },
  // The door control clicks and nothing moves.
  fumble() { tone(180, .08, 'square', .12); setTimeout(() => tone(140, .1, 'square', .1), 90); },
  // A door breaker goes: a pop and a thud in the wall, then the door dropping open.
  trip() {
    noise(.07, .5, { band: 2400, q: .7 }); tone(110, .3, 'sine', .45, 38);
    sample('door_open', { gain: 1, rate: .8, at: .08, wet: .3 }) || tone(90, .3, 'square', .15, 40, .08);
  },
  // The breaker is back in: one relay tick.
  reset() { tone(1900, .03, 'square', .07); },
  // A button on a tripped door. Lower and shorter than a fumble, with nothing
  // after it, so hands failing and hardware failing do not sound the same.
  dead() { tone(95, .06, 'square', .14, 70); },
  // The generator seizes: the handle grinds down to a stop.
  seize() { tone(200, .5, 'sawtooth', .16, 40); noise(.5, .22, { band: 900, band2: 160, q: 1.5 }); },
  // Cool enough to turn again.
  unseize() { tone(700, .04, 'triangle', .06); },
  // A shut door's motor is close to tripping its breaker: a rising whine and
  // the relay chattering. Played in every view, so a guard on the cameras
  // hears a trip coming in time to open the door.
  strain() {
    tone(140, .9, 'sawtooth', .07, 230); tone(281, .9, 'square', .025, 460);
    for (let i = 0; i < 5; i++) tone(2200, .015, 'square', .05, 0, .25 + i * .11);
  },
};

export const click = (f = 600) => tone(f, .05, 'square', .05);

/* ---------- ambience ---------- */

// Quiet is the default. The hum is barely there, the wind comes in gusts with
// long gaps, and a background sound happens about once a minute.
let bed = null, windGain = null, nextBeat = 0, nextOdd = 0, nextFalse = 0;

// A low two-note hum and some filtered hiss that run for the whole night.
function startBed() {
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(master);
  for (const f of [46, 49.5]) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = .11; o.connect(g).connect(out); o.start(); }
  const n = ac.sampleRate * 3, buf = ac.createBuffer(1, n, ac.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; src.loop = true; lp.type = 'lowpass'; lp.frequency.value = 240; g.gain.value = .07;
  src.connect(lp).connect(g).connect(out); src.start();
  bed = out;
}

// Wind through the building, looped under the hum once its recording has loaded.
function startWind() {
  const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buffers.wind; src.loop = true; lp.type = 'lowpass'; lp.frequency.value = 1400; g.gain.value = 0;
  src.connect(lp).connect(g).connect(bed); src.start();
  windGain = g;
}

const farGrowl = () => sample(pick('far_growl1', 'far_growl2', 'far_growl3', 'far_growl4'), { gain: .14, rate: .5 + Math.random() * .2, lowpass: 380, wet: .6 });

// Things you hear from somewhere else in the building.
const ODD = [
  () => { sample('knock2', { gain: .25, rate: .7, lowpass: 500, wet: .6 }) || noise(.12, .12); sample('knock1', { gain: .18, rate: .7, lowpass: 500, at: .28, wet: .6 }); },   // two knocks
  () => sample(pick('creak1', 'creak2'), { gain: .3, rate: .7, lowpass: 900, wet: .6 }),                              // a door, far off
  () => tone(70, 2.2, 'sawtooth', .035, 52),                                                                // something dragged
  () => [660, 587, 660].forEach((f, i) => setTimeout(() => tone(f, .5, 'sine', .018, f * .985), i * 520)),   // someone humming
  // It, somewhere below you. Muffled this far, it is closer to a whisper than a growl.
  // Listed three times so it is the sound you hear most.
  farGrowl, farGrowl, farGrowl,                             // it, downstairs
];

// Sounds the game makes when something real happens, played when nothing has.
// They are exactly the real ones, so you cannot tell.
const FALSE_ALARMS = [() => SFX.arrive(), () => SFX.arrive(), () => SFX.bang(), () => { lastSteps = -STEP_GAP; SFX.step(); SFX.step(); }];

// Call once per frame. threat and dread: 0 to 1 while a night is running.
// sanity: this guard's, 1 to 0. threat = -1 goes quiet.
export function ambience(threat, dread = 0, sanity = 1) {
  if (!ac || ac.state !== 'running') return;
  if (!bed) startBed();
  if (!windGain && buffers.wind) startWind();
  const now = ac.currentTime;
  bed.gain.setTargetAtTime(threat < 0 ? 0 : .06 + dread * .4, now, .4);
  // Two slow waves multiplied: the wind is near silent most of the time and swells now and then.
  if (windGain) windGain.gain.setTargetAtTime(Math.max(0, Math.sin(now * .045) * Math.sin(now * .017 + 1)) ** 2 * .9, now, 1.5);
  if (threat < 0) return;
  if (threat > 0 && now > nextBeat) {                                                      // heartbeat, faster as it leans in
    nextBeat = now + 1 - threat * .55;
    tone(58, .14, 'sine', .22 + threat * .2, 38); setTimeout(() => tone(52, .16, 'sine', .16 + threat * .15, 34), 150);
  }
  // Below 60% sanity you start hearing things: more often the lower it goes.
  if (now > nextFalse) { if (nextFalse && Math.random() < (.6 - sanity) * 1.6) pick(...FALSE_ALARMS)(); nextFalse = now + 14 + Math.random() * 22; }
  if (now > nextOdd) { if (nextOdd && dread > .25) ODD[Math.random() * ODD.length | 0](); nextOdd = now + 45 - dread * 15 + Math.random() * 60; }
}
