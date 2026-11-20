// Building one mesh out of many flat pieces. Everything static in the Depot
// that shares a material goes into one Batch and so into one draw call.

import type { RGB } from '@thick-shift/sim/data';
import * as THREE from 'three';

// A point or a direction in the building, [x, y, z].
export type Vec3 = [number, number, number];
// A rectangle of a texture, [u0, v0, u1, v1].
export type UV = [number, number, number, number];

const WHITE: RGB = [1, 1, 1];
export const rgbOf = (hex: THREE.ColorRepresentation): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

export class Batch {
  declare pos: number[];
  declare nor: number[];
  declare uv: number[];
  declare col: number[];
  declare idx: number[];
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  get empty(): boolean {
    return !this.idx.length;
  }
  // Four corners in order round the edge, facing n. uv: [u0, v0, u1, v1], with
  // (u0, v0) at corner a and (u1, v1) at corner c.
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, n: Vec3, uv: UV = [0, 0, 1, 1], col: RGB = WHITE): void {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c, ...d);
    for (let k = 0; k < 4; k++) {
      this.nor.push(...n);
      this.col.push(...col);
    }
    this.uv.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]);
    // wind it so the front is the side n points out of
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2],
      vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const front = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] > 0;
    this.idx.push(...(front ? [i, i + 1, i + 2, i, i + 2, i + 3] : [i, i + 2, i + 1, i, i + 3, i + 2]));
  }
  // An upright rectangle standing on the line (x0, z0) to (x1, z1), facing (nx, nz).
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, nx: number, nz: number, uv?: UV, col?: RGB): void {
    this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], [nx, 0, nz], uv, col);
  }
  // A level rectangle at height y, facing up or down.
  flat(x0: number, z0: number, x1: number, z1: number, y: number, up: boolean, uv?: UV, col?: RGB): void {
    this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, up ? 1 : -1, 0], uv, col);
  }
  // A rectangle w by h centred on (x, y, z) on a wall facing (nx, nz), the
  // right way round for writing: uv runs left to right as you look at it.
  sign(x: number, y: number, z: number, w: number, h: number, nx: number, nz: number, uv?: UV, col?: RGB): void {
    const rx = (nz * w) / 2,
      rz = (-nx * w) / 2;
    this.quad([x - rx, y - h / 2, z - rz], [x + rx, y - h / 2, z + rz], [x + rx, y + h / 2, z + rz], [x - rx, y + h / 2, z - rz], [nx, 0, nz], uv, col);
  }
  // The same lying on the floor (or stuck to the ceiling with up false), its top edge toward yaw.
  decal(x: number, y: number, z: number, w: number, h: number, yaw: number, up: boolean, uv?: UV, col?: RGB): void {
    const fx = (Math.sin(yaw) * h) / 2,
      fz = (Math.cos(yaw) * h) / 2,
      s = up ? 1 : -1,
      rx = ((-Math.cos(yaw) * w) / 2) * s,
      rz = ((Math.sin(yaw) * w) / 2) * s;
    this.quad([x - rx - fx, y, z - rz - fz], [x + rx - fx, y, z + rz - fz], [x + rx + fx, y, z + rz + fz], [x - rx + fx, y, z - rz + fz], [0, s, 0], uv, col);
  }
  // A box between two corners. per: metres of surface per texture repeat.
  // flatUv: give every face this one uv rectangle instead.
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, col?: RGB, per = 1, flatUv?: UV): void {
    const u = (a: number, b: number): UV => flatUv || [0, 0, a / per, b / per],
      w = x1 - x0,
      h = y1 - y0,
      d = z1 - z0;
    this.wall(x0, z1, x1, z1, y0, y1, 0, 1, u(w, h), col);
    this.wall(x0, z0, x1, z0, y0, y1, 0, -1, u(w, h), col);
    this.wall(x1, z0, x1, z1, y0, y1, 1, 0, u(d, h), col);
    this.wall(x0, z0, x0, z1, y0, y1, -1, 0, u(d, h), col);
    this.flat(x0, z0, x1, z1, y1, true, u(w, d), col);
    this.flat(x0, z0, x1, z1, y0, false, u(w, d), col);
  }
  // A round bar of radius r from a to b, which must differ along one axis only.
  bar(a: Vec3, b: Vec3, r: number, col?: RGB, sides = 8, flatUv?: UV): void {
    const ax = [0, 1, 2].find(k => a[k] !== b[k]),
      p = (ax + 1) % 3,
      q = (ax + 2) % 3,
      len = Math.abs(b[ax] - a[ax]);
    for (let i = 0; i < sides; i++) {
      const t0 = (i / sides) * Math.PI * 2,
        t1 = ((i + 1) / sides) * Math.PI * 2,
        tm = (t0 + t1) / 2;
      const at = (end: Vec3, t: number): Vec3 => {
        const v: Vec3 = [0, 0, 0];
        v[ax] = end[ax];
        v[p] = a[p] + Math.cos(t) * r;
        v[q] = a[q] + Math.sin(t) * r;
        return v;
      };
      const n: Vec3 = [0, 0, 0];
      n[p] = Math.cos(tm);
      n[q] = Math.sin(tm);
      this.quad(at(a, t0), at(b, t0), at(b, t1), at(a, t1), n, flatUv || [0, i / sides, len, (i + 1) / sides], col);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    return g;
  }
  mesh<M extends THREE.Material>(material: M): THREE.Mesh<THREE.BufferGeometry, M> {
    return new THREE.Mesh(this.geometry(), material);
  }
}
