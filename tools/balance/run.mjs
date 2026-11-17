// Balance harness for the booth game. Scripted guards play whole nights
// through the real public/src/sim.js with a stubbed clock and a seeded
// Math.random, and the outcomes are printed as a table and checked against the
// targets the game is tuned to.
//
//   node tools/balance/run.mjs                    every scenario, nights 1, 3 and 5, 200 nights each
//   node tools/balance/run.mjs --only S1,T2,G4    some of them
//   node tools/balance/run.mjs --n 500 --nights 5 --seed 7
//   node tools/balance/run.mjs --src /tmp/old     the same guards through another copy of
//                                                 sim.js, rules.js, config.js and state.js
//
// --src is how to see what a rules change did: save the old files somewhere
// (git show HEAD:public/src/sim.js > /tmp/old/sim.js, and the other three) and
// run both. The guards cope with a sim that has no breakers or generator heat.
//
// It exits non-zero if a target is missed, unless --src is given: another copy
// of the sim is being measured, not judged.
//
// Needs Node 22.7 or later (it imports the game's .js files as ES modules).
// No dependencies. Each row runs in its own process, as many at once as there
// are cores (--jobs changes that). The whole table is about 40 million sim
// ticks, which is minutes, not seconds. --n 50 is enough for a quick look.
//
// The guards (see crew below):
//   exact    sees every door, shuts when a mascot's leanOf reaches .78, reopens at once.
//            This is the guard the power numbers in sim.js are tuned against.
//   human    shuts .3 to .7 s after a mascot is shown, retries a failed press
//            after .35 s, reopens .6 to 2 s after the door is clear. Alone in
//            the booth it sweeps between the two halves of the room every .8 s.
//            Two or more in the booth see every door.
//   sloppy   human with .6 to 1.4 s to shut and 2 to 5 s to reopen.
//   cranker  turns the handle whenever power is under 97%, lets go when it is
//            nearly seized (heat .95) and comes back once it is out of the red (.8).
//   rider    a cranker who never lets go and waits out every seize.
//   turtle   presses shut on every open door every .35 s.
//   slam all shuts all three doors .3 to .8 s after a creak, opens them when the doors are clear.
//   counter  never looks. Shuts all three a count after each creak (a fixed share of
//            the night's door wait, with 10% error) and opens them .3 to .8 s after the bang.
//   dark     any of the above with the booth lights switched off all night.
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const SRC = resolve(arg('src', resolve(HERE, '../../public/src')));
const STEP = .1;   // seconds per tick, the host's rate

