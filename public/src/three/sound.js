// Sound for the 3D mode. On the floor you hear things before you see them, so
// everything that makes a noise has a place: a mascot, another guard, a door,
// a breaker box. Each place is an emitter (a panner with a filter in front of it),
// the listener is this guard's head, and walls dull what is behind them.
//
// The sounds themselves are the pieces in ../audio.js (recordings, tones,
// noise, the room reverb, the one limiter), played into an emitter with
// into(). Nothing here runs until the audio context is running, and events
// that happen before then are dropped, not queued.
import { MASC, DOORS } from '../config.js';
import { game, rnd } from '../state.js';
import { SFX, ctx, bus, room, into, muffle, voices, sample, tone, noise, boom, pick, whiteNoise, shriek } from '../audio.js';
import { ROOMS3, DOORWAYS, PANELS, BOXES, GENERATOR, CHARGER, DUCTS, EYE, sees, roomAt } from './map.js';
import { lightsF } from './sim3d.js';
import { CUES } from './actors/scare.js';

const HEAR = 28;        // metres past which a footstep is not worth a voice
const BUSY = 18;        // with this many voices sounding, footsteps and other texture are skipped
const POOL = 8;         // emitters shared by one-off sounds (a bang, a fixed fault)
const FIZZ = [1.6, 3.2];  // seconds between the crackles of an open fault, so it can be found by ear
const MAX_GUARDS = 5;   // other guards whose footsteps are placed
const MUFFLED = 420;    // Hz the whole mix is cut to while this guard is flat
const IN_LOCKER = 2600; // and while they stand in a locker, behind its doors
// What walls do to a sound, as [gain, low-pass Hz]: in sight, in the same room
// but round a corner, then one, two, and three or more doorways away.
const OCC = [[1, 18000], [.8, 4500], [.55, 1400], [.36, 750], [.24, 450]];
const LOOK = .13;       // seconds between line-of-sight checks for one emitter

// By MASC index. Each mascot has to be tellable from the others in the dark.
const STRIDE = [1.5, .75, 1.7, 1.2];            // metres per footfall
// Breath: a band of noise that swells and falls. sharp: higher is more of a snort.
const BREATH = [
  { hz: 260, q: 1.2, rate: .28, level: .5, sharp: 2 },    // Biggs: slow and deep
  { hz: 900, q: 3, rate: .4, level: .16, sharp: 2 },      // Flan: a thin wheeze
  { hz: 420, q: 6, rate: .7, level: .3, sharp: 3 },       // Squish: quick, through something wet
  { hz: 180, q: 1, rate: .45, level: .6, sharp: 6 },      // Tank: snorts
];
const GROWL_RATE = [.7, 1.3, 1.1, .85];         // how each one's voice is pitched

// One footstep cut from the step recordings, which hold five each.
const STEPS = [['steps1', .08], ['steps1', .99], ['steps1', 1.59], ['steps1', 2.14], ['steps1', 2.75], ['steps2', .33], ['steps2', .95], ['steps2', 1.6], ['steps2', 2.2], ['steps2', 2.8]];
function footfall(rate, gain, lowpass) {
  const [name, from] = STEPS[Math.random() * STEPS.length | 0];
  sample(name, { from, len: .26, rate, gain, lowpass }) || tone(70, .1, 'sine', gain * .5, 40);
}
// Something soft and wet being pressed on.
const squelch = (level, at = 0) => { noise(.16 + rnd(0, .08), level, { band: rnd(1200, 1900), band2: 280, q: 1.6, at }); tone(rnd(150, 210), .09, 'sine', level * .5, 70, at); };

