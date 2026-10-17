import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { type CityIndex, toWorld } from "../lib/geo";
import type { Quality } from "../store/store";
import { createRoadMaterial } from "./materials";
import { ROAD_Y } from "./geometry";
import { bridges, decorRoads, ROAD_W, type Segment, streetLamps, waterfront } from "./streetscape";
import { GROUND_Y } from "./CityKit";

const FOG_PARS_V = "#include <fog_pars_vertex>";
const FOG_PARS_F = "#include <fog_pars_fragment>";

function withFog<T extends Record<string, THREE.IUniform>>(u: T): T {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, u]) as T;
}

function createWater(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: withFog({
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color("#020a12") },
      uSky: { value: new THREE.Color("#0e2c4a") },
      uGlow: { value: new THREE.Color("#ffc58a") },
      uCool: { value: new THREE.Color("#2b8fd8") },
      uRiverN: { value: 0 },
      uSeaE: { value: 0 },
    }),
    vertexShader: /* glsl */ `
      ${FOG_PARS_V}
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_PARS_F}
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uSky;
      uniform vec3 uGlow;
      uniform vec3 uCool;
      uniform float uRiverN;
      uniform float uSeaE;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        float r = sin(p.x * 0.31 + uTime * 0.55) * 0.5 + sin(p.y * 0.47 - uTime * 0.42) * 0.5 + sin((p.x + p.y) * 0.9 + uTime * 0.8) * 0.3 + sin((p.x - p.y) * 1.7 - uTime * 1.1) * 0.15;
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        vec3 col = mix(uDeep, uSky, 0.18 + 0.6 * fres);
        // reflected city glow hugging the quays
        float dN = max(vW.z - uRiverN, 0.0);
        float dE = max(uSeaE - vW.x, 0.0);
        float band = exp(-dN / 5.5) * step(uSeaE, vW.x) + exp(-dE / 5.5) * step(vW.z, uRiverN);
        float shimmer = 0.55 + 0.45 * sin(p.x * 2.3 + p.y * 1.7 + r * 3.0 + uTime * 1.6);
        col += uGlow * band * (0.75 + 0.25 * shimmer) * 0.06;
        col += uCool * exp(-dN / 2.0) * step(uSeaE, vW.x) * 0.12;
        col *= 0.92 + 0.08 * r;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

function createStreak(color: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        vUv = uv;
        vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        float across = 1.0 - smoothstep(0.0, 0.5, abs(vUv.x - 0.5));
        float along = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y));
        float wav = 0.55 + 0.45 * smoothstep(0.2, 0.8, sin(vUv.y * 38.0 - uTime * 2.4 + vSeed * 17.0) * 0.5 + 0.5);
        float a = across * along * wav * 0.55;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

function createPool(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#ffaa55") }, uStrength: { value: 0.62 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(1.0 - d, 0.0), 2.2) * uStrength;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

/** Block centres (operational + decorative ring) for plinths. */
function plinthCentres(idx: CityIndex): [number, number][] {
  const s = idx.city.spacing_m;
  const out: [number, number][] = idx.blocks.map((b) => toWorld(b.x, b.z));
  const rows = idx.city.rows;
  const cols = idx.city.cols;
  for (let r = rows - 1; r < rows + 1; r++) for (let c = 0; c < cols + 1; c++) out.push(toWorld((c + 0.5) * s, (r + 0.5) * s));
  for (let r = 0; r < rows - 1; r++) for (let c = cols - 1; c < cols + 1; c++) out.push(toWorld((c + 0.5) * s, (r + 0.5) * s));
  return out;
}

export function Ground({ idx, quality }: { idx: CityIndex; quality: Quality }) {
  const wf = waterfront(idx);
  const water = useMemo(() => createWater(), []);
  const streakWarm = useMemo(() => createStreak("#ffb06a"), []);
  const pool = useMemo(() => createPool(), []);
  useEffect(() => {
    water.uniforms.uRiverN.value = wf.riverN;
    water.uniforms.uSeaE.value = wf.seaE;
  }, [water, wf.riverN, wf.seaE]);
  useEffect(
    () => () => {
      water.dispose();
      streakWarm.dispose();
      pool.dispose();
    },
    [water, streakWarm, pool],
  );
  useFrame((_, dt) => {
    water.uniforms.uTime.value += dt;
    streakWarm.uniforms.uTime.value += dt;
  });

  const plinths = useMemo(() => {
    const centres = plinthCentres(idx);
    const s = idx.city.spacing_m / 10;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: "#151f2a", roughness: 0.92, metalness: 0.02 });
    const mesh = new THREE.InstancedMesh(geo, mat, centres.length);
    const curbGeo = new THREE.BoxGeometry(1, 1, 1);
    curbGeo.translate(0, 0.5, 0);
    const curb = new THREE.InstancedMesh(curbGeo, new THREE.MeshStandardMaterial({ color: "#26323e", roughness: 0.85 }), centres.length);
    const m = new THREE.Matrix4();
    centres.forEach(([x, z], i) => {
      m.makeScale(s - 4.6, GROUND_Y, s - 4.6).setPosition(x, 0, z);
      curb.setMatrixAt(i, m);
      m.makeScale(s - 5.4, GROUND_Y + 0.012, s - 5.4).setPosition(x, 0, z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    curb.instanceMatrix.needsUpdate = true;
    return [mesh, curb];
  }, [idx]);

  const lamps = useMemo(() => streetLamps(idx, quality), [idx, quality]);
  const pools = useMemo(() => {
    if (!lamps.length) return null;
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(g, pool, lamps.length);
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      m.makeScale(l.ps, 1, l.ps).setPosition(l.px, ROAD_Y + 0.02, l.pz);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 2;
    return mesh;
  }, [lamps, pool]);

  // reflection streaks under waterfront lamps and bridge lights
  const streaks = useMemo(() => {
    if (quality === "low") return null;
    const items: { x: number; z: number; rot: number }[] = [];
    let k = 0;
    for (const l of lamps) {
      if (Math.abs(l.z - (wf.riverN - 1.4)) < 0.01) {
        if (k++ % 2 === 0) items.push({ x: l.x, z: wf.riverN + 0.2, rot: 0 });
      } else if (Math.abs(l.x - (wf.seaE + 1.4)) < 0.01) {
        if (k++ % 2 === 0) items.push({ x: wf.seaE - 0.2, z: l.z, rot: -Math.PI / 2 });
      }
    }
    for (const b of bridges(idx)) for (let z = b.z0 + 2; z < b.z1 - 1; z += 3.2) for (const sd of [-1, 1]) items.push({ x: b.x + sd * (b.w / 2 + 0.3), z: z, rot: 0 });
    const g = new THREE.PlaneGeometry(0.42, 6.5);
    g.translate(0, 3.25, 0);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI);
    const seeds = new Float32Array(items.length).map((_, i) => (i * 0.618) % 1);
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
    const mesh = new THREE.InstancedMesh(g, streakWarm, items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
      m.compose(new THREE.Vector3(it.x, -0.5, it.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 1;
    return mesh;
  }, [lamps, quality, idx, wf.riverN, wf.seaE, streakWarm]);

  useEffect(
    () => () => {
      for (const p of plinths) {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }
      pools?.geometry.dispose();
      streaks?.geometry.dispose();
    },
    [plinths, pools, streaks],
  );

  const eastX = idx.halfW + 300;
  const northZ = -idx.halfD - 300;
  const landW = eastX - wf.seaE;
  const landD = wf.riverN - northZ;
  return (
    <group>
      {/* water */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.55, 0]} material={water}>
        <planeGeometry args={[4200, 4200]} />
      </mesh>
      {/* city land and far bank (tops at y = 0, embankments drop into the water) */}
      <mesh position={[(wf.seaE + eastX) / 2, -0.6, (northZ + wf.riverN) / 2]}>
        <boxGeometry args={[landW, 1.2, landD]} />
        <meshStandardMaterial color="#0a1219" roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.6, wf.riverS + 300]}>
        <boxGeometry args={[2400, 1.2, 600]} />
        <meshStandardMaterial color="#0a1219" roughness={0.95} />
      </mesh>
      {/* lit quay edges */}
      <mesh position={[(wf.seaE + eastX) / 2, -0.05, wf.riverN]}>
        <boxGeometry args={[landW, 0.1, 0.18]} />
        <meshBasicMaterial color="#9fd8ff" toneMapped={false} />
      </mesh>
      <mesh position={[wf.seaE, -0.05, (northZ + wf.riverN) / 2]}>
        <boxGeometry args={[0.18, 0.1, landD]} />
        <meshBasicMaterial color="#9fd8ff" toneMapped={false} />
      </mesh>
      <mesh position={[0, -0.05, wf.riverS]}>
        <boxGeometry args={[2400, 0.1, 0.18]} />
        <meshBasicMaterial color="#7fb8e6" toneMapped={false} />
      </mesh>
      {/* promenades */}
      <mesh position={[(wf.seaE + eastX) / 2, 0.01, wf.riverN - 3.2]}>
        <boxGeometry args={[landW, 0.04, 6]} />
        <meshStandardMaterial color="#1a2430" roughness={0.9} />
      </mesh>
      <mesh position={[wf.seaE + 3.4, 0.01, (northZ + wf.riverN) / 2]}>
        <boxGeometry args={[6, 0.04, landD]} />
        <meshStandardMaterial color="#1a2430" roughness={0.9} />
      </mesh>
      {bridges(idx).map((b) => (
        <BridgeDeck key={b.x} b={b} />
      ))}
      {plinths.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
      {pools && <primitive object={pools} />}
      {streaks && <primitive object={streaks} />}
    </group>
  );
}

function BridgeDeck({ b }: { b: { x: number; z0: number; z1: number; w: number } }) {
  const len = b.z1 - b.z0;
  const lights = useMemo(() => {
    const pts: [number, number][] = [];
    for (let z = b.z0 + 1.5; z < b.z1 - 0.5; z += 3.2) for (const sd of [-1, 1]) pts.push([sd * (b.w / 2 + 0.25), z]);
    return pts;
  }, [b]);
  return (
    <group position={[b.x, 0, 0]}>
      <mesh position={[0, ROAD_Y - 0.2, (b.z0 + b.z1) / 2]}>
        <boxGeometry args={[b.w + 1.0, 0.36, len + 1]} />
        <meshStandardMaterial color="#1b2632" roughness={0.8} />
      </mesh>
      {[0.25, 0.5, 0.75].map((f) => (
        <mesh key={f} position={[0, -0.5, b.z0 + len * f]}>
          <boxGeometry args={[b.w * 0.55, 0.9, 1.1]} />
          <meshStandardMaterial color="#121b24" roughness={0.9} />
        </mesh>
      ))}
      {[-1, 1].map((sd) => (
        <mesh key={sd} position={[sd * (b.w / 2 + 0.42), ROAD_Y + 0.22, (b.z0 + b.z1) / 2]}>
          <boxGeometry args={[0.12, 0.3, len + 1]} />
          <meshStandardMaterial color="#3a4a5a" roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
      {lights.map(([x, z], i) => (
        <mesh key={i} position={[x, ROAD_Y + 0.55, z]}>
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          <meshBasicMaterial color="#ffd6a0" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function segmentGeometry(segs: Segment[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const along: number[] = [];
  const across: number[] = [];
  const cls: number[] = [];
  const index: number[] = [];
  let v = 0;
  for (const s of segs) {
    const w = ROAD_W[s.cls] / 2;
    const dx = s.b[0] - s.a[0];
    const dz = s.b[1] - s.a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz * w;
    const nz = ux * w;
    const ext = 0.6;
    const ax = s.a[0] - ux * ext;
    const az = s.a[1] - uz * ext;
    const bx = s.b[0] + ux * ext;
    const bz = s.b[1] + uz * ext;
    const k = s.cls === "expressway" ? 2 : s.cls === "arterial" ? 1 : 0;
    pos.push(ax + nx, ROAD_Y, az + nz, ax - nx, ROAD_Y, az - nz, bx + nx, ROAD_Y, bz + nz, bx - nx, ROAD_Y, bz - nz);
    along.push(-ext, -ext, len + ext, len + ext);
    across.push(1, -1, 1, -1);
    cls.push(k, k, k, k);
    index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aAlong", new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute("aAcross", new THREE.Float32BufferAttribute(across, 1));
  g.setAttribute("aClass", new THREE.Float32BufferAttribute(cls, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export function Roads({ idx, quality }: { idx: CityIndex; quality: Quality }) {
  const segs = useMemo<Segment[]>(() => {
    const ops: Segment[] = [];
    for (const e of idx.city.edges) {
      const a = idx.nodeWorld.get(e.a);
      const b = idx.nodeWorld.get(e.b);
      if (a && b) ops.push({ a, b, cls: e.road_class as Segment["cls"] });
    }
    return [...ops, ...decorRoads(idx)];
  }, [idx]);
  const geo = useMemo(() => segmentGeometry(segs), [segs]);
  const mat = useMemo(() => {
    const m = createRoadMaterial();
    m.uniforms.uAsphalt.value.set("#152030");
    m.uniforms.uEdgeHi.value.set("#3d7fb8");
    m.uniforms.uEdgeLo.value.set("#26343f");
    m.uniforms.uMark.value.set("#b4c0cb");
    m.uniforms.uFlowCol.value.set("#7fd4ff");
    return m;
  }, []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  useEffect(() => {
    mat.uniforms.uFlow.value = quality === "low" ? 0 : 0.35;
  }, [mat, quality]);
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
  });
  const pads = useMemo(() => {
    const widest = new Map<string, number>();
    const key = (p: [number, number]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const posOf = new Map<string, [number, number]>();
    for (const s of segs) {
      for (const p of [s.a, s.b]) {
        const k = key(p);
        posOf.set(k, p);
        widest.set(k, Math.max(widest.get(k) ?? 0, ROAD_W[s.cls]));
      }
    }
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: "#121c26" }), posOf.size);
    const m = new THREE.Matrix4();
    let i = 0;
    for (const [k, p] of posOf) {
      const s = (widest.get(k) ?? 2) + 0.6;
      m.makeScale(s, 1, s).setPosition(p[0], ROAD_Y + 0.004, p[1]);
      mesh.setMatrixAt(i++, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }, [segs]);
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
