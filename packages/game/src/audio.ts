// Sound. Physical events (doors, bangs, footsteps, growls) are recordings from
// packages/game/public/sfx; things that change as you play (the hum, the heartbeat) are
// synthesised. If a recording has not loaded yet, a synthesised stand-in plays.
// three/sound.ts places each sound in the building, built from these
// pieces: it plays them into its own nodes with into().
let ac: AudioContext | null = null,
  master: DynamicsCompressorNode | null = null,
  ears: BiquadFilterNode | null = null;
const OPEN_HZ = 20000;

// Browsers only allow audio after a user gesture, so call this from handlers.
export function unlockAudio(): void {
  if (!ac) {
    try {
      ac = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
    } catch {
      return;
    }
    // Everything goes through one limiter, so a growl over a bass hit does not clip.
    master = ac.createDynamicsCompressor();
    master.threshold.value = -8;
    master.ratio.value = 12;
    master.attack.value = 0.003;
    master.release.value = 0.2;
    // After the limiter, one filter over the whole mix. muffle() closes it.
    ears = ac.createBiquadFilter();
    ears.type = 'lowpass';
    ears.frequency.value = OPEN_HZ;
    master.connect(ears).connect(ac.destination);
    loadSamples();
  }
  if (ac.state === 'suspended') ac.resume();
}

// The context, but only while it can make sound: null before the first
// gesture and while the browser has it suspended.
export const ctx = (): AudioContext | null => (ac && ac.state === 'running' ? ac : null);
export const bus = (): DynamicsCompressorNode | null => master;

// Everything, heard from under something heavy. No argument opens it again.
export function muffle(hz = OPEN_HZ, at = 0): void {
  if (ac) ears.frequency.setTargetAtTime(hz, ac.currentTime + at, 0.12);
}

// Sounds made inside fn go to this node, not straight to the limiter, and
// skip their own reverb send: the node is expected to have one.
let dest: AudioNode | null = null;
export function into(node: AudioNode, fn: () => void): void {
  const was = dest;
  dest = node;
  try {
    fn();
  } finally {
    dest = was;
  }
}
const out = (): AudioNode => dest || master;

// Every one-shot is counted until the time it is due to end, and cut out of
// the graph when it does, so a long night cannot pile up nodes. Past
// MAX_VOICES new ones are dropped. The count goes by the clock and not by
// `ended` events, because a source the browser collects before it starts never sends one.
const MAX_VOICES = 32;
let ends: number[] = [];
export function voices(): number {
  if (ends.length) ends = ends.filter(t => t > ac.currentTime);
  return ends.length;
}
const full = (): boolean => !ac || voices() >= MAX_VOICES;
// tail: the last node of this sound's own chain. end: when it will have
// finished. slice: [offset, seconds] of a buffer to play, in place of all of it.
function play(src: AudioScheduledSourceNode, tail: AudioNode, t0: number, end: number, slice?: [number, number] | null): void {
  ends.push(end);
  src.onended = () => {
    src.disconnect();
    tail.disconnect();
  };
  if (slice) (src as AudioBufferSourceNode).start(t0, ...slice);
  else {
    src.start(t0);
    src.stop(end);
  }
}

/* ---------- recordings ---------- */

// All CC0. Sources are listed in the README.
const FILES = [
  'door_shut',
  'door_open',
  'slam1',
  'slam2',
  'slam3',
  'sheet1',
  'sheet2',
  'sheet3',
  'thud',
  'hit_low',
  'hit_long',
  'knock1',
  'knock2',
  'steps1',
  'steps2',
  'creak1',
  'creak2',
  'wind',
  'scare_growl',
  'far_growl1',
  'far_growl2',
  'far_growl3',
  'far_growl4',
];
const buffers: Record<string, AudioBuffer> = {};

function loadSamples(): void {
  for (const name of FILES) {
    fetch(`sfx/${name}.mp3`)
      .then(r => r.arrayBuffer())
      .then(b => ac.decodeAudioData(b))
      .then(buf => {
        buffers[name] = buf;
      })
      .catch(() => {
        /* the stand-in plays */
      });
  }
}

