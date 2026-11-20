// The fault minigames: a panel over the bottom half of the screen while a
// guard has their hands in a breaker box. The room stays in view above it and
// the mouse still looks round, but the guard cannot walk and their torch hangs
// at the floor (sim3d.js beamOn), so the room is something you glance at.
//
// Three kinds, by the fault's k (F.FIX gives the seconds each is tuned to):
//   0 breaker: flip the tripped switches back in the order on their tags
//   1 wires:   join each loose wire on the left to its colour on the right
//   2 valve:   hold to open the valve and keep the needle in the green
//
// Everything works from the keyboard (W A S D or the number keys to choose,
// E or Space to act, X or Esc to let go), a gamepad (stick or d-pad, A, B) and
// touch (tap the parts). The host is told only when the job is done.
import { BOXES, ROOMS3 } from './map.js';

const KIND = ['Reset the breaker', 'Reconnect the wires', 'Bleed the valve'];
export const FAULT_NAME = KIND;
const WIRES = [
  ['#f38ba8', 'red'],
  ['#f9e2af', 'yellow'],
  ['#89b4fa', 'blue'],
  ['#a6e3a1', 'green'],
];
const VALVE = { rise: 0.9, fall: 1.1, wobble: 0.35, band: [0.58, 0.8], need: 1.3 }; // per second; the green band; seconds in it

const shuffle = list => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

