import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Ambulance, Decision } from "../api/types";
import { serverNow } from "../lib/clock";
import { type CityIndex, routeWorld } from "../lib/geo";
import { buildRoutePath, pointAlong, routeKey, sampleRoute, type RouteSample } from "../lib/sim";
import { currentDecisionId, getState, useStore } from "../store/store";
import { buildRibbonGeometry, polylineLength } from "./geometry";
import { createHexShieldMaterial, createRibbonMaterial } from "./materials";

const destRing = new THREE.RingGeometry(3.2, 3.8, 48);
destRing.rotateX(-Math.PI / 2);
const hexRing = new THREE.RingGeometry(6.2, 7.0, 6, 1, Math.PI / 6);
hexRing.rotateX(-Math.PI / 2);

/** Route the backend assigned to a unit. Authorised (agent action executed) routes glow teal. */
function ActiveRoute({ amb, idx }: { amb: Ambulance; idx: CityIndex }) {
  const key = routeKey(amb);
  const path = useMemo(() => buildRoutePath(amb, idx), [key, idx]); // eslint-disable-line react-hooks/exhaustive-deps
  const authorised = amb.last_action_id !== null;
  const color = authorised ? "#00d5b5" : "#2b8fae";
  const geo = useMemo(() => (path ? buildRibbonGeometry(path.pts, authorised ? 2.1 : 1.3, 0.14) : null), [path, authorised]);
  const mat = useMemo(() => createRibbonMaterial(color), [color]);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  const sample = useRef<RouteSample>({ x: 0, z: 0, moving: false, dist: 0, dirX: 0, dirZ: 1 });
  const fade = useRef(1);
  useEffect(
    () => () => {
      geo?.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useFrame((state, dt) => {
    if (!path) return;
    const sim = getState().sim;
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    if (sim) sampleRoute(path, serverNow(), sim.sim_speedup, sample.current);
    mat.uniforms.uTraveled.value = sample.current.dist;
    // Once the unit has arrived, let the route fade out.
    const target = sample.current.moving ? 1 : 0;
    fade.current += (target - fade.current) * Math.min(1, dt * (target ? 4 : 0.6));
    mat.uniforms.uOpacity.value = fade.current * (authorised ? 1 : 0.55);
    if (ringMat.current) ringMat.current.opacity = fade.current * (0.45 + 0.35 * Math.sin(state.clock.elapsedTime * 4));
  });
  if (!path || !geo) return null;
  const end = path.pts[path.pts.length - 1];
  return (
    <group>
      <mesh geometry={geo} material={mat} renderOrder={5} />
      <mesh geometry={destRing} position={[end[0], 0.16, end[1]]} renderOrder={5}>
        <meshBasicMaterial ref={ringMat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

function GhostRoute({ d, idx, emphasized }: { d: Decision; idx: CityIndex; emphasized: boolean }) {
  const pts = useMemo(() => routeWorld(idx, d.ghost_route ?? []), [d.ghost_route, idx]);
  const geo = useMemo(() => (pts.length > 1 ? buildRibbonGeometry(pts, 2.2, 0.2) : null), [pts]);
  const mat = useMemo(() => {
    const m = createRibbonMaterial("#ff5d70", true);
    m.uniforms.uFlicker.value = 1;
    return m;
  }, []);
  const shieldMat = useMemo(() => {
    const m = createHexShieldMaterial("#ff5d70");
    m.uniforms.uScale.value.set(16, 4.2);
    return m;
  }, []);
  useEffect(
    () => () => {
      geo?.dispose();
      mat.dispose();
      shieldMat.dispose();
    },
    [geo, mat, shieldMat],
  );
  const checkpoint = useRef<THREE.Group>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    mat.uniforms.uOpacity.value = emphasized ? 1 : 0.45;
    shieldMat.uniforms.uTime.value = t;
    shieldMat.uniforms.uOpacity.value = emphasized ? 1 : 0.5;
    const g = checkpoint.current;
    if (g) {
      // Same distance scaling as the vehicles, so the field always encloses the held unit.
      const s = THREE.MathUtils.clamp(state.camera.position.distanceTo(g.position) / 120, 0.9, 3.4);
      g.scale.setScalar(s);
    }
  });
  if (!geo || pts.length < 2) return null;
  const total = polylineLength(pts);
  const at = pointAlong(pts, Math.min(2, total * 0.1));
  const heading = Math.atan2(at.dirX, at.dirZ);
  const start = pts[0];
  const end = pts[pts.length - 1];
  const codes = d.findings.filter((f) => f.outcome === "block").map((f) => f.code);
  return (
    <group>
      <mesh geometry={geo} material={mat} renderOrder={6} />
      {/* IntentGate checkpoint: a hexagonal force field holding the unit where the blocked plan would start */}
      <group ref={checkpoint} position={[start[0], 0, start[1]]} rotation-y={heading}>
        <mesh position={[0, 3.6, 0]} material={shieldMat} renderOrder={7}>
          <cylinderGeometry args={[6.5, 6.5, 7.2, 6, 1, true]} />
        </mesh>
        <mesh geometry={hexRing} position={[0, 0.26, 0]} renderOrder={7}>
          <meshBasicMaterial color="#ff5d70" transparent opacity={emphasized ? 0.9 : 0.45} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
        {emphasized && (
          <Html position={[0, 9.5, 0]} center zIndexRange={[34, 10]} style={{ pointerEvents: "none" }}>
            <div className="ig-scene-label rounded-[4px] border border-[#ff5d70]/70 bg-[#1a0910]/90 px-2 py-1 shadow-[0_0_24px_rgba(255,93,112,0.35)]">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-[#ff5d70]">
                <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M4 1h4l3 3v4l-3 3H4L1 8V4l3-3Z" fill="none" stroke="#ff5d70" strokeWidth="1.4" />
                  <path d="M4.3 4.3 7.7 7.7M7.7 4.3 4.3 7.7" stroke="#ff5d70" strokeWidth="1.4" />
                </svg>
                BLOCKED · INTENTGATE Z
              </div>
              <div className="mt-0.5 font-mono text-[9.5px] text-[#ffb3bd]">{codes.slice(0, 3).join(" · ")}</div>
            </div>
          </Html>
        )}
      </group>
      <mesh geometry={destRing} position={[end[0], 0.22, end[1]]} renderOrder={6}>
        <meshBasicMaterial color="#ff5d70" transparent opacity={emphasized ? 0.7 : 0.3} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  );
}

export function Routes({ idx }: { idx: CityIndex }) {
  const ambulances = useStore((s) => s.sim?.ambulances);
  const cache = useStore((s) => s.decisionCache);
  const selectedId = useStore(currentDecisionId);
  const active = (ambulances ?? []).filter((a) => !a.ambient && a.route.length > 1);
  const ghosts = useMemo(
    () =>
      Object.values(cache)
        .filter((d) => d.verdict === "BLOCK" && d.ghost_route && d.ghost_route.length > 1)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 3),
    [cache],
  );
  const emphasizedId = ghosts.some((g) => g.decision_id === selectedId) ? selectedId : ghosts[0]?.decision_id;
  return (
    <group>
      {active.map((a) => (
        <ActiveRoute key={`${a.id}|${routeKey(a)}`} amb={a} idx={idx} />
      ))}
      {ghosts.map((d) => (
        <GhostRoute key={d.decision_id} d={d} idx={idx} emphasized={d.decision_id === emphasizedId} />
      ))}
    </group>
  );
}
