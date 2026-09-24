import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * Small building blocks for the Building Site:
 *  - Batch: static pieces merged into ONE vertex-coloured mesh (one draw call
 *    per batch, however many props it holds).
 *  - pop / land curves: the toy squash-and-stretch vocabulary.
 *  - Pops: threshold-triggered springs. Whether a piece is "in" is derived
 *    from local progress; the spring itself plays in real time, so pops feel
 *    the same however fast you scroll, and a jump to any local settles to
 *    the right picture in well under a second.
 */

const _c = new THREE.Color()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _d = new THREE.Vector3()
const _e = new THREE.Euler()
const Y = new THREE.Vector3(0, 1, 0)

/** unit box, pre-flattened (non-indexed, position + normal only) so each copy is a cheap clone */
const UNIT_BOX = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed()
  g.deleteAttribute('uv')
  return g
})()

export class Batch {
  private parts: THREE.BufferGeometry[] = []
  constructor(private opts: { uv?: boolean; color?: boolean } = {}) {}

  /**
   * Add a geometry (cloned, flattened to non-indexed) with a flat colour and
   * an optional transform. `glow` > 0 marks it as a window that lights up
   * warm at dusk (the kit's clayVC material reads the attribute).
   */
  add(geo: THREE.BufferGeometry, color: string | THREE.Color | null, m?: THREE.Matrix4, glow = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    const keepUv = !!this.opts.uv
    // null colour keeps the geometry's own vertex colours (if it has any)
    const keepColor = color === null && !!g.attributes.color && this.opts.color !== false
    const keepGlow = keepColor && !!g.attributes.glow
    for (const k of Object.keys(g.attributes)) {
      if (k === 'position' || k === 'normal' || (keepUv && k === 'uv') || (keepColor && k === 'color') || (keepGlow && k === 'glow')) continue
      g.deleteAttribute(k)
    }
    g.morphAttributes = {}
    g.clearGroups()
    if (!g.attributes.normal) g.computeVertexNormals()
    const n = g.attributes.position.count
    if (keepUv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
    if (m) g.applyMatrix4(m)
    if (this.opts.color !== false && !keepColor) {
      if (color === null) _c.set('#ffffff')
      else if (typeof color === 'string') _c.set(color)
      else _c.copy(color)
      const arr = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        arr[i * 3] = _c.r
        arr[i * 3 + 1] = _c.g
        arr[i * 3 + 2] = _c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    }
    if (this.opts.color !== false && !keepGlow) g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1))
    this.parts.push(g)
    return this
  }

  /** Axis-aligned box (then yawed) by its centre. */
  box(w: number, h: number, d: number, color: string, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0, glow = 0): this {
    _e.set(rx, ry, rz)
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(w, h, d))
    return this.add(UNIT_BOX, color, _m, glow)
  }

  /** A thin square beam from a to b. */
  strut(a: THREE.Vector3, b: THREE.Vector3, t: number, color: string): this {
    _d.subVectors(b, a)
    const len = _d.length()
    if (len < 1e-5) return this
    _q.setFromUnitVectors(Y, _d.divideScalar(len))
    _m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(t, len, t))
    return this.add(UNIT_BOX, color, _m)
  }

  /** Any geometry placed at x,y,z with a yaw and a uniform-or-xyz scale. */
  put(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0): this {
    _e.set(rx, ry, rz)
    _q.setFromEuler(_e)
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))
    return this.add(geo, color, _m)
  }

  /** Bake a kit object (its meshes, their material colours, its transform) into the batch. */
  object(o: THREE.Object3D, parent?: THREE.Matrix4): this {
    o.updateMatrixWorld(true)
    o.traverse(c => {
      const mesh = c as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
      _m.copy(mesh.matrixWorld)
      if (parent) _m.premultiply(parent)
      this.add(mesh.geometry, mesh.geometry.attributes.color ? null : mat.color ? mat.color : '#ffffff', _m)
    })
    return this
  }

  /** The merged geometry (the batch is emptied). */
  geometry(): THREE.BufferGeometry {
    const geo = this.parts.length ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry()
    for (const p of this.parts) p.dispose()
    this.parts = []
    geo.computeBoundingSphere()
    geo.computeBoundingBox()
    return geo
  }

  build(material: THREE.Material, cast = true, receive = true): THREE.Mesh {
    const geo = this.geometry()
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = cast
    mesh.receiveShadow = receive
    return mesh
  }
}

