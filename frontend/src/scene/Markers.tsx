import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Closure, Decision, Incident } from "../api/types";
import { type CityIndex, edgeWorld, facilityWorld } from "../lib/geo";
import { money } from "../lib/format";
import { commandCamera, useStore, type VerdictEffect } from "../store/store";
import { ROAD_WIDTH } from "./geometry";
import { createBeamMaterial, createClosureOverlayMaterial, createHexShieldMaterial, createStripeMaterial } from "./materials";
import { SceneLabel } from "./SceneLabel";

// ------------------------------------------------------------------ incidents

const SEV_COLOR = (sev: number) => (sev >= 5 ? "#ff7a45" : sev === 4 ? "#ff9f43" : "#ffc861");
const ring = new THREE.RingGeometry(2.0, 2.45, 48);
ring.rotateX(-Math.PI / 2);

const IncidentMarker = memo(function IncidentMarker({ inc, pos }: { inc: Incident; pos: [number, number] }) {
  const color = SEV_COLOR(inc.severity);
  const open = inc.status === "open";
  const beam = useMemo(() => createBeamMaterial(color, open ? 0.85 : 0.45), [color, open]);
  const pulse = useRef<THREE.Mesh>(null);
  const pulseMat = useRef<THREE.MeshBasicMaterial>(null);
  const core = useRef<THREE.Mesh>(null);
  useEffect(() => () => beam.dispose(), [beam]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    beam.uniforms.uTime.value = t;
    const p = (t * (open ? 0.6 : 0.35)) % 1;
    if (pulse.current) pulse.current.scale.setScalar(1 + p * 2.6);
    if (pulseMat.current) pulseMat.current.opacity = (1 - p) * (open ? 0.85 : 0.45);
    if (core.current) {
      core.current.rotation.y = t * 1.2;
      core.current.position.y = 4.5 + Math.sin(t * 2) * 0.35;
    }
  });
  const h = 10 + inc.severity * 4;
  return (
    <group position={[pos[0], 0.2, pos[1]]}>
      <mesh geometry={ring}>
        <meshBasicMaterial color={color} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={pulse} geometry={ring}>
        <meshBasicMaterial ref={pulseMat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh position={[0, h / 2, 0]} material={beam}>
        <cylinderGeometry args={[0.35, 0.9, h, 12, 1, true]} />
      </mesh>
      <mesh
        ref={core}
        position={[0, 4.5, 0]}
        onClick={(e) => {
          e.stopPropagation();
          commandCamera("incident", inc.id);
        }}
      >
        <octahedronGeometry args={[1.1, 0]} />
        <meshBasicMaterial color={color} wireframe />
      </mesh>
      <SceneLabel position={[0, h + 2.5, 0]} minScale={0.85} z={22}>
        <div className="ig-scene-label rounded-[3px] border bg-[#140b06]/80 px-1.5 py-[2px]" style={{ borderColor: `${color}66` }}>
          <span className="font-mono text-[9.5px] font-medium" style={{ color }}>
            {inc.id}
          </span>
          <span className="ml-1 text-[9px] tracking-[0.08em] text-[#c3d0dc] uppercase">sev {inc.severity}</span>
        </div>
      </SceneLabel>
    </group>
  );
});

