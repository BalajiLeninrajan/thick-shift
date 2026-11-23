// The fault minigames: a panel over the bottom half of the screen while a
// guard has their hands in a breaker box. The room stays in view above it and
// the mouse still looks round, but the guard cannot walk and their torch hangs
// at the floor (sim.ts beamOn), so the room is something you glance at.
//
// Three kinds, by the fault's k (F.FIX gives the seconds each is tuned to):
//   0 breaker: flip the tripped switches back in the order on their tags
//   1 wires:   join each loose wire on the left to its colour on the right
//   2 valve:   hold to open the valve and keep the needle in the green
//
// Everything works from the keyboard (W A S D or the number keys to choose,
// E or Space to act, X or Esc to let go), a gamepad (stick or d-pad, A, B) and
// touch (tap the parts). The room is told only when the job is done.
// The panel reads no keyboard or gamepad input of its own: player.ts reads it
// all and hands the box its share through key(), keyUp() and pad().
import { defined } from '@thick-shift/sim/check';
import { BOXES, ROOMS3 } from '@thick-shift/sim/map';
import { query } from '../dom';

const KIND = ['Reset the breaker', 'Reconnect the wires', 'Bleed the valve'];
// What a fault of kind k (Fault.k) asks of the guard. The sim only makes kinds 0 to 2.
export const faultName = (k: number): string => defined(KIND[k], `fault kind ${k}`);
// w: the wire, its place on the left. c: its colour. name: what a screen reader says.
const WIRES = [
  { w: 0, c: '#f38ba8', name: 'red' },
  { w: 1, c: '#f9e2af', name: 'yellow' },
  { w: 2, c: '#89b4fa', name: 'blue' },
  { w: 3, c: '#a6e3a1', name: 'green' },
];
const VALVE = { rise: 0.9, fall: 1.1, wobble: 0.35, band: [0.58, 0.8] satisfies [number, number], need: 1.3 }; // per second; the green band; seconds in it

// A new list in random order. Each entry goes in at a random place among those already taken, which makes every
// order equally likely.
const shuffle = <T>(list: readonly T[]): T[] => {
  const out: T[] = [];
  for (const v of list) out.splice(Math.floor(Math.random() * (out.length + 1)), 0, v);
  return out;
};

// One minigame while it is up. Each kind fills in its own fields (sel, next, held, ...) besides these.
interface Job {
  done: boolean;
  help: string;
  draw(): void;
  move(dx: number, dy: number): void;
  pick(i: number): void;
  act(down: boolean): void;
  tap(e: MouseEvent): void;
  tick?(dt: number): void;
}