/** Add colour + glow attributes to a bare geometry so the kit's clayVC() can draw it. */
export function paintFlat(g: THREE.BufferGeometry, color: string, glow = 0) {
  const n = g.attributes.position.count
  _c.set(color)
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r
    arr[i * 3 + 1] = _c.g
    arr[i * 3 + 2] = _c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1))
  return g
}

// ------------------------------------------------------------------ curves

export interface Squash {
  xz: number
  y: number
}

/**
 * Springy pop-in over p (0..1): grows fast, stretched tall while it shoots
 * up, squashes on the overshoot and wobbles to rest.
 */
export function popCurve(p: number, calm: boolean, out: Squash): Squash {
  if (p <= 0) {
    out.xz = out.y = 0
    return out
  }
  if (p >= 1) {
    out.xz = out.y = 1
    return out
  }
  const g = 1 - Math.pow(1 - Math.min(1, p / 0.34), 3)
  if (calm) {
    out.xz = out.y = g
    return out
  }
  const w = Math.exp(-4.6 * p) * Math.sin(p * 17)
  out.y = g * (1 + 0.34 * w)
  out.xz = g * (1 - 0.17 * w)
  return out
}

/** Landing squash over q (0..1) after contact: squash, rebound, settle. */
export function landCurve(q: number, calm: boolean, out: Squash): Squash {
  if (q <= 0 || q >= 1 || calm) {
    out.xz = out.y = 1
    return out
  }
  const w = Math.exp(-5.2 * q) * Math.sin(q * 15)
  out.y = 1 - 0.24 * w
  out.xz = 1 + 0.12 * w
  return out
}

/** 0..1 flip with a small overshoot (revolving hoarding panels). */
export function flipCurve(p: number, calm: boolean) {
  if (p <= 0) return 0
  if (p >= 1) return 1
  if (calm) return p * p * (3 - 2 * p)
  return 1 - Math.exp(-6 * p) * Math.cos(9 * p) * (1 - p)
}

// ------------------------------------------------------------------ pops

/**
 * Threshold-triggered springs. Each frame call begin(), then item(i, on, t)
 * for every item: when an item's target flips, its spring restarts from the
 * current time (items flipping on in the same frame cascade in order).
 */
export class Pops {
  readonly xz: Float32Array
  readonly y: Float32Array
  /** 0..1 progress of the current phase (in or out) */
  readonly p: Float32Array
  private on: Uint8Array
  private t0: Float64Array
  private from: Float32Array
  private k = 0
  private tmp: Squash = { xz: 0, y: 0 }

  constructor(
    n: number,
    private dur = 0.72,
    private outDur = 0.32,
  ) {
    this.xz = new Float32Array(n)
    this.y = new Float32Array(n)
    this.p = new Float32Array(n)
    this.on = new Uint8Array(n)
    this.t0 = new Float64Array(n).fill(-1e9)
    this.from = new Float32Array(n)
  }

  begin() {
    this.k = 0
  }

  isOn(i: number) {
    return this.on[i] === 1
  }

  item(i: number, on: boolean, time: number, calm: boolean) {
    if (on !== (this.on[i] === 1)) {
      this.from[i] = Math.max(this.xz[i], this.y[i])
      this.on[i] = on ? 1 : 0
      this.t0[i] = time + (on ? Math.min(this.k++ * 0.035, 0.5) : 0)
    }
    const age = time - this.t0[i]
    if (this.on[i]) {
      const p = age / (calm ? 0.3 : this.dur)
      this.p[i] = Math.max(0, Math.min(1, p))
      popCurve(p, calm, this.tmp)
      this.xz[i] = this.tmp.xz
      this.y[i] = this.tmp.y
    } else {
      const p = Math.max(0, Math.min(1, age / (calm ? 0.2 : this.outDur)))
      this.p[i] = p
      const s = this.from[i] * (1 - p) * (1 + 0.6 * p)
      this.xz[i] = this.y[i] = p >= 1 ? 0 : s
    }
  }
}

export const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0)
