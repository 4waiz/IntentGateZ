import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";

const tmp = new THREE.Vector3();

/**
 * DOM label anchored in the scene. Shrinks slightly with camera distance (never below minScale,
 * so it stays readable) and can hide itself beyond a distance to reduce clutter in overviews.
 */
export function SceneLabel({
  position,
  children,
  minScale = 0.78,
  near = 140,
  far = 700,
  hideBeyond,
  z = 20,
}: {
  position: [number, number, number];
  children: ReactNode;
  minScale?: number;
  near?: number;
  far?: number;
  hideBeyond?: number;
  z?: number;
}) {
  const anchor = useRef<THREE.Group>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef({ s: -1, o: -1 });
  useFrame(({ camera }) => {
    const a = anchor.current;
    const el = box.current;
    if (!a || !el) return;
    a.getWorldPosition(tmp);
    const d = camera.position.distanceTo(tmp);
    const t = THREE.MathUtils.clamp((d - near) / (far - near), 0, 1);
    const s = Math.round((1 + (minScale - 1) * t) * 100) / 100;
    const o = hideBeyond !== undefined && d > hideBeyond ? 0 : 1;
    if (s !== last.current.s) {
      el.style.transform = `scale(${s})`;
      last.current.s = s;
    }
    if (o !== last.current.o) {
      el.style.opacity = String(o);
      last.current.o = o;
    }
  });
  return (
    <group ref={anchor} position={position}>
      <Html center zIndexRange={[z, 10]} style={{ pointerEvents: "none" }}>
        <div ref={box} style={{ transformOrigin: "50% 50%", transition: "opacity 220ms ease" }}>
          {children}
        </div>
      </Html>
    </group>
  );
}
