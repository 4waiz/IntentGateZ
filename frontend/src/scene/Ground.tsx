import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import * as THREE from "three";
import { type CityIndex, toWorld } from "../lib/geo";
import { createRoadMaterial, createWaterMaterial } from "./materials";
import { buildRoadGeometry, ROAD_WIDTH, ROAD_Y } from "./geometry";
import type { Quality } from "../store/store";

const DISTRICT_TINT: Record<string, string> = {
  harbor: "#1b5fd1",
  financial: "#2f7cff",
  medical: "#00d5b5",
  industrial: "#8a7356",
  university: "#7fb0ff",
  old_town: "#8f7a63",
  residential: "#8496a8",
};

export function Ground({ idx, quality }: { idx: CityIndex; quality: Quality }) {
  const w = idx.halfW * 2;
  const d = idx.halfD * 2;
  const water = useMemo(() => createWaterMaterial(), []);
  useEffect(() => () => water.dispose(), [water]);
  useFrame((_, dt) => {
    water.uniforms.uTime.value += dt;
  });

  // District tint pads + block plinths: two instanced meshes.
  const { plinths, tints } = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const plinthMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: "#09131e", roughness: 0.95, metalness: 0 }), idx.blocks.length);
    const tintGeo = new THREE.PlaneGeometry(1, 1);
    tintGeo.rotateX(-Math.PI / 2);
    const tintMesh = new THREE.InstancedMesh(
      tintGeo,
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: quality === "high" ? 0.05 : 0.075, depthWrite: false }),
      idx.blocks.length,
    );
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    const s = idx.city.spacing_m / 10;
    idx.blocks.forEach((b, i) => {
      const [x, z] = toWorld(b.x, b.z);
      m.makeScale(s - 4.6, 0.32, s - 4.6).setPosition(x, 0, z);
      plinthMesh.setMatrixAt(i, m);
      m.makeScale(s - 5.6, 1, s - 5.6).setPosition(x, 0.34, z);
      tintMesh.setMatrixAt(i, m);
      tintMesh.setColorAt(i, col.set(DISTRICT_TINT[b.district] ?? "#8496a8"));
    });
    plinthMesh.instanceMatrix.needsUpdate = true;
    tintMesh.instanceMatrix.needsUpdate = true;
    if (tintMesh.instanceColor) tintMesh.instanceColor.needsUpdate = true;
    return { plinths: plinthMesh, tints: tintMesh };
  }, [idx, quality]);

  useEffect(
    () => () => {
      plinths.geometry.dispose();
      (plinths.material as THREE.Material).dispose();
      tints.geometry.dispose();
      (tints.material as THREE.Material).dispose();
    },
    [plinths, tints],
  );

  return (
    <group>
      {/* city slab */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]}>
        <planeGeometry args={[w + 120, d + 120]} />
        <meshBasicMaterial color="#07111b" />
      </mesh>
      {/* outer ground */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.08, 0]}>
        <planeGeometry args={[2600, 2600]} />
        <meshBasicMaterial color="#050b12" />
      </mesh>
      {/* harbour water on the west edge */}
      <mesh rotation-x={-Math.PI / 2} position={[-idx.halfW - 60 - 9, 0.0, 0]} material={water}>
        <planeGeometry args={[120, d + 260]} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-idx.halfW - 9.2, 0.03, 0]}>
        <planeGeometry args={[0.35, d + 260]} />
        <meshBasicMaterial color="#1e8fbf" transparent opacity={0.55} />
      </mesh>
      {quality !== "low" && (
        <Grid
          position={[0, 0.012, 0]}
          args={[w + 120, d + 120]}
          cellSize={4}
          cellThickness={0.5}
          cellColor="#0e2231"
          sectionSize={40}
          sectionThickness={0.9}
          sectionColor="#123247"
          fadeDistance={900}
          fadeStrength={1.2}
          infiniteGrid={false}
        />
      )}
      <primitive object={plinths} />
      <primitive object={tints} />
    </group>
  );
}

export function Roads({ idx, quality }: { idx: CityIndex; quality: Quality }) {
  const geo = useMemo(() => buildRoadGeometry(idx), [idx]);
  const mat = useMemo(() => createRoadMaterial(), []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useEffect(() => {
    mat.uniforms.uFlow.value = quality === "low" ? 0 : 1;
  }, [mat, quality]);
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
  });

  // Junction pads sized by the widest road meeting there.
  const pads = useMemo(() => {
    const widest = new Map<string, number>();
    for (const e of idx.city.edges) {
      const wv = ROAD_WIDTH[e.road_class];
      widest.set(e.a, Math.max(widest.get(e.a) ?? 0, wv));
      widest.set(e.b, Math.max(widest.get(e.b) ?? 0, wv));
    }
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: "#1b2c3c" }), idx.city.nodes.length);
    const m = new THREE.Matrix4();
    idx.city.nodes.forEach((n, i) => {
      const p = idx.nodeWorld.get(n.id) ?? [0, 0];
      const s = (widest.get(n.id) ?? 2) + 0.6;
      m.makeScale(s, 1, s).setPosition(p[0], ROAD_Y + 0.004, p[1]);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [idx]);
  useEffect(
    () => () => {
      pads.geometry.dispose();
      (pads.material as THREE.Material).dispose();
    },
    [pads],
  );

  return (
    <group>
      <mesh geometry={geo} material={mat} />
      <primitive object={pads} />
    </group>
  );
}
