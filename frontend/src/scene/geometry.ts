import * as THREE from "three";
import type { CityIndex } from "../lib/geo";

export const ROAD_WIDTH = { local: 2.0, arterial: 2.9, expressway: 4.4 } as const;
export const ROAD_Y = 0.06;

/** All road segments merged into one geometry: one draw call for the whole network. */
export function buildRoadGeometry(idx: CityIndex): THREE.BufferGeometry {
  const pos: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const cls: number[] = [];
  const index: number[] = [];
  let v = 0;
  for (const e of idx.city.edges) {
    const a = idx.nodeWorld.get(e.a);
    const b = idx.nodeWorld.get(e.b);
    if (!a || !b) continue;
    const w = ROAD_WIDTH[e.road_class] / 2;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz * w;
    const nz = ux * w;
    // extend slightly under the junction pads to avoid seams
    const ext = 0.6;
    const ax = a[0] - ux * ext;
    const az = a[1] - uz * ext;
    const bx = b[0] + ux * ext;
    const bz = b[1] + uz * ext;
    const k = e.road_class === "expressway" ? 2 : e.road_class === "arterial" ? 1 : 0;
    pos.push(ax + nx, ROAD_Y, az + nz, ax - nx, ROAD_Y, az - nz, bx + nx, ROAD_Y, bz + nz, bx - nx, ROAD_Y, bz - nz);
    along.push(-ext, -ext, len + ext, len + ext);
    across.push(1, -1, 1, -1);
    cls.push(k, k, k, k);
    index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  g.setAttribute("aClass", new THREE.Float32BufferAttribute(cls, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/**
 * Flat ribbon along a polyline (world x/z), with a continuous distance attribute for dashes and
 * moving pulses. Each segment is extended by half a width so 90-degree corners stay closed.
 */
export function buildRibbonGeometry(pts: [number, number][], width: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const dist: number[] = [];
  const across: number[] = [];
  const index: number[] = [];
  let acc = 0;
  let v = 0;
  const hw = width / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz * hw;
    const nz = ux * hw;
    const e0 = i === 0 ? 0 : hw;
    const e1 = i === pts.length - 2 ? 0 : hw;
    const ax = a[0] - ux * e0;
    const az = a[1] - uz * e0;
    const bx = b[0] + ux * e1;
    const bz = b[1] + uz * e1;
    pos.push(ax + nx, y, az + nz, ax - nx, y, az - nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
    dist.push(acc - e0, acc - e0, acc + len + e1, acc + len + e1);
    across.push(1, -1, 1, -1);
    index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    v += 4;
    acc += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
  g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export function polylineLength(pts: [number, number][]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

/** Deterministic PRNG (mulberry32) seeded from a string. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
