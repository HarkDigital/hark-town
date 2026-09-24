import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clay } from '../../kit/palette'

/*
 * Main Street's little geometry workshop.
 *
 * Every static piece of the street is baked into a handful of vertex-coloured
 * meshes (one per finish) so a whole shop, the island or the tram is 1–4 draw
 * calls instead of dozens. Colours are the town palette's clay; the matte
 * finish shares the kit's clay() material recipe (and any shader tweaks the
 * kit adds) so Main Street matches the other islands.
 */

export type Finish = 'matte' | 'gloss' | 'glow'

/** Where to put a piece: position, euler rotation, scale. */
export interface Place {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  sx?: number
  sy?: number
  sz?: number
}

function vertexMaterial(rough: number) {
  const base = clay('#ffffff', { rough })
  const m = base.clone()
  m.vertexColors = true
  // keep whatever look the shared clay recipe adds
  if (base.onBeforeCompile) m.onBeforeCompile = base.onBeforeCompile
  return m
}

let mats: Record<Finish, THREE.Material> | null = null
/** Shared finishes: matte clay, glossy enamel/glass, and glowing LEDs (HDR → bloom). */
export function finishes() {
  if (!mats) {
    mats = {
      matte: vertexMaterial(0.84),
      gloss: vertexMaterial(0.3),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    }
  }
  return mats
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

const rbCache = new Map<string, THREE.BufferGeometry>()
/** Rounded box, bottom at y = 0 (cached by size). */
export function roundBox(w: number, h: number, d: number, r = 0.06, seg = 2) {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}|${seg}`
  let g = rbCache.get(key)
  if (!g) {
    g = r > 0.001 ? new RoundedBoxGeometry(w, h, d, seg, r) : new THREE.BoxGeometry(w, h, d)
    g.translate(0, h / 2, 0)
    rbCache.set(key, g)
  }
  return g
}

const cylCache = new Map<string, THREE.BufferGeometry>()
/** Cylinder standing on y = 0. */
export function cyl(rt: number, rb: number, h: number, seg = 10) {
  const key = `${rt}|${rb}|${h}|${seg}`
  let g = cylCache.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg)
    g.translate(0, h / 2, 0)
    cylCache.set(key, g)
  }
  return g
}

const sphCache = new Map<string, THREE.BufferGeometry>()
export function ball(r: number, detail = 1) {
  const key = `${r}|${detail}`
  let g = sphCache.get(key)
  if (!g) {
    g = new THREE.IcosahedronGeometry(r, detail)
    sphCache.set(key, g)
  }
  return g
}

/** Triangular prism (gable / pediment): base w along x, height h, depth d along z, base on y = 0. */
const prismCache = new Map<string, THREE.BufferGeometry>()
export function prism(w: number, h: number, d: number) {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`
  let g = prismCache.get(key)
  if (!g) {
    g = makePrism(w, h, d)
    prismCache.set(key, g)
  }
  return g
}
function makePrism(w: number, h: number, d: number) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0)
  s.lineTo(0, h)
  s.lineTo(w / 2, 0)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false })
  g.translate(0, 0, -d / 2)
  return g
}

/** A plane whose UVs cover one cell of a canvas atlas (canvas px, top-left origin). */
export function cellPlane(w: number, h: number, cell: { x: number; y: number; w: number; h: number }, W: number, H: number) {
  const g = new THREE.PlaneGeometry(w, h)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    uv.setXY(i, (cell.x + u * cell.w) / W, 1 - (cell.y + (1 - v) * cell.h) / H)
  }
  return g
}

interface Bin {
  geos: THREE.BufferGeometry[]
  mapped: boolean
  finish?: Finish
}

/** Accumulates coloured (and atlas-mapped) pieces and bakes them into one mesh per material. */
export class Kit {
  private bins = new Map<THREE.Material, Bin>()

  private bin(mat: THREE.Material, mapped: boolean, finish?: Finish) {
    let b = this.bins.get(mat)
    if (!b) {
      b = { geos: [], mapped, finish }
      this.bins.set(mat, b)
    }
    return b
  }