export function createTask(root: HTMLElement) {
  const panel = document.createElement('div');
  panel.className = 'ts-f-task';
  panel.hidden = true;
  panel.innerHTML = `<div class="ts-f-task-head"><b></b><span></span><button class="btn btn-ghost is-sm" data-task="quit"><kbd class="ts-key">X</kbd><span>Let go</span></button></div><div class="ts-f-task-body"></div><div class="ts-f-task-help"></div>`;
  root.append(panel);
  const title = query(panel, 'b'),
    where = query(panel, '.ts-f-task-head > span'),
    body = query(panel, '.ts-f-task-body'),
    help = query(panel, '.ts-f-task-help');
  let job: Job | null = null,
    onDone: (() => void) | null = null,
    onQuit: (() => void) | null = null;

  const buzz = (): void => {
    panel.classList.remove('is-wrong');
    void panel.offsetWidth;
    panel.classList.add('is-wrong');
  };

  /* ---------- the three jobs ---------- */

  // Each returns { draw(), move(dx, dy), pick(n), act(down), tick(dt), done }.
  function breaker(): Job {
    const n = 5,
      tripped = shuffle([0, 1, 2, 3, 4]).slice(0, 3),
      order = shuffle(tripped);
    const up = Array.from({ length: n }, (_, i) => !tripped.includes(i));
    const j = { sel: 0, next: 0, done: false };
    const flip = (i: number): void => {
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
    function draw(): void {
      body.innerHTML = `<div class="ts-tk-breaker">${up.map((on, i) => `<button class="ts-tk-switch${on ? ' is-up' : ''}${i === j.sel ? ' is-sel' : ''}" data-i="${i}"><i></i><span>${on ? '' : order.indexOf(i) + 1}</span><small>${i + 1}</small></button>`).join('')}</div>`;
    }
    return Object.assign(j, {
      help: 'Flip the tripped switches up in the order on their tags. <kbd class="ts-key">A</kbd><kbd class="ts-key">D</kbd> or <kbd class="ts-key">1</kbd>–<kbd class="ts-key">5</kbd> to choose, <kbd class="ts-key">E</kbd> to flip.',
      draw,
      move(dx: number) {
        if (dx) {
          j.sel = (j.sel + dx + n) % n;
          draw();
        }
      },
      pick(i: number) {
        if (i < n) {
          j.sel = i;
          flip(i);
        }
      },
      act(down: boolean) {
        if (down) flip(j.sel);
      },
      tap(e: MouseEvent) {
        const b = e.target instanceof Element && e.target.closest<HTMLElement>('[data-i]');
        if (b) this.pick(Number(b.dataset.i));
      },
    });
  }

  function wires(): Job {
    const right = shuffle(WIRES),
      joined = new Set<number>();
    const j = { sel: 0, done: false };
    // The wire to join next: the first not yet joined, or undefined once all four are.
    const live = (): number | undefined => WIRES.find(({ w }) => !joined.has(w))?.w;
    // slot: a socket on the right, 0 to 3 (pick checks it, and sel wraps).
    const join = (slot: number): void => {
      const w = right[slot]?.w;
      if (w !== undefined && w === live()) {
        joined.add(w);
        j.done = joined.size === 4;
      } else buzz();
      draw();
    };
    // Where wire w's socket is on the right.
    const socket = (w: number): number => right.findIndex(r => r.w === w);
    // Wires are joined in WIRES order, so the joined ones are drawn in the order they went in.
    function draw(): void {
      const now = live();
      body.innerHTML = `<div class="ts-tk-wires"><div>${WIRES.map(({ w, c }) => `<span class="ts-tk-end${joined.has(w) ? ' is-joined' : w === now ? ' is-live' : ''}" style="--c:${c}"></span>`).join('')}</div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${WIRES.filter(({ w }) => joined.has(w))
          .map(
            ({ w, c }) =>
              `<path d="M0 ${12.5 + w * 25} C50 ${12.5 + w * 25} 50 ${12.5 + socket(w) * 25} 100 ${12.5 + socket(w) * 25}" stroke="${c}" stroke-width="5" fill="none" vector-effect="non-scaling-stroke"/>`
          )
          .join('')}</svg>
        <div>${right.map(({ w, c, name }, s) => `<button class="ts-tk-end is-socket${joined.has(w) ? ' is-joined' : ''}${s === j.sel ? ' is-sel' : ''}" style="--c:${c}" data-s="${s}" aria-label="${name}"><small>${s + 1}</small></button>`).join('')}</div></div>`;
    }
    return Object.assign(j, {
      help: 'Join the lit wire to its colour. <kbd class="ts-key">W</kbd><kbd class="ts-key">S</kbd> or <kbd class="ts-key">1</kbd>–<kbd class="ts-key">4</kbd> to choose, <kbd class="ts-key">E</kbd> to join.',
      draw,
      move(_dx: number, dy: number) {
        if (dy) {
          j.sel = (j.sel + dy + 4) % 4;
          draw();
        }
      },
      pick(s: number) {
        if (s < 4) {
          j.sel = s;
          join(s);
        }
      },
      act(down: boolean) {
        if (down) join(j.sel);
      },
      tap(e: MouseEvent) {
        const b = e.target instanceof Element && e.target.closest<HTMLElement>('[data-s]');
        if (b) this.pick(Number(b.dataset.s));
      },
    });
  }

  function valve(): Job {
    const j = { p: 0, held: false, inBand: 0, t: Math.random() * 9, done: false };
    let needle: HTMLElement, fill: HTMLElement, dial: HTMLElement;
    function draw(): void {
      body.innerHTML = `<div class="ts-tk-valve"><div class="ts-tk-dial"><i class="ts-tk-band" style="--a:${VALVE.band[0]};--b:${VALVE.band[1]}"></i><i class="ts-tk-needle"></i></div><div class="ts-tk-fill"><i></i></div><button class="btn btn-secondary ts-tk-hold" data-hold>Hold</button></div>`;
      dial = query(body, '.ts-tk-dial');
      needle = query(body, '.ts-tk-needle');
      fill = query(body, '.ts-tk-fill i');
      const hold = query(body, '[data-hold]');
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
      act(down: boolean) {
        j.held = down;
      },
      tap() {},
      tick(dt: number) {
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
        needle.style.rotate = `${-120 + j.p * 240}deg`;
        fill.style.width = `${Math.min(1, j.inBand / VALVE.need) * 100}%`;
        dial.dataset.state = ok ? 'ok' : j.p >= VALVE.band[1] ? 'high' : '';
      },
    });
  }

  /* ---------- input ---------- */

  const KEY_DIR: Record<string, [number, number]> = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  panel.addEventListener('click', e => {
    if (e.target instanceof Element && e.target.closest('[data-task="quit"]')) {
      quit();
      return;
    }
    if (job) {
      job.tap(e);
      check();
    }
  });

  function check(): void {
    if (job?.done) {
      const done = onDone;
      close();
      done?.();
    }
  }
  function quit(): void {
    const q = onQuit;
    close();
    q?.();
  }
  function close(): void {
    job = null;
    onDone = onQuit = null;
    panel.hidden = true;
    panel.classList.remove('is-wrong');
  }

  return {
    // i: the box; k: the kind. done: called once the job is finished; quit: when the guard lets go.
    open(i: number, k: number, done: () => void, quit_: () => void): void {
      job = defined([breaker, wires, valve][k], `fault kind ${k}`)();
      onDone = done;
      onQuit = quit_;
      title.textContent = faultName(k);
      where.textContent = ROOMS3[defined(BOXES[i], `box ${i}`).room]?.name || '';
      help.innerHTML = job.help;
      job.draw();
      panel.hidden = false;
    },
    close,
    // Keyboard: a key going down, by KeyboardEvent.code. True when the box took it, and then it is not the guard's.
    // X and Esc let go. A held key's repeats are not taken: nothing here repeats, and the valve reads E as held from
    // its press to its keyUp.
    key(code: string, repeat: boolean): boolean {
      if (!job) return false;
      if (code === 'KeyX' || code === 'Escape') {
        quit();
        return true;
      }
      if (repeat) return false;
      if (KEY_DIR[code]) job.move(...KEY_DIR[code]);
      else if (/^Digit[1-9]$/.test(code)) job.pick(+code.slice(5) - 1);
      else if (code === 'KeyE' || code === 'Space') job.act(true);
      else return false;
      check();
      return true;
    },
    keyUp(code: string): void {
      if (job && (code === 'KeyE' || code === 'Space')) job.act(false);
    },
    // Gamepad: dir is [dx, dy] on a fresh press; a: the A button held; b: pressed this frame.
    pad(dir: [number, number] | null, a: boolean, aWas: boolean, b: boolean): void {
      if (!job) return;
      if (b) {
        quit();
        return;
      }
      if (dir) job.move(...dir);
      if (a !== aWas) job.act(a);
      check();
    },
    tick(dt: number): void {
      if (job?.tick) {
        job.tick(dt);
        check();
      }
    },
  };
}
