import { memo, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { HospitalState, Purchase } from "../api/types";
import { type CityIndex, facilityWorld } from "../lib/geo";
import { money } from "../lib/format";
import { SUPPLIERS } from "../lib/constants";
import { setState, useStore } from "../store/store";
import { createBeamMaterial } from "./materials";
import { SceneLabel } from "./SceneLabel";

let towerTex: { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } | null = null;

function towerTextures() {
  if (towerTex) return towerTex;
  const w = 128;
  const h = 160;
  const mk = () => {
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    return cv;
  };
  const a = mk();
  const e = mk();
  const ca = a.getContext("2d");
  const ce = e.getContext("2d");
  if (ca && ce) {
    ca.fillStyle = "#d4dee8";
    ca.fillRect(0, 0, w, h);
    ce.fillStyle = "#000";
    ce.fillRect(0, 0, w, h);
    for (let y = 10; y < h - 8; y += 24) {
      ca.fillStyle = "#13273a";
      ca.fillRect(0, y, w, 13);
      for (let x = 0; x < w; x += 16) {
        ca.fillStyle = "#c9d5e0";
        ca.fillRect(x, y, 2, 13);
        if (Math.sin(x * 12.9898 + y * 78.233) > 0.1) {
          ce.fillStyle = Math.sin(x + y) > 0.6 ? "#ffe3b0" : "#b9e6ff";
          ce.fillRect(x + 3, y + 2, 11, 9);
        }
      }
    }
  }
  const map = new THREE.CanvasTexture(a);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(e);
  emissive.colorSpace = THREE.SRGBColorSpace;
  towerTex = { map, emissive };
  return towerTex;
}

const STATUS_COLOR = { accepting: "#00D5B5", diverting: "#FFBC5C" } as const;

function HospitalLabel({ h, purchases }: { h: HospitalState; purchases: Purchase[] }) {
  const c = STATUS_COLOR[h.status];
  const inbound = purchases.filter((p) => p.delivery_hospital_id === h.id);
  const inboundTotal = inbound.reduce((s, p) => s + p.total_usd, 0);
  return (
    <div className="ig-scene-label rounded-[4px] border bg-[#07111c]/85 px-2 py-1 shadow-[0_4px_18px_rgba(0,0,0,0.5)] backdrop-blur-[2px]" style={{ borderColor: `${c}55` }}>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
        <span className="text-[10.5px] font-semibold tracking-[0.06em] text-[#E8F0F7] uppercase">{h.name}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-[#8496A8]">
        <span style={{ color: c }} className="font-sans font-semibold tracking-[0.08em]">
          {h.status === "diverting" ? "DIVERTING" : "ACCEPTING"}
        </span>
        <span>
          BEDS <span className="text-[#C3D0DC]">{h.beds_available}</span>/{h.beds_total}
        </span>
        <span>
          ICU <span className="text-[#C3D0DC]">{h.icu_available}</span>/{h.icu_total}
        </span>
      </div>
      {inbound.length > 0 && (
        <div className="mt-0.5 font-mono text-[9.5px] text-[#00D5B5]">
          PO {money(inboundTotal)} · {SUPPLIERS[inbound[inbound.length - 1].supplier_id] ?? inbound[inbound.length - 1].supplier_id}
        </div>
      )}
    </div>
  );
}

const Hospital = memo(function Hospital({ pos, h, purchases }: { pos: [number, number]; h: HospitalState; purchases: Purchase[] }) {
  const { map, emissive } = towerTextures();
  const beamMat = useMemo(() => createBeamMaterial(STATUS_COLOR[h.status], 0.55), [h.status]);
  const orb = useRef<THREE.MeshBasicMaterial>(null);
  useEffect(() => () => beamMat.dispose(), [beamMat]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    beamMat.uniforms.uTime.value = t;
    if (orb.current) orb.current.opacity = 0.65 + 0.35 * Math.sin(t * (h.status === "diverting" ? 5 : 2.2));
  });
  const c = STATUS_COLOR[h.status];
  return (
    <group position={[pos[0], 0.32, pos[1]]}>
      <mesh position={[0, 0.05, 0]} onPointerOver={() => setState({ hovered: { type: "hospital", id: h.id } })} onPointerOut={() => setState({ hovered: null })}>
        <boxGeometry args={[27, 0.1, 27]} />
        <meshStandardMaterial color="#0d2230" roughness={0.9} />
      </mesh>
      {/* podium */}
      <mesh position={[0, 1.7, 1.5]}>
        <boxGeometry args={[20, 3.4, 14]} />
        <meshStandardMaterial color="#b9c7d4" roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[0, 3.45, 1.5]}>
        <boxGeometry args={[20.3, 0.36, 14.3]} />
        <meshStandardMaterial color="#00d5b5" emissive="#00d5b5" emissiveIntensity={0.55} roughness={0.4} />
      </mesh>
      {/* entrance canopy */}
      <mesh position={[0, 1.2, 9.2]}>
        <boxGeometry args={[7, 0.3, 2.6]} />
        <meshStandardMaterial color="#e8f0f7" emissive="#9fdcff" emissiveIntensity={0.25} />
      </mesh>
      {/* tower */}
      <mesh position={[-2.2, 3.6 + 6.2, -1.2]}>
        <boxGeometry args={[10, 12.4, 9]} />
        <meshStandardMaterial map={map} emissiveMap={emissive} emissive="#ffffff" emissiveIntensity={0.55} roughness={0.5} />
      </mesh>
      {/* red cross emblems (south and east faces) */}
      <group position={[-2.2, 13.4, 3.32]}>
        <mesh>
          <boxGeometry args={[3.2, 0.95, 0.12]} />
          <meshStandardMaterial color="#ff3b4e" emissive="#ff3b4e" emissiveIntensity={1.1} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.95, 3.2, 0.12]} />
          <meshStandardMaterial color="#ff3b4e" emissive="#ff3b4e" emissiveIntensity={1.1} />
        </mesh>
      </group>
      <group position={[2.86, 13.4, -1.2]} rotation-y={Math.PI / 2}>
        <mesh>
          <boxGeometry args={[3.2, 0.95, 0.12]} />
          <meshStandardMaterial color="#ff3b4e" emissive="#ff3b4e" emissiveIntensity={1.1} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.95, 3.2, 0.12]} />
          <meshStandardMaterial color="#ff3b4e" emissive="#ff3b4e" emissiveIntensity={1.1} />
        </mesh>
      </group>
      {/* rooftop helipad */}
      <group position={[-2.2, 16.05, -1.2]}>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[3.6, 40]} />
          <meshStandardMaterial color="#1a2a39" roughness={0.8} />
        </mesh>
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
          <ringGeometry args={[3.0, 3.35, 48]} />
          <meshBasicMaterial color="#e8f0f7" />
        </mesh>
        <mesh position={[-0.7, 0.05, 0]}>
          <boxGeometry args={[0.32, 0.05, 2.2]} />
          <meshBasicMaterial color="#e8f0f7" />
        </mesh>
        <mesh position={[0.7, 0.05, 0]}>
          <boxGeometry args={[0.32, 0.05, 2.2]} />
          <meshBasicMaterial color="#e8f0f7" />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[1.4, 0.05, 0.32]} />
          <meshBasicMaterial color="#e8f0f7" />
        </mesh>
      </group>
      {/* status beacon + light column */}
      <group position={[3.4, 3.6, -5.6]}>
        <mesh position={[0, 3.2, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 6.4, 6]} />
          <meshStandardMaterial color="#5b6c7e" />
        </mesh>
        <mesh position={[0, 6.8, 0]}>
          <sphereGeometry args={[0.75, 16, 12]} />
          <meshBasicMaterial ref={orb} color={c} transparent />
        </mesh>
        <mesh position={[0, 6.8 + 17, 0]} material={beamMat}>
          <cylinderGeometry args={[0.45, 1.1, 34, 16, 1, true]} />
        </mesh>
      </group>
      <SceneLabel position={[0, 22, 0]} minScale={0.8} z={24}>
        <HospitalLabel h={h} purchases={purchases} />
      </SceneLabel>
    </group>
  );
});

