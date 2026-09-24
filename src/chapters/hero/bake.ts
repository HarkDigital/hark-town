import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clayVC } from '../../kit/palette'

/*
 * Turn kit props (Groups of clay meshes, or already vertex-coloured kit
 * geometry) into ONE vertex-coloured geometry, so a whole street of houses
 * can be a single InstancedMesh. Attributes: position, normal, color, glow
 * (the kit's dusk-light channel) and aTint.
 *
 * aTint marks vertices that take the per-instance colour (roofs, shirts, car
 * paint): build the prop with the SENTINEL colour for those parts and they
 * come out white + aTint = 1, so instanceColor paints them and leaves the
 * rest of the prop alone.
 */

/** Paint parts with this to make them instance-tintable. */
export const SENTINEL = '#ff00ff'
const SENT = new THREE.Color(SENTINEL)

const _inv = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _im = new THREE.Matrix4()
const _c = new THREE.Color()

function isSentinel(r: number, g: number, b: number) {
  return Math.abs(r - SENT.r) < 0.2 && Math.abs(g - SENT.g) < 0.2 && Math.abs(b - SENT.b) < 0.2
}

export interface BakeOptions {
  /** only bake meshes that pass */
  include?: (mesh: THREE.Mesh) => boolean
  /** recolour everything (e.g. white for a glow part) */
  color?: string
}

/** Bake a prop into one geometry in the root's local space. */
export function bake(root: THREE.Object3D, opts: BakeOptions = {}): THREE.BufferGeometry | null {
  root.updateMatrixWorld(true)
  _inv.copy(root.matrixWorld).invert()
  const parts: THREE.BufferGeometry[] = []
  const over = opts.color ? new THREE.Color(opts.color) : null
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.visible) return
    if (opts.include && !opts.include(mesh)) return
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    const src = mesh.geometry
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null
    const copies = inst ? inst.count : 1
    for (let k = 0; k < copies; k++) {
      let g = src.index ? src.toNonIndexed() : src.clone()
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'color' && name !== 'glow') g.deleteAttribute(name)
      }
      g.morphAttributes = {}
      g.clearGroups()
      if (!g.attributes.normal) g.computeVertexNormals()
      _m.multiplyMatrices(_inv, mesh.matrixWorld)
      if (inst) {
        inst.getMatrixAt(k, _im)
        _m.multiply(_im)
      }
      g.applyMatrix4(_m)
      const n = g.attributes.position.count
      const col = new Float32Array(n * 3)
      const tint = new Float32Array(n)
      const base = mat?.color ?? _c.set(1, 1, 1)
      const vc = g.attributes.color as THREE.BufferAttribute | undefined
      const useVc = !!vc && !!mat?.vertexColors
      for (let i = 0; i < n; i++) {
        let r = base.r, gg = base.g, b = base.b
        if (useVc) {
          r *= vc!.getX(i)
          gg *= vc!.getY(i)
          b *= vc!.getZ(i)
        }
        if (over) {
          r = over.r
          gg = over.g
          b = over.b
        } else if (isSentinel(r, gg, b)) {
          r = gg = b = 1
          tint[i] = 1
        }
        col[i * 3] = r
        col[i * 3 + 1] = gg
        col[i * 3 + 2] = b
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      if (!g.attributes.glow) g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n), 1))
      g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1))
      // make sure every part has the exact same attribute layout
      for (const name of Object.keys(g.attributes)) {
        const a = g.attributes[name] as THREE.BufferAttribute
        if (!(a.array instanceof Float32Array) || (a as THREE.BufferAttribute).normalized) {
          const f = new Float32Array(a.count * a.itemSize)
          for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j)
          g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize))
        }
      }
      parts.push(g)
    }
  })
  if (!parts.length) return null
  const out = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)
  if (parts.length > 1) parts.forEach(p => p.dispose())
  if (!out) return null
  out.computeBoundingSphere()
  out.computeBoundingBox()
  return out
}

/** Add a zero aTint (and glow) to a plain kit geometry so it can share the tint material. */
export function withTint(g: THREE.BufferGeometry, value = 0) {
  const n = g.attributes.position.count
  if (!g.attributes.aTint) g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(n).fill(value), 1))
  if (!g.attributes.glow) g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n), 1))
  return g
}

const TINT_VERTEX = THREE.ShaderChunk.color_vertex.replace(
  'vColor.rgb *= instanceColor.rgb;',
  'vColor.rgb *= mix( vec3( 1.0 ), instanceColor.rgb, aTint );',
)

let tintMat: THREE.MeshStandardMaterial | null = null

/**
 * The kit's vertex-colour clay (rim light, dusk glow) + per-instance tint on
 * aTint vertices. Shared by every instanced prop in the hero.
 */
export function tintClay(): THREE.MeshStandardMaterial {
  if (tintMat) return tintMat
  const base = clayVC()
  const m = base.clone()
  const prev = base.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(base, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTint;')
      .replace('#include <color_vertex>', TINT_VERTEX)
  }
  m.customProgramCacheKey = () => 'hero-tint'
  tintMat = m
  return m
}
