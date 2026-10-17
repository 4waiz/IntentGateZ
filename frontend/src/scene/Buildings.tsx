import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { type CityIndex, toWorld } from "../lib/geo";
import type { Quality } from "../store/store";
import { createBuildingMaterial } from "./materials";
import { seededRandom } from "./geometry";

interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  seed: number;
  kind: number;
}

const LOW_RISE = new Set(["industrial", "harbor"]);

function layout(idx: CityIndex, quality: Quality): { boxes: Box[]; beacons: [number, number, number][] } {
  const boxes: Box[] = [];
  const beacons: [number, number, number][] = [];
  const usable = idx.city.spacing_m / 10 - 9;
  for (const b of idx.blocks) {
    if (b.reserved_for) continue;
    const rnd = seededRandom(b.id);
    const [cx, cz] = toWorld(b.x, b.z);
    const lowRise = LOW_RISE.has(b.district);
    const n = quality === "low" || lowRise ? 2 : 3;
    const lot = usable / n;
    const skip = quality === "low" ? 0.05 : lowRise ? 0.22 : 0.1;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const r0 = rnd();
        if (r0 < skip) continue;
        const fw = lot * (lowRise ? 0.7 + rnd() * 0.22 : 0.52 + rnd() * 0.34);
        const fd = lot * (lowRise ? 0.62 + rnd() * 0.3 : 0.52 + rnd() * 0.34);
        const ox = (rnd() - 0.5) * (lot - fw);
        const oz = (rnd() - 0.5) * (lot - fd);
        const x = cx - usable / 2 + lot * (i + 0.5) + ox;
        const z = cz - usable / 2 + lot * (j + 0.5) + oz;
        let h = (2.6 + Math.pow(rnd(), 1.55) * 9.8) * b.height_bias;
        if (lowRise) h *= 0.5;
        if (b.district === "old_town") h *= 0.8;
        h = Math.min(36, Math.max(1.8, h));
        const seed = rnd() * 100;
        boxes.push({ x, z, w: fw, d: fd, h, seed, kind: lowRise ? 1 : 0 });
        if (quality === "high" && !lowRise && h > 12 && rnd() < 0.55) {
          const h2 = Math.min(40, h + 2.5 + rnd() * 7);
          boxes.push({ x: x + (rnd() - 0.5) * fw * 0.15, z: z + (rnd() - 0.5) * fd * 0.15, w: fw * 0.6, d: fd * 0.6, h: h2, seed: seed + 7, kind: 0 });
          h = h2;
        }
        if (quality !== "low" && h > 21) beacons.push([x, h + 0.45, z]);
      }
    }
  }
  return { boxes, beacons };
}

export function Buildings({ idx, quality }: { idx: CityIndex; quality: Quality }) {
  const material = useMemo(() => createBuildingMaterial(), []);
  const { mesh, beaconMesh } = useMemo(() => {
    const { boxes, beacons } = layout(idx, quality);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const seeds = new Float32Array(boxes.length);
    const kinds = new Float32Array(boxes.length);
    boxes.forEach((b, i) => {
      seeds[i] = b.seed;
      kinds[i] = b.kind;
    });
    geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute("aKind", new THREE.InstancedBufferAttribute(kinds, 1));
    const im = new THREE.InstancedMesh(geo, material, boxes.length);
    const m = new THREE.Matrix4();
    boxes.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, 0.32, b.z);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();

    const bg = new THREE.SphereGeometry(0.28, 8, 6);
    const bm = new THREE.MeshBasicMaterial({ color: "#ff3b4e", transparent: true, opacity: 1 });
    const beaconsIm = new THREE.InstancedMesh(bg, bm, Math.max(1, beacons.length));
    beacons.forEach((p, i) => {
      m.makeTranslation(p[0], p[1] + 0.32, p[2]);
      beaconsIm.setMatrixAt(i, m);
    });
    beaconsIm.count = beacons.length;
    beaconsIm.instanceMatrix.needsUpdate = true;
    return { mesh: im, beaconMesh: beaconsIm };
  }, [idx, quality, material]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      beaconMesh.geometry.dispose();
      (beaconMesh.material as THREE.Material).dispose();
    },
    [mesh, beaconMesh],
  );
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    const bm = beaconMesh.material as THREE.MeshBasicMaterial;
    bm.opacity = Math.sin(t * 2.6) > 0.55 ? 1 : 0.12;
  });

  return (
    <group>
      <primitive object={mesh} />
      <primitive object={beaconMesh} />
    </group>
  );
}
