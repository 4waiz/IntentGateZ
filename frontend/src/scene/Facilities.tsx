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

let badgeTex: Record<string, THREE.CanvasTexture> = {};

function badgeTexture(color: string): THREE.CanvasTexture {
  if (badgeTex[color]) return badgeTex[color];
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const g = cv.getContext("2d");
  if (g) {
    const c = size / 2;
    const glow = g.createRadialGradient(c, c, size * 0.18, c, c, size * 0.5);
    glow.addColorStop(0, `${color}cc`);
    glow.addColorStop(0.55, `${color}33`);
    glow.addColorStop(1, `${color}00`);
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
    g.beginPath();
    g.arc(c, c, size * 0.27, 0, Math.PI * 2);
    g.fillStyle = `${color}55`;
    g.fill();
    g.lineWidth = size * 0.04;
    g.strokeStyle = color;
    g.stroke();
    g.fillStyle = "#ffffff";
    const arm = size * 0.07;
    const len = size * 0.17;
    g.fillRect(c - arm, c - len, arm * 2, len * 2);
    g.fillRect(c - len, c - arm, len * 2, arm * 2);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  badgeTex[color] = t;
  return t;
}

const Hospital = memo(function Hospital({ pos, h, purchases }: { pos: [number, number]; h: HospitalState; purchases: Purchase[] }) {
  const beamMat = useMemo(() => createBeamMaterial(STATUS_COLOR[h.status], 0.5), [h.status]);
  const badge = useRef<THREE.SpriteMaterial>(null);
  useEffect(() => () => beamMat.dispose(), [beamMat]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    beamMat.uniforms.uTime.value = t;
    if (badge.current) badge.current.opacity = 0.82 + 0.18 * Math.sin(t * (h.status === "diverting" ? 5 : 2.2));
  });
  const c = STATUS_COLOR[h.status];
  return (
    <group position={[pos[0], 0.32, pos[1]]}>
      {/* invisible hover target over the campus */}
      <mesh position={[0, 7, 0]} onPointerOver={() => setState({ hovered: { type: "hospital", id: h.id } })} onPointerOut={() => setState({ hovered: null })}>
        <boxGeometry args={[20, 14, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* campus status ring */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[12.2, 12.6, 72]} />
        <meshBasicMaterial color={new THREE.Color(c).multiplyScalar(1.6)} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {/* glowing status badge with cross */}
      <sprite position={[0, 18.5, 0]} scale={[5.2, 5.2, 1]}>
        <spriteMaterial ref={badge} map={badgeTexture(c)} transparent depthWrite={false} toneMapped={false} color={new THREE.Color(1.6, 1.6, 1.6)} />
      </sprite>
      <mesh position={[0, 18.5 + 14, 0]} material={beamMat}>
        <cylinderGeometry args={[0.35, 0.9, 26, 16, 1, true]} />
      </mesh>
      <SceneLabel position={[0, 24, 0]} minScale={0.8} z={24}>
        <HospitalLabel h={h} purchases={purchases} />
      </SceneLabel>
    </group>
  );
});

const Station = memo(function Station({ pos, name }: { pos: [number, number]; name: string }) {
  return (
    <group position={[pos[0], 0.32, pos[1]]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]}>
        <ringGeometry args={[7.6, 7.9, 64]} />
        <meshBasicMaterial color={new THREE.Color("#ff8a4c").multiplyScalar(1.5)} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <SceneLabel position={[0, 13, 0]} hideBeyond={560} z={21}>
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