// A generated room: a second and a half of decaying noise, used as a reverb.
let roomNode: ConvolverNode | null = null;
export function room(): ConvolverNode {
  if (roomNode) return roomNode;
  const len = ac.sampleRate * 1.5,
    ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp += (Math.random() * 2 - 1 - lp) * 0.35;
      d[i] = lp * (1 - i / len) ** 2.6;
    }
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
export interface SampleOpts {
  gain?: number;
  rate?: number;
  lowpass?: number;
  at?: number;
  wet?: number;
  from?: number;
  len?: number;
}
export function sample(name: string, { gain = 1, rate = 1, lowpass = 0, at = 0, wet = 0, from = 0, len = 0 }: SampleOpts = {}): boolean {
  if (!ac || !buffers[name]) return false;
  if (full()) return true;
  const src = ac.createBufferSource(),
    g = ac.createGain(),
    t = ac.currentTime + at;
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  g.gain.value = gain;
  let node: AudioNode = src;
  if (lowpass) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;
    node.connect(lp);
    node = lp;
  }
  node.connect(g).connect(out());
  if (wet && !dest) {
    const send = ac.createGain();
    send.gain.value = wet;
    g.connect(send).connect(room());
  }
  // A slice ends mid-sound, so fade its last 40 ms.
  const end = t + (len || src.buffer.duration) / rate;
  if (len) {
    g.gain.setValueAtTime(gain, Math.max(t, end - 0.04));
    g.gain.linearRampToValueAtTime(0, end);
  }
  play(src, g, t, end, len ? [from, len] : null);
  return true;
}
export const pick = <T>(...names: T[]): T => names[(Math.random() * names.length) | 0];

/* ---------- synthesis ---------- */

export function tone(f: number, d: number, type: OscillatorType = 'sine', v = 0.2, f2?: number, at = 0): void {
  if (full()) return;
  const o = ac.createOscillator(),
    g = ac.createGain(),
    t = ac.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g).connect(out());
  play(o, g, t, t + d);
}