/* ---------- scenarios ---------- */
// [id, what it is, guards, crew options, nights to play if not the default]
const ROWS = [
  // One guard. These must stay where they were before breakers and the crowd rule.
  ['S1', 'solo exact, no crank', 1, { exact: true }, [1, 2, 3, 4, 5]],
  ['S2', 'solo human sweep, no crank', 1, {}],
  ['S3', 'solo human sweep, cranks under 60%', 1, { soloCrank: 60 }],
  ['S4', 'solo slams all on the creak', 1, { creakAll: true }],
  ['S5', 'solo slams all, cranks under 60%', 1, { creakAll: true, soloCrank: 60 }],
  // Turtles. All of these must lose.
  ['T1', 'turtle, solo', 1, { hold: ['L', 'V', 'R'] }],
  ['T2', 'turtle, 2 guards, 1 cranks', 2, { hold: ['L', 'V', 'R'], crank: 1, below: 101 }],
  ['T3', 'turtle, 3 guards, 2 crank', 3, { hold: ['L', 'V', 'R'], crank: 2, below: 101 }],
  ['T4', 'turtle, 4 guards, 3 crank', 4, { hold: ['L', 'V', 'R'], crank: 3, below: 101 }],
  ['T5', 'turtle, 6 guards, 5 crank', 6, { hold: ['L', 'V', 'R'], crank: 5, below: 101 }],
  ['T6', 'cycles doors by the gauge, 4 guards', 4, { cycle: [.85, .4], crank: 1, below: 101 }],
  ['T7', 'shut by default, opens to cool, 3 guards', 3, { smart: [.6, .1], crank: 1, below: 101 }],
  ['T8', 'left and right held, human on the vent, 3', 3, { hold: ['L', 'R'], crank: 1, below: 101 }],
  ['T9', 'left held, humans on the rest, 3 guards', 3, { hold: ['L'], crank: 1, below: 101 }],
  // Slamming everything on the creak, in a group.
  ['C1', 'slam all, 2 guards, 1 cranks', 2, { creakAll: true, crank: 1 }],
  ['C2', 'slam all, 4 guards, 1 cranks', 4, { creakAll: true, crank: 1 }],
  ['C3', 'slam all, 6 guards, 1 cranks', 6, { creakAll: true, crank: 1 }],
  // Playing properly.
  ['G1', 'duo, both on the doors, no crank', 2, {}],
  ['G2', 'duo, one cranks between attacks', 2, { crank: 1, crankQuiet: true }],
  ['G3', 'duo sloppy, cranker ignores creaks', 2, { crank: 1, r0: .6, r1: 1.4, o0: 2, o1: 5 }],
  ['G4', 'trio, 2 on doors, 1 cranks', 3, { crank: 1 }],
  ['G5', 'four, 2 doors, 1 crank, 1 cameras', 4, { crank: 1, cams: 1 }],
  ['G6', 'six, 3 booth, 1 crank, 2 cameras', 6, { crank: 1, cams: 2 }],
  ['G7', 'six, 5 booth, 1 crank', 6, { crank: 1 }],
  ['G8', 'six sloppy, 5 booth, 1 crank', 6, { crank: 1, r0: .6, r1: 1.4, o0: 2, o1: 5 }],
  ['G9', 'four, two at the generator at once', 4, { crank: 2 }],
  ['G10', 'trio, the cranker rides it to the seize', 3, { crank: 1, ride: true }],
  // Counting after the creak and shutting everything, nobody looking. Each
  // count is the one of .3, .4 and .5 of the wait that did best for that crew.
  ['K1', 'counter, solo, no crank', 1, { count: .4 }],
  ['K2', 'counter, 2 guards, 1 cranks', 2, { count: .3, crank: 1 }],
  ['K4', 'counter, 4 guards, 1 cranks', 4, { count: .3, crank: 1 }],
  ['K6', 'counter, 6 guards, 1 cranks', 6, { count: .4, crank: 1 }],
  // The lights off all night, watching the doors in the dark, nobody cranking.
  ['D1', 'dark, solo human sweep', 1, { dark: true }],
  ['D2', 'dark, duo on the doors', 2, { dark: true }],
  ['D4', 'dark, four on the doors', 4, { dark: true }],
  ['D6', 'dark, six on the doors', 6, { dark: true }],
  ['D9', 'dark between attacks, lit on the creak, duo', 2, { darkLull: true }],
];