const Station = memo(function Station({ pos, name }: { pos: [number, number]; name: string }) {
  return (
    <group position={[pos[0], 0.32, pos[1]]}>
      <mesh position={[0, 1.6, 0]}>
        <boxGeometry args={[15, 3.2, 10]} />
        <meshStandardMaterial color="#2a3746" roughness={0.75} />
      </mesh>
      <mesh position={[0, 2.5, 0]}>
        <boxGeometry args={[15.15, 0.45, 10.15]} />
        <meshStandardMaterial color="#ff8a4c" emissive="#ff8a4c" emissiveIntensity={0.7} />
      </mesh>
      {[-4.6, 0, 4.6].map((x) => (
        <mesh key={x} position={[x, 1.1, 5.02]}>
          <boxGeometry args={[3.6, 2.2, 0.08]} />
          <meshStandardMaterial color="#0e1a26" emissive="#2a5a80" emissiveIntensity={0.25} />
        </mesh>
      ))}
      <mesh position={[0, 3.35, 0]}>
        <boxGeometry args={[13.5, 0.25, 8.5]} />
        <meshStandardMaterial color="#1c2733" />
      </mesh>
      <SceneLabel position={[0, 7.5, 0]} hideBeyond={560} z={21}>
        <div className="ig-scene-label rounded-[3px] border border-[#ff8a4c]/40 bg-[#07111c]/80 px-1.5 py-[2px] text-[9px] font-semibold tracking-[0.1em] text-[#ffb48a] uppercase">
          {name}
        </div>
      </SceneLabel>
    </group>
  );
});

