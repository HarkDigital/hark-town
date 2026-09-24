import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Collects static meshes (kit props, hand-built dressing) and merges them into
 * one mesh per material + shadow flags, so a whole island draws in a handful
 * of calls. Geometry is baked into the batch root's space and stripped to
 * position/normal (plus colour and the kit's dusk `glow` when present) so any
 * mix of kit pieces merges. Pieces in a bucket without `glow` get zeros, so
 * kit windows and bulbs still light up at dusk after the merge. Everything
 * stays indexed (non-indexed pieces get an identity index), so the kit's
 * welded vertices aren't blown back up into a triangle soup.
 */
export class StaticBatch {
  private buckets = new Map<
    string,
    { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean; color: boolean; glow: boolean }
  >()
  /** instanced / skinned / non-mesh children that can't merge are kept as-is */
  private loose: THREE.Object3D[] = []

  /**
   * Add every mesh under `obj` (obj must NOT have a parent; its own transform
   * is baked). `cast` / `receive` override the meshes' own shadow flags.
   */
  add(obj: THREE.Object3D, opts: { cast?: boolean; receive?: boolean } = {}) {
    obj.updateMatrixWorld(true)
    obj.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      if ((m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) {
        const clone = m.clone()
        clone.matrixAutoUpdate = false
        clone.matrix.copy(m.matrixWorld)
        this.loose.push(clone)
        return
      }
      const mat = Array.isArray(m.material) ? m.material[0] : m.material
      if (!mat) return
      const cast = opts.cast ?? m.castShadow
      const receive = opts.receive ?? m.receiveShadow
      const src = m.geometry
      if (!src?.attributes?.position) return
      const g = src.clone()
      if (!g.index) {
        const n = g.attributes.position.count
        const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n)
        for (let i = 0; i < n; i++) idx[i] = i
        g.setIndex(new THREE.BufferAttribute(idx, 1))
      }
      const hasColor = !!g.attributes.color && !!(mat as THREE.MeshStandardMaterial).vertexColors
      // the kit's evening-light channel (windows, bulbs): keep it through the merge
      const hasGlow = hasColor && !!g.attributes.glow && g.attributes.glow.itemSize === 1
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && !(hasColor && name === 'color') && !(hasGlow && name === 'glow')) g.deleteAttribute(name)
      }
      g.morphAttributes = {}
      g.clearGroups()
      if (!g.attributes.normal) g.computeVertexNormals()
      if (hasColor && g.attributes.color.itemSize !== 3) {
        // normalise RGBA → RGB so buckets merge
        const c = g.attributes.color
        const out = new Float32Array(c.count * 3)
        for (let i = 0; i < c.count; i++) {
          out[i * 3] = c.getX(i)
          out[i * 3 + 1] = c.getY(i)
          out[i * 3 + 2] = c.getZ(i)
        }
        g.setAttribute('color', new THREE.BufferAttribute(out, 3))
      }
      g.applyMatrix4(m.matrixWorld)
      // mirrored transforms flip the winding: fix it so faces stay front-facing
      if (m.matrixWorld.determinant() < 0) flipWinding(g)
      const key = `${mat.uuid}|${cast ? 1 : 0}|${receive ? 1 : 0}|${hasColor ? 1 : 0}`
      let b = this.buckets.get(key)
      if (!b) {
        b = { mat, geos: [], cast, receive, color: hasColor, glow: false }
        this.buckets.set(key, b)
      }
      if (hasGlow && !b.glow) b.glow = (g.attributes.glow.array as Float32Array).some(v => v !== 0)
      b.geos.push(g)
    })
  }

  /** Merge everything into `parent`. Returns the created meshes. */
  build(parent: THREE.Object3D): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const b of this.buckets.values()) {
      // every piece in a bucket needs the same attribute set: pad `glow` with
      // zeros where a piece has none, or drop it when nothing in the bucket glows
      for (const g of b.geos) {
        if (b.glow && !g.attributes.glow) g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1))
        else if (!b.glow && g.attributes.glow) g.deleteAttribute('glow')
      }
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false)
      if (!merged) continue
      merged.computeBoundingSphere()
      const mesh = new THREE.Mesh(merged, b.mat)
      mesh.castShadow = b.cast
      mesh.receiveShadow = b.receive
      mesh.matrixAutoUpdate = false
      parent.add(mesh)
      out.push(mesh)
      for (const g of b.geos) if (g !== merged) g.dispose()
    }
    for (const l of this.loose) {
      parent.add(l)
      out.push(l)
    }
    this.buckets.clear()
    this.loose = []
    return out
  }
}

/** swap the 2nd/3rd corner of every triangle (indexed geometry) */
function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index!.array as Uint16Array | Uint32Array
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const t = idx[i + 1]
    idx[i + 1] = idx[i + 2]
    idx[i + 2] = t
  }
}

/** Paint a flat vertex colour onto a geometry (for vertex-coloured merges). */
export function paint(g: THREE.BufferGeometry, r: number, gg: number, b: number) {
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = r
    arr[i * 3 + 1] = gg
    arr[i * 3 + 2] = b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}
