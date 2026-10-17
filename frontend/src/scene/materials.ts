import * as THREE from "three";

/**
 * Hand-written shader materials. Every colour is passed as a THREE.Color uniform (sRGB hex in,
 * linear internally) and every shader ends with tonemapping + colorspace chunks, so the result
 * matches the palette both on the default framebuffer and through the bloom composer.
 */

const FOG_VERT_PARS = /* glsl */ `#include <common>
#include <fog_pars_vertex>`;
const FOG_FRAG_PARS = /* glsl */ `#include <common>
#include <fog_pars_fragment>`;
const FRAG_TAIL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>`;

function withFog<T extends Record<string, THREE.IUniform>>(u: T): T & typeof THREE.UniformsLib.fog {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.fog, u]) as T & typeof THREE.UniformsLib.fog;
}

const c = (hex: string) => new THREE.Color(hex);

// ------------------------------------------------------------------ roads

export function createRoadMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: withFog({
      uTime: { value: 0 },
      uFlow: { value: 1 },
      uAsphalt: { value: c("#0d1925") },
      uEdgeHi: { value: c("#3f8fc4") },
      uEdgeLo: { value: c("#2a3a4a") },
      uMark: { value: c("#9fb0c0") },
      uFlowCol: { value: c("#14c7ff") },
    }),
    vertexShader: /* glsl */ `
      ${FOG_VERT_PARS}
      attribute float aAlong;
      attribute float aAcross;
      attribute float aClass;
      varying float vAlong;
      varying float vAcross;
      varying float vClass;
      void main() {
        vAlong = aAlong;
        vAcross = aAcross;
        vClass = aClass;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_FRAG_PARS}
      uniform float uTime;
      uniform float uFlow;
      uniform vec3 uAsphalt;
      uniform vec3 uEdgeHi;
      uniform vec3 uEdgeLo;
      uniform vec3 uMark;
      uniform vec3 uFlowCol;
      varying float vAlong;
      varying float vAcross;
      varying float vClass;
      void main() {
        float a = abs(vAcross);
        bool xway = vClass > 1.5;
        bool art = vClass > 0.5 && !xway;
        vec3 col = uAsphalt * (0.85 + 0.25 * (1.0 - a));
        float ew = xway ? 0.09 : (art ? 0.08 : 0.07);
        float edge = smoothstep(1.0 - ew - 0.05, 1.0 - ew, a) * (1.0 - smoothstep(0.97, 1.0, a));
        vec3 edgeCol = xway ? uEdgeHi : uEdgeLo;
        col = mix(col, edgeCol, edge * (xway ? 0.9 : (art ? 0.75 : 0.5)));
        float dash = step(0.5, fract(vAlong / (xway ? 3.6 : 2.8)));
        float center = 1.0 - smoothstep(0.025, 0.06, a);
        col = mix(col, uMark, center * dash * (xway ? 0.0 : (art ? 0.45 : 0.2)));
        if (xway) {
          float median = 1.0 - smoothstep(0.02, 0.05, a);
          col = mix(col, uEdgeHi, median * 0.55);
          float lane = 1.0 - smoothstep(0.015, 0.04, abs(a - 0.5));
          col = mix(col, uMark, lane * step(0.55, fract(vAlong / 2.2)) * 0.35);
          float dir = vAcross > 0.0 ? 1.0 : -1.0;
          float laneMask = 1.0 - smoothstep(0.08, 0.2, abs(a - 0.72));
          float p = fract((vAlong - dir * uTime * 9.0) / 7.0);
          float dotv = (1.0 - smoothstep(0.0, 0.07, abs(p - 0.5))) * laneMask * uFlow;
          col += uFlowCol * dotv * 1.1;
        }
        gl_FragColor = vec4(col, 1.0);
        ${FRAG_TAIL}
      }`,
  });
}

// ------------------------------------------------------------------ buildings

export function createBuildingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: withFog({
      uLightDir: { value: new THREE.Vector3(-0.45, 0.8, 0.35).normalize() },
      uBase: { value: c("#132433") },
      uBaseB: { value: c("#0e1c2a") },
      uWarm: { value: c("#ffcf8a") },
      uCool: { value: c("#9fdcff") },
      uDark: { value: c("#0a1622") },
      uEdge: { value: c("#3aa7e0") },
      uTime: { value: 0 },
    }),
    vertexShader: /* glsl */ `
      ${FOG_VERT_PARS}
      attribute float aSeed;
      attribute float aKind;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying float vRelY;
      varying float vSeed;
      varying float vKind;
      varying vec3 vScale;
      void main() {
        vUv = uv;
        vSeed = aSeed;
        vKind = aKind;
        vRelY = position.y;
        vScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_FRAG_PARS}
      uniform vec3 uLightDir;
      uniform vec3 uBase;
      uniform vec3 uBaseB;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      uniform vec3 uDark;
      uniform vec3 uEdge;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec2 vUv;
      varying float vRelY;
      varying float vSeed;
      varying float vKind;
      varying vec3 vScale;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vNormal);
        float ndl = clamp(dot(n, uLightDir), 0.0, 1.0);
        vec3 base = mix(uBaseB, uBase, h21(vec2(vSeed, 3.1)));
        vec3 col = base * (0.5 + 0.75 * ndl);
        float heightM = vWorld.y;
        col *= 0.55 + 0.45 * smoothstep(0.0, 6.0, heightM);
        if (abs(n.y) < 0.5) {
          bool sideX = abs(n.x) > 0.5;
          float hc = sideX ? vWorld.z : vWorld.x;
          float faceW = sideX ? vScale.z : vScale.x;
          float industrial = step(0.5, vKind);
          vec2 cellSize = mix(vec2(0.95, 1.15), vec2(2.4, 1.6), industrial);
          vec2 cell = vec2(hc / cellSize.x, vWorld.y / cellSize.y);
          vec2 id = floor(cell);
          vec2 f = fract(cell);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.78);
          win *= step(0.9, vWorld.y) * step(vWorld.y, vScale.y - 0.35);
          float r = h21(id + vSeed * 13.7);
          float litP = mix(0.79, 0.93, industrial);
          float lit = step(litP, r);
          float flick = 0.85 + 0.15 * sin(uTime * (0.6 + r * 2.0) + r * 40.0);
          vec3 lc = mix(uCool, uWarm, step(0.45, h21(id.yx + vSeed))) * (0.45 + 0.55 * h21(id * 1.37 + 2.0)) * flick;
          col = mix(col, uDark * 1.2 + base * 0.15, win * (1.0 - lit) * 0.85);
          col += win * lit * lc * 0.85;
          float e = min(vUv.x, 1.0 - vUv.x) * faceW;
          col += uEdge * (1.0 - smoothstep(0.0, 0.14, e)) * 0.22 * smoothstep(1.0, 10.0, heightM);
        } else if (n.y > 0.5) {
          col = base * 0.72;
          float ex = min(vUv.x, 1.0 - vUv.x) * vScale.x;
          float ez = min(vUv.y, 1.0 - vUv.y) * vScale.z;
          float e = min(ex, ez);
          col += uEdge * (1.0 - smoothstep(0.0, 0.22, e)) * 0.75;
        }
        gl_FragColor = vec4(col, 1.0);
        ${FRAG_TAIL}
      }`,
  });
}

// ------------------------------------------------------------------ route ribbons

export interface RibbonUniforms {
  [uniform: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uTime: THREE.IUniform<number>;
  uTraveled: THREE.IUniform<number>;
  uDashed: THREE.IUniform<number>;
  uOpacity: THREE.IUniform<number>;
  uSpeed: THREE.IUniform<number>;
  uFlicker: THREE.IUniform<number>;
}

export function createRibbonMaterial(color: string, dashed = false): THREE.ShaderMaterial {
  const uniforms: RibbonUniforms = {
    uColor: { value: c(color) },
    uTime: { value: 0 },
    uTraveled: { value: 0 },
    uDashed: { value: dashed ? 1 : 0 },
    uOpacity: { value: 1 },
    uSpeed: { value: 16 },
    uFlicker: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: withFog(uniforms),
    vertexShader: /* glsl */ `
      ${FOG_VERT_PARS}
      attribute float aDist;
      attribute float aAcross;
      varying float vDist;
      varying float vAcross;
      void main() {
        vDist = aDist;
        vAcross = aAcross;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_FRAG_PARS}
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uTraveled;
      uniform float uDashed;
      uniform float uOpacity;
      uniform float uSpeed;
      uniform float uFlicker;
      varying float vDist;
      varying float vAcross;
      void main() {
        float a = abs(vAcross);
        float core = 1.0 - smoothstep(0.14, 0.36, a);
        float glow = pow(max(0.0, 1.0 - a), 2.2) * 0.5;
        float alpha = core * 0.9 + glow;
        vec3 col = uColor * (0.55 + 0.9 * core);
        if (uDashed > 0.5) {
          float dash = step(0.42, fract((vDist + uTime * 1.5) / 3.0));
          alpha *= mix(0.08, 1.0, dash);
          alpha *= 0.78 + 0.22 * sin(uTime * 7.0 + vDist * 0.15) * uFlicker;
        } else {
          float p = fract((vDist - uTime * uSpeed) / 18.0);
          float pulse = smoothstep(0.0, 0.03, p) * (1.0 - smoothstep(0.03, 0.2, p));
          col += vec3(1.0) * pulse * core * 0.55 + uColor * pulse * 0.9;
          alpha += pulse * 0.35;
        }
        float done = 1.0 - step(uTraveled, vDist);
        alpha *= mix(1.0, 0.16, done);
        gl_FragColor = vec4(col * alpha * uOpacity, 1.0);
        ${FRAG_TAIL}
      }`,
  });
}

// ------------------------------------------------------------------ hex shield (BLOCK checkpoint)

export function createHexShieldMaterial(color = "#ff5d70"): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: c(color) },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uScale: { value: new THREE.Vector2(9, 6) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uOpacity;
      uniform vec2 uScale;
      varying vec2 vUv;
      float hexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
      vec4 hexCoords(vec2 uv) {
        vec2 r = vec2(1.0, 1.7320508);
        vec2 h = r * 0.5;
        vec2 a = mod(uv, r) - h;
        vec2 b = mod(uv - h, r) - h;
        vec2 gv = dot(a, a) < dot(b, b) ? a : b;
        return vec4(gv, uv - gv);
      }
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 uv = vUv * uScale * 0.9;
        vec4 hc = hexCoords(uv);
        float d = 0.5 - hexDist(hc.xy);
        float edge = 1.0 - smoothstep(0.0, 0.05, d);
        float rnd = h21(hc.zw);
        float cellPulse = 0.5 + 0.5 * sin(uTime * 3.0 + rnd * 6.28);
        float fill = 0.06 + 0.12 * cellPulse * step(0.6, rnd);
        float fade = smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.06, vUv.y) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float base = (1.0 - smoothstep(0.0, 0.06, vUv.y)) * 1.5;
        float scan = smoothstep(0.03, 0.0, abs(fract(vUv.y - uTime * 0.35) - 0.5) - 0.47);
        float alpha = (edge * 0.75 + fill + scan * 0.25) * fade + base * 0.35;
        vec3 col = uColor * alpha * uOpacity;
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ vertical light beam

export function createBeamMaterial(color: string, strength = 0.8): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: c(color) }, uTime: { value: 0 }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float a = pow(1.0 - vUv.y, 1.6);
        float band = 0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 4.0);
        float side = 1.0 - abs(vUv.x - 0.5) * 2.0;
        side = pow(max(side, 0.0), 0.6);
        float alpha = a * band * side * uStrength;
        gl_FragColor = vec4(uColor * alpha, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ striped barrier (road closure)

export function createStripeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: withFog({ uA: { value: c("#ff5d70") }, uB: { value: c("#f2f4f7") }, uTime: { value: 0 } }),
    vertexShader: /* glsl */ `
      ${FOG_VERT_PARS}
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_FRAG_PARS}
      uniform vec3 uA;
      uniform vec3 uB;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        float s = step(0.5, fract((vPos.x + vPos.z + vPos.y) * 0.9));
        vec3 col = mix(uA, uB * 0.85, s);
        col *= 0.9 + 0.25 * (0.5 + 0.5 * sin(uTime * 4.0));
        gl_FragColor = vec4(col, 1.0);
        ${FRAG_TAIL}
      }`,
  });
}

// ------------------------------------------------------------------ closed-road overlay

export function createClosureOverlayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: c("#ff5d70") }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float stripes = step(0.5, fract((vUv.x * 14.0 + vUv.y * 1.2) - uTime * 0.4));
        float edge = 1.0 - smoothstep(0.0, 0.12, min(vUv.y, 1.0 - vUv.y));
        float alpha = 0.18 + stripes * 0.22 + edge * 0.5;
        gl_FragColor = vec4(uColor * alpha, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// ------------------------------------------------------------------ water

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: withFog({ uTime: { value: 0 }, uDeep: { value: c("#04121f") }, uGlint: { value: c("#1d6fa5") } }),
    vertexShader: /* glsl */ `
      ${FOG_VERT_PARS}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      ${FOG_FRAG_PARS}
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uGlint;
      varying vec3 vWorld;
      void main() {
        float w = sin(vWorld.z * 0.35 + uTime * 0.6) * sin(vWorld.x * 0.22 - uTime * 0.4);
        float lines = smoothstep(0.92, 1.0, sin(vWorld.z * 1.4 + sin(vWorld.x * 0.08 + uTime * 0.3) * 2.0));
        vec3 col = uDeep + uGlint * (0.05 + 0.05 * w) + uGlint * lines * 0.12;
        gl_FragColor = vec4(col, 1.0);
        ${FRAG_TAIL}
      }`,
  });
}