// What each scenario has to do. r is the scenario's results by night, all is
// every scenario's. A check on a night that was not played is skipped.
// Bands are wide enough for 200 nights of noise, not for a rules change.
const on = (r, nights, test) => nights.every(n => !r[n] || test(r[n], n));
const ALL = [1, 2, 3, 4, 5];
const near = (x, target, by) => Math.abs(x - target) <= by;
const CHECKS = {
  S1: r => [
    ['wins every night', on(r, ALL, x => x.win === 100)],
    ['ends at 46 / 37 / 29 / 20 / 12% power, give or take 2', on(r, ALL, (x, n) => near(x.endP, [46, 37, 29, 20, 12][n - 1], 2))],
    ['never trips a breaker, peak heat under .4', on(r, ALL, x => x.trips === 0 && x.heat < .4)],
  ],
  S2: r => [['wins at least 85% of night 5s', on(r, [5], x => x.win >= 85)], ['never trips a breaker', on(r, ALL, x => x.trips === 0)]],
  S3: r => [['night 5: at most 66 s on the handle, ends at 30 to 50%', on(r, [5], x => x.crank <= 66 && x.endP >= 30 && x.endP <= 50)]],
  // Shutting everything blind holds the doors through the whole lurk, so it trips now and then. It should cost heat, not the night.
  S4: r => [['wins at least 93% of nights 1 and 3 and 70% of night 5s', on(r, ALL, (x, n) => x.win >= (n === 5 ? 70 : 93))], ['at most 3% of nights end through a tripped door', on(r, ALL, x => x.tripDeath * (100 - x.win) / 100 <= 3)]],
  S5: r => [['wins at least 97% of every night', on(r, ALL, x => x.win >= 97)]],
  T1: r => [['wins at most 5%', on(r, ALL, x => x.win <= 5)]],
  T2: r => [['never wins, dead before 3 AM', on(r, ALL, x => x.win <= 1 && x.diedAt < 3)], ['at least 90% of deaths come through a tripped door', on(r, ALL, x => x.tripDeath >= 90)]],
  T3: r => [['never wins, dead before 3 AM', on(r, ALL, x => x.win <= 1 && x.diedAt < 3)]],
  T4: r => [['never wins, dead before 3 AM', on(r, ALL, x => x.win <= 1 && x.diedAt < 3)]],
  T5: r => [['never wins, dead before 3 AM', on(r, ALL, x => x.win <= 1 && x.diedAt < 3)]],
  T6: r => [['wins at most 5%', on(r, ALL, x => x.win <= 5)]],
  // This guard sees a mascot in the dark the moment it arrives (atDoor), which no player can, so it is an upper bound.
  T7: (r, all) => [['clearly worse than the trio that plays properly (G4): at least 10 points fewer wins every night', on(r, ALL, (x, n) => !all.G4?.[n] || x.win <= all.G4[n].win - 10)], ['night 5 ends under 10% power', on(r, [5], x => x.endP == null || x.endP < 10)]],
  T8: r => [['wins at most 2%', on(r, ALL, x => x.win <= 2)]],
  T9: r => [['wins under 35% of night 1s and under 20% after', on(r, ALL, (x, n) => x.win < (n === 1 ? 35 : 20))]],
  C2: r => [['wins under 65%', on(r, ALL, x => x.win < 65)]],
  C3: r => [['wins under 25%', on(r, ALL, x => x.win < 25)]],
  G1: r => [['wins at least 97%', on(r, ALL, x => x.win >= 97)], ['night 5 ends at 2 to 10%: they have to crank', on(r, [5], x => x.endP >= 2 && x.endP <= 10)]],
  G2: r => [['wins at least 97%', on(r, ALL, x => x.win >= 97)], ['night 5 ends at 55 to 72%', on(r, [5], x => x.endP >= 55 && x.endP <= 72)]],
  G3: r => [['night 5 wins 50 to 75%: not calling the cranker back is what kills', on(r, [5], x => x.win >= 50 && x.win <= 75)]],
  G4: r => [['wins at least 97%', on(r, ALL, x => x.win >= 97)], ['night 5 ends at 50 to 70%', on(r, [5], x => x.endP >= 50 && x.endP <= 70)], ['never trips a breaker', on(r, ALL, x => x.trips === 0)]],
  G5: r => [['wins at least 97%', on(r, ALL, x => x.win >= 97)], ['night 5 ends at 15 to 35%: one camera watcher is paid for', on(r, [5], x => x.endP >= 15 && x.endP <= 35)]],
  G6: r => [['night 5 runs out of power or ends under 10%: two camera watchers use up all one handle makes', on(r, [5], x => x.out >= 50 || x.endP < 10)]],
  G7: r => [['wins at least 97%', on(r, ALL, x => x.win >= 97)], ['night 5 ends at 50 to 70%', on(r, [5], x => x.endP >= 50 && x.endP <= 70)]],
  G8: r => [['wins at least 95%', on(r, ALL, x => x.win >= 95)], ['at most 3% of nights end through a tripped door', on(r, ALL, x => x.tripDeath * (100 - x.win) / 100 <= 3)]],
  G9: (r, all) => [['a second guard at the generator adds nothing: night 5 within 3 points of G7', on(r, [5], x => !all.G7?.[5] || near(x.endP, all.G7[5].endP, 3))]],
  G10: (r, all) => [['riding the handle into a seize costs at least 10 s of cranking on night 5 against G4', on(r, [5], x => !all.G4?.[5] || x.crank <= all.G4[5].crank - 10)]],
  K1: r => [['a solo guard who never looks loses at least one night in ten', on(r, ALL, x => x.win <= 90)]],
  K2: (r, all) => [['worse than the duo that plays properly (G2): night 5 ends at least 10 points of power lower, night 3 wins under 95%', on(r, [5], x => !all.G2?.[5] || x.endP <= all.G2[5].endP - 10) && on(r, [3], x => x.win < 95)]],
  K4: r => [['wins under 90% of nights, under 65% of night 3s', on(r, ALL, (x, n) => x.win < (n === 3 ? 65 : 90))]],
  K6: r => [['wins under 60%', on(r, ALL, x => x.win < 60)]],
  D1: r => [['wins at most 10%', on(r, ALL, x => x.win <= 10)]],
  D2: r => [['wins under 35% from night 3', on(r, [3, 4, 5], x => x.win < 35)]],
  D4: r => [['wins under 35% from night 3', on(r, [3, 4, 5], x => x.win < 35)]],
  D6: r => [['wins under 35% from night 3', on(r, [3, 4, 5], x => x.win < 35)]],
  D9: r => [['night 5 wins under 70%: the lights take too long to strike to switch them on at the creak', on(r, [5], x => x.win < 70)]],
};

