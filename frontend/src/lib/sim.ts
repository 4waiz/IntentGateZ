import type { Ambulance } from "../api/types";
import { type CityIndex, toWorld } from "./geo";

/**
 * Client-side replica of SimulationWorld.position() (backend/intentgate/simulation.py).
 * A vehicle's position is a pure function of the route the backend assigned (route node ids,
 * cumulative simulated times, optional lead-in point, departure time) and server time.
 * Vehicles without a backend route stay at their node; nothing here invents movement.
 */
export interface RoutePath {
  key: string;
  /** world-space points (lead-in point first when present) */
  pts: [number, number][];
  /** cumulative simulated seconds per point */
  times: number[];
  /** cumulative world-unit distance per point */
  cum: number[];
  total: number;
  departedAt: number;
}

export function routeKey(a: Ambulance): string {
  return `${a.departed_at}|${a.route.join(",")}|${a.start_xz ? a.start_xz.join(",") : ""}`;
}

export function buildRoutePath(a: Ambulance, idx: CityIndex): RoutePath | null {
  if (!a.route.length) return null;
  const pts: [number, number][] = [];
  let times = a.route_times.slice();
  if (a.start_xz) {
    pts.push(toWorld(a.start_xz[0], a.start_xz[1]));
    times = [0, ...times];
  }
  for (const id of a.route) {
    const p = idx.nodeWorld.get(id);
    if (!p) return null;
    pts.push(p);
  }
  if (times.length !== pts.length) return null;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  return { key: routeKey(a), pts, times, cum, total: cum[cum.length - 1], departedAt: a.departed_at };
}

export interface RouteSample {
  x: number;
  z: number;
  moving: boolean;
  /** world units travelled along the polyline */
  dist: number;
  dirX: number;
  dirZ: number;
}

function segDir(path: RoutePath, i: number, out: RouteSample): void {
  const n = path.pts.length;
  if (n < 2) return;
  const a = path.pts[Math.min(i, n - 2)];
  const b = path.pts[Math.min(i, n - 2) + 1];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len > 1e-6) {
    out.dirX = dx / len;
    out.dirZ = dz / len;
  }
}

export function sampleRoute(path: RoutePath, now: number, speedup: number, out: RouteSample): RouteSample {
  const t = (now - path.departedAt) * speedup;
  const { pts, times, cum } = path;
  const n = pts.length;
  if (t <= 0) {
    out.x = pts[0][0];
    out.z = pts[0][1];
    out.moving = true;
    out.dist = 0;
    segDir(path, 0, out);
    return out;
  }
  if (t >= times[n - 1]) {
    out.x = pts[n - 1][0];
    out.z = pts[n - 1][1];
    out.moving = false;
    out.dist = path.total;
    segDir(path, n - 2, out);
    return out;
  }
  for (let i = 0; i < n - 1; i++) {
    if (times[i] <= t && t < times[i + 1]) {
      const f = (t - times[i]) / Math.max(1e-6, times[i + 1] - times[i]);
      const a = pts[i];
      const b = pts[i + 1];
      out.x = a[0] + (b[0] - a[0]) * f;
      out.z = a[1] + (b[1] - a[1]) * f;
      out.moving = true;
      out.dist = cum[i] + (cum[i + 1] - cum[i]) * f;
      segDir(path, i, out);
      return out;
    }
  }
  out.x = pts[n - 1][0];
  out.z = pts[n - 1][1];
  out.moving = false;
  out.dist = path.total;
  return out;
}

/** Point at a given distance along a polyline (world units). */
export function pointAlong(pts: [number, number][], d: number): { x: number; z: number; dirX: number; dirZ: number } {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + len >= d || i === pts.length - 2) {
      const f = len > 0 ? Math.min(1, Math.max(0, (d - acc) / len)) : 0;
      return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, dirX: len ? (b[0] - a[0]) / len : 0, dirZ: len ? (b[1] - a[1]) / len : 1 };
    }
    acc += len;
  }
  const p = pts[0] ?? [0, 0];
  return { x: p[0], z: p[1], dirX: 0, dirZ: 1 };
}
