import * as THREE from 'three'
import { rng } from '../core/math'

/*
 * Performance helpers.
 *
 *   scatter(geometry, material, points, opts)  one InstancedMesh for many
 *       copies (trees, tufts, flowers, rocks) with random yaw/scale and
 *       optional per-instance colours.
 *   mergeStatic(root)  bake every static mesh under `root` into one mesh per
 *       material (+ shadow flags). Returns a NEW group; add it instead of
 *       `root`. Skips InstancedMesh, objects named in `keep`, and anything
 *       with userData.dynamic = true (moving parts, spinners, signs).
 */

export type ScatterPoint = THREE.Vector3 | { x: number; y?: number; z: number; s?: number; ry?: number }

export interface ScatterOptions {
  seed?: number
  /** uniform scale or [min, max] random range (default [0.85, 1.15]) */
  scale?: number | [number, number]
  /** random yaw (default true) */
  rotate?: boolean
  /** random per-instance colours (multiplies vertex colours: paint the geometry white where it should tint) */
  colors?: string[]
  castShadow?: boolean
  receiveShadow?: boolean
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/** Many copies of one geometry as a single InstancedMesh. castShadow defaults to false. */
export function scatter(geometry: THREE.BufferGeometry, material: THREE.Material, points: ScatterPoint[], o: ScatterOptions = {}): THREE.InstancedMesh {
  const rand = rng(o.seed ?? 7)
  const im = new THREE.InstancedMesh(geometry, material, Math.max(1, points.length))
  im.count = points.length
  const sc = o.scale ?? [0.85, 1.15]
  const col = new THREE.Color()
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { x: number; y?: number; z: number; s?: number; ry?: number }
    const s = p.s ?? (typeof sc === 'number' ? sc : sc[0] + rand() * (sc[1] - sc[0]))
    const ry = p.ry ?? (o.rotate === false ? 0 : rand() * Math.PI * 2)
    _p.set(p.x, p.y ?? 0, p.z)
    _q.setFromAxisAngle(_up, ry)
    _s.setScalar(s)
    im.setMatrixAt(i, _m.compose(_p, _q, _s))
    if (o.colors?.length) im.setColorAt(i, col.set(o.colors[Math.floor(rand() * o.colors.length)]))
  }
  im.instanceMatrix.needsUpdate = true
  if (im.instanceColor) im.instanceColor.needsUpdate = true
  im.castShadow = o.castShadow ?? false
  im.receiveShadow = o.receiveShadow ?? true
  im.computeBoundingSphere()
  return im
}

/**
 * Merge every static mesh under `root` into one mesh per (material, shadow
 * flags, renderOrder). World transforms are baked relative to `root`. The
 * original objects are left untouched; add the returned group (it copies
 * root's local transform) to root's parent instead of root.
 */
export function mergeStatic(root: THREE.Object3D, o: { keep?: string[] } = {}): THREE.Group {
  root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert()
  type Part = { geo: THREE.BufferGeometry; m: THREE.Matrix4 }
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; order: number; parts: Part[] }>()
  const keep = new Set(o.keep ?? [])
  const out = new THREE.Group()
  const skip = new Set<THREE.Object3D>()
  root.traverse(obj => {
    if (skip.has(obj)) return
    if (obj !== root && (obj.userData.dynamic || keep.has(obj.name))) {
      obj.traverse(c => skip.add(c))
      return
    }
    const m = obj as THREE.Mesh
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material) || !m.visible) return
    if (!m.geometry.attributes.position) return
    const mat = m.material as THREE.Material
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}|${m.receiveShadow ? 1 : 0}|${m.renderOrder}`
    let bk = buckets.get(key)
    if (!bk) {
      bk = { mat, cast: m.castShadow, recv: m.receiveShadow, order: m.renderOrder, parts: [] }
      buckets.set(key, bk)
    }
    bk.parts.push({ geo: m.geometry, m: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld) })
  })
  const nm = new THREE.Matrix3()
  for (const bk of buckets.values()) {
    const first = bk.parts[0].geo
    // attributes every part shares (same item size)
    const names = Object.keys(first.attributes).filter(n =>
      bk.parts.every(p => p.geo.attributes[n] && p.geo.attributes[n].itemSize === first.attributes[n].itemSize && !(p.geo.attributes[n] as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute),
    )
    let total = 0
    for (const p of bk.parts) total += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count
    const arrays: Record<string, Float32Array> = {}
    for (const n of names) arrays[n] = new Float32Array(total * first.attributes[n].itemSize)
    let o0 = 0
    for (const p of bk.parts) {
      const g = p.geo
      const idx = g.index ? g.index.array : null
      const cnt = idx ? idx.length : g.attributes.position.count
      const e = p.m.elements
      nm.getNormalMatrix(p.m)
      const ne = nm.elements
      const flip = p.m.determinant() < 0
      for (const n of names) {
        const src = g.attributes[n].array as ArrayLike<number>
        const k = g.attributes[n].itemSize
        const dst = arrays[n]
        for (let j = 0; j < cnt; j++) {
          // mirrored transforms: swap the 2nd/3rd vertex of each triangle
          const jj = flip ? (j % 3 === 1 ? j + 1 : j % 3 === 2 ? j - 1 : j) : j
          const i = idx ? idx[jj] : jj
          const d = (o0 + j) * k
          if (n === 'position') {
            const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2]
            dst[d] = e[0] * x + e[4] * y + e[8] * z + e[12]
            dst[d + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]
            dst[d + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]
          } else if (n === 'normal') {
            const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2]
            const ux = ne[0] * x + ne[3] * y + ne[6] * z
            const uy = ne[1] * x + ne[4] * y + ne[7] * z
            const uz = ne[2] * x + ne[5] * y + ne[8] * z
            const l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
            dst[d] = ux / l
            dst[d + 1] = uy / l
            dst[d + 2] = uz / l
          } else {
            for (let c = 0; c < k; c++) dst[d + c] = src[i * k + c]
          }
        }
      }
      o0 += cnt
    }
    const merged = new THREE.BufferGeometry()
    for (const n of names) merged.setAttribute(n, new THREE.BufferAttribute(arrays[n], first.attributes[n].itemSize))
    merged.computeBoundingSphere()
    const mesh = new THREE.Mesh(merged, bk.mat)
    mesh.castShadow = bk.cast
    mesh.receiveShadow = bk.recv
    mesh.renderOrder = bk.order
    out.add(mesh)
  }
  out.position.copy(root.position)
  out.quaternion.copy(root.quaternion)
  out.scale.copy(root.scale)
  return out
}