export function createTask(root) {
  const panel = document.createElement('div');
  panel.className = 'ts-f-task';
  panel.hidden = true;
  panel.innerHTML = `<div class="ts-f-task-head"><b></b><span></span><button class="btn btn-ghost is-sm" data-task="quit"><kbd class="ts-key">X</kbd><span>Let go</span></button></div><div class="ts-f-task-body"></div><div class="ts-f-task-help"></div>`;
  root.append(panel);
  const title = panel.querySelector('b'),
    where = panel.querySelector('.ts-f-task-head > span'),
    body = panel.querySelector('.ts-f-task-body'),
    help = panel.querySelector('.ts-f-task-help');
  let job = null,
    onDone = null,
    onQuit = null;

  const buzz = () => {
    panel.classList.remove('is-wrong');
    void panel.offsetWidth;
    panel.classList.add('is-wrong');
  };

  /* ---------- the three jobs ---------- */

  // Each returns { draw(), move(dx, dy), pick(n), act(down), tick(dt), done }.
  function breaker() {
    const n = 5,
      tripped = shuffle([0, 1, 2, 3, 4]).slice(0, 3),
      order = shuffle(tripped.slice());
    const up = Array.from({ length: n }, (_, i) => !tripped.includes(i));
    const j = { sel: 0, next: 0, done: false };
    const flip = i => {
      if (up[i]) return;
      if (i === order[j.next]) {
        up[i] = true;
        j.next++;
        j.done = j.next === order.length;
      } else {
        buzz();
        for (const k of order.slice(0, j.next)) up[k] = false;
        j.next = 0;
      } // the wrong one trips them all again
      draw();
    };
    function draw() {
      body.innerHTML = `<div class="ts-tk-breaker">${up.map((on, i) => `<button class="ts-tk-switch${on ? ' is-up' : ''}${i === j.sel ? ' is-sel' : ''}" data-i="${i}"><i></i><span>${on ? '' : order.indexOf(i) + 1}</span><small>${i + 1}</small></button>`).join('')}</div>`;
    }
    return Object.assign(j, {
      help: 'Flip the tripped switches up in the order on their tags. <kbd class="ts-key">A</kbd><kbd class="ts-key">D</kbd> or <kbd class="ts-key">1</kbd>–<kbd class="ts-key">5</kbd> to choose, <kbd class="ts-key">E</kbd> to flip.',
      draw,
      move(dx) {
        if (dx) {
          j.sel = (j.sel + dx + n) % n;
          draw();
        }
      },
      pick(i) {
        if (i < n) {
          j.sel = i;
          flip(i);
        }
      },
      act(down) {
        if (down) flip(j.sel);
      },
      tap(e) {
        const b = e.target.closest('[data-i]');
        if (b) this.pick(+b.dataset.i);
      },
    });
  }

  function wires() {
    const right = shuffle([0, 1, 2, 3]),
      joined = new Set();
    const j = { sel: 0, done: false };
    const live = () => [0, 1, 2, 3].find(w => !joined.has(w));
    const join = slot => {
      if (right[slot] === live()) {
        joined.add(right[slot]);
        j.done = joined.size === 4;
      } else buzz();
      draw();
    };
    function draw() {
      const now = live();
      body.innerHTML = `<div class="ts-tk-wires"><div>${WIRES.map(([c], w) => `<span class="ts-tk-end${joined.has(w) ? ' is-joined' : w === now ? ' is-live' : ''}" style="--c:${c}"></span>`).join('')}</div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${[...joined].map(w => `<path d="M0 ${12.5 + w * 25} C50 ${12.5 + w * 25} 50 ${12.5 + right.indexOf(w) * 25} 100 ${12.5 + right.indexOf(w) * 25}" stroke="${WIRES[w][0]}" stroke-width="5" fill="none" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
        <div>${right.map((w, s) => `<button class="ts-tk-end is-socket${joined.has(w) ? ' is-joined' : ''}${s === j.sel ? ' is-sel' : ''}" style="--c:${WIRES[w][0]}" data-s="${s}" aria-label="${WIRES[w][1]}"><small>${s + 1}</small></button>`).join('')}</div></div>`;
    }
    return Object.assign(j, {
      help: 'Join the lit wire to its colour. <kbd class="ts-key">W</kbd><kbd class="ts-key">S</kbd> or <kbd class="ts-key">1</kbd>–<kbd class="ts-key">4</kbd> to choose, <kbd class="ts-key">E</kbd> to join.',
      draw,
      move(dx, dy) {
        if (dy) {
          j.sel = (j.sel + dy + 4) % 4;
          draw();
        }
      },
      pick(s) {
        if (s < 4) {
          j.sel = s;
          join(s);
        }
      },
      act(down) {
        if (down) join(j.sel);
      },
      tap(e) {
        const b = e.target.closest('[data-s]');
        if (b) this.pick(+b.dataset.s);
      },
    });
  }

  function valve() {
    const j = { p: 0, held: false, inBand: 0, t: Math.random() * 9, done: false };
    let needle, fill, dial;
    function draw() {
      body.innerHTML = `<div class="ts-tk-valve"><div class="ts-tk-dial"><i class="ts-tk-band" style="--a:${VALVE.band[0]};--b:${VALVE.band[1]}"></i><i class="ts-tk-needle"></i></div><div class="ts-tk-fill"><i></i></div><button class="btn btn-secondary ts-tk-hold" data-hold>Hold</button></div>`;
      dial = body.querySelector('.ts-tk-dial');
      needle = body.querySelector('.ts-tk-needle');
      fill = body.querySelector('.ts-tk-fill i');
      const hold = body.querySelector('[data-hold]');
      hold.addEventListener('pointerdown', e => {
        e.preventDefault();
        j.held = true;
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel'])
        hold.addEventListener(ev, () => {
          j.held = false;
        });
    }
    return Object.assign(j, {
      help: 'Hold <kbd class="ts-key">E</kbd> to open the valve. Keep the needle in the green until the bar fills. Too far and it blows back.',
      draw,
      move() {},
      pick() {},
      act(down) {
        j.held = down;
      },
      tap() {},
      tick(dt) {
        j.t += dt;
        j.p += (j.held ? VALVE.rise : -VALVE.fall) * dt + Math.sin(j.t * 7.3) * Math.sin(j.t * 2.1) * VALVE.wobble * dt;
        if (j.p > 1) {
          j.p = 0.2;
          j.inBand = Math.max(0, j.inBand - 0.6);
          buzz();
        } // blew back
        j.p = Math.max(0, j.p);
        const ok = j.p > VALVE.band[0] && j.p < VALVE.band[1];
        j.inBand = Math.max(0, j.inBand + (ok ? dt : -dt * 0.5));
        j.done = j.inBand >= VALVE.need;
        needle.style.rotate = -120 + j.p * 240 + 'deg';
        fill.style.width = Math.min(1, j.inBand / VALVE.need) * 100 + '%';
        dial.dataset.state = ok ? 'ok' : j.p >= VALVE.band[1] ? 'high' : '';
      },
    });
  }

  /* ---------- input ---------- */

  const KEY_DIR = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  addEventListener(
    'keydown',
    e => {
      if (!job || /** @type {Element} */ (e.target).closest?.('input, textarea, select')) return;
      const c = e.code;
      if (c === 'KeyX' || c === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        quit();
        return;
      }
      if (e.repeat && c !== 'KeyE' && c !== 'Space') return;
      if (KEY_DIR[c]) job.move(...KEY_DIR[c]);
      else if (/^Digit[1-9]$/.test(c)) job.pick(+c.slice(5) - 1);
      else if ((c === 'KeyE' || c === 'Space') && !e.repeat) job.act(true);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
      check();
    },
    true
  );
  addEventListener(
    'keyup',
    e => {
      if (job && (e.code === 'KeyE' || e.code === 'Space')) job.act(false);
    },
    true
  );
  panel.addEventListener('click', e => {
    if (/** @type {Element} */ (e.target).closest('[data-task="quit"]')) {
      quit();
      return;
    }
    if (job) {
      job.tap(e);
      check();
    }
  });

  function check() {
    if (job?.done) {
      const done = onDone;
      close();
      done?.();
    }
  }
  function quit() {
    const q = onQuit;
    close();
    q?.();
  }
  function close() {
    job = null;
    onDone = onQuit = null;
    panel.hidden = true;
    panel.classList.remove('is-wrong');
  }

  return {
    get active() {
      return !!job;
    },
    // i: the box; k: the kind. done: called once the job is finished; quit: when the guard lets go.
    open(i, k, done, quit_) {
      job = [breaker, wires, valve][k]();
      onDone = done;
      onQuit = quit_;
      title.textContent = KIND[k];
      where.textContent = ROOMS3[BOXES[i].room]?.name || '';
      help.innerHTML = job.help;
      job.draw();
      panel.hidden = false;
    },
    close,
    // Gamepad: dir is [dx, dy] on a fresh press; a: the A button held; b: pressed this frame.
    pad(dir, a, aWas, b) {
      if (!job) return;
      if (b) {
        quit();
        return;
      }
      if (dir) job.move(...dir);
      if (a !== aWas) job.act(a);
      check();
    },
    tick(dt) {
      if (job?.tick) {
        job.tick(dt);
        check();
      }
    },
  };
}
