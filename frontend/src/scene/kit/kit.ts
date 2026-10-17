/**
 * Building kit loader. The GLB models (public/models) come from Encirra, an earlier MIT-licensed
 * project by the same team, built from an original procedural Blender kit: metres, +Y up, every
 * node's origin at the centre of its footprint on the ground. Files load once, in parallel, and
 * the scene keeps its fallback until they arrive.
 */
import { useEffect, useState } from "react";
import type { Object3D } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface KitAsset {
  id: string;
  kind: string;
  variant: number;
  node: string;
  file: string;
  nominalSize?: [number, number, number];
  stoneTint?: string;
  anchors?: Record<string, unknown>;
  placement?: { position: [number, number, number]; rotationY?: number };
}

export interface KitManifest {
  basePath: string;
  assets: KitAsset[];
  materialPBR?: Record<string, { baseColor?: string; roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; opacity?: number }>;
}

export interface Kit {
  manifest: KitManifest;
  gltf: Record<string, GLTF>;
}

export const KIT_FILES = [
  "tower-office.glb",
  "tower-residential.glb",
  "midrise-residential.glb",
  "lowrise-residential.glb",
  "villa.glb",
  "commercial-podium.glb",
  "office-complex.glb",
  "mall.glb",
  "hospital.glb",
  "emergency-ops.glb",
  "palm.glb",
  "streetlight.glb",
  "skyline.glb",
] as const;

let promise: Promise<Kit | null> | null = null;
let ready: Kit | null = null;

function base(): string {
  const b = (import.meta.env.BASE_URL as string | undefined) ?? "/";
  return b.endsWith("/") ? `${b}models/` : `${b}/models/`;
}

export function loadKit(): Promise<Kit | null> {
  if (promise) return promise;
  promise = (async () => {
    try {
      const res = await fetch(`${base()}manifest.json`);
      if (!res.ok) return null;
      const manifest = (await res.json()) as KitManifest;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const entries = await Promise.all(
        KIT_FILES.map(
          (f) =>
            new Promise<[string, GLTF | null]>((resolve) => {
              loader.load(
                `${base()}${f}`,
                (g) => resolve([f, g]),
                undefined,
                () => resolve([f, null]),
              );
            }),
        ),
      );
      const gltf: Record<string, GLTF> = {};
      for (const [f, g] of entries) if (g) gltf[f] = g;
      ready = { manifest, gltf };
      return ready;
    } catch {
      return null;
    }
  })();
  return promise;
}

/** The loaded kit, or null while loading (or if the models are unavailable). */
export function useKit(): Kit | null {
  const [kit, setKit] = useState<Kit | null>(ready);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadKit().then((k) => {
      if (alive) setKit(k);
    });
    return () => {
      alive = false;
    };
  }, []);
  return kit;
}

export function kitNode(kit: Kit, file: string, node: string): Object3D | null {
  return kit.gltf[file]?.scene.getObjectByName(node) ?? null;
}

export function kitAssets(kit: Kit, kind: string): KitAsset[] {
  return kit.manifest.assets.filter((a) => a.kind === kind && kit.gltf[a.file]);
}
