/**
 * Night materials for the batched kit meshes.
 *  - glazing: lit-window shader driven by the kit's glazing UV grid (u = facade bay, v = storey):
 *    per-window hashed occupancy, warm homes, cool offices, a few TV-blue rooms, blinds, AA
 *    mullions and a distance fallback to average coverage so far towers do not shimmer;
 *  - emissive (lamps, HOSPITAL / red-cross signage): bright enough to bloom;
 *  - everything else: kit PBR + baked AO, darkened for night, with warm street-level uplight.
 * The per-building id travels in aBld as id * 4 + style (0 home, 1 office, 2 skyline, 3 facility).
 */
import { Color, DoubleSide, type Material, MeshStandardMaterial } from "three";
import type { KitManifest } from "./kit";

const PARS_V = /* glsl */ `
attribute float aBld;
attribute vec2 aGrid;
varying float vBld;
varying vec2 vGrid;
varying vec3 vKN;
varying vec3 vKP;
`;
const MAIN_V = /* glsl */ `
vBld = aBld;
vGrid = aGrid;
vec4 kwp = vec4(transformed, 1.0);
vec3 kn = objectNormal;
#ifdef USE_INSTANCING
kwp = instanceMatrix * kwp;
kn = mat3(instanceMatrix) * kn;
#endif
vKN = normalize(mat3(modelMatrix) * kn);
vKP = (modelMatrix * kwp).xyz;
`;
const PARS_F = /* glsl */ `
varying float vBld;
varying vec2 vGrid;
varying vec3 vKN;
varying vec3 vKP;
float kH13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float kBox(float x, float a, float b, float w){ return clamp(smoothstep(a - w, a + w, x) - smoothstep(b - w, b + w, x), 0.0, 1.0); }
`;

const GLAZING = /* glsl */ `#include <color_fragment>
float style = mod(floor(vBld + 0.5), 4.0);
float bid = floor((vBld + 0.5) / 4.0);
vec2 g = vGrid;
vec2 ci = floor(g);
vec2 cf = fract(g);
vec2 fw = max(fwidth(g), vec2(1e-4));
float farF = smoothstep(0.2, 0.5, max(fw.x, fw.y));
float pane = kBox(cf.x, 0.06, 0.94, fw.x) * kBox(cf.y, 0.08, 0.92, fw.y);
pane = mix(pane, 0.62, farF);
vec3 nq = normalize(vKN);
float face = floor(atan(nq.z, nq.x) * 0.6366 + 2.5);
vec3 cid = vec3(ci, face * 31.0 + bid * 7.13);
float h1 = kH13(cid);
float h2 = kH13(cid + 11.3);
float h3 = mix(kH13(cid + 27.1), 0.5, farF);
bool lobby = g.y < 1.0;
float litFrac = style > 2.5 ? 0.66 : (style > 1.5 ? 0.3 : (style > 0.5 ? 0.46 : 0.42));
if (lobby) litFrac = 0.8;
// offices light whole floors together
if (style > 0.5 && style < 1.5) h1 = kH13(vec3(ci.y, face, bid)) * 0.75 + h1 * 0.25;
float lit = step(h1, litFrac);
lit = mix(lit, litFrac, farF);
vec3 warm = mix(vec3(1.0, 0.52, 0.2), vec3(1.0, 0.76, 0.46), h2);
vec3 cool = mix(vec3(0.78, 0.88, 1.0), vec3(1.0, 0.92, 0.78), step(0.6, h2));
vec3 col = style > 0.5 && style < 1.5 ? cool : warm;
col = mix(col, vec3(0.45, 0.62, 1.0), step(0.93, h2) * step(style, 0.5));
if (style > 2.5) col = mix(vec3(0.85, 0.95, 1.0), vec3(1.0, 0.86, 0.6), step(0.5, h2));
col = mix(col, vec3(0.95, 0.85, 0.7), farF * 0.5);
float interior = mix(0.55, 1.0, smoothstep(0.0, 0.85, cf.y));
interior = mix(interior, 0.8, farF);
float blinds = mix(1.0, 0.45 + 0.35 * step(0.5, fract(cf.y * 9.0)), step(0.74, h3) * (1.0 - farF));
float inten = (0.55 + 1.05 * h3) * interior * blinds * (lobby ? 1.25 : 1.0);
if (style > 1.5 && style < 2.5) inten *= 0.62;
vec3 kWinEm = col * inten * lit * pane * mix(0.8, 0.36, farF);
vec3 frameCol = vec3(0.05, 0.065, 0.085);
diffuseColor.rgb = mix(frameCol, vec3(0.025, 0.04, 0.06), pane);
float kRough = mix(0.5, 0.12, pane);
float kMetal = mix(0.5, 0.6, pane);`;

