import type { City, CityBlock, CityEdge, CityHospital, CityNode, CityStation } from "../api/types";

/**
 * World frame: 1 world unit = 10 m, city centred at the origin, north (higher row index) away
 * from the default camera (-Z) and east (higher column) to the right (+X).
 */
export const M_PER_UNIT = 10;

let cxM = 1800;
let czM = 1400;

export function toWorld(xM: number, zM: number): [number, number] {
  return [(xM - cxM) / M_PER_UNIT, (czM - zM) / M_PER_UNIT];
}

export interface CityIndex {
  city: City;
  nodes: Map<string, CityNode>;
  edges: Map<string, CityEdge>;
  hospitals: Map<string, CityHospital>;
  stations: Map<string, CityStation>;
  blocks: CityBlock[];
  /** world-space half extents of the road grid */
  halfW: number;
  halfD: number;
  /** world positions of nodes */
  nodeWorld: Map<string, [number, number]>;
}

export function buildCityIndex(city: City): CityIndex {
  cxM = ((city.cols - 1) * city.spacing_m) / 2;
  czM = ((city.rows - 1) * city.spacing_m) / 2;
  const nodes = new Map(city.nodes.map((n) => [n.id, n] as const));
  const nodeWorld = new Map(city.nodes.map((n) => [n.id, toWorld(n.x, n.z)] as const));
  return {
    city,
    nodes,
    edges: new Map(city.edges.map((e) => [e.id, e] as const)),
    hospitals: new Map(city.hospitals.map((h) => [h.id, h] as const)),
    stations: new Map(city.stations.map((s) => [s.id, s] as const)),
    blocks: city.blocks,
    halfW: cxM / M_PER_UNIT,
    halfD: czM / M_PER_UNIT,
    nodeWorld,
  };
}

export function nodeWorld(idx: CityIndex, nodeId: string): [number, number] | null {
  return idx.nodeWorld.get(nodeId) ?? null;
}

/**
 * Where a facility building sits: inside the block whose north-west corner hosts it, or just
 * outside the grid when the facility node is on the outer ring.
 */
export function facilityWorld(idx: CityIndex, nodeId: string): [number, number] | null {
  const n = idx.nodes.get(nodeId);
  if (!n) return null;
  const s = idx.city.spacing_m;
  const fx = n.c < idx.city.cols - 1 ? s / 2 : s * 0.42;
  const fz = n.r < idx.city.rows - 1 ? s / 2 : s * 0.42;
  return toWorld(n.x + fx, n.z + fz);
}

export function edgeWorld(idx: CityIndex, edgeId: string): { a: [number, number]; b: [number, number]; edge: CityEdge } | null {
  const e = idx.edges.get(edgeId);
  if (!e) return null;
  const a = idx.nodeWorld.get(e.a);
  const b = idx.nodeWorld.get(e.b);
  if (!a || !b) return null;
  return { a, b, edge: e };
}

/** Polyline (world) for a list of node ids; unknown ids are skipped. */
export function routeWorld(idx: CityIndex, route: string[]): [number, number][] {
  const out: [number, number][] = [];
  for (const id of route) {
    const p = idx.nodeWorld.get(id);
    if (p) out.push(p);
  }
  return out;
}

export function edgeLabel(idx: CityIndex, edgeId: string): string {
  const e = idx.edges.get(edgeId);
  if (!e) return edgeId;
  const a = idx.nodes.get(e.a);
  const b = idx.nodes.get(e.b);
  const cross = (n: CityNode | undefined) => (n ? n.street.split(" & ").find((s) => s !== e.name) ?? n.id : "?");
  return `${e.name}: ${cross(a)} to ${cross(b)}`;
}
