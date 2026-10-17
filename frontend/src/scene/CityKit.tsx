/**
 * The built city: kit buildings (lit-window night shader), hospitals and EMS stations, palms,
 * streetlights and a distant skyline, all GPU-instanced (one shared geometry per model variant and
 * material, per-instance transform / stone tint / window seed). Layout is deterministic from the
 * backend city graph: every block gets a district recipe; facility blocks keep their campus free.
 * Decorative only: nothing here is state the gateway controls.
 */
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { type CityIndex, facilityWorld, toWorld } from "../lib/geo";
import type { Quality } from "../store/store";
import { seededRandom } from "./geometry";
import { type Kit, kitAssets, kitNode, useKit } from "./kit/kit";
import { collectTemplates, type Template } from "./kit/merge";
import { bridges, streetLamps, waterfront } from "./streetscape";
import { createKitMaterial } from "./kit/kitMaterials";

/** World units per kit metre (1 unit = 10 m; buildings are drawn ~2.4x for legibility). */
export const KIT = 0.24;
export const GROUND_Y = 0.32;
const LOT_N = 5;

type Style = 0 | 1 | 2 | 3; // 0 home, 1 office, 2 skyline, 3 facility

interface Placement {
  file: string;
  node: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  style: Style;
  tint: [number, number, number];
  top?: number;
}

const TINT: Record<string, [number, number, number]> = {
  white: [1, 1, 1],
  cream: [1, 0.95, 0.88],
  beige: [0.94, 0.86, 0.75],
  sand: [0.9, 0.82, 0.68],
};

interface Recipe {
  kinds: [string, number][];
  h: [number, number];
  skip: number;
  inner: "courtyard" | "tower" | "dense" | "plaza";
}

const RECIPES: Record<string, Recipe> = {
  financial: { kinds: [["tower-office", 0.46], ["tower-residential", 0.18], ["commercial-podium", 0.2], ["midrise-residential", 0.16]], h: [0.95, 1.25], skip: 0.08, inner: "tower" },
  medical: { kinds: [["midrise-residential", 0.42], ["commercial-podium", 0.3], ["lowrise-residential", 0.28]], h: [0.9, 1.15], skip: 0.12, inner: "courtyard" },
  residential: { kinds: [["midrise-residential", 0.36], ["tower-residential", 0.22], ["lowrise-residential", 0.34], ["villa", 0.08]], h: [0.85, 1.2], skip: 0.1, inner: "courtyard" },
  old_town: { kinds: [["lowrise-residential", 0.62], ["villa", 0.26], ["midrise-residential", 0.12]], h: [0.8, 1.05], skip: 0.06, inner: "dense" },
  harbor: { kinds: [["lowrise-residential", 0.4], ["commercial-podium", 0.38], ["midrise-residential", 0.22]], h: [0.85, 1.1], skip: 0.12, inner: "plaza" },
  industrial: { kinds: [["commercial-podium", 0.62], ["lowrise-residential", 0.38]], h: [0.7, 0.95], skip: 0.18, inner: "plaza" },
  university: { kinds: [["midrise-residential", 0.38], ["commercial-podium", 0.3], ["lowrise-residential", 0.2], ["tower-residential", 0.12]], h: [0.9, 1.15], skip: 0.12, inner: "courtyard" },
  outer: { kinds: [["midrise-residential", 0.4], ["lowrise-residential", 0.35], ["tower-residential", 0.15], ["commercial-podium", 0.1]], h: [0.8, 1.15], skip: 0.22, inner: "courtyard" },
};