/* ---------- one cell: a scenario on one night, N times ---------- */

// Small seeded generator (mulberry32), so a table can be reproduced.
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hashStr = s => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

async function runCell({ id, guards, crewOpts, night, n, seed }) {
  let now = 0;
  globalThis.performance = { now: () => now };   // sim.js reads the clock once at import and once per step
  process.removeAllListeners('warning');         // the repo's package.json does not say its modules are ES modules. Node works it out.
  const load = f => import(pathToFileURL(resolve(SRC, f)).href);
  const sim = await load('sim.js'), { game } = await load('state.js'), R = await load('rules.js'), { DOORS } = await load('config.js');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const SCREENS = [['L', 'V'], ['V', 'R']];   // what one guard sees panned left, and panned right
  const anyAt = S => DOORS.some(k => R.atDoor(S, k).length);
  const heat = (S, k) => S.heat?.[k] ?? 0;
  // The handle is going round. An older sim has no handle to hold: anyone at the generator turns it.
  const turning = S => R.turning ? R.turning(S) : S.players.some(p => p.view === 'crank');

  // A crew of g guards, as one function to call before each tick. Options:
  //   exact           the exact guard (see the top of the file)
  //   r0, r1          seconds to react to a mascot, default .3 to .7
  //   o0, o1          seconds to reopen a clear door, default .6 to 2
  //   sweep           seconds between pans for a guard alone in the booth, default .8
  //   crank: n        the last n guards are crankers. below: they crank under this power, default 97
  //   ride            crankers never let go before it seizes
  //   crankQuiet      crankers come back to the booth .4 to .8 s after a creak
  //   cams: n         the n guards before the crankers sit on the cameras all night
  //   soloCrank: p    the first guard also cranks under p% power while nothing is at a door
  //   hold: [doors]   keep these shut whatever happens
  //   cycle: [hi, lo] never look: open a door at heat hi, shut it again at lo
  //   smart: [hi, lo] the same, but always shut on a mascot at the door
  //   creakAll        slam all
  //   count: f        the counter, shutting all three f of the night's door wait after each creak
  //   dark            the first guard switches the lights off whenever they are on
  //   darkLull        the lights go off when the doors are clear and on again .2 to .4 s after a creak
  function crew(g, o) {
    const ids = Array.from({ length: g }, (_, i) => 'p' + i);
    const st = { shutAt: {}, openAt: {}, retry: {}, pan: 0, panAt: 0, lastEv: 0, backAt: 0, shutWant: { L: true, V: true, R: true }, heard: 0, pending: [], reopenAt: 0, litAt: 0 };
    const view = (id, v) => { if (game.players[id].view !== v) sim.act(id, { t: 'view', v, cam: 0 }); };
    const press = (id, k) => { if ((st.retry[k] || 0) > game.S.t) return; st.retry[k] = game.S.t + .35; sim.act(id, { t: 'door', k }); };
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    return S => {
      const t = S.t;
      // A cranker lets go near the top of the dial and waits for it to leave the red, unless it rides.
      if (!o.ride && (S.gen ?? 0) >= .95) st.cooling = true;
      if ((S.gen ?? 0) < .8) st.cooling = false;
      const canCrank = S.power < (o.below ?? 97) && !S.seized && !st.cooling;
      const fresh = S.evs.filter(e => e.id > st.heard);
      if (fresh.length) st.heard = fresh[fresh.length - 1].id;
      if (o.dark && S.lights && S.power > 0) sim.act(ids[0], { t: 'lights' });
      if (o.darkLull && S.power > 0) {
        if (fresh.some(e => e.type === 'arrive')) st.litAt = t + rnd(.2, .4);
        const want = anyAt(S) ? t >= st.litAt : false;
        if (S.lights !== want) sim.act(ids[0], { t: 'lights' });
      }
      ids.forEach((id, i) => {
        if (i >= g - (o.crank || 0)) {
          const at = anyAt(S);
          if (at && !st.wasAt) st.crankBack = t + rnd(.4, .8);
          st.wasAt = at;
          const needed = o.crankQuiet && at && t >= (st.crankBack ?? 0);
          view(id, canCrank && !needed ? 'crank' : 'office');
        }
        else if (i >= g - (o.crank || 0) - (o.cams || 0)) view(id, 'cams');
        else if (!(o.soloCrank && i === 0)) view(id, 'office');
      });
      if (o.soloCrank) {
        let creak = false;
        for (const e of S.evs) if (e.id > st.lastEv) { st.lastEv = e.id; if (e.type === 'arrive') creak = true; }
        if (creak) st.backAt = t + rnd(.4, .8);
        const want = !anyAt(S) && canCrank && S.power < o.soloCrank && !DOORS.some(k => S.doors[k]);
        if (game.players.p0.view === 'crank') { if (!want && (t >= st.backAt || !canCrank)) view('p0', 'office'); }
        else if (want && t > (st.quietAt ?? 0)) view('p0', 'crank');
        if (anyAt(S)) st.quietAt = t + 1.5;
      }
      const booth = ids.filter(id => game.players[id].view === 'office');
      if (!booth.length) return;
      const p = booth[0];
      if (o.count) {
        // Nobody looks. Each creak starts a count, and the doors stay shut from
        // the end of the count until the bang, or until it has surely passed.
        const W = R.doorWait(S.night), longest = W * (1 + (R.REVEAL ?? .6) * (R.LURK ?? 0));
        for (const e of fresh) {
          if (e.type === 'arrive') st.pending.push({ at: t + rnd(.15, .35) + o.count * W * (1 + gauss() * .1), until: t + longest + 1 });
          if (e.type === 'bang') { st.pending.shift(); st.reopenAt = t + rnd(.3, .8); }
        }
        st.pending = st.pending.filter(x => t < x.until);
        const want = st.pending.some(x => t >= x.at);
        for (const k of DOORS) {
          if (want && !S.doors[k] && !S.trip?.[k]) press(p, k);
          if (!want && S.doors[k] && t >= st.reopenAt) press(p, k);
        }
        return;
      }
      if (o.hold) for (const k of o.hold) if (!S.doors[k]) press(p, k);
      if (o.cycle || o.smart) {
        const [hi, lo] = o.cycle || o.smart;
        for (const k of DOORS) {
          if (heat(S, k) > hi) st.shutWant[k] = false;
          if (heat(S, k) < lo) st.shutWant[k] = true;
          const want = st.shutWant[k] || (!!o.smart && R.atDoor(S, k).length > 0);
          if (S.doors[k] !== want) press(p, k);
        }
        return;
      }
      if (o.creakAll) {
        const at = anyAt(S);
        for (const k of DOORS) {
          if (S.doors[k] === at) { delete st.shutAt[k + true]; delete st.shutAt[k + false]; continue; }
          st.shutAt[k + at] ??= t + rnd(o.r0 ?? .3, o.r1 ?? .8);
          if (t >= st.shutAt[k + at]) press(p, k);
        }
        return;
      }
      // Who can see what: two or more in the booth cover every door, one has to sweep.
      let seen = DOORS;
      if (!o.exact && booth.length < 2) { if (t >= st.panAt) { st.pan ^= 1; st.panAt = t + (o.sweep ?? .8); } seen = SCREENS[st.pan]; }
      for (const k of DOORS) {
        if (o.hold?.includes(k)) continue;
        const who = booth.length >= 2 && k === 'R' ? booth[1] : p;
        const here = R.atDoor(S, k), shown = R.shownAtDoor(S, k);
        if (!S.doors[k]) {
          delete st.openAt[k];
          if (o.exact) { if (here.some(m => R.leanOf(S, m) >= .78)) press(who, k); continue; }
          if (shown.length && seen.includes(k)) { st.shutAt[k] ??= t + rnd(o.r0 ?? .3, o.r1 ?? .7); if (t >= st.shutAt[k]) press(who, k); }
          else if (!shown.length) delete st.shutAt[k];
        } else {
          delete st.shutAt[k];
          if (!here.length) { st.openAt[k] ??= t + (o.exact ? 0 : rnd(o.o0 ?? .6, o.o1 ?? 2)); if (t >= st.openAt[k]) press(who, k); }
        }
      }
    };
  }

  function playNight(i) {
    Math.random = seeded(seed + hashStr(id) + night * 7919 + i * 104729);
    game.players = {};
    for (let j = 0; j < guards; j++) game.players['p' + j] = { id: 'p' + j, name: 'G' + j, view: 'office', cam: 0 };
    game.S = sim.newState('TEST');
    game.S.players = Object.values(game.players);
    sim.startNight(night);
    const S = game.S, tick = crew(guards, crewOpts), out = { trips: 0, crank: 0, two: 0, heat: 0, outAt: 0 };
    let lastEv = S.evId;
    while (S.phase === 'play') {
      tick(S);
      now += STEP * 1000;
      sim.step();
      for (const e of S.evs) if (e.id > lastEv) { lastEv = e.id; if (e.type === 'trip') out.trips++; }
      if (S.power <= 0 && !out.outAt) out.outAt = S.t;
      let threatened = 0;
      for (const k of DOORS) { out.heat = Math.max(out.heat, heat(S, k)); if (R.atDoor(S, k).length) threatened++; }
      if (turning(S)) out.crank += STEP;
      if (threatened >= 2) out.two += STEP;
    }
    return { ...out, win: S.phase !== 'dead', t: S.t, power: S.power, attacks: S.attacks, tripDeath: S.phase === 'dead' && !!S.trip?.[S.killDoor] };
  }

  const runs = Array.from({ length: n }, (_, i) => playNight(i)), won = runs.filter(x => x.win), died = runs.filter(x => !x.win);
  const avg = (list, f) => list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : null;
  const typical = won.length ? won : runs;   // a lost night is cut short, so it says little about a whole one
  return {
    win: 100 * won.length / n,                              // percent of nights survived
    endP: avg(won, x => x.power),                           // power at 6 AM, nights survived only
    out: 100 * runs.filter(x => x.outAt).length / n,        // percent of nights the power ran out
    diedAt: avg(died, x => x.t / 45),                       // mean hour of death
    tripDeath: 100 * died.filter(x => x.tripDeath).length / (died.length || 1),   // percent of deaths through a tripped door
    trips: avg(runs, x => x.trips),                         // breaker trips per night
    heat: avg(runs, x => x.heat),                           // mean of each night's hottest door
    crank: avg(typical, x => x.crank),                      // seconds the handle turned
    attacks: avg(typical, x => x.attacks),
    two: avg(typical, x => x.two),                          // seconds with two doors threatened at once
  };
}

