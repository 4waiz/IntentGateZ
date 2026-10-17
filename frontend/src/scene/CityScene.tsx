import { lazy, Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { setState, useStore } from "../store/store";
import { Ambulances } from "./Ambulances";
import { Atmosphere } from "./Atmosphere";
import { CAMERA_FOV, CameraRig } from "./CameraRig";
import { CityKit } from "./CityKit";
import { Facilities } from "./Facilities";
import { Ground, Roads } from "./Ground";
import { ChallengeMarkers, Closures, Effects, Incidents } from "./Markers";
import { CameraToolbar, Legend, SceneHud } from "./Overlays";
import { Routes } from "./Routes";
import { Traffic } from "./Traffic";

const PostFX = lazy(() => import("./PostFX"));

function World() {
  const idx = useStore((s) => s.cityIndex);
  const quality = useStore((s) => s.quality);
  if (!idx) return null;
  return (
    <>
      <color attach="background" args={["#03070d"]} />
      <fog attach="fog" args={["#06111d", 420, 1550]} />
      <Atmosphere />
      <ambientLight intensity={0.12} color="#8fa9c8" />
      <hemisphereLight args={["#2b4a70", "#030508", 0.5]} />
      <directionalLight position={[-220, 320, -180]} intensity={0.42} color="#a9c1ff" />
      <directionalLight position={[160, 90, 260]} intensity={0.22} color="#ffb784" />
      <Ground idx={idx} quality={quality} />
      <Roads idx={idx} quality={quality} />
      <CityKit idx={idx} quality={quality} />
      <Traffic idx={idx} quality={quality} />
      <Facilities idx={idx} />
      <Closures idx={idx} />
      <Incidents idx={idx} />
      <Routes idx={idx} />
      <Ambulances idx={idx} />
      <ChallengeMarkers idx={idx} />
      <Effects />
      <CameraRig idx={idx} />
    </>
  );
}

/** The 3D city. It renders only server state: routes, statuses and verdict effects from the API. */
export default function CityScene({ active, chrome = true }: { active: boolean; chrome?: boolean }) {
  const quality = useStore((s) => s.quality);
  const presentation = useStore((s) => s.presentation);
  const dprMax = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const dpr: [number, number] = quality === "low" ? [1, 1] : quality === "med" ? [1, Math.min(1.5, dprMax)] : [1, Math.min(2, dprMax)];
  const antialias = quality === "low";

  useEffect(() => () => setState({ hovered: null }), []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink" style={{ visibility: active ? "visible" : "hidden" }}>
      <Canvas
        key={quality}
        dpr={dpr}
        frameloop={active ? "always" : "never"}
        gl={{ antialias, powerPreference: "high-performance", alpha: false, stencil: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.0 }}
        camera={{ fov: CAMERA_FOV, near: 2, far: 3200, position: [-160, 380, 420] }}
        onPointerMissed={() => setState({ hovered: null })}
      >
        <World />
        {quality !== "low" && (
          <Suspense fallback={null}>
            <PostFX quality={quality} />
          </Suspense>
        )}
      </Canvas>
      {chrome && (
        <>
          <div className="pointer-events-none absolute top-0 left-0 h-24 w-[560px] bg-[radial-gradient(420px_90px_at_0%_0%,rgba(5,11,18,0.92),transparent_75%)]" />
          <div className="pointer-events-none absolute top-3 left-3">
            <SceneHud />
          </div>
          {!presentation && (
            <div className="pointer-events-none absolute top-3 right-3 flex justify-end">
              <CameraToolbar />
            </div>
          )}
          {!presentation && (
            <div className="pointer-events-none absolute bottom-3 left-3">
              <Legend />
            </div>
          )}
        </>
      )}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_80px_rgba(2,6,11,0.85)]" />
    </div>
  );
}