// Two seconds of white noise, made once. Every burst and hiss plays from it.
let white: AudioBuffer | null = null;
export function whiteNoise(): AudioBuffer {
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
export interface NoiseOpts {
  at?: number;
  band?: number;
  band2?: number;
  q?: number;
  attack?: number;
}
export function noise(d: number, v = 0.3, { at = 0, band = 0, band2 = 0, q = 1, attack = 0 }: NoiseOpts = {}): void {
  if (full()) return;
  const s = ac.createBufferSource(),
    g = ac.createGain(),
    t = ac.currentTime + at;
  s.buffer = whiteNoise();
  s.loop = true;
  g.gain.setValueAtTime(attack ? 0 : v, t);
  if (attack) g.gain.linearRampToValueAtTime(v, t + attack);
  g.gain.linearRampToValueAtTime(0, t + d);
  let node: AudioNode = s;
  if (band) {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(band, t);
    if (band2) bp.frequency.exponentialRampToValueAtTime(band2, t + d);
    node.connect(bp);
    node = bp;
  }
  node.connect(g).connect(out());
  play(s, g, t, t + d, [Math.random(), d]);
}

// A piercing scream: two voices a semitone apart (so they beat against each
// other), sweeping from about 2.6 kHz up past 6 kHz and cracking on the way
// down. Everything below 2.8 kHz is cut, so there is no body to it, only edge.
export function shriek(level = 0.7, at = 0): void {
  if (!ac) return;
  const t0 = ac.currentTime + 0.06 + at,
    dur = 1.5,
    t1 = t0 + dur,
    mix = ac.createGain();
  for (const ratio of [1, 1.06]) {
    const voice = ac.createOscillator(),
      rough = ac.createOscillator(),
      depth = ac.createGain();
    voice.type = rough.type = 'sawtooth';
    voice.frequency.setValueAtTime(2600 * ratio, t0);
    voice.frequency.exponentialRampToValueAtTime(6500 * ratio, t0 + 0.25);
    voice.frequency.exponentialRampToValueAtTime(5400 * ratio, t0 + 0.9);
    voice.frequency.exponentialRampToValueAtTime(2300 * ratio, t1);
    rough.frequency.value = 91 * ratio;
    depth.gain.value = 700; // fast pitch wobble: the crack in the voice
    rough.connect(depth).connect(voice.frequency);
    voice.connect(mix);
    for (const o of [voice, rough]) {
      o.start(t0);
      o.stop(t1);
    }
  }
  const amp = ac.createGain(),
    rasp = ac.createOscillator(),
    raspDepth = ac.createGain(),
    chop = ac.createGain();
  rasp.type = 'square';
  rasp.frequency.value = 47;
  raspDepth.gain.value = 0.25;
  chop.gain.value = 0.75;
  rasp.connect(raspDepth).connect(chop.gain);
  rasp.start(t0);
  rasp.stop(t1);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(level, t0 + 0.03);
  amp.gain.setValueAtTime(level, t0 + dur * 0.75);
  amp.gain.linearRampToValueAtTime(0, t1);
  // Two high-pass filters in a row for a steep cut, then a peak where ears are most sensitive.
  const cut1 = ac.createBiquadFilter(),
    cut2 = ac.createBiquadFilter(),
    bite = ac.createBiquadFilter();
  cut1.type = cut2.type = 'highpass';
  cut1.frequency.value = cut2.frequency.value = 2800;
  bite.type = 'peaking';
  bite.frequency.value = 4200;
  bite.Q.value = 1.2;
  bite.gain.value = 9;
  mix.connect(cut1).connect(cut2).connect(bite).connect(chop).connect(amp).connect(out());
}

// A Mini Biggs singing where it came down (TOY in packages/sim/src/sim.ts): a thump on the floor, a click as the voice box
// wakes, then two lines of Happy Birthday from a chip that was never meant to run on a torch battery. A thin pulse
// wave, crushed to a few bits like a cheap voice box, that drags and sags in pitch as the charge runs out over
// `secs`, until the last note is a groan. Made once into a buffer, so the whole song is one voice.
let songBuf: AudioBuffer | null = null;
export function song(gain = 0.5, at = 0, secs = 3): void {
  if (full()) return;
  songBuf ||= songBuffer(secs);
  const src = ac.createBufferSource(),
    g = ac.createGain(),
    t = ac.currentTime + at;
  src.buffer = songBuf;
  g.gain.value = gain;
  src.connect(g).connect(out());
  play(src, g, t, t + songBuf.duration);
}
function songBuffer(secs: number): AudioBuffer {
  const sr = ac.sampleRate,
    start = 0.25,
    len = Math.ceil(sr * (secs + start + 0.4)),
    buf = ac.createBuffer(1, len, sr),
    d = buf.getChannelData(0);
  // The thump of a soft toy landing, and the click of the voice box.
  for (let i = 0; i < sr * 0.08; i++) d[i] += Math.sin((i / sr) * 2 * Math.PI * 90) * Math.exp(-i / (sr * 0.02)) * 0.8;
  for (let i = 0; i < sr * 0.004; i++) d[Math.floor(sr * 0.15) + i] += (Math.random() * 2 - 1) * 0.5;
  // Semitones from G4 and beats: "Happy birthday to you, happy birthday to you".
  const NOTES = [
    [0, 0.75],
    [0, 0.25],
    [2, 1],
    [0, 1],
    [5, 1],
    [4, 2],
    [0, 0.75],
    [0, 0.25],
    [2, 1],
    [0, 1],
    [7, 1],
    [5, 2.5],
  ];
  const beats = NOTES.reduce((n, [, b]) => n + b, 0);
  let t = start,
    phase = 0,
    beat = 0;
  for (const [semi, b] of NOTES) {
    // How much charge is left, by how far through the song it is: the tempo drags to half and the pitch falls up to
    // seven semitones, most of it at the end.
    const left = 1 - beat / beats,
      dur = (((b * secs) / beats) * (1.5 - 0.5 * left)) / 1.15,
      n = Math.floor(dur * sr),
      i0 = Math.floor(t * sr);
    for (let k = 0; k < n && i0 + k < len; k++) {
      const u = k / n,
        now = 1 - (beat + b * u) / beats,
        sag = 7 * (1 - now) ** 2;
      const hz = 392 * 2 ** ((semi - sag) / 12) * (1 + 0.012 * Math.sin((t + k / sr) * 2 * Math.PI * 6)); // a warble
      phase = (phase + hz / sr) % 1;
      const pulse = phase < 0.28 ? 1.44 : -0.56; // a narrow pulse, centred so it carries no DC
      const env = Math.min(1, u * 40) * Math.min(1, (1 - u) * 12) * (0.4 + 0.6 * now);
      d[i0 + k] += Math.round(pulse * env * 0.5 * 8) / 8; // three bits of voice box
    }
    t += dur;
    beat += b;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < len; i++) d[i] /= peak * 1.1;
  return buf;
}

// The part of a heavy impact you feel more than hear.
export interface BoomOpts {
  from?: number;
  to?: number;
  level?: number;
  at?: number;
}
export function boom({ from = 72, to = 30, level = 0.9, at = 0 }: BoomOpts = {}): void {
  if (full()) return;
  const o = ac.createOscillator(),
    g = ac.createGain(),
    t = ac.currentTime + at;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + 0.45);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  o.connect(g).connect(out());
  play(o, g, t, t + 0.65);
}