function pick<T>(rnd: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export interface CityLayout {
  buildings: Placement[];
  palms: { x: number; z: number; s: number; rot: number; v: number }[];
  skyline: Placement[];
}

/** Block centres for the operational grid plus a decorative ring to the north and east. */
function blockCentres(idx: CityIndex): { x: number; z: number; district: string; outer: boolean; id: string; bias: number }[] {
  const s = idx.city.spacing_m;
  const out: { x: number; z: number; district: string; outer: boolean; id: string; bias: number }[] = [];
  for (const b of idx.blocks) {
    const [x, z] = toWorld(b.x, b.z);
    out.push({ x, z, district: b.district, outer: false, id: b.id, bias: b.height_bias });
  }
  const rows = idx.city.rows;
  const cols = idx.city.cols;
  for (let r = rows - 1; r < rows + 1; r++)
    for (let c = 0; c < cols + 1; c++) {
      const [x, z] = toWorld((c + 0.5) * s, (r + 0.5) * s);
      out.push({ x, z, district: "outer", outer: true, id: `o_${r}_${c}`, bias: 1 });
    }
  for (let r = 0; r < rows - 1; r++)
    for (let c = cols - 1; c < cols + 1; c++) {
      const [x, z] = toWorld((c + 0.5) * s, (r + 0.5) * s);
      out.push({ x, z, district: "outer", outer: true, id: `o_${r}_${c}`, bias: 1 });
    }
  return out;
}

export function buildLayout(idx: CityIndex, kit: Kit, quality: Quality): CityLayout {
  const S = idx.city.spacing_m / 10;
  const plinth = S - 4.6;
  const usable = plinth - 1.6;
  const lot = usable / LOT_N;
  const buildings: Placement[] = [];
  const palms: CityLayout["palms"] = [];

  const variantsByKind = new Map<string, { file: string; node: string; tint: [number, number, number]; size: [number, number, number] }[]>();
  for (const kind of ["tower-office", "tower-residential", "midrise-residential", "lowrise-residential", "villa", "commercial-podium"]) {
    variantsByKind.set(
      kind,
      kitAssets(kit, kind).map((a) => ({ file: a.file, node: a.node, tint: TINT[a.stoneTint ?? "white"] ?? TINT.white, size: a.nominalSize ?? [20, 18, 30] })),
    );
  }

  // facility campuses
  const facilities: { x: number; z: number; r: number }[] = [];
  const hospitalAsset = kitAssets(kit, "hospital")[0];
  const opsAsset = kitAssets(kit, "emergency-ops")[0];
  for (const h of idx.city.hospitals) {
    const p = facilityWorld(idx, h.node);
    if (!p || !hospitalAsset) continue;
    const sc = KIT * 1.45;
    buildings.push({ file: hospitalAsset.file, node: hospitalAsset.node, x: p[0], y: GROUND_Y, z: p[1], rot: 0, sx: sc, sy: sc, sz: sc, style: 3, tint: [1, 1, 1] });
    facilities.push({ x: p[0], z: p[1], r: 11.5 });
  }
  for (const st of idx.city.stations) {
    const p = facilityWorld(idx, st.node);
    if (!p || !opsAsset) continue;
    const sc = KIT * 1.1;
    buildings.push({ file: opsAsset.file, node: opsAsset.node, x: p[0], y: GROUND_Y, z: p[1], rot: 0, sx: sc, sy: sc, sz: sc, style: 3, tint: [0.92, 0.9, 0.86] });
    facilities.push({ x: p[0], z: p[1], r: 8.5 });
  }
  const nearFacility = (x: number, z: number, pad: number) => facilities.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + pad);

  const officeComplex = kitAssets(kit, "office-complex")[0];
  const density = quality === "low" ? 0.55 : 1;

  for (const b of blockCentres(idx)) {
    const rnd = seededRandom(b.id);
    const rec = RECIPES[b.district] ?? RECIPES.residential;
    const outer = b.outer;
    if (outer && quality === "low") continue;
    // landmark blocks
    let innerTaken = false;
    if (!outer && b.district === "financial" && officeComplex && rnd() < 0.45 && !nearFacility(b.x, b.z, 4)) {
      const sc = KIT * 1.15 * (b.bias > 2 ? 1.12 : 1);
      buildings.push({ file: officeComplex.file, node: officeComplex.node, x: b.x, y: GROUND_Y, z: b.z, rot: rnd() < 0.5 ? 0 : Math.PI / 2, sx: sc, sy: sc * (1 + rnd() * 0.25), sz: sc, style: 1, tint: [1, 1, 1] });
      innerTaken = true;
    }
    for (let i = 0; i < LOT_N; i++) {
      for (let j = 0; j < LOT_N; j++) {
        const perimeter = i === 0 || j === 0 || i === LOT_N - 1 || j === LOT_N - 1;
        const x = b.x - usable / 2 + lot * (i + 0.5);
        const z = b.z - usable / 2 + lot * (j + 0.5);
        if (nearFacility(x, z, 1.2)) continue;
        const r0 = rnd();
        if (!perimeter) {
          if (innerTaken) continue;
          if (outer && r0 < 0.6) continue;
          if (rec.inner === "courtyard" || (rec.inner === "plaza" && r0 < 0.7)) {
            if (i === 2 && j === 2 && quality !== "low") {
              for (let k = 0; k < 4; k++) palms.push({ x: x + (rnd() - 0.5) * lot * 1.6, z: z + (rnd() - 0.5) * lot * 1.6, s: 0.85 + rnd() * 0.4, rot: rnd() * 6.28, v: Math.floor(rnd() * 3) });
            }
            if (rec.inner === "courtyard" && r0 < 0.75) continue;
            if (rec.inner === "plaza") continue;
          }
          if (rec.inner === "tower" && i === 2 && j === 2) {
            const v = variantsByKind.get(rnd() < 0.7 ? "tower-office" : "tower-residential") ?? [];
            const t = v[Math.floor(rnd() * v.length)];
            if (t) {
              const k = KIT * (1.12 + rnd() * 0.18);
              const syT = KIT * (1.05 + rnd() * 0.35) * Math.min(1.15, 0.6 + b.bias * 0.2);
              buildings.push({ file: t.file, node: t.node, x, y: GROUND_Y, z, rot: Math.floor(rnd() * 4) * (Math.PI / 2), sx: k, sy: syT, sz: k, style: 1, tint: t.tint, top: GROUND_Y + t.size[2] * syT });
            }
            continue;
          }
        }
        if (r0 < rec.skip || rnd() > density) {
          if (quality !== "low" && rnd() < 0.55) palms.push({ x: x + (rnd() - 0.5) * lot * 0.6, z: z + (rnd() - 0.5) * lot * 0.6, s: 0.8 + rnd() * 0.45, rot: rnd() * 6.28, v: Math.floor(rnd() * 3) });
          continue;
        }
        const kind = pick(rnd, rec.kinds);
        const v = variantsByKind.get(kind) ?? [];
        const t = v[Math.floor(rnd() * v.length)];
        if (!t) continue;
        // face the nearest street
        let rot = 0;
        if (j === LOT_N - 1) rot = 0;
        else if (j === 0) rot = Math.PI;
        else if (i === 0) rot = -Math.PI / 2;
        else if (i === LOT_N - 1) rot = Math.PI / 2;
        else rot = Math.floor(rnd() * 4) * (Math.PI / 2);
        const fit = Math.min(1.12, (lot * 0.86) / (Math.max(t.size[0], t.size[1]) * KIT));
        const fx = KIT * fit * (0.94 + rnd() * 0.12);
        const fz = KIT * fit * (0.94 + rnd() * 0.12);
        const hScale = rec.h[0] + rnd() * (rec.h[1] - rec.h[0]);
        const biasH = b.district === "financial" ? Math.min(1.15, 0.8 + b.bias * 0.12) : 1;
        const sy = KIT * hScale * biasH * (kind.startsWith("tower") ? 0.95 + rnd() * 0.3 : 1);
        const ox = (rnd() - 0.5) * lot * 0.08;
        const oz = (rnd() - 0.5) * lot * 0.08;
        const style: Style = kind === "tower-office" || kind === "commercial-podium" ? 1 : 0;
        buildings.push({ file: t.file, node: t.node, x: x + ox, y: GROUND_Y, z: z + oz, rot, sx: fx, sy, sz: fz, style, tint: t.tint, top: GROUND_Y + t.size[2] * sy });
      }
    }
  }

  // promenade palms along the river and the harbour quay
  const wf = waterfront(idx);
  if (quality !== "low") {
    for (let x = -idx.halfW - 2; x < idx.halfW + 110; x += 7) {
      if (bridges(idx).some((b) => Math.abs(b.x - x) < 5)) continue;
      palms.push({ x, z: wf.riverN - 3.2, s: 0.95, rot: x * 1.7, v: Math.abs(Math.round(x)) % 3 });
    }
    for (let z = -idx.halfD - 90; z < wf.riverN - 4; z += 7) palms.push({ x: wf.seaE + 3.6, z: z + 3.5, s: 0.9, rot: z * 1.3, v: Math.abs(Math.round(z)) % 3 });
    for (let x = -idx.halfW - 40; x < idx.halfW + 110; x += 9) palms.push({ x, z: wf.riverS + 3.2, s: 0.9, rot: x * 0.7, v: Math.abs(Math.round(x * 3)) % 3 });
  }

  // distant skyline to the north-east
  const skyline: Placement[] = [];
  const sky = kitAssets(kit, "skyline");
  if (quality !== "low") {
    const rnd = seededRandom("skyline");
    sky.forEach((a, k) => {
      const ang = -0.95 + (k / Math.max(1, sky.length - 1)) * 1.4;
      const dist = 430 + rnd() * 110;
      const sc = 0.055 + rnd() * 0.02;
      skyline.push({ file: a.file, node: a.node, x: Math.sin(ang) * dist + 60, y: -0.2, z: -Math.cos(ang) * dist - 40, rot: rnd() * 6.28, sx: sc, sy: sc, sz: sc, style: 2, tint: [0.8, 0.84, 0.92] });
    });
  }

  return { buildings, palms, skyline };
}

