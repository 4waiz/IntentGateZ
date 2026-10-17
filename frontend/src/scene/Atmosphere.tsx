import { useMemo } from "react";
import * as THREE from "three";

/** Night sky dome: deep blue zenith, a warm city glow on the horizon and a sparse star field. */
export function Atmosphere() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new THREE.Color("#02060c") },
          uMid: { value: new THREE.Color("#071629") },
          uHorizon: { value: new THREE.Color("#163150") },
          uGlow: { value: new THREE.Color("#1d2f48") },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith;
          uniform vec3 uMid;
          uniform vec3 uHorizon;
          uniform vec3 uGlow;
          varying vec3 vDir;
          float h(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          void main() {
            float y = clamp(vDir.y, -0.2, 1.0);
            vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, y));
            col = mix(col, uZenith, smoothstep(0.18, 0.75, y));
            col += uGlow * exp(-max(y, 0.0) * 18.0) * 0.6;
            vec3 sd = floor(vDir * 420.0);
            float star = step(0.9985, h(sd)) * smoothstep(0.12, 0.5, y);
            col += vec3(0.8, 0.88, 1.0) * star * (0.4 + 0.6 * h(sd + 3.0));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  );
  return (
    <mesh material={mat} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[2600, 48, 24]} />
    </mesh>
  );
}