// Something very heavy hitting a shut door. Each is several recordings at
// about half speed over a boom, in a room. One is picked at random per hit.
const BANGS = [
  // body against a shutter
  () => {
    boom();
    sample('slam2', { rate: 0.5, wet: 0.5 });
    sample('sheet3', { rate: 0.55, gain: 0.6, at: 0.01, wet: 0.5 });
  },
  // two fists
  () => {
    boom({ level: 0.6 });
    sample('slam3', { rate: 0.5, gain: 0.8, wet: 0.5 });
    boom({ at: 0.17 });
    sample('slam1', { rate: 0.45, at: 0.17, wet: 0.5 });
    sample('sheet2', { rate: 0.5, gain: 0.5, at: 0.2, wet: 0.5 });
  },
  // mostly boom, as if the door is very thick
  () => {
    boom({ from: 60, to: 26, level: 1 });
    sample('thud', { rate: 0.45, gain: 0.9, lowpass: 500, wet: 0.5 });
    sample('hit_long', { gain: 0.7, wet: 0.2 });
    sample('sheet1', { rate: 0.5, gain: 0.3, at: 0.02, wet: 0.5 });
  },
  // three, fast, getting louder
  () => {
    [0, 0.14, 0.3].forEach((at, i) => {
      boom({ at, level: 0.5 + i * 0.2 });
      sample(['slam1', 'slam3', 'slam2'][i], { rate: 0.55, gain: 0.6 + i * 0.2, at, wet: 0.5 });
    });
    sample('sheet2', { rate: 0.5, gain: 0.5, at: 0.32, wet: 0.5 });
  },
];

/* ---------- event sounds ---------- */

// Keyed by simulation event type, for the sounds three/sound.ts reuses (bang, out, scare) and the win jingle,
// which main.ts plays itself because it has no place in the building.
export const SFX = {
  bang(): void {
    if (!buffers.slam1) {
      noise(0.35, 0.5);
      tone(55, 0.4, 'sine', 0.5, 30);
      return;
    }
    BANGS[(Math.random() * BANGS.length) | 0]();
  },
  scare(): void {
    // The growl leads. The shriek is quieter than it sounds like it should be,
    // because everything shares one limiter and a loud shriek ducks the growl.
    sample('hit_low', { gain: 0.8 });
    if (!sample('scare_growl', { gain: 1.7, wet: 0.25 })) noise(1.2, 0.6);
    sample('scare_growl', { gain: 0.9, rate: 0.5, lowpass: 900 }); // the same growl an octave down, for body
    shriek(0.42);
  },
  win(): void {
    [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'triangle', 0.2), i * 160));
  },
  out(): void {
    sample('hit_low', { gain: 0.9, rate: 0.7 });
    tone(200, 1.2, 'sawtooth', 0.12, 30);
  },
};