/** Instanced meshes for a set of placements: one InstancedMesh per (node, material). */
function instancePlacements(kit: Kit, placements: Placement[], mats: Map<string, THREE.MeshStandardMaterial>, matFor: (name: string, src: THREE.Material) => THREE.MeshStandardMaterial, idBase: number): THREE.Object3D[] {
  const groups = new Map<string, Placement[]>();
  for (const p of placements) {
    const k = `${p.file}#${p.node}`;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const out: THREE.Object3D[] = [];
  const m = new THREE.Matrix4();
  const pm = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  let id = idBase;
  for (const [key, list] of groups) {
    const [file, node] = key.split("#");
    const root = kitNode(kit, file, node);
    if (!root) continue;
    const templates: Template[] = collectTemplates(root);
    const ids = new Float32Array(list.length);
    list.forEach((p, i) => (ids[i] = (id + i) * 4 + p.style));
    id += list.length;
    for (const t of templates) {
      const geo = t.geometry.clone();
      geo.setAttribute("aBld", new THREE.InstancedBufferAttribute(ids, 1));
      if (!geo.getAttribute("uv")) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
      if (!geo.getAttribute("color")) {
        const n = geo.getAttribute("position").count;
        geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      geo.setAttribute("aGrid", geo.getAttribute("uv"));
      let mat = mats.get(t.name);
      if (!mat) {
        mat = matFor(t.name, t.material);
        mats.set(t.name, mat);
      }
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        pos.set(p.x, p.y, p.z);
        scl.set(p.sx, p.sy, p.sz);
        pm.compose(pos, q, scl);
        m.multiplyMatrices(pm, t.matrix);
        im.setMatrixAt(i, m);
        im.setColorAt(i, color.setRGB(p.tint[0], p.tint[1], p.tint[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.frustumCulled = true;
      out.push(im);
    }
  }
  return out;
}

export function CityKit({ idx, quality, onLayout }: { idx: CityIndex; quality: Quality; onLayout?: (l: CityLayout | null) => void }) {
  const kit = useKit();
  const built = useMemo(() => {
    if (!kit) return null;
    const layout = buildLayout(idx, kit, quality);
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    const skyMats = new Map<string, THREE.MeshStandardMaterial>();
    const matFor = (name: string, src: THREE.Material) => createKitMaterial(name, src, kit.manifest);
    const skyFor = (name: string, src: THREE.Material) => createKitMaterial(name, src, kit.manifest, { skyline: true });
    const objects: THREE.Object3D[] = [];
    objects.push(...instancePlacements(kit, layout.buildings, mats, matFor, 1));
    objects.push(...instancePlacements(kit, layout.skyline, skyMats, skyFor, 9000));
    const palmAssets = kitAssets(kit, "palm");
    const palmPlacements: Placement[] = layout.palms.map((p) => {
      const a = palmAssets[p.v % Math.max(1, palmAssets.length)];
      const sc = KIT * 0.62 * p.s;
      return { file: a?.file ?? "palm.glb", node: a?.node ?? "palm_v0", x: p.x, y: GROUND_Y, z: p.z, rot: p.rot, sx: sc, sy: sc, sz: sc, style: 0, tint: [1, 1, 1] };
    });
    objects.push(...instancePlacements(kit, palmPlacements, mats, matFor, 20000));
    const lightAssets = kitAssets(kit, "streetlight");
    const lightPlacements: Placement[] = streetLamps(idx, quality).map((l) => {
      const a = lightAssets[l.v % Math.max(1, lightAssets.length)];
      const sc = KIT * 0.62;
      return { file: a?.file ?? "streetlight.glb", node: a?.node ?? "streetlight_v0", x: l.x, y: 0.06, z: l.z, rot: l.rot, sx: sc, sy: sc, sz: sc, style: 0, tint: [1, 1, 1] };
    });
    objects.push(...instancePlacements(kit, lightPlacements, mats, matFor, 40000));
    // blinking red aviation lights on the tallest roofs
    const tops = layout.buildings.filter((b) => (b.top ?? 0) > 11.5);
    const avMat = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ff2a2a").multiplyScalar(4), toneMapped: false, transparent: true });
    const av = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), avMat, Math.max(1, tops.length));
    const am = new THREE.Matrix4();
    tops.forEach((b, i) => av.setMatrixAt(i, am.makeTranslation(b.x, (b.top ?? 0) + 0.25, b.z)));
    av.count = tops.length;
    av.instanceMatrix.needsUpdate = true;
    objects.push(av);
    const group = new THREE.Group();
    for (const o of objects) group.add(o);
    return { group, mats: [...mats.values(), ...skyMats.values(), avMat], layout, avMat };
  }, [kit, idx, quality]);

  useEffect(() => {
    onLayout?.(built?.layout ?? null);
  }, [built, onLayout]);

  useFrame((state) => {
    if (built) built.avMat.opacity = Math.sin(state.clock.elapsedTime * 3.1) > 0.35 ? 1 : 0.08;
  });

  useEffect(
    () => () => {
      if (!built) return;
      built.group.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          im.geometry.dispose();
          im.dispose();
        }
      });
      for (const m of built.mats) m.dispose();
    },
    [built],
  );

  if (!built) return null;
  return <primitive object={built.group} />;
}
