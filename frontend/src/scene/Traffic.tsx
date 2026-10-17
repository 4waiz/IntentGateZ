/**
 * Ambient traffic (decorative): instanced cars wander the road graph with headlights and
 * taillights so the city reads as alive at night. It is not simulation state and never touches
 * the ambulances, routes or verdicts, which all come from the backend.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { CityIndex } from "../lib/geo";
import type { Quality } from "../store/store";
import { ROAD_Y, seededRandom } from "./geometry";
import { ROAD_W } from "./streetscape";

interface Car {
  from: string;
  to: string;
  t: number;
  len: number;
  speed: number;
  lane: number;
}

const BODY = ["#d9dee3", "#1c2229", "#3b4652", "#7d8792", "#a52a2a", "#f2c14e", "#2d4f7a", "#e9ecef"];

export function Traffic({ idx, quality }: { idx: CityIndex; quality: Quality }) {
  const n = quality === "low" ? 0 : quality === "med" ? 190 : 300;
  const graph = useMemo(() => {
    const adj = new Map<string, { to: string; w: number }[]>();
    for (const e of idx.city.edges) {
      const w = ROAD_W[e.road_class as keyof typeof ROAD_W];
      adj.set(e.a, [...(adj.get(e.a) ?? []), { to: e.b, w }]);
      adj.set(e.b, [...(adj.get(e.b) ?? []), { to: e.a, w }]);
    }
    return adj;
  }, [idx]);

  const sim = useMemo(() => {
    if (!n) return null;
    const rnd = seededRandom("traffic");
    const ids = [...graph.keys()];
    const cars: Car[] = [];
    for (let i = 0; i < n; i++) {
      const from = ids[Math.floor(rnd() * ids.length)];
      const nb = graph.get(from) ?? [];
      const nx = nb[Math.floor(rnd() * nb.length)];
      if (!nx) continue;
      const a = idx.nodeWorld.get(from)!;
      const b = idx.nodeWorld.get(nx.to)!;
      cars.push({ from, to: nx.to, t: rnd(), len: Math.hypot(b[0] - a[0], b[1] - a[1]), speed: 5 + rnd() * 6, lane: nx.w * (0.18 + rnd() * 0.12) });
    }
    const bodyGeo = new THREE.BoxGeometry(0.42, 0.3, 0.95);
    bodyGeo.translate(0, 0.2, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.5 });
    const body = new THREE.InstancedMesh(bodyGeo, bodyMat, cars.length);
    const col = new THREE.Color();
    cars.forEach((_, i) => body.setColorAt(i, col.set(BODY[Math.floor(rnd() * BODY.length)])));
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    const lightGeo = new THREE.BoxGeometry(0.38, 0.08, 0.05);
    const head = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color("#fff1d0").multiplyScalar(3.2), toneMapped: false }), cars.length);
    const tail = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2a3a").multiplyScalar(2.6), toneMapped: false }), cars.length);
    for (const m of [body, head, tail]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    return { cars, body, head, tail, rnd };
  }, [n, graph, idx]);

  useEffect(
    () => () => {
      if (!sim) return;
      for (const m of [sim.body, sim.head, sim.tail]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [sim],
  );

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), up: new THREE.Vector3(0, 1, 0), f: new THREE.Vector3() }), []);

  useFrame((_, dtRaw) => {
    if (!sim) return;
    const dt = Math.min(dtRaw, 0.05);
    const { cars, body, head, tail, rnd } = sim;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.t += (c.speed * dt) / Math.max(1, c.len);
      if (c.t >= 1) {
        const nb = (graph.get(c.to) ?? []).filter((x) => x.to !== c.from);
        const options = nb.length ? nb : graph.get(c.to) ?? [];
        const nx = options[Math.floor(rnd() * options.length)];
        if (nx) {
          const a = idx.nodeWorld.get(c.to)!;
          const b = idx.nodeWorld.get(nx.to)!;
          c.from = c.to;
          c.to = nx.to;
          c.len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          c.lane = nx.w * (0.18 + rnd() * 0.12);
        }
        c.t = 0;
      }
      const a = idx.nodeWorld.get(c.from)!;
      const b = idx.nodeWorld.get(c.to)!;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.max(1e-6, Math.hypot(dx, dz));
      const ux = dx / len;
      const uz = dz / len;
      // right-hand traffic: offset to the right of the travel direction
      const px = a[0] + dx * c.t - uz * c.lane;
      const pz = a[1] + dz * c.t + ux * c.lane;
      const yaw = Math.atan2(ux, uz);
      tmp.q.setFromAxisAngle(tmp.up, yaw);
      tmp.p.set(px, ROAD_Y + 0.02, pz);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      body.setMatrixAt(i, tmp.m);
      tmp.p.set(px + ux * 0.49, ROAD_Y + 0.24, pz + uz * 0.49);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      head.setMatrixAt(i, tmp.m);
      tmp.p.set(px - ux * 0.49, ROAD_Y + 0.24, pz - uz * 0.49);
      tmp.m.compose(tmp.p, tmp.q, tmp.s);
      tail.setMatrixAt(i, tmp.m);
    }
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    tail.instanceMatrix.needsUpdate = true;
  });

  if (!sim) return null;
  return (
    <group>
      <primitive object={sim.body} />
      <primitive object={sim.head} />
      <primitive object={sim.tail} />
    </group>
  );
}
