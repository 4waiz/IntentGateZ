import { lazy, Suspense, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { setState, useStore } from "../store/store";
import { Ambulances } from "./Ambulances";
import { Buildings } from "./Buildings";
import { CAMERA_FOV, CameraRig } from "./CameraRig";
import { Facilities } from "./Facilities";
import { Ground, Roads } from "./Ground";
import { ChallengeMarkers, Closures, Effects, Incidents } from "./Markers";
import { CameraToolbar, Legend, SceneHud } from "./Overlays";
import { Routes } from "./Routes";

const PostFX = lazy(() => import("./PostFX"));

function World() {
  const idx = useStore((s) => s.cityIndex);
  const quality = useStore((s) => s.quality);
  if (!idx) return null;
  return (
    <>
      <color attach="background" args={["#050b12"]} />
      <fog attach="fog" args={["#050b12", 430, 1250]} />
      <ambientLight intensity={0.75} color="#a9c2da" />
      <hemisphereLight args={["#2d5378", "#050b12", 0.9]} />
      <directionalLight position={[-160, 260, 120]} intensity={2.2} color="#e3edf7" />
      <directionalLight position={[180, 120, -160]} intensity={0.5} color="#4589ff" />
      <Ground idx={idx} quality={quality} />
      <Roads idx={idx} quality={quality} />
      <Buildings idx={idx} quality={quality} />
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
  const antialias = quality !== "low";

  useEffect(() => () => setState({ hovered: null }), []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink" style={{ visibility: active ? "visible" : "hidden" }}>
      <Canvas
        key={antialias ? "aa" : "noaa"}
        flat
        dpr={dpr}
        frameloop={active ? "always" : "never"}
        gl={{ antialias, powerPreference: "high-performance", alpha: false, stencil: false }}
        camera={{ fov: CAMERA_FOV, near: 2, far: 3200, position: [-160, 380, 420] }}
        onPointerMissed={() => setState({ hovered: null })}
      >
        <World />
        {quality === "high" && (
          <Suspense fallback={null}>
            <PostFX />
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