  private place(geo: THREE.BufferGeometry, keep: string[], p: Place) {
    // copy only what we keep, and stay indexed (4× fewer verts than toNonIndexed)
    const g = new THREE.BufferGeometry()
    for (const k of keep) {
      const a = geo.attributes[k] as THREE.BufferAttribute | undefined
      if (a) g.setAttribute(k, new THREE.BufferAttribute((a.array as Float32Array).slice(0, a.count * a.itemSize), a.itemSize))
    }
    const n = (geo.attributes.position as THREE.BufferAttribute).count
    if (geo.index) g.setIndex(new THREE.BufferAttribute((geo.index.array as Uint16Array).slice(), 1))
    else {
      const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n)
      for (let i = 0; i < n; i++) idx[i] = i
      g.setIndex(new THREE.BufferAttribute(idx, 1))
    }
    if (!g.attributes.normal) g.computeVertexNormals()
    // yaw first, then pitch/roll in the turned frame (how you'd place a thing by hand)
    _e.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'YXZ')
    _q.setFromEuler(_e)
    _m.compose(_p.set(p.x ?? 0, p.y ?? 0, p.z ?? 0), _q, _s.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1))
    g.applyMatrix4(_m)
    return g
  }

  /** Add any geometry (cloned, transformed, coloured). `glow` scales the colour past 1 for bloom. */
  add(geo: THREE.BufferGeometry, color: string | THREE.Color, p: Place = {}, finish: Finish = 'matte', glow = 1) {
    const g = this.place(geo, ['position', 'normal'], p)
    if (typeof color === 'string') _c.set(color)
    else _c.copy(color)
    const n = g.attributes.position.count
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _c.r * glow
      arr[i * 3 + 1] = _c.g * glow
      arr[i * 3 + 2] = _c.b * glow
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
    this.bin(finishes()[finish], false, finish).geos.push(g)
    return this
  }

  /** Add a textured piece (keeps its UVs) drawn with `mat`. */
  mapped(geo: THREE.BufferGeometry, mat: THREE.Material, p: Place = {}) {
    this.bin(mat, true).geos.push(this.place(geo, ['position', 'normal', 'uv'], p))
    return this
  }

  /** Rounded box sitting on (x, y, z). */
  box(w: number, h: number, d: number, color: string, p: Place = {}, r = 0.05, finish: Finish = 'matte', seg = 1) {
    return this.add(roundBox(w, h, d, r, seg), color, p, finish)
  }

  cyl(rt: number, rb: number, h: number, color: string, p: Place = {}, seg = 10, finish: Finish = 'matte') {
    return this.add(cyl(rt, rb, h, seg), color, p, finish)
  }

  ball(r: number, color: string, p: Place = {}, detail = 1, finish: Finish = 'matte', glow = 1) {
    return this.add(ball(r, detail), color, p, finish, glow)
  }

  /** Bake into a group: one mesh per material. Glow never casts or receives shadows. */
  build(opts: { cast?: boolean; receive?: boolean } = {}) {
    const group = new THREE.Group()
    for (const [mat, b] of this.bins) {
      if (!b.geos.length) continue
      const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos)
      if (!geo) continue
      if (geo !== b.geos[0]) for (const g of b.geos) g.dispose()
      geo.computeBoundingSphere()
      const mesh = new THREE.Mesh(geo, mat)
      mesh.name = b.finish ?? 'mapped'
      const lit = b.finish !== 'glow'
      mesh.castShadow = lit && !b.mapped && (opts.cast ?? true)
      mesh.receiveShadow = lit && (opts.receive ?? true)
      group.add(mesh)
    }
    this.bins = new Map()
    return group
  }
}

/**
 * Yield to the browser between heavy init steps. rAF never fires in a hidden
 * tab, so fall back to a macrotask there (and a timeout guards a tab that is
 * hidden mid-wait).
 */
export const breathe = () =>
  new Promise<void>(resolve => {
    let done = false
    const r = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (document.hidden) {
      const ch = new MessageChannel()
      ch.port1.onmessage = r
      ch.port2.postMessage(0)
      return
    }
    requestAnimationFrame(r)
    setTimeout(r, 120)
  })

/**
 * A springy value driven toward a scroll-derived target. The target always
 * comes from `local`, so jumping anywhere settles to the right state; the
 * spring only adds the toy "pop" (squash, overshoot, settle).
 */
export class Spring {
  x = 0
  v = 0
  constructor(
    public k = 190,
    public c = 12,
  ) {}
  step(target: number, dt: number, snap = false) {
    if (snap) {
      this.x = target
      this.v = 0
      return this.x
    }
    const h = Math.min(dt, 1 / 20) / 3
    for (let i = 0; i < 3; i++) {
      const a = this.k * (target - this.x) - this.c * this.v
      this.v += a * h
      this.x += this.v * h
    }
    if (Math.abs(target - this.x) < 5e-4 && Math.abs(this.v) < 5e-3) {
      this.x = target
      this.v = 0
    }
    return this.x
  }
}

/**
 * Squash-and-stretch scale from a spring (x: 0 hidden … 1 settled, >1
 * overshoot; v its velocity): tall-and-thin while shooting up, short-and-wide
 * as it drops back on the bounce.
 */
export function squash(s: Spring, out: THREE.Vector3, amount = 1) {
  const y = Math.max(0, s.x)
  if (y < 0.002) return out.set(0, 0, 0)
  const st = Math.max(-0.28, Math.min(0.28, s.v * 0.03)) * amount
  const xz = Math.min(1, y * 1.6) * (1 - st * 0.7)
  return out.set(xz, y * (1 + st), xz)
}
