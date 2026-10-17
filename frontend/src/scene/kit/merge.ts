/**
 * Static batching: many (geometry, matrix) items baked into one geometry per material, so the
 * whole city draws in about a dozen calls. Each vertex keeps the baked ambient occlusion from the
 * kit (COLOR_0) times a per-building tint, the glazing grid (aGrid: u = facade bay, v = storey)
 * and a per-building id (aBld) used to vary the lit-window pattern. Reads quantized meshopt
 * attributes through getX/getY/getZ. Adapted from Encirra (MIT, same team).
 */
import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, type Material, type Mesh, type Object3D, Vector3 } from "three";

export interface Template {
  geometry: BufferGeometry;
  material: Material;
  name: string;
  matrix: Matrix4;
}

export interface MergeItem {
  geometry: BufferGeometry;
  matrix: Matrix4;
  bld: number;
  tint: [number, number, number];
}

/** Meshes under `node`, with matrices relative to `node`. Multi-material meshes are split. */
export function collectTemplates(node: Object3D): Template[] {
  node.updateMatrixWorld(true);
  const inv = new Matrix4().copy(node.matrixWorld).invert();
  const out: Template[] = [];
  node.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const rel = new Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) out.push({ geometry: m.geometry, material: mat, name: mat.name, matrix: rel });
  });
  return out;
}

export function mergeItems(items: MergeItem[]): BufferGeometry | null {
  let nv = 0;
  let ni = 0;
  for (const it of items) {
    const p = it.geometry.getAttribute("position");
    if (!p) continue;
    nv += p.count;
    ni += it.geometry.index ? it.geometry.index.count : p.count;
  }
  if (nv === 0) return null;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const grid = new Float32Array(nv * 2);
  const bld = new Float32Array(nv);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new Vector3();
  const n = new Vector3();
  const nm = new Matrix3();
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const g = it.geometry;
    const P = g.getAttribute("position");
    if (!P) continue;
    const N = g.getAttribute("normal");
    const UV = g.getAttribute("uv");
    const C = g.getAttribute("color");
    nm.getNormalMatrix(it.matrix);
    const flip = it.matrix.determinant() < 0;
    for (let i = 0; i < P.count; i++) {
      v.set(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(it.matrix);
      pos[(vo + i) * 3] = v.x;
      pos[(vo + i) * 3 + 1] = v.y;
      pos[(vo + i) * 3 + 2] = v.z;
      if (N) n.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(nm).normalize();
      else n.set(0, 1, 0);
      nor[(vo + i) * 3] = n.x;
      nor[(vo + i) * 3 + 1] = n.y;
      nor[(vo + i) * 3 + 2] = n.z;
      const ar = C ? C.getX(i) : 1;
      const ag = C ? C.getY(i) : 1;
      const ab = C ? C.getZ(i) : 1;
      col[(vo + i) * 3] = ar * it.tint[0];
      col[(vo + i) * 3 + 1] = ag * it.tint[1];
      col[(vo + i) * 3 + 2] = ab * it.tint[2];
      if (UV) {
        grid[(vo + i) * 2] = UV.getX(i);
        grid[(vo + i) * 2 + 1] = UV.getY(i);
      }
      bld[vo + i] = it.bld;
    }
    if (g.index) {
      const I = g.index;
      for (let k = 0; k < I.count; k += 3) {
        const a = I.getX(k) + vo;
        const b = I.getX(k + 1) + vo;
        const c = I.getX(k + 2) + vo;
        idx[io++] = a;
        idx[io++] = flip ? c : b;
        idx[io++] = flip ? b : c;
      }
    } else {
      for (let k = 0; k < P.count; k++) idx[io++] = vo + k;
    }
    vo += P.count;
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new BufferAttribute(pos, 3));
  out.setAttribute("normal", new BufferAttribute(nor, 3));
  out.setAttribute("color", new BufferAttribute(col, 3));
  out.setAttribute("aGrid", new BufferAttribute(grid, 2));
  out.setAttribute("aBld", new BufferAttribute(bld, 1));
  out.setIndex(new BufferAttribute(idx.subarray(0, io), 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
