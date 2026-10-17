import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import * as THREE from "three";
import { exposeForCapture } from "../lib/capture";
import { serverNow } from "../lib/clock";
import { type CityIndex, routeWorld } from "../lib/geo";
import { buildRoutePath, sampleRoute, type RouteSample } from "../lib/sim";
import { ambulanceWorld, hospitalWorld, incidentWorld } from "../store/actions";
import { currentDecisionId, getState, setState, useStore, type CameraCommand } from "../store/store";

export const CAMERA_FOV = 40;
const OVERVIEW = { polar: 0.84, azimuth: -0.5, target: new THREE.Vector3(8, 0, 22) };

function overviewDistance(aspect: number): number {
  const R = 228;
  const vf = THREE.MathUtils.degToRad(CAMERA_FOV);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
  const f = Math.min(vf, hf);
  return (R / Math.sin(f / 2)) * 0.6;
}

function spherical(target: THREE.Vector3, dist: number, polar: number, azimuth: number): THREE.Vector3 {
  return new THREE.Vector3(
    target.x + dist * Math.sin(polar) * Math.sin(azimuth),
    target.y + dist * Math.cos(polar),
    target.z + dist * Math.sin(polar) * Math.cos(azimuth),
  );
}

const tmp: RouteSample = { x: 0, z: 0, moving: false, dist: 0, dirX: 0, dirZ: 1 };

function ambulancePose(id: string, idx: CityIndex): { x: number; z: number; dx: number; dz: number } | null {
  const sim = getState().sim;
  const amb = sim?.ambulances.find((a) => a.id === id);
  if (!sim || !amb) return null;
  const path = buildRoutePath(amb, idx);
  if (!path) {
    const p = idx.nodeWorld.get(amb.node);
    return p ? { x: p[0], z: p[1], dx: 0, dz: -1 } : null;
  }
  sampleRoute(path, serverNow(), sim.sim_speedup, tmp);
  return { x: tmp.x, z: tmp.z, dx: tmp.dirX, dz: tmp.dirZ };
}

/** Latest blocked operation with a ghost route (the selected one if it is a BLOCK). */
export function blockedRoutePoints(idx: CityIndex): [number, number][] | null {
  const s = getState();
  const sel = currentDecisionId(s);
  const selected = sel ? s.decisionCache[sel] : null;
  const pick =
    selected && selected.verdict === "BLOCK" && selected.ghost_route?.length
      ? selected
      : Object.values(s.decisionCache)
          .filter((d) => d.verdict === "BLOCK" && d.ghost_route && d.ghost_route.length > 1)
          .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!pick?.ghost_route) return null;
  return routeWorld(idx, pick.ghost_route);
}

export function CameraRig({ idx }: { idx: CityIndex }) {
  const ref = useRef<CameraControls>(null);
  const cmd = useStore((s) => s.cameraCmd);
  const size = useThree((s) => s.size);
  const lastNonce = useRef(0);
  const aspect = size.width / Math.max(1, size.height);

  const focusPoint = (x: number, z: number, dist: number, polar = 0.92, y = 0) => {
    const c = ref.current;
    if (!c) return;
    const az = c.azimuthAngle;
    const target = new THREE.Vector3(x, y, z);
    const p = spherical(target, dist, polar, az);
    void c.setLookAt(p.x, p.y, p.z, target.x, target.y, target.z, true);
  };

  const overview = (animate: boolean) => {
    const c = ref.current;
    if (!c) return;
    const p = spherical(OVERVIEW.target, overviewDistance(aspect), OVERVIEW.polar, OVERVIEW.azimuth);
    void c.setLookAt(p.x, p.y, p.z, OVERVIEW.target.x, OVERVIEW.target.y, OVERVIEW.target.z, animate);
  };

  const apply = (c: CameraCommand) => {
    switch (c.preset) {
      case "overview":
      case "reset":
        setState({ cameraMode: "static", followId: null });
        overview(true);
        break;
      case "orbit": {
        setState({ cameraMode: "orbit", followId: null });
        const ctl = ref.current;
        if (ctl) {
          const t = new THREE.Vector3(0, 0, 0);
          const p = spherical(t, overviewDistance(aspect) * 0.86, 0.98, ctl.azimuthAngle);
          void ctl.setLookAt(p.x, p.y, p.z, t.x, t.y, t.z, true);
        }
        break;
      }
      case "ambulance": {
        setState({ cameraMode: "static", followId: null });
        const p = c.id ? ambulanceWorld(c.id) : null;
        if (p) focusPoint(p[0], p[1], 150, 0.74);
        break;
      }
      case "hospital": {
        setState({ cameraMode: "static", followId: null });
        const p = c.id ? hospitalWorld(c.id) : null;
        if (p) focusPoint(p[0], p[1], 165, 0.8, 8);
        break;
      }
      case "incident": {
        setState({ cameraMode: "static", followId: null });
        const p = c.id ? incidentWorld(c.id) : null;
        if (p) focusPoint(p[0], p[1], 155, 0.76);
        break;
      }
      case "follow":
        if (c.id) setState({ cameraMode: "follow", followId: c.id });
        break;
      case "blocked": {
        setState({ cameraMode: "static", followId: null });
        const pts = blockedRoutePoints(idx);
        if (!pts || !pts.length) break;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const [x, z] of pts) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        const cx = (minX + maxX) / 2;
        const cz = (minZ + maxZ) / 2;
        const r = Math.max(30, Math.hypot(maxX - minX, maxZ - minZ) / 2);
        const vf = THREE.MathUtils.degToRad(CAMERA_FOV);
        const f = Math.min(vf, 2 * Math.atan(Math.tan(vf / 2) * aspect));
        focusPoint(cx, cz, (r / Math.sin(f / 2)) * 0.95, 0.72);
        break;
      }
    }
  };

  // First frame: establishing shot.
  useEffect(() => {
    overview(false);
    exposeForCapture("__igzCam", ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!cmd || cmd.nonce === lastNonce.current) return;
    lastNonce.current = cmd.nonce;
    apply(cmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd]);

  useEffect(() => {
    const ctl = ref.current;
    if (!ctl) return;
    ctl.setBoundary(new THREE.Box3(new THREE.Vector3(-idx.halfW - 120, -5, -idx.halfD - 120), new THREE.Vector3(idx.halfW + 120, 60, idx.halfD + 120)));
  }, [idx]);

  useFrame((_, dt) => {
    const ctl = ref.current;
    if (!ctl) return;
    const { cameraMode, followId } = getState();
    if (cameraMode === "orbit") {
      void ctl.rotate(dt * 0.06, 0, false);
    } else if (cameraMode === "follow" && followId) {
      const pose = ambulancePose(followId, idx);
      if (pose) {
        const back = 34;
        const up = 21;
        void ctl.setLookAt(pose.x - pose.dx * back, up, pose.z - pose.dz * back, pose.x + pose.dx * 6, 1.5, pose.z + pose.dz * 6, true);
      }
    }
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={18}
      maxDistance={1000}
      minPolarAngle={0.06}
      maxPolarAngle={Math.PI * 0.46}
      smoothTime={0.55}
      draggingSmoothTime={0.08}
      dollySpeed={0.6}
      truckSpeed={1.4}
      onStart={() => {
        const m = getState().cameraMode;
        if (m !== "static") setState({ cameraMode: "static", followId: null });
      }}
    />
  );
}