// m: the mascot, for its rot (0 to 2) and state. Each is played into that mascot's emitter.
const MASCOT_STEP = [
  // Biggs: you feel it in the floor before you hear the foot.
  m => { boom({ from: 58 - m.rot * 6, to: 30, level: .4 + m.rot * .07 }); footfall(.5 - m.rot * .05, .55, 600); },
  // Flan: a hem dragging, and her pearls. The pearls are how you find her.
  () => { noise(.16, .25, { band: 500, band2: 250, q: .8 }); for (let k = 0, n = 2 + Math.random() * 2 | 0; k < n; k++) tone(rnd(3200, 5000), .035, 'sine', .2, 0, k * .045 + rnd(0, .02)); },
  // Squish: a slap on tile, or sheet metal booming when it is in the ducts.
  m => {
    if (roomAt(m.x, m.z) === DUCTS) { sample(pick('sheet1', 'sheet2', 'sheet3'), { rate: rnd(.6, .8), gain: .5 }) || noise(.2, .4, { band: 700 }); tone(rnd(180, 230), .5, 'triangle', .12, 170); }
    else { noise(.13, .45, { band: 1600, band2: 350, q: 1.5 }); tone(170, .09, 'sine', .3, 70); }
  },
  // Tank: hooves. At a charge they come five a second.
  m => { sample('knock2', { rate: .55, gain: m.st === 'charge' ? .8 : .5 }) || tone(120, .08, 'square', .3, 60); boom({ from: 80, to: 40, level: m.st === 'charge' ? .55 : .35 }); },
];
// What each does the moment it sees a guard.
const SPOT = [
  () => { sample('far_growl1', { rate: .6, gain: .5 }) || tone(60, .8, 'sawtooth', .3, 40); boom({ level: .35 }); },
  () => { for (let k = 0; k < 9; k++) tone(rnd(3000, 5200), .04, 'sine', .2, 0, k * .035 + rnd(0, .015)); noise(.5, .3, { band: 1500, band2: 3200, q: 3, attack: .35 }); },
  () => { for (const at of [0, .22]) { tone(150, .18, 'sawtooth', .3, 85, at); noise(.15, .2, { band: 900, band2: 300, q: 2, at }); } },
  () => { noise(.4, .4, { band: 320, q: 1, attack: .04 }); sample('far_growl3', { rate: .8, gain: .6, at: .1 }); },
];

const doorAt = key => { const [x0, z0, x1, z1] = DOORWAYS.find(d => d.key === key).rect; return { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }; };
// Doorways between two rooms by the shortest way, a shut door counting double. 9 is "a long way".
function doorwaysBetween(a, b, doors) {
  const d = ROOMS3.map(() => 9);
  d[a] = 0;
  for (let pass = 0; pass < 4; pass++) for (const w of DOORWAYS) {
    const cost = doors[w.key] ? 2 : 1;
    d[w.b] = Math.min(d[w.b], d[w.a] + cost); d[w.a] = Math.min(d[w.a], d[w.b] + cost);
  }
  return d[b];
}
// Bigger rooms have a lower, louder tone and more echo. 0 for the ducts, 1 for the stage.
const SIZE = ROOMS3.map(r => { const [x0, z0, x1, z1] = r.rects[0]; return Math.max(0, Math.min(1, Math.log((x1 - x0) * (z1 - z0) * r.h / 69) / Math.log(14))); });