/* ---------- ambience ---------- */

// Quiet is the default. The hum is barely there, the wind comes in gusts with
// long gaps, and a background sound happens about once a minute.
let bed: GainNode | null = null,
  windGain: GainNode | null = null,
  nextBeat = 0,
  nextOdd = 0;

// A low two-note hum and some filtered hiss that run for the whole night.
function startBed(): void {
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(master);
  for (const f of [46, 49.5]) {
    const o = ac.createOscillator(),
      g = ac.createGain();
    o.frequency.value = f;
    g.gain.value = 0.11;
    o.connect(g).connect(out);
    o.start();
  }
  const n = ac.sampleRate * 3,
    buf = ac.createBuffer(1, n, ac.sampleRate),
    data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(),
    lp = ac.createBiquadFilter(),
    g = ac.createGain();
  src.buffer = buf;
  src.loop = true;
  lp.type = 'lowpass';
  lp.frequency.value = 240;
  g.gain.value = 0.07;
  src.connect(lp).connect(g).connect(out);
  src.start();
  bed = out;
}

// Wind through the building, looped under the hum once its recording has loaded.
function startWind(): void {
  const src = ac.createBufferSource(),
    lp = ac.createBiquadFilter(),
    g = ac.createGain();
  src.buffer = buffers.wind;
  src.loop = true;
  lp.type = 'lowpass';
  lp.frequency.value = 1400;
  g.gain.value = 0;
  src.connect(lp).connect(g).connect(bed);
  src.start();
  windGain = g;
}

const farGrowl = (): boolean =>
  sample(pick('far_growl1', 'far_growl2', 'far_growl3', 'far_growl4'), { gain: 0.14, rate: 0.5 + Math.random() * 0.2, lowpass: 380, wet: 0.6 });

// Things you hear from somewhere else in the building.
const ODD = [
  () => {
    sample('knock2', { gain: 0.25, rate: 0.7, lowpass: 500, wet: 0.6 }) || noise(0.12, 0.12);
    sample('knock1', { gain: 0.18, rate: 0.7, lowpass: 500, at: 0.28, wet: 0.6 });
  }, // two knocks
  () => sample(pick('creak1', 'creak2'), { gain: 0.3, rate: 0.7, lowpass: 900, wet: 0.6 }), // a door, far off
  () => tone(70, 2.2, 'sawtooth', 0.035, 52), // something dragged
  () => [660, 587, 660].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sine', 0.018, f * 0.985), i * 520)), // someone humming
  // It, somewhere below you. Muffled this far, it is closer to a whisper than a growl.
  // Listed three times so it is the sound you hear most.
  farGrowl,
  farGrowl,
  farGrowl, // it, downstairs
];

// Call once per frame. threat and dread: 0 to 1 while a night is running.
// threat = -1 goes quiet.
export function ambience(threat: number, dread = 0): void {
  if (!ac || ac.state !== 'running') return;
  if (!bed) startBed();
  if (!windGain && buffers.wind) startWind();
  const now = ac.currentTime;
  bed.gain.setTargetAtTime(threat < 0 ? 0 : 0.06 + dread * 0.4, now, 0.4);
  // Two slow waves multiplied: the wind is near silent most of the time and swells now and then.
  if (windGain) windGain.gain.setTargetAtTime(Math.max(0, Math.sin(now * 0.045) * Math.sin(now * 0.017 + 1)) ** 2 * 0.9, now, 1.5);
  if (threat < 0) return;
  if (threat > 0 && now > nextBeat) {
    // heartbeat, faster as it leans in
    nextBeat = now + 1 - threat * 0.55;
    tone(58, 0.14, 'sine', 0.22 + threat * 0.2, 38);
    setTimeout(() => tone(52, 0.16, 'sine', 0.16 + threat * 0.15, 34), 150);
  }
  if (now > nextOdd) {
    if (nextOdd && dread > 0.25) ODD[(Math.random() * ODD.length) | 0]();
    nextOdd = now + 45 - dread * 15 + Math.random() * 60;
  }
}
