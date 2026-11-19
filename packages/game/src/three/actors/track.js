// Where something the host moves is right now. The host sends positions ten
// times a second; drawing the latest one stutters and easing toward it lags by
// an amount that depends on speed, so feet slide. Instead each actor keeps its
// last few snapshots, stamped with the host's clock (S.t), and is drawn a
// little in the past, between two of them.
const KEEP = 8;
const TELEPORT = 5;      // metres between two snapshots that mean a jump, not a walk
const TAU = Math.PI * 2;
export const wrap = a => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };

// One clock for every track: what host time to draw at.
export const hostClock = {
  off: 0, gap: .1, last: -1, fresh: false, now: 0,
  // Call once a frame. A snapshot is new when S.t has moved.
  see(St, now) {
    this.fresh = St !== this.last;
    if (this.fresh) {
      const off = St - now, step = St - this.last;
      if (this.last < 0 || step < 0 || step > 1) { this.off = off; this.gap = .1; }
      else { this.gap += (step - this.gap) * .1; this.off += (off - this.off) * (off > this.off ? .5 : .05); }   // follow the freshest arrival
      this.last = St;
    }
    // One and a half gaps back: far enough that there is nearly always a
    // snapshot on each side, and on the host (which steps every frame) it is 25 ms.
    this.now = now + this.off - Math.min(.25, this.gap * 1.5);
  },
};

export class Track {
  constructor() {
    this.t = new Float64Array(KEEP); this.xs = new Float32Array(KEEP); this.zs = new Float32Array(KEEP); this.yaws = new Float32Array(KEEP); this.pitches = new Float32Array(KEEP);
    this.n = 0; this.x = 0; this.z = 0; this.yaw = 0; this.pitch = 0;
    this.speed = 0; this.vf = 0; this.vs = 0; this.spin = 0; this.moved = 0; this.jumped = false;
  }
  push(t, x, z, yaw, pitch = 0) {
    const n = this.n, last = n - 1;
    if (n && (t < this.t[last] || Math.hypot(x - this.xs[last], z - this.zs[last]) > TELEPORT)) { this.n = 0; return this.push(t, x, z, yaw, pitch); }
    if (n === KEEP) { this.t.copyWithin(0, 1); this.xs.copyWithin(0, 1); this.zs.copyWithin(0, 1); this.yaws.copyWithin(0, 1); this.pitches.copyWithin(0, 1); this.n--; }
    const i = this.n++;
    this.t[i] = t; this.xs[i] = x; this.zs[i] = z; this.pitches[i] = pitch;
    this.yaws[i] = i ? this.yaws[i - 1] + wrap(yaw - this.yaws[i - 1]) : yaw;   // unwrapped, so it never turns the long way
    if (!i) { this.x = x; this.z = z; this.yaw = yaw; this.pitch = pitch; this.jumped = true; }
  }
  // Move to host time t. Also works out how fast it is going, along its facing
  // (vf), sideways (vs) and round (spin), from the distance it actually moved.
  sample(t, dt) {
    const n = this.n;
    if (!n) return;
    let i = n - 1;
    while (i > 0 && this.t[i - 1] > t) i--;
    const a = Math.max(0, i - 1), span = this.t[i] - this.t[a];
    // Past the newest snapshot, carry on a quarter of a step and then wait.
    const u = span > 0 ? Math.max(0, Math.min(i === n - 1 ? 1.25 : 1, (t - this.t[a]) / span)) : 1;
    const x = this.xs[a] + (this.xs[i] - this.xs[a]) * u, z = this.zs[a] + (this.zs[i] - this.zs[a]) * u, yaw = this.yaws[a] + (this.yaws[i] - this.yaws[a]) * u;
    if (this.jumped || dt <= 0) { this.jumped = false; this.moved = this.speed = this.vf = this.vs = this.spin = 0; }
    else {
      const dx = x - this.x, dz = z - this.z, k = Math.min(1, dt * 10), sin = Math.sin(yaw), cos = Math.cos(yaw);
      this.moved = Math.hypot(dx, dz);
      this.speed += (this.moved / dt - this.speed) * k;
      this.vf += ((dx * sin + dz * cos) / dt - this.vf) * k; this.vs += ((dx * cos - dz * sin) / dt - this.vs) * k;
      this.spin += ((yaw - this.yaw) / dt - this.spin) * k;
    }
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = this.pitches[a] + (this.pitches[i] - this.pitches[a]) * u;
  }
}