export function createSound() {
  let ac = null, now = 0, rig = null, lastEv = -1, stingAt = -9, sting = null, wasPlay = false, under = 0, echo = 1;
  let head = { x: 0, z: 0, fx: 0, fz: 1 }, doors = null, torchOn = false, sources = 0, steps = 0, pant = 0, gasp = false, crank = 0, holdTick = 0, dim = false;

  /* ---------- the graph ---------- */

  const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const filter = (type, hz, q = 1) => { const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q; return f; };
  const osc = (type, hz) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = hz; o.start(); sources++; return o; };
  const chain = (...nodes) => nodes.reduce((a, b) => (a.connect(b), b));
  // Glide a parameter to a value. Asking for the value it already has queues nothing.
  const aimed = new WeakMap();
  function aim(param, v, over = .08) {
    if (Math.abs(aimed.get(param) - v) < 1e-4 * (1 + Math.abs(v))) return;
    aimed.set(param, v); param.setTargetAtTime(v, now, over);
  }
  // Older Safari and Firefox have the methods but not the parameters.
  const put = (node, x, z) => { if (node.positionX) { node.positionX.value = x; node.positionY.value = EYE; node.positionZ.value = z; } else node.setPosition(x, EYE, z); };

  // A place a sound comes from. Play into `in`. wet: how much reverb it gets.
  // The panning is the cheap left-right kind. The head-shaped kind (HRTF)
  // measured about twenty times the cost per source, sounding or not.
  function emitter(wet) {
    const e = { in: gain(1), lp: filter('lowpass', OCC[0][1], .5), pan: ac.createPanner(), send: gain(0), wet, occ: 0, look: 0 };
    e.pan.panningModel = 'equalpower'; e.pan.distanceModel = 'inverse'; e.pan.refDistance = 2.5; e.pan.rolloffFactor = 1.2;
    chain(e.in, e.lp, e.pan, bus());
    chain(e.lp, e.send, room());
    return e;
  }
  const unplug = e => { e.pan.disconnect(); e.send.disconnect(); };

  function occlusion(S, x, z) {
    if (sees(head.x, head.z, x, z, S.doors)) return 0;
    const a = roomAt(head.x, head.z), b = roomAt(x, z);
    return a < 0 || b < 0 ? 2 : Math.min(4, 1 + doorwaysBetween(a, b, S.doors));
  }
  // Put an emitter somewhere and work out how it sounds from here. snap: it
  // was somewhere else a moment ago, so set the filter and levels outright.
  function place(e, S, x, z, snap) {
    if (!Number.isFinite(x + z)) return;   // a parameter set to NaN throws
    put(e.pan, x, z);
    if (snap || now > e.look) { e.look = now + LOOK + Math.random() * .05; e.occ = occlusion(S, x, z); }
    const dx = x - head.x, dz = z - head.z, d = Math.hypot(dx, dz) || 1;
    let [g, hz] = OCC[e.occ];
    // Left-right panning cannot say "behind you", so sounds behind lose their top end.
    hz *= 1 + Math.min(0, (dx * head.fx + dz * head.fz) / d) * .7;
    // The echo falls off more slowly than the sound, so far things are more room
    // than source. Kept low all the same: the reverb is random noise and leans
    // left or right by chance, and it must not outvote the panner.
    const send = e.wet * echo / (1 + d * .1);
    if (snap) { for (const [p, v] of [[e.in.gain, g], [e.lp.frequency, hz], [e.send.gain, send]]) { aimed.set(p, v); p.cancelScheduledValues(now); p.setValueAtTime(v, now); } }
    else { aim(e.in.gain, g); aim(e.lp.frequency, hz); aim(e.send.gain, send, .1); }
  }

  function build() {
    const hiss = ac.createBufferSource(), quiet = [];
    hiss.buffer = whiteNoise(); hiss.loop = true; hiss.start(); sources++;
    // A loop is a source that never stops behind a gain that update() rides. quiet: every such gain.
    const loop = (to, ...nodes) => { const g = gain(); chain(...nodes, g, to); quiet.push(g); return g; };
    const mascots = MASC.map((_, i) => {
      const e = emitter(.2), band = filter('bandpass', BREATH[i].hz, BREATH[i].q);
      return { e, band, breath: loop(e.in, hiss, band), x: null, z: 0, walked: 0, phase: Math.random() * 6, lit: false, creak: 0, strain: 0, chew: 0, glup: 2 };
    });
    const gen = emitter(.25), charger = emitter(.15);
    const whine = osc('sawtooth', 45), buzz = osc('triangle', 100), mains = osc('sine', 100), tube = osc('triangle', 200.7), air = filter('lowpass', 500, .5);
    return {
      mascots, gen, charger, whine, buzz, mains, air, loops: quiet,
      pool: Array.from({ length: POOL }, () => emitter(.3)), next: 0, guards: new Map(),
      whineG: loop(gen.in, whine, filter('lowpass', 420)),
      buzzG: loop(charger.in, buzz),
      tone: loop(bus(), hiss, air),
      // Mains hum from the lights: two notes a hair apart, so it beats slowly.
      hum: loop(bus(), mains), humHigh: loop(bus(), tube),
    };
  }

  // Play a one-off sound at a point.
  function at(S, p, fn) {
    const e = rig.pool[rig.next++ % POOL];
    place(e, S, p.x, p.z, true);
    into(e.in, fn);
  }
  const mine = id => id === game.myId;
  // Stop this guard's stinger, sounding or still to come. Its parts are
  // scheduled ahead and cannot be stopped one by one, so it plays through one gain.
  function cut(over = .04) {
    if (!sting) return;
    const g = sting; sting = null;
    g.gain.cancelScheduledValues(now); g.gain.setTargetAtTime(0, now, over);
    setTimeout(() => g.disconnect(), 500);
  }

  /* ---------- events ---------- */

  const BELL = (f, level, when = 0) => { tone(f, .9, 'sine', level, 0, when); tone(f * 2.4, .35, 'sine', level * .35, 0, when); };
  const ON = {
    // A breaker going: a pop and a thud where it is, and the hum of the building catching for a moment.
    fault(x, S) { at(S, x, () => { noise(.06, .5, { band: 3200, q: 1 }); sample('hit_low', { gain: .4, rate: 1.3, at: .03 }); fizz(); }); tone(60, .5, 'sawtooth', .05, 45, .1); },
    // A fault burning: a low warning everyone hears.
    burn() { tone(196, .5, 'sawtooth', .1, 98, .2); tone(185, .6, 'square', .05, 92, .25); sample('hit_low', { gain: .35, rate: .8, at: .2 }); },
    // The hour, from a clock nobody can see. Dry, and again through the reverb alone.
    hour() { const bell = v => { tone(392, 2.6, 'sine', v); tone(1082, 1.4, 'sine', v * .4); tone(2117, .7, 'sine', v * .2); }; bell(.1); into(room(), () => bell(.14)); },
    out() { SFX.out(); sample('door_shut', { rate: .6, gain: .6, at: .1 }); },
    // A relay, then the tubes catching one at a time.
    on() { sample('door_shut', { rate: 1.5, gain: .5 }) || tone(120, .08, 'square', .2, 60); for (let k = 0; k < 4; k++) tone(rnd(2400, 4200), .05, 'sine', .04, 0, .15 + k * rnd(.1, .2)); },
    // Fixed: the breaker's clunk, then the relay and the lights catching.
    fix(x, S) {
      at(S, x, () => {
        sample('knock1', { rate: .9, gain: .7 }) || tone(90, .1, 'square', .25, 50);
        tone(120, .08, 'square', .12, 60, .08);
        for (let k = 0; k < 3; k++) tone(rnd(2400, 4200), .05, 'sine', .04, 0, .2 + k * rnd(.08, .16));
        BELL(1568, .15, .45);
      });
    },
    bat(x, S) {
      const pickUp = () => { sample('knock1', { rate: 2, gain: .4 }) || tone(300, .03, 'square', .1); tone(660, .08, 'square', .06, 0, .09); tone(990, .12, 'square', .06, 0, .17); };
      const who = S.players.find(p => p.id === x.by);
      if (mine(x.by)) pickUp(); else if (who?.x != null) at(S, who, pickUp);
    },
    spot(x) {
      into(rig.mascots[x.i].e.in, SPOT[x.i]);
      if (mine(x.id)) sample('hit_long', { gain: .3, rate: 1.2 });   // it is you it has seen
    },
    roar(x) { into(rig.mascots[x.i].e.in, () => { sample('scare_growl', { rate: .75, gain: 1 }) || noise(1, .6, { band: 300 }); sample('far_growl2', { rate: .6, gain: .5 }); boom({ level: .5 }); }); },
    crash(x, S) { at(S, x, () => { boom({ level: 1 }); sample('slam2', { rate: .45 }) || noise(.4, .6); sample('sheet3', { rate: .5, gain: .8, at: .02 }); sample('hit_long', { gain: .5 }); }); },
    bang(key, S) { at(S, doorAt(key), SFX.bang); },
    arrive(key, S) { at(S, doorAt(key), () => { sample(pick('creak1', 'creak2'), { gain: 1.2, rate: .8 }); tone(70, .6, 'sawtooth', .05, 50); }); },
    fumble(x, S) { at(S, PANELS[x.k], () => { tone(180, .08, 'square', .12); tone(140, .1, 'square', .1, 0, .09); }); },
    flat(x, S) {
      if (!mine(x.id)) {
        // Awful, and a bit funny: a splat, the air going out, bubbles.
        at(S, x, () => { boom({ from: 90, to: 28, level: .7 }); sample('thud', { rate: .6, gain: .7 }); noise(.4, .45, { band: 2600, band2: 260, q: 1.2 }); tone(620, .38, 'sine', .14, 80); for (let k = 0; k < 3; k++) tone(240 - k * 40, .07, 'sine', .12, 120, .45 + k * .11); });
        return;
      }
      // The booth game's jumpscare at the booth's levels, hung on the catch's own
      // timings (actors/scare.js): a hit as the camera is taken, its voice and the
      // shriek as the face arrives, lower at the bite, then the floor. It has to
      // be louder than everything else on the floor, so the limiter ducks the rest.
      const rate = GROWL_RATE[x.by], c = CUES;
      cut(); stingAt = now; sting = gain(1); sting.connect(bus());
      into(sting, () => {
        sample('hit_low', { gain: .8, at: c.grab }); boom({ level: .6, at: c.grab });
        sample('scare_growl', { gain: 1.7, rate, at: c.face }) || noise(1.2, .6, { at: c.face });
        shriek(.42, c.face);
        sample('scare_growl', { gain: .9, rate: rate * .5, lowpass: 900, at: c.bite }); boom({ from: 110, to: 40, level: .5, at: c.bite });
        boom({ from: 90, to: 26, level: .6, at: c.floor }); sample('thud', { rate: .5, gain: .6, at: c.floor }); noise(.35, .3, { band: 2200, band2: 240, at: c.floor });
      });
      // The growls run on for seconds after the catch. A guard still in the
      // night lets them go, or their tail holds the limiter down over the
      // teammates and the peel this guard is waiting to hear.
      if (S.phase === 'play') sting.gain.setTargetAtTime(0, now + c.end, .3);
    },
    // A flat guard calling for help: two notes from where they lie.
    call(x, S) {
      const notes = v => { tone(880, .12, 'triangle', v); tone(660, .2, 'triangle', v, 0, .13); };
      if (mine(x.id)) notes(.08); else at(S, x, () => notes(.3));
    },
    // The mascots stirring, and settling again. Nothing on screen says so; this is the only tell.
    // Both come through the reverb alone, so they are in the building and nowhere in it.
    stir() { into(room(), () => { sample(pick('far_growl2', 'far_growl3', 'far_growl4'), { rate: .5, gain: .2 }) || tone(60, 2, 'sawtooth', .05, 40); tone(55, 2.5, 'sine', .05, 38); }); },
    calm() { into(room(), () => sample(pick('creak1', 'creak2'), { rate: .5, gain: .5 })); },
    // It has run out of wind and given up the chase: a long breath out.
    quit(x) { into(rig.mascots[x.i].e.in, () => noise(.8, 1.2, { band: BREATH[x.i].hz * 2, band2: BREATH[x.i].hz, q: 1, attack: .12 })); },
    // A locker door: a sheet-metal clank and the latch. Pulled open, it is wrenched.
    locker(x, S) {
      const clank = () => { sample('sheet3', { rate: x.in ? 1.7 : 1.5, gain: .45 }) || noise(.18, .35, { band: 2400, q: 3 }); tone(x.in ? 1400 : 1200, .03, 'square', .05, 0, .12); };
      if (mine(x.id)) clank(); else at(S, x, clank);
    },
    // A mascot yanking open a locker that turned out empty.
    check(x, S) { at(S, x, () => { sample('sheet3', { rate: 1.2, gain: .6 }) || noise(.25, .45, { band: 1800, q: 2 }); sample('knock1', { rate: .9, gain: .4, at: .35 }); }); },
    found(x, S) { at(S, x, () => { sample('slam2', { rate: 1.3, gain: .8 }) || noise(.3, .6, { band: 1500 }); sample('sheet3', { rate: 1.1, gain: .7, at: .02 }); }); },
    peel(x, S) {
      const rip = () => { noise(.5, .6, { band: 600, band2: 3600, q: 2.5, attack: .3 }); tone(300, .08, 'sine', .4, 900, .46); };
      if (mine(x.id)) rip(); else at(S, x, rip);
    },
  };

  /* ---------- things that go on sounding ---------- */

  function mascot(S, m, v, dt) {
    const b = BREATH[m.i], awake = m.st !== 'rest', far = Math.hypot(m.x - head.x, m.z - head.z), busy = voices() >= BUSY;
    const moved = v.x == null ? 0 : Math.hypot(m.x - v.x, m.z - v.z);
    v.x = m.x; v.z = m.z;
    place(v.e, S, m.x, m.z);
    // Footsteps by distance covered, so they keep time with how fast it is really going.
    if (awake && moved < 3) v.walked += moved;
    if (v.walked >= STRIDE[m.i] * (m.st === 'charge' ? 1.3 : 1)) {
      v.walked = 0;
      if (far < HEAR && !busy) into(v.e.in, () => { MASCOT_STEP[m.i](m); if (m.rot) squelch(.1 * m.rot, .03); });
    }
    // Breath: faster when it is after someone, lower and louder as it rots. None while it eats.
    const keen = ['hunt', 'windup', 'charge'].includes(m.st) ? 1.7 : m.lit ? 1.4 : 1;
    v.phase += dt * b.rate * keen * Math.PI * 2;
    aim(v.breath.gain, awake && m.st !== 'feast' ? b.level * (1 + m.rot * .35) * Math.max(0, Math.sin(v.phase)) ** b.sharp : 0, .05);
    aim(v.band.frequency, b.hz * (1 - m.rot * .15));
    // Held in a beam it strains against it: its own growl in short overlapping
    // pulls, louder and lower the less the light can hold it.
    if (m.lit && (v.strain -= dt) <= 0 && far < HEAR) {
      v.strain = rnd(.3, .45);
      into(v.e.in, () => sample('far_growl1', { from: rnd(.15, .4), len: .5, rate: GROWL_RATE[m.i] * (.9 - m.rot * .1), gain: .2 + m.rot * .08 }) || tone(60 * GROWL_RATE[m.i], .4, 'sawtooth', .15, 50 * GROWL_RATE[m.i]));
    }
    v.creak -= dt;
    if (far < 10 && !busy && v.creak <= 0 && (m.lit !== v.lit || (moved > 0 && Math.random() < dt * .4))) {
      // The costume: seams and foam, when it moves near you or a beam first catches it.
      v.creak = 2;
      into(v.e.in, () => sample(pick('creak1', 'creak2'), { from: rnd(0, .4), len: .5, rate: rnd(1.2, 1.6), gain: m.lit ? .5 : .25 }));
    }
    v.lit = m.lit;
    if (m.st === 'feast' && (v.chew -= dt) <= 0 && far < HEAR) { v.chew = rnd(.22, .38); into(v.e.in, () => squelch(.5)); }
    // Squish gulps now and then, wherever it is.
    if (m.i === 2 && awake && (v.glup -= dt) <= 0) { v.glup = rnd(1.5, 3.5); if (far < 14 && !busy) into(v.e.in, () => tone(300, .09, 'sine', .2, 140)); }
  }

  function otherGuards(S) {
    const here = new Set();
    for (const p of S.players) {
      if (mine(p.id) || p.x == null) continue;
      let g = rig.guards.get(p.id);
      if (!g) { if (rig.guards.size >= MAX_GUARDS) continue; g = { e: emitter(.2), x: p.x, z: p.z, walked: 0, on: p.on }; rig.guards.set(p.id, g); }
      here.add(p.id);
      const moved = Math.hypot(p.x - g.x, p.z - g.z);
      g.x = p.x; g.z = p.z;
      place(g.e, S, p.x, p.z);
      if (moved < 3 && !p.flat) g.walked += moved;
      if (g.walked >= (p.sp ? 1.25 : .9)) { g.walked = 0; if (voices() < BUSY) into(g.e.in, () => footfall(rnd(1.05, 1.25), p.sp ? 1 : .6)); }
      if (p.on !== g.on) { g.on = p.on; into(g.e.in, () => tone(p.on ? 1400 : 900, .04, 'square', .12)); }
    }
    for (const [id, g] of rig.guards) if (!here.has(id)) { unplug(g.e); rig.guards.delete(id); }
  }

  // This guard's own body and kit. None of it is placed: it is all at your ears.
  function self(me, bat, dt) {
    const step = Math.floor(me.bob / Math.PI);   // the same wave that bobs the camera
    if (step !== steps) { steps = step; if (me.moving > .2) footfall(rnd(1.1, 1.3), me.sp ? .34 : .2, 2400); }
    // Out of breath below 40% stamina, in and out, quicker the emptier you are.
    if (me.stam < .4 && !me.flat && (pant -= dt) <= 0) {
      pant = .3 + me.stam * .6; gasp = !gasp;
      noise(.24, .05 + (.4 - me.stam) * .22, { band: gasp ? 1900 : 1100, q: 1.2, attack: .07 });
    }
    if (me.on !== torchOn) { torchOn = me.on; tone(me.on ? 1400 : 900, .04, 'square', .07); }
    // A dying torch buzzes each time its flicker dips (player.js dims the beam on the same wave).
    const dip = me.on && bat < .15 && bat > 0 && Math.sin(performance.now() * .05) < -.2;
    if (dip && !dim) { tone(110, .05, 'square', .035); noise(.03, .05, { band: 3000, q: 2 }); }
    dim = dip;
    // Holding the use key: a friend coming unstuck, or the hum of something being held.
    const tick = me.hold > 0 ? Math.floor(me.hold / .2) + 1 : 0;
    if (tick > holdTick) me.target?.what === 'peel' ? noise(.12, .12, { band: rnd(1800, 3000), q: 3, attack: .05 }) : tone(700 + tick * 70, .025, 'square', .05);
    holdTick = tick;
  }

  // An open fault spits and crackles, now and then, from its box.
  const fizzAt = BOXES.map(() => 0);
  function fizz() { for (let k = 0; k < 4; k++) noise(.02 + Math.random() * .03, .22, { band: rnd(2500, 6000), q: 2, at: k * rnd(.04, .12) }); }
  function faults(S, dt) {
    S.faults?.forEach((f, i) => {
      if (!f) { fizzAt[i] = 0; return; }
      if ((fizzAt[i] -= dt) > 0) return;
      fizzAt[i] = rnd(...FIZZ);
      const b = BOXES[i];
      if (Math.hypot(b.x - head.x, b.z - head.z) < HEAR) at(S, b, fizz);
    });
  }

  function building(S, dt) {
    const lit = lightsF(S), here = roomAt(head.x, head.z), size = SIZE[here] ?? .5;
    echo = .4 + size * .6;
    aim(rig.tone.gain, .09 + size * .09, .6); aim(rig.air.frequency, 700 - size * 450, .6);
    // With the power out the hum sags and stops, and the building is only its own air.
    aim(rig.hum.gain, lit ? .022 : 0, .35); aim(rig.humHigh.gain, lit ? .012 : 0, .35); aim(rig.mains.frequency, lit ? 100 : 35, .5);
    // The generator: a handle on a ratchet, and a dynamo that spins up while someone keeps at it.
    place(rig.gen, S, GENERATOR.x, GENERATOR.z); place(rig.charger, S, CHARGER.x, CHARGER.z);
    aim(rig.whineG.gain, S.crank ? .14 : 0, .3); aim(rig.whine.frequency, S.crank ? 95 : 45, .8);
    if (S.crank && (crank -= dt) <= 0) { crank = .17; into(rig.gen.in, () => { noise(.04, .3, { band: 1100, q: 3 }); if (Math.random() < .25) sample('knock1', { rate: .7, gain: .5 }); }); }
    // The charger ticks over while there is power and whines with a torch on it.
    const charging = lit && S.players.some(p => p.act === 'charge' && !p.flat);
    aim(rig.buzzG.gain, charging ? .1 : lit ? .02 : 0, .2); aim(rig.buzz.frequency, charging ? 150 : 100, .3);
    // A door that changed since the last frame: its motor, at the door.
    if (doors) for (const k of DOORS) if (S.doors[k] !== doors[k]) at(S, doorAt(k), () => { sample(S.doors[k] ? 'door_shut' : 'door_open', { gain: 1.8, rate: .9 }) || tone(90, .25, 'square', .3, 40); tone(64, .5, 'sawtooth', .15, 44); });
    doors = { ...S.doors };
  }

  function quiet() {
    ac = ctx();
    if (!ac || !rig) return;
    now = ac.currentTime;
    for (const g of rig.loops) aim(g.gain, 0, .1);
    doors = null;
    if (under) { under = 0; muffle(); }
  }

  return {
    // The floor is put away: nothing of it goes on sounding.
    quiet() { quiet(); cut(); },
    // Call once per frame while a night on the floor is drawn. me: player.me.
    update(S, me, dt) {
      ac = ctx();
      // A night already under way: what has happened has happened.
      if (lastEv < 0) lastEv = S.evId;
      const fresh = S.evs.filter(e => e.id > lastEv);
      if (fresh.length) lastEv = fresh[fresh.length - 1].id;
      if (!ac) return;
      now = ac.currentTime;
      rig ||= build();
      if (S.phase !== 'play') {
        // The night is over and the screens take it from here. A guard caught
        // last gets the night's end in the same tick as their catch, so their
        // stinger is played here, still on the catch's timings. A guard already
        // flat hears the booth game's jumpscare, unless their own is still sounding.
        quiet(); wasPlay = false;
        const caught = fresh.find(e => e.type === 'flat' && mine(e.x.id));
        if (caught) ON.flat(caught.x, S);
        else if (fresh.some(e => e.type === 'scare') && now - stingAt > CUES.end) { cut(); SFX.scare(); }
        return;
      }
      // A night began: what is left of the last one's stinger does not carry into it.
      if (!wasPlay) { wasPlay = true; cut(); }
      const mate = S.players.find(p => mine(p.id)) || {}, l = ac.listener;
      if (Number.isFinite(me.x + me.z + me.yaw)) head = { x: me.x, z: me.z, fx: Math.sin(me.yaw), fz: Math.cos(me.yaw) };
      if (l.positionX) { l.positionX.value = head.x; l.positionY.value = EYE; l.positionZ.value = head.z; l.forwardX.value = head.fx; l.forwardY.value = 0; l.forwardZ.value = head.fz; }
      else { l.setPosition(head.x, EYE, head.z); l.setOrientation(head.fx, 0, head.fz, 0, 1, 0); }
      building(S, dt);
      faults(S, dt);
      for (const m of S.m) mascot(S, m, rig.mascots[m.i], dt);
      otherGuards(S);
      self(me, mate.bat ?? 1, dt);
      for (const e of fresh) ON[e.type]?.(e.x, S);
      // Flat on the floor the world is somewhere above you, from the moment the catch drops you there.
      const down = me.flat && now - stingAt > CUES.floor, shut = !me.flat && me.hid >= 0;
      const want = down ? MUFFLED : shut ? IN_LOCKER : 0;
      if (want !== (under || 0)) { under = want; muffle(want || undefined); }
    },
    // For ?debug and tests: what is sounding, and the recipes by name.
    stats: () => ({ voices: voices(), loops: sources, emitters: rig ? rig.mascots.length + POOL + 2 + rig.guards.size : 0 }),
    cue: { ON, MASCOT_STEP, SPOT, footfall, squelch },
  };
}