/* ---------- the table ---------- */

const job = arg('job');
if (job) {
  process.stdout.write(JSON.stringify(await runCell(JSON.parse(job))));
} else {
  const only = arg('only')?.split(','), nights = arg('nights')?.split(',').map(Number), n = +arg('n', 200), seed = +arg('seed', 1);
  const rows = ROWS.filter(r => !only || only.includes(r[0]));
  const cells = rows.flatMap(([id, label, guards, crewOpts, own]) => (nights || own || [1, 3, 5]).map(night => ({ id, label, guards, crewOpts, night, n, seed })));
  // A pool of child processes, one cell each. Each gets its own copy of the sim and its own Math.random.
  const child = cell => new Promise((done, fail) => execFile(process.execPath, [fileURLToPath(import.meta.url), '--src', SRC, '--job', JSON.stringify(cell)], { maxBuffer: 1 << 20 }, (err, out, errText) => err ? fail(new Error(`${cell.id} night ${cell.night}: ${errText || err.message}`)) : done(JSON.parse(out))));
  const results = new Array(cells.length);
  let next = 0, finished = 0;
  const progress = () => { if (process.stderr.isTTY) process.stderr.write(`\r${finished} of ${cells.length} rows${finished === cells.length ? '\n' : ''}`); };
  await Promise.all(Array.from({ length: Math.min(cells.length, +arg('jobs', availableParallelism())) }, async () => { while (next < cells.length) { const i = next++; results[i] = await child(cells[i]); finished++; progress(); } }));

  const num = (x, digits = 0, width = 5) => (x == null ? '-' : x.toFixed(digits)).padStart(width);   // an average of nothing arrives as null
  console.log(`${n} nights per row, seed ${seed}, sim from ${SRC}`);
  console.log('    scenario                                     g  night   win%  endP  out%  died  trip%  trips  heat  crank   att   two');
  const by = {};
  cells.forEach((cell, i) => {
    const r = results[i];
    (by[cell.id] ||= {})[cell.night] = r;
    console.log(`${cell.id.padEnd(3)} ${cell.label.padEnd(44)} ${cell.guards}  ${String(cell.night).padStart(5)}  ${num(r.win)} ${num(r.endP)} ${num(r.out)} ${(r.diedAt == null ? '-' : r.diedAt.toFixed(1) + 'h').padStart(5)} ${num(r.tripDeath, 0, 6)}  ${num(r.trips, 2)} ${num(r.heat, 2)}  ${num(r.crank)}s ${num(r.attacks, 1)} ${num(r.two)}s`);
  });
  console.log(`
win%   nights survived            endP   power at 6 AM on nights survived      out%   nights the power ran out
died   mean hour of death         trip%  deaths that came through a tripped door
trips  breaker trips per night    heat   mean of each night's hottest door, 0 to 1
crank  seconds the handle turned  att    attacks per night                     two    seconds with two doors threatened`);

  let failed = 0;
  console.log('\nTargets');
  for (const id in by) for (const [text, ok] of CHECKS[id]?.(by[id], by) || []) { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${id}  ${text}`); }
  console.log(failed ? `\n${failed} target${failed === 1 ? '' : 's'} missed.` : '\nEvery target met.');
  if (failed && !arg('src')) process.exitCode = 1;
}
