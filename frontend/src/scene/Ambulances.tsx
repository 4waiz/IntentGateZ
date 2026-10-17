import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Ambulance } from "../api/types";
import { serverNow } from "../lib/clock";
import type { CityIndex } from "../lib/geo";
import { buildRoutePath, routeKey, sampleRoute, type RouteSample } from "../lib/sim";
import { commandCamera, currentDecisionId, getState, setState, useStore } from "../store/store";
import { ROAD_Y } from "./geometry";

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: "#eef3f7", roughness: 0.42, metalness: 0.08 }),
  stripe: new THREE.MeshStandardMaterial({ color: "#ff5a36", emissive: "#ff5a36", emissiveIntensity: 0.35, roughness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: "#0b1b2b", emissive: "#12395a", emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.3 }),
  wheel: new THREE.MeshStandardMaterial({ color: "#11181f", roughness: 0.9 }),
  bar: new THREE.MeshStandardMaterial({ color: "#1d2630", roughness: 0.6 }),
  head: new THREE.MeshBasicMaterial({ color: "#fff3d6" }),
  tail: new THREE.MeshBasicMaterial({ color: "#ff3b4e" }),
};

const STATUS_RING: Record<string, string> = {
  transporting: "#00d5b5",
  dispatched: "#4589ff",
  available: "#8496a8",
  returning: "#5b6c7e",
  at_hospital: "#c3d0dc",
};

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const AmbulanceModel = memo(function AmbulanceModel({ redRef, blueRef }: { redRef: RefObject<THREE.MeshStandardMaterial>; blueRef: RefObject<THREE.MeshStandardMaterial> }) {
  return (
    <group>
      <RoundedBox args={[1.9, 1.75, 3.0]} radius={0.16} smoothness={2} position={[0, 1.27, -0.35]} material={MAT.body} />
      <RoundedBox args={[1.84, 1.3, 1.25]} radius={0.16} smoothness={2} position={[0, 1.02, 1.62]} material={MAT.body} />
      <mesh position={[0, 1.3, 2.25]} material={MAT.glass}>
        <boxGeometry args={[1.56, 0.58, 0.06]} />
      </mesh>
      <mesh position={[0.93, 1.3, 1.62]} material={MAT.glass}>
        <boxGeometry args={[0.05, 0.46, 0.8]} />
      </mesh>
      <mesh position={[-0.93, 1.3, 1.62]} material={MAT.glass}>
        <boxGeometry args={[0.05, 0.46, 0.8]} />
      </mesh>
      <mesh position={[0, 1.02, 0.25]} material={MAT.stripe}>
        <boxGeometry args={[1.96, 0.24, 4.3]} />
      </mesh>
      {[
        [0.92, 1.38],
        [-0.92, 1.38],
        [0.92, -1.15],
        [-0.92, -1.15],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.36, z]} rotation-z={Math.PI / 2} material={MAT.wheel}>
          <cylinderGeometry args={[0.36, 0.36, 0.3, 12]} />
        </mesh>
      ))}
      <mesh position={[0, 2.2, -0.05]} material={MAT.bar}>
        <boxGeometry args={[1.5, 0.14, 0.42]} />
      </mesh>
      <mesh position={[-0.4, 2.33, -0.05]}>
        <boxGeometry args={[0.62, 0.18, 0.34]} />
        <meshStandardMaterial ref={redRef} color="#ff2d3f" emissive="#ff2d3f" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0.4, 2.33, -0.05]}>
        <boxGeometry args={[0.62, 0.18, 0.34]} />
        <meshStandardMaterial ref={blueRef} color="#2d6bff" emissive="#2d6bff" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0.62, 0.82, 2.27]} material={MAT.head}>
        <boxGeometry args={[0.34, 0.18, 0.05]} />
      </mesh>
      <mesh position={[-0.62, 0.82, 2.27]} material={MAT.head}>
        <boxGeometry args={[0.34, 0.18, 0.05]} />
      </mesh>
      <mesh position={[0.72, 0.9, -1.87]} material={MAT.tail}>
        <boxGeometry args={[0.24, 0.3, 0.05]} />
      </mesh>
      <mesh position={[-0.72, 0.9, -1.87]} material={MAT.tail}>
        <boxGeometry args={[0.24, 0.3, 0.05]} />
      </mesh>
    </group>
  );
});

const ringGeo = new THREE.RingGeometry(2.3, 2.75, 48);
ringGeo.rotateX(-Math.PI / 2);
const discGeo = new THREE.CircleGeometry(2.3, 40);
discGeo.rotateX(-Math.PI / 2);

