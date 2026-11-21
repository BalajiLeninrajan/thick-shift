// Where something the room moves is right now. The room sends positions ten
// times a second; drawing the latest one stutters and easing toward it lags by
// an amount that depends on speed, so feet slide. Instead each actor keeps its
// last few snapshots, stamped with the night's clock (S.t), and is drawn a
// little in the past, between two of them.

import { defined } from '@thick-shift/sim/check';

const KEEP = 8;
const TELEPORT = 5; // metres between two snapshots that mean a jump, not a walk
const TAU = Math.PI * 2;
export const wrap = (a: number): number => {
  a %= TAU;
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
};

export interface HostClock {
  off: number;
  gap: number;
  last: number;
  fresh: boolean;
  now: number;
  see(St: number, now: number): void;
}

// One clock for every track: what time on the night's clock to draw at.
export const hostClock: HostClock = {
  off: 0,
  gap: 0.1,
  last: -1,
  fresh: false,
  now: 0,
  // Call once a frame. A snapshot is new when S.t has moved.
  see(St: number, now: number): void {
    this.fresh = St !== this.last;
    if (this.fresh) {
      const off = St - now,
        step = St - this.last;
      if (this.last < 0 || step < 0 || step > 1) {
        this.off = off;
        this.gap = 0.1;
      } else {
        this.gap += (step - this.gap) * 0.1;
        this.off += (off - this.off) * (off > this.off ? 0.5 : 0.05);
      } // follow the freshest arrival
      this.last = St;
    }
    // One and a half gaps back: far enough that there is nearly always a
    // snapshot on each side. A new state comes every 100 ms, from the room or
    // from a solo night's own step, so that is 150 ms.
    this.now = now + this.off - Math.min(0.25, this.gap * 1.5);
  },
};

// Snapshot i of one of a track's arrays. Every read is below n, and n never passes KEEP, the arrays' length.
const at = (a: Float32Array | Float64Array, i: number): number => defined(a[i], 'a track snapshot');
// u of the way from snapshot a to snapshot i.
const mix = (arr: Float32Array, a: number, i: number, u: number): number => at(arr, a) + (at(arr, i) - at(arr, a)) * u;

export class Track {
  declare t: Float64Array;
  declare xs: Float32Array;
  declare zs: Float32Array;
  declare yaws: Float32Array;
  declare pitches: Float32Array;
  declare n: number;
  declare x: number;
  declare z: number;
  declare yaw: number;
  declare pitch: number;
  declare speed: number;
  declare vf: number;
  declare vs: number;
  declare spin: number;
  declare moved: number;
  declare jumped: boolean;
  constructor() {
    this.t = new Float64Array(KEEP);
    this.xs = new Float32Array(KEEP);
    this.zs = new Float32Array(KEEP);
    this.yaws = new Float32Array(KEEP);
    this.pitches = new Float32Array(KEEP);
    this.n = 0;
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.speed = 0;
    this.vf = 0;
    this.vs = 0;
    this.spin = 0;
    this.moved = 0;
    this.jumped = false;
  }
  push(t: number, x: number, z: number, yaw: number, pitch = 0): undefined {
    const n = this.n,
      last = n - 1;
    if (n && (t < at(this.t, last) || Math.hypot(x - at(this.xs, last), z - at(this.zs, last)) > TELEPORT)) {
      this.n = 0;
      return this.push(t, x, z, yaw, pitch);
    }
    if (n === KEEP) {
      this.t.copyWithin(0, 1);
      this.xs.copyWithin(0, 1);
      this.zs.copyWithin(0, 1);
      this.yaws.copyWithin(0, 1);
      this.pitches.copyWithin(0, 1);
      this.n--;
    }
    const i = this.n++;
    this.t[i] = t;
    this.xs[i] = x;
    this.zs[i] = z;
    this.pitches[i] = pitch;
    this.yaws[i] = i ? at(this.yaws, i - 1) + wrap(yaw - at(this.yaws, i - 1)) : yaw; // unwrapped, so it never turns the long way
    if (!i) {
      this.x = x;
      this.z = z;
      this.yaw = yaw;
      this.pitch = pitch;
      this.jumped = true;
    }
  }
  // Move to time t on the night's clock. Also works out how fast it is going, along its facing
  // (vf), sideways (vs) and round (spin), from the distance it actually moved.
  sample(t: number, dt: number): void {
    const n = this.n;
    if (!n) return;
    let i = n - 1;
    while (i > 0 && at(this.t, i - 1) > t) i--;
    const a = Math.max(0, i - 1),
      ta = at(this.t, a),
      span = at(this.t, i) - ta;
    // Past the newest snapshot, carry on a quarter of a step and then wait.
    const u = span > 0 ? Math.max(0, Math.min(i === n - 1 ? 1.25 : 1, (t - ta) / span)) : 1;
    const x = mix(this.xs, a, i, u),
      z = mix(this.zs, a, i, u),
      yaw = mix(this.yaws, a, i, u);
    if (this.jumped || dt <= 0) {
      this.jumped = false;
      this.moved = this.speed = this.vf = this.vs = this.spin = 0;
    } else {
      const dx = x - this.x,
        dz = z - this.z,
        k = Math.min(1, dt * 10),
        sin = Math.sin(yaw),
        cos = Math.cos(yaw);
      this.moved = Math.hypot(dx, dz);
      this.speed += (this.moved / dt - this.speed) * k;
      this.vf += ((dx * sin + dz * cos) / dt - this.vf) * k;
      this.vs += ((dx * cos - dz * sin) / dt - this.vs) * k;
      this.spin += ((yaw - this.yaw) / dt - this.spin) * k;
    }
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = mix(this.pitches, a, i, u);
  }
}