export function Incidents({ idx }: { idx: CityIndex }) {
  const incidents = useStore((s) => s.sim?.incidents);
  const key = incidents?.map((i) => `${i.id}:${i.status}:${i.node}`).join("|");
  const stable = useMemo(() => incidents ?? [], [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {stable.map((inc) => {
        const p = idx.nodeWorld.get(inc.node);
        return p ? <IncidentMarker key={inc.id} inc={inc} pos={p} /> : null;
      })}
    </group>
  );
}

// ------------------------------------------------------------------ road closures

const ClosureMarker = memo(function ClosureMarker({ closure, idx }: { closure: Closure; idx: CityIndex }) {
  const e = edgeWorld(idx, closure.edge_id);
  const overlay = useMemo(() => createClosureOverlayMaterial(), []);
  const stripes = useMemo(() => createStripeMaterial(), []);
  useEffect(
    () => () => {
      overlay.dispose();
      stripes.dispose();
    },
    [overlay, stripes],
  );
  useFrame((state) => {
    overlay.uniforms.uTime.value = state.clock.elapsedTime;
    stripes.uniforms.uTime.value = state.clock.elapsedTime;
  });
  if (!e) return null;
  const [ax, az] = e.a;
  const [bx, bz] = e.b;
  const len = Math.hypot(bx - ax, bz - az);
  const rot = Math.atan2(bx - ax, bz - az);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const w = ROAD_WIDTH[e.edge.road_class] + 0.8;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  return (
    <group>
      <mesh position={[mx, 0.18, mz]} rotation={[-Math.PI / 2, 0, rot]} material={overlay} renderOrder={4}>
        <planeGeometry args={[w, len - 4]} />
      </mesh>
      {[0.22, 0.78].map((f) => (
        <group key={f} position={[ax + ux * len * f, 0, az + uz * len * f]} rotation-y={rot}>
          <mesh position={[0, 0.9, 0]} material={stripes}>
            <boxGeometry args={[w + 1.2, 0.7, 0.45]} />
          </mesh>
          <mesh position={[-(w + 1.2) / 2 + 0.25, 0.45, 0]}>
            <boxGeometry args={[0.25, 0.9, 0.25]} />
            <meshStandardMaterial color="#2a3746" />
          </mesh>
          <mesh position={[(w + 1.2) / 2 - 0.25, 0.45, 0]}>
            <boxGeometry args={[0.25, 0.9, 0.25]} />
            <meshStandardMaterial color="#2a3746" />
          </mesh>
        </group>
      ))}
      <SceneLabel position={[mx, 5, mz]} minScale={0.85} z={22}>
        <div className="ig-scene-label rounded-[3px] border border-[#ff5d70]/60 bg-[#1a0910]/85 px-1.5 py-[2px]">
          <span className="text-[9.5px] font-semibold tracking-[0.12em] text-[#ff5d70]">ROAD CLOSED</span>
          <span className="ml-1 text-[9.5px] text-[#c3d0dc]">· {e.edge.name}</span>
        </div>
      </SceneLabel>
    </group>
  );
});

export function Closures({ idx }: { idx: CityIndex }) {
  const closures = useStore((s) => s.sim?.closures);
  const key = closures?.map((c) => c.edge_id).join("|");
  const stable = useMemo(() => closures ?? [], [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {stable.map((c) => (
        <ClosureMarker key={c.edge_id} closure={c} idx={idx} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ challenge markers

function challengeHospital(d: Decision): string | null {
  const p = d.action.parameters;
  if (d.action.action_type === "purchase_supplies" && typeof p.delivery_hospital_id === "string") return p.delivery_hospital_id;
  if ((d.action.action_type === "reserve_icu_beds" || d.action.action_type === "update_hospital_status") && typeof p.hospital_id === "string") return p.hospital_id;
  return null;
}

const ChallengeMarker = memo(function ChallengeMarker({ pos, title, sub, color }: { pos: [number, number]; title: string; sub: string; color: string }) {
  const gem = useRef<THREE.Group>(null);
  const beam = useMemo(() => createBeamMaterial(color, 0.7), [color]);
  useEffect(() => () => beam.dispose(), [beam]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    beam.uniforms.uTime.value = t;
    if (gem.current) {
      gem.current.rotation.y = t * 0.9;
      gem.current.position.y = 31 + Math.sin(t * 1.6) * 0.6;
    }
  });
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <group ref={gem} position={[0, 31, 0]}>
        <mesh>
          <octahedronGeometry args={[2.4, 0]} />
          <meshBasicMaterial color={color} wireframe transparent opacity={0.95} />
        </mesh>
        <mesh scale={0.62}>
          <octahedronGeometry args={[2.4, 0]} />
          <meshBasicMaterial color={color} transparent opacity={0.35} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
      <mesh position={[0, 23.5, 0]} material={beam}>
        <cylinderGeometry args={[0.2, 0.6, 11, 10, 1, true]} />
      </mesh>
      <Html position={[0, 36.5, 0]} center zIndexRange={[32, 10]} style={{ pointerEvents: "none" }}>
        <div className="ig-scene-label rounded-[4px] border bg-[#1a1206]/90 px-2 py-1 text-center shadow-[0_0_22px_rgba(255,188,92,0.25)]" style={{ borderColor: `${color}99` }}>
          <div className="font-mono text-[12px] font-semibold" style={{ color }}>
            {title}
          </div>
          <div className="text-[9px] font-semibold tracking-[0.14em]" style={{ color }}>
            {sub}
          </div>
        </div>
      </Html>
    </group>
  );
});

export function ChallengeMarkers({ idx }: { idx: CityIndex }) {
  const challenges = useStore((s) => s.sim?.challenges);
  const cache = useStore((s) => s.decisionCache);
  const items = useMemo(() => {
    const out: { key: string; pos: [number, number]; title: string; sub: string; color: string }[] = [];
    for (const c of challenges ?? []) {
      if (c.status !== "pending" && c.status !== "approved") continue;
      const d = cache[c.decision_id];
      const hid = d ? challengeHospital(d) : null;
      const h = hid ? idx.hospitals.get(hid) : undefined;
      const pos = h ? facilityWorld(idx, h.node) : null;
      if (!pos) continue;
      const req = c.review_findings.find((f) => typeof f.evidence.requested_usd === "number")?.evidence.requested_usd;
      const title = typeof req === "number" ? money(req) : c.review_codes[0] ?? "REVIEW";
      out.push({
        key: c.challenge_id,
        pos,
        title,
        sub: c.status === "pending" ? "PENDING REVIEW" : "APPROVED · AWAITING EXECUTION",
        color: c.status === "pending" ? "#ffbc5c" : "#4589ff",
      });
    }
    return out;
  }, [challenges, cache, idx]);
  return (
    <group>
      {items.map((m) => (
        <ChallengeMarker key={`${m.key}:${m.sub}`} pos={m.pos} title={m.title} sub={m.sub} color={m.color} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------ verdict interventions

const EFFECT_MS = 2600;
const fxRing = new THREE.RingGeometry(0.92, 1.0, 64);
fxRing.rotateX(-Math.PI / 2);

function Effect({ e }: { e: VerdictEffect }) {
  const color = e.verdict === "ALLOW" ? "#00d5b5" : e.verdict === "CHALLENGE" ? "#ffbc5c" : "#ff5d70";
  const r1 = useRef<THREE.Mesh>(null);
  const r2 = useRef<THREE.Mesh>(null);
  const m1 = useRef<THREE.MeshBasicMaterial>(null);
  const m2 = useRef<THREE.MeshBasicMaterial>(null);
  const dome = useRef<THREE.Mesh>(null);
  const col = useRef<THREE.Mesh>(null);
  const colMat = useRef<THREE.MeshBasicMaterial>(null);
  const shield = useMemo(() => (e.verdict === "BLOCK" ? createHexShieldMaterial(color) : null), [e.verdict, color]);
  useEffect(() => () => shield?.dispose(), [shield]);
  useFrame((state) => {
    const t = (performance.now() - e.born) / EFFECT_MS;
    const k = Math.min(1, Math.max(0, t));
    const ease = 1 - Math.pow(1 - k, 3);
    const maxR = e.verdict === "BLOCK" ? 34 : e.verdict === "CHALLENGE" ? 22 : 26;
    if (r1.current && m1.current) {
      r1.current.scale.setScalar(2 + ease * maxR);
      m1.current.opacity = (1 - k) * 0.95;
    }
    if (r2.current && m2.current) {
      const k2 = Math.min(1, Math.max(0, t - 0.18) / 0.82);
      const e2 = 1 - Math.pow(1 - k2, 3);
      r2.current.scale.setScalar(1 + e2 * maxR * 0.7);
      m2.current.opacity = k2 > 0 ? (1 - k2) * 0.7 : 0;
    }
    if (col.current && colMat.current) {
      col.current.scale.set(1, 0.2 + ease * 1.0, 1);
      colMat.current.opacity = (1 - k) * (e.verdict === "CHALLENGE" ? 0.55 : 0.35);
    }
    if (dome.current && shield) {
      const s = 3 + ease * 9;
      dome.current.scale.set(s, s, s);
      shield.uniforms.uTime.value = state.clock.elapsedTime;
      shield.uniforms.uOpacity.value = (1 - k) * 1.2;
    }
  });
  return (
    <group position={[e.x, 0.3, e.z]}>
      <mesh ref={r1} geometry={fxRing} renderOrder={9}>
        <meshBasicMaterial ref={m1} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={r2} geometry={fxRing} renderOrder={9}>
        <meshBasicMaterial ref={m2} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={col} position={[0, 12, 0]} renderOrder={9}>
        <cylinderGeometry args={[1.2, 2.2, 24, 16, 1, true]} />
        <meshBasicMaterial ref={colMat} color={color} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
      {shield && (
        <mesh ref={dome} material={shield} renderOrder={9}>
          <sphereGeometry args={[1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      )}
    </group>
  );
}

export function Effects() {
  const effects = useStore((s) => s.effects);
  const live = effects.filter((e) => performance.now() - e.born < EFFECT_MS + 200);
  return (
    <group>
      {live.map((e) => (
        <Effect key={e.key} e={e} />
      ))}
    </group>
  );
}