const STANDARD_NIGHT = /* glsl */ `#include <color_fragment>
diffuseColor.rgb *= vec3(0.3, 0.35, 0.46);
float kUp = (1.0 - smoothstep(0.32, 1.25, vKP.y)) * step(abs(vKN.y), 0.5);`;

export type KitMatKind = "glazing" | "emissive" | "glass" | "foliage" | "standard";

export function kitMaterialKind(name: string): KitMatKind {
  if (name === "glazing") return "glazing";
  if (name === "light_emissive" || name === "emissive_sign") return "emissive";
  if (name === "glass_clear") return "glass";
  if (name === "foliage") return "foliage";
  return "standard";
}

export function createKitMaterial(name: string, src: Material | null, manifest: KitManifest | null, opts: { skyline?: boolean } = {}): MeshStandardMaterial {
  const pbr = manifest?.materialPBR?.[name] ?? {};
  const s = src as MeshStandardMaterial | null;
  const kind = kitMaterialKind(name);
  const mat = new MeshStandardMaterial({
    color: s?.color?.clone() ?? new Color(pbr.baseColor ?? "#cccccc"),
    roughness: s?.roughness ?? pbr.roughness ?? 0.8,
    metalness: s?.metalness ?? pbr.metalness ?? 0,
    vertexColors: true,
    envMapIntensity: 0.6,
  });
  if (kind === "foliage" || kind === "glass") mat.side = DoubleSide;
  if (kind === "emissive") {
    mat.emissive = s?.emissive?.clone() ?? new Color(pbr.emissive ?? "#ffd08a");
    const base = s?.emissiveIntensity ?? pbr.emissiveIntensity ?? 4;
    mat.emissiveIntensity = name === "emissive_sign" ? base * 0.75 : base * 0.6;
  }
  if (kind === "glass") {
    mat.transparent = true;
    mat.opacity = 0.22;
    mat.depthWrite = false;
    mat.roughness = 0.08;
    mat.color = new Color("#5d7f99");
  }
  if (kind === "foliage") {
    mat.color = new Color("#2c4a2a");
  }
  if (name === "water") {
    mat.emissive = new Color("#1A8FD0");
    mat.emissiveIntensity = 0.5;
  }
  if (opts.skyline && kind === "standard") mat.color.multiply(new Color(0.42, 0.46, 0.55));
  mat.customProgramCacheKey = () => `igz-kit-${kind}${opts.skyline ? "-s" : ""}`;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${PARS_V}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${MAIN_V}`);
    let frag = shader.fragmentShader.replace("#include <common>", `#include <common>\n${PARS_F}`);
    if (kind === "glazing") {
      frag = frag
        .replace("#include <color_fragment>", GLAZING)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = kRough;")
        .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = kMetal;")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += kWinEm;");
    } else if (kind === "standard") {
      frag = frag
        .replace("#include <color_fragment>", STANDARD_NIGHT)
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.62, 0.32) * kUp * ${opts.skyline ? "0.0" : "0.22"};`,
        );
    }
    shader.fragmentShader = frag;
  };
  return mat;
}
