// Sound. Physical events (doors, bangs, footsteps, growls) are recordings from
// public/sfx; things that change as you play (the hum, the heartbeat) are
// synthesised. If a recording has not loaded yet, a synthesised stand-in plays.
let ac = null, master = null;

// Browsers only allow audio after a user gesture, so call this from handlers.
export function unlockAudio() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    // Everything goes through one limiter, so a growl over a bass hit does not clip.
    master = ac.createDynamicsCompressor();
    master.threshold.value = -8; master.ratio.value = 12; master.attack.value = .003; master.release.value = .2;
    master.connect(ac.destination);
    loadSamples();
  }
  if (ac.state === 'suspended') ac.resume();
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
function room() {
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
function sample(name, { gain = 1, rate = 1, lowpass = 0, at = 0, wet = 0 } = {}) {
  if (!ac || !buffers[name]) return false;
  const src = ac.createBufferSource(), g = ac.createGain();
  src.buffer = buffers[name]; src.playbackRate.value = rate; g.gain.value = gain;
  let node = src;
  if (lowpass) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lowpass; node.connect(lp); node = lp; }
  node.connect(g).connect(master);
  if (wet) { const send = ac.createGain(); send.gain.value = wet; g.connect(send).connect(room()); }
  src.start(ac.currentTime + at);
  return true;
}
const pick = (...names) => names[Math.random() * names.length | 0];

/* ---------- synthesis ---------- */

export function tone(f, d, type = 'sine', v = .2, f2) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + d);
}

function noise(d, v = .3) {
  if (!ac) return;
  const n = ac.sampleRate * d, b = ac.createBuffer(1, n, ac.sampleRate), a = b.getChannelData(0);
  for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = b;
  g.gain.value = v;
  s.connect(g).connect(master);
  s.start();
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
function boom({ from = 72, to = 30, level = .9, at = 0 } = {}) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + .45);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + .006); g.gain.exponentialRampToValueAtTime(.001, t + .6);
  o.connect(g).connect(master); o.start(t); o.stop(t + .65);
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

// Keyed by simulation event type. Each gets the event, for the few that need it.
export const SFX = {
  // e.x is true when the door just shut.
  door(e) { sample(e && e.x ? 'door_shut' : 'door_open', { gain: .9, rate: .9, wet: .2 }) || tone(90, .25, 'square', .15, 40); },
  bang() {
    if (!buffers.slam1) { noise(.35, .5); tone(55, .4, 'sine', .5, 30); return; }
    BANGS[Math.random() * BANGS.length | 0]();
  },
  // It moved, somewhere else in the building.
  step() { sample(pick('steps1', 'steps2'), { gain: .6, rate: .8, lowpass: 650, wet: .4 }) || tone(48, .3, 'sine', .35, 30); },
  // It is outside one of your doors.
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
};

export const click = (f = 600) => tone(f, .05, 'square', .05);

/* ---------- ambience ---------- */

let bed = null, windOn = false, nextBeat = 0, nextOdd = 0;

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
  src.buffer = buffers.wind; src.loop = true; lp.type = 'lowpass'; lp.frequency.value = 1400; g.gain.value = .5;
  src.connect(lp).connect(g).connect(bed); src.start();
  windOn = true;
}

const farGrowl = () => sample(pick('far_growl1', 'far_growl2', 'far_growl3', 'far_growl4'), { gain: .14, rate: .5 + Math.random() * .2, lowpass: 380, wet: .6 });

// Things you hear from somewhere else in the building.
const ODD = [
  () => { sample('knock2', { gain: .25, rate: .7, lowpass: 500, wet: .6 }) || noise(.12, .12); sample('knock1', { gain: .18, rate: .7, lowpass: 500, at: .28, wet: .6 }); },   // two knocks
  () => sample(pick('creak1', 'creak2'), { gain: .3, rate: .7, lowpass: 900, wet: .6 }),                              // a door, far off
  () => sample(pick('steps1', 'steps2'), { gain: .3, rate: .7, lowpass: 420, wet: .6 }),                              // someone walking
  () => tone(70, 2.2, 'sawtooth', .035, 52),                                                                // something dragged
  () => [660, 587, 660].forEach((f, i) => setTimeout(() => tone(f, .5, 'sine', .018, f * .985), i * 520)),   // someone humming
  // It, somewhere below you. Muffled this far, it is closer to a whisper than a growl.
  // Listed three times so it is the sound you hear most.
  farGrowl, farGrowl, farGrowl,                             // it, downstairs
];

// Call once per frame. threat and dread: 0 to 1 while a night is running.
// threat = -1 goes quiet.
export function ambience(threat, dread = 0) {
  if (!ac || ac.state !== 'running') return;
  if (!bed) startBed();
  if (!windOn && buffers.wind) startWind();
  const now = ac.currentTime;
  bed.gain.setTargetAtTime(threat < 0 ? 0 : .15 + dread * .85, now, .4);
  if (threat < 0) return;
  if (threat > 0 && now > nextBeat) {                                                      // heartbeat, faster as it leans in
    nextBeat = now + 1 - threat * .55;
    tone(58, .14, 'sine', .22 + threat * .2, 38); setTimeout(() => tone(52, .16, 'sine', .16 + threat * .15, 34), 150);
  }
  if (now > nextOdd) { if (nextOdd && dread > .25) ODD[Math.random() * ODD.length | 0](); nextOdd = now + 22 - dread * 14 + Math.random() * 10; }
}