function AmbulanceUnit({ amb, idx, park }: { amb: Ambulance; idx: CityIndex; park: [number, number] }) {
  const group = useRef<THREE.Group>(null);
  const scaled = useRef<THREE.Group>(null);
  const red = useRef<THREE.MeshStandardMaterial>(null);
  const blue = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.MeshBasicMaterial>(null);
  const key = routeKey(amb);
  const path = useMemo(() => buildRoutePath(amb, idx), [key, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const sample = useRef<RouteSample>({ x: 0, z: 0, moving: false, dist: 0, dirX: 0, dirZ: 1 });
  const heading = useRef<number | null>(null);
  const phase = useMemo(() => Math.random() * 10, []);
  const emergency = amb.status === "dispatched" || amb.status === "transporting";
  const ringColor = amb.ambient ? "#5b6c7e" : STATUS_RING[amb.status] ?? "#8496a8";
  const hovered = useStore((s) => s.hovered?.type === "ambulance" && s.hovered.id === amb.id);
  const followed = useStore((s) => s.cameraMode === "follow" && s.followId === amb.id);
  const inDecision = useStore((s) => {
    const id = currentDecisionId(s);
    const d = id ? s.decisionCache[id] : null;
    return d ? d.action.parameters.ambulance_id === amb.id : false;
  });

  useFrame((state, dt) => {
    const g = group.current;
    const sg = scaled.current;
    if (!g || !sg) return;
    const sim = getState().sim;
    let x: number;
    let z: number;
    let moving = false;
    if (path && sim) {
      const s = sampleRoute(path, serverNow(), sim.sim_speedup, sample.current);
      x = s.x;
      z = s.z;
      moving = s.moving;
      const target = Math.atan2(s.dirX, s.dirZ);
      if (heading.current === null) heading.current = target;
      if (moving) heading.current = lerpAngle(heading.current, target, Math.min(1, dt * 8));
      if (!moving) {
        x += park[0];
        z += park[1];
      }
    } else {
      const p = idx.nodeWorld.get(amb.node) ?? [0, 0];
      x = p[0] + park[0];
      z = p[1] + park[1];
      if (heading.current === null) heading.current = 0;
    }
    g.position.set(x, ROAD_Y, z);
    sg.rotation.y = heading.current ?? 0;
    const dist = state.camera.position.distanceTo(g.position);
    const sc = THREE.MathUtils.clamp(dist / 120, 0.9, 3.4);
    sg.scale.setScalar(sc);
    const t = state.clock.elapsedTime + phase;
    if (red.current && blue.current) {
      const on = emergency && moving;
      const f = Math.sin(t * 13) > 0;
      red.current.emissiveIntensity = on ? (f ? 3.2 : 0.15) : 0.15;
      blue.current.emissiveIntensity = on ? (f ? 0.15 : 3.2) : 0.15;
    }
    if (ring.current) ring.current.opacity = moving ? 0.55 + 0.3 * Math.sin(t * 5) : 0.35;
  });

  const showLabel = hovered || followed || inDecision || (!amb.ambient && emergency);
  return (
    <group
      ref={group}
      onPointerOver={(e) => {
        e.stopPropagation();
        setState({ hovered: { type: "ambulance", id: amb.id } });
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        if (getState().hovered?.id === amb.id) setState({ hovered: null });
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        commandCamera("ambulance", amb.id);
      }}
    >
      <group ref={scaled}>
        <mesh geometry={discGeo} position={[0, 0.02, 0]}>
          <meshBasicMaterial color={ringColor} transparent opacity={0.08} depthWrite={false} />
        </mesh>
        <mesh geometry={ringGeo} position={[0, 0.03, 0]}>
          <meshBasicMaterial ref={ring} color={ringColor} transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <AmbulanceModel redRef={red} blueRef={blue} />
        {showLabel && (
          <Html position={[0, 3.6, 0]} center zIndexRange={[30, 10]} style={{ pointerEvents: "none" }}>
            <div
              className="ig-scene-label rounded-[3px] border bg-[#07111c]/85 px-1.5 py-[2px] text-center"
              style={{ borderColor: `${ringColor}66`, boxShadow: hovered || followed ? `0 0 12px ${ringColor}44` : undefined }}
            >
              <div className="font-mono text-[10px] font-medium text-[#E8F0F7]">{amb.call_sign}</div>
              {(hovered || followed || inDecision) && (
                <div className="text-[9px] tracking-[0.06em] uppercase" style={{ color: ringColor }}>
                  {amb.status.replace("_", " ")}
                  {amb.ambient ? " · ambient" : ""}
                </div>
              )}
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}

export function Ambulances({ idx }: { idx: CityIndex }) {
  const ambulances = useStore((s) => s.sim?.ambulances);
  // Parking slots so units waiting at the same junction do not overlap (display offset only).
  const parks = useMemo(() => {
    const byNode = new Map<string, string[]>();
    const now = serverNow();
    const sim = getState().sim;
    const s: RouteSample = { x: 0, z: 0, moving: false, dist: 0, dirX: 0, dirZ: 1 };
    for (const a of ambulances ?? []) {
      let node = a.node;
      const path = buildRoutePath(a, idx);
      if (path && sim) {
        sampleRoute(path, now, sim.sim_speedup, s);
        if (s.moving) continue;
        node = a.route[a.route.length - 1] ?? a.node;
      }
      byNode.set(node, [...(byNode.get(node) ?? []), a.id]);
    }
    const out = new Map<string, [number, number]>();
    for (const ids of byNode.values()) {
      ids.forEach((id, i) => {
        const off = (i - (ids.length - 1) / 2) * 5.5;
        out.set(id, [off, ids.length > 1 ? 2.2 : 0]);
      });
    }
    return out;
  }, [ambulances, idx]);

  useEffect(() => () => void (document.body.style.cursor = ""), []);

  return (
    <group>
      {(ambulances ?? []).map((a) => (
        <AmbulanceUnit key={a.id} amb={a} idx={idx} park={parks.get(a.id) ?? [0, 0]} />
      ))}
    </group>
  );
}
