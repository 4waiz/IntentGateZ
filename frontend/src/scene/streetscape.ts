/**
 * Deterministic streetscape shared by roads, water, buildings and lights: decorative roads around
 * the operational grid, river bridges, the waterfront line, streetlight positions and light pools.
 * Pure functions of the backend city graph (no randomness that differs between components).
 */
import { type CityIndex, toWorld } from "../lib/geo";
import type { Quality } from "../store/store";

export const ROAD_W = { local: 2.0, arterial: 2.9, expressway: 4.4 } as const;
export type RoadClass = keyof typeof ROAD_W;

export interface Segment {
  a: [number, number];
  b: [number, number];
  cls: RoadClass;
}

export interface Bridge {
  x: number;
  z0: number;
  z1: number;
  w: number;
}

export interface Waterfront {
  /** z of the river's north quay (city side) and south quay (far bank) */
  riverN: number;
  riverS: number;
  /** x of the harbour quay on the west */
  seaE: number;
}

export function waterfront(idx: CityIndex): Waterfront {
  const south = toWorld(0, 0)[1];
  return { riverN: south + 7, riverS: south + 36, seaE: -idx.halfW - 6.5 };
}

export function bridges(idx: CityIndex): Bridge[] {
  const s = idx.city.spacing_m;
  const wf = waterfront(idx);
  return [
    { x: toWorld(6 * s, 0)[0], z0: wf.riverN, z1: wf.riverS, w: ROAD_W.expressway },
    { x: toWorld(2 * s, 0)[0], z0: wf.riverN, z1: wf.riverS, w: ROAD_W.arterial },
  ];
}

/** Decorative road segments outside the operational grid (north and east rings, bridge approaches). */
export function decorRoads(idx: CityIndex): Segment[] {
  const s = idx.city.spacing_m;
  const rows = idx.city.rows;
  const cols = idx.city.cols;
  const W = (c: number, r: number) => toWorld(c * s, r * s) as [number, number];
  const out: Segment[] = [];
  for (let r = rows; r <= rows + 1; r++) for (let c = 0; c < cols + 1; c++) out.push({ a: W(c, r), b: W(c + 1, r), cls: "local" });
  for (let c = 0; c <= cols + 1; c++) for (let r = rows - 1; r < rows + 1; r++) out.push({ a: W(c, r), b: W(c, r + 1), cls: c === 6 ? "expressway" : "local" });
  for (let c = cols; c <= cols + 1; c++) for (let r = 0; r < rows - 1; r++) out.push({ a: W(c, r), b: W(c, r + 1), cls: "local" });
  for (let r = 0; r < rows; r++) for (let c = cols - 1; c < cols + 1; c++) out.push({ a: W(c, r), b: W(c + 1, r), cls: r === 3 ? "expressway" : "local" });
  const south = toWorld(0, 0)[1];
  for (const br of bridges(idx)) out.push({ a: [br.x, south], b: [br.x, br.z1 + 40], cls: br.w > 4 ? "expressway" : "arterial" });
  // promenade road along the far bank
  const wf = waterfront(idx);
  out.push({ a: [-idx.halfW - 60, wf.riverS + 7], b: [idx.halfW + 120, wf.riverS + 7], cls: "arterial" });
  return out;
}

export interface Lamp {
  x: number;
  z: number;
  rot: number;
  v: number;
  /** light pool position on the road */
  px: number;
  pz: number;
  ps: number;
}

/** Streetlights along arterials/expressways (both sides), locals (one side), quays and bridges. */
export function streetLamps(idx: CityIndex, quality: Quality): Lamp[] {
  const every = quality === "low" ? 0 : quality === "med" ? 8 : 6.5;
  if (!every) return [];
  const out: Lamp[] = [];
  const segs: Segment[] = [
    ...idx.city.edges.flatMap((e) => {
      const a = idx.nodeWorld.get(e.a);
      const b = idx.nodeWorld.get(e.b);
      return a && b ? [{ a, b, cls: e.road_class as RoadClass }] : [];
    }),
    ...decorRoads(idx).filter((s) => s.cls !== "local"),
  ];
  for (const sg of segs) {
    const dx = sg.b[0] - sg.a[0];
    const dz = sg.b[1] - sg.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const off = ROAD_W[sg.cls] / 2 + 0.5;
    const step = sg.cls === "local" ? every * 1.7 : every;
    const sides = sg.cls === "local" ? [1] : [1, -1];
    for (let d = step * 0.5 + 2.5; d < len - 2.5; d += step) {
      for (const sd of sides) {
        const x = sg.a[0] + ux * d + nx * off * sd;
        const z = sg.a[1] + uz * d + nz * off * sd;
        out.push({ x, z, rot: Math.atan2(-nx * sd, -nz * sd), v: sg.cls === "expressway" ? 1 : 0, px: x - nx * sd * 1.15, pz: z - nz * sd * 1.15, ps: sg.cls === "expressway" ? 4.4 : 3.4 });
      }
    }
  }
  const wf = waterfront(idx);
  for (let x = -idx.halfW - 2; x < idx.halfW + 110; x += 7) {
    if (bridges(idx).some((b) => Math.abs(b.x - x) < 5)) continue;
    out.push({ x: x + 3.5, z: wf.riverN - 1.4, rot: 0, v: 0, px: x + 3.5, pz: wf.riverN - 2.6, ps: 3 });
  }
  for (let z = -idx.halfD - 90; z < wf.riverN - 4; z += 7) out.push({ x: wf.seaE + 1.4, z, rot: -Math.PI / 2, v: 0, px: wf.seaE + 2.6, pz: z, ps: 3 });
  return out;
}