export function Facilities({ idx }: { idx: CityIndex }) {
  const hospitals = useStore((s) => s.sim?.hospitals);
  const purchases = useStore((s) => s.sim?.purchases);
  const hospitalKey = hospitals?.map((h) => `${h.id}:${h.status}:${h.beds_available}:${h.icu_available}`).join("|");
  const purchaseKey = purchases?.map((p) => p.action_id).join("|");
  // Re-render facilities only when their data actually changes.
  const stableHospitals = useMemo(() => hospitals ?? [], [hospitalKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const stablePurchases = useMemo(() => purchases ?? [], [purchaseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      {stableHospitals.map((h) => {
        const ch = idx.hospitals.get(h.id);
        const pos = ch ? facilityWorld(idx, ch.node) : null;
        return pos ? <Hospital key={h.id} pos={pos} h={h} purchases={stablePurchases} /> : null;
      })}
      {idx.city.stations.map((s) => {
        const pos = facilityWorld(idx, s.node);
        return pos ? <Station key={s.id} pos={pos} name={s.name} /> : null;
      })}
      <AccessRoads idx={idx} />
    </group>
  );
}

/** Short driveways linking each facility to the junction it is registered at. */
function AccessRoads({ idx }: { idx: CityIndex }) {
  const segs = useMemo(() => {
    const out: { x: number; z: number; len: number; rot: number }[] = [];
    const nodes = [...idx.city.hospitals.map((h) => h.node), ...idx.city.stations.map((s) => s.node)];
    for (const n of nodes) {
      const a = idx.nodeWorld.get(n);
      const b = facilityWorld(idx, n);
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) * 0.62;
      out.push({ x: a[0] + (dx / Math.hypot(dx, dz)) * len * 0.5, z: a[1] + (dz / Math.hypot(dx, dz)) * len * 0.5, len, rot: Math.atan2(dx, dz) });
    }
    return out;
  }, [idx]);
  return (
    <group>
      {segs.map((s, i) => (
        <mesh key={i} position={[s.x, 0.36, s.z]} rotation={[-Math.PI / 2, 0, s.rot]}>
          <planeGeometry args={[1.6, s.len]} />
          <meshBasicMaterial color="#13283a" />
        </mesh>
      ))}
    </group>
  );
}
