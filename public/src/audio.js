// Synthesised sound effects. No audio files.
let ac = null;

// Browsers only allow audio after a user gesture, so call this from handlers.
export function unlockAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ } }
  if (ac && ac.state === 'suspended') ac.resume();
}

export function tone(f, d, type = 'sine', v = .2, f2) {
  if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g).connect(ac.destination);
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
  s.connect(g).connect(ac.destination);
  s.start();
}

// Keyed by simulation event type.
export const SFX = {
  door() { tone(90, .25, 'square', .15, 40); },
  bang() { noise(.35, .5); tone(55, .4, 'sine', .5, 30); },
  step() { tone(48, .3, 'sine', .35, 30); },
  arrive() { tone(70, .6, 'sawtooth', .08, 50); },
  scare() { noise(1.2, .6); tone(420, 1.2, 'sawtooth', .3, 90); tone(633, 1.2, 'square', .15, 120); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .5, 'triangle', .2), i * 160)); },
  out() { tone(200, 1.2, 'sawtooth', .2, 30); },
  hour() { tone(880, .15, 'triangle', .08); },
};

export const click = (f = 600) => tone(f, .05, 'square', .05);

/* ---------- ambience ---------- */

let bed = null, nextBeat = 0, nextOdd = 0;

// A low two-note hum and some filtered hiss that run for the whole night.
function startBed() {
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(ac.destination);
  for (const f of [46, 49.5]) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; g.gain.value = .11; o.connect(g).connect(out); o.start(); }
  const n = ac.sampleRate * 3, buf = ac.createBuffer(1, n, ac.sampleRate), data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
  src.buffer = buf; src.loop = true; lp.type = 'lowpass'; lp.frequency.value = 240; g.gain.value = .07;
  src.connect(lp).connect(g).connect(out); src.start();
  bed = out;
}

// Things you hear from somewhere else in the building.
const ODD = [
  () => { noise(.12, .12); setTimeout(() => noise(.12, .09), 260); },                       // two knocks
  () => tone(70, 2.2, 'sawtooth', .035, 52),                                                // something dragged
  () => [660, 587, 660].forEach((f, i) => setTimeout(() => tone(f, .5, 'sine', .018, f * .985), i * 520)),   // someone humming
  () => tone(1900, .9, 'sine', .01, 1700),                                                  // a light about to go
];

// Call once per frame. threat and dread: 0 to 1 while a night is running.
// threat = -1 goes quiet.
export function ambience(threat, dread = 0) {
  if (!ac || ac.state !== 'running') return;
  if (!bed) startBed();
  const now = ac.currentTime;
  bed.gain.setTargetAtTime(threat < 0 ? 0 : .15 + dread * .85, now, .4);
  if (threat < 0) return;
  if (threat > 0 && now > nextBeat) {                                                      // heartbeat, faster as it leans in
    nextBeat = now + 1 - threat * .55;
    tone(58, .14, 'sine', .22 + threat * .2, 38); setTimeout(() => tone(52, .16, 'sine', .16 + threat * .15, 34), 150);
  }
  if (now > nextOdd) { if (nextOdd && dread > .25) ODD[Math.random() * ODD.length | 0](); nextOdd = now + 22 - dread * 14 + Math.random() * 10; }
}
