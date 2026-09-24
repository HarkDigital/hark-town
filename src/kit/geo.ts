import * as THREE from 'three'

/*
 * Vertex-colour geometry builder. Kit props are assembled from primitive
 * parts, each painted with a flat colour (or a paint function for gradients)
 * and merged into ONE non-indexed BufferGeometry with position / normal /
 * color / glow attributes — drawn with the shared clayVC() material.
 *
 *   const b = new Builder()
 *   b.add(new THREE.BoxGeometry(1, 1, 1), C.white, { y: 0.5 })
 *   b.add(sphere, (x, y, z, out) => out.set(y > 0 ? a : b))
 *   const geo = b.build()
 */

export interface Xf {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
  /** uniform scale */
  s?: number
  sx?: number
  sy?: number
  sz?: number
}

/** Per-vertex paint: receives the transformed position + normal, writes `out` (linear colour). */
export type Paint = (x: number, y: number, z: number, out: THREE.Color, nx: number, ny: number, nz: number) => void

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

export function xfMatrix(t: Xf, out = _m) {
  _p.set(t.x ?? 0, t.y ?? 0, t.z ?? 0)
  _q.setFromEuler(_e.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, 'YXZ'))
  const s = t.s ?? 1
  _s.set((t.sx ?? 1) * s, (t.sy ?? 1) * s, (t.sz ?? 1) * s)
  return out.compose(_p, _q, _s)
}

const colorCache = new Map<string, THREE.Color>()
/** Linear-space colour for a hex string (cached). */
export function col(hex: string) {
  let c = colorCache.get(hex)
  if (!c) {
    c = new THREE.Color(hex)
    colorCache.set(hex, c)
  }
  return c
}

/**
 * Normalise a geometry for merging: non-indexed; only position, normal,
 * color, glow. Consumes `geo` (disposes it).
 */
export function paint(
  geo: THREE.BufferGeometry,
  color: string | THREE.Color | Paint | null,
  t?: Xf | THREE.Matrix4,
  glow = 0,
): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone()
  geo.dispose()
  if (!g.attributes.normal) g.computeVertexNormals()
  const keep = color === null && !!g.attributes.color
  for (const name of Object.keys(g.attributes))
    if (name !== 'position' && name !== 'normal' && !(keep && name === 'color')) g.deleteAttribute(name)
  g.morphAttributes = {}
  g.clearGroups()
  if (t) g.applyMatrix4(t instanceof THREE.Matrix4 ? t : xfMatrix(t))
  const pos = g.attributes.position.array as Float32Array
  const nor = g.attributes.normal.array as Float32Array
  const n = g.attributes.position.count
  const c = new Float32Array(n * 3)
  if (keep) {
    c.set(g.attributes.color.array as Float32Array)
  } else if (typeof color === 'function') {
    for (let i = 0; i < n; i++) {
      const k = i * 3
      color(pos[k], pos[k + 1], pos[k + 2], _c, nor[k], nor[k + 1], nor[k + 2])
      c[k] = _c.r
      c[k + 1] = _c.g
      c[k + 2] = _c.b
    }
  } else {
    const cc = typeof color === 'string' ? col(color) : color ?? col('#ffffff')
    for (let i = 0; i < n; i++) {
      c[i * 3] = cc.r
      c[i * 3 + 1] = cc.g
      c[i * 3 + 2] = cc.b
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  const gl = new Float32Array(n)
  if (glow) gl.fill(glow)
  g.setAttribute('glow', new THREE.BufferAttribute(gl, 1))
  return g
}

// ------------------------------------------------------------------ fast builder

/** Cached unit primitives (indexed, with normals). */
const prim = new Map<string, THREE.BufferGeometry>()
function unit(key: string, make: () => THREE.BufferGeometry) {
  let g = prim.get(key)
  if (!g) {
    g = make()
    prim.set(key, g)
  }
  return g
}

/** Rounded-box template per segment count: per-vertex sign + direction (RoundedBoxGeometry's method). */
interface RTemplate {
  sign: Float32Array
  dir: Float32Array
  index: ArrayLike<number>
  count: number
}
const rTemplates = new Map<number, RTemplate>()
function rTemplate(seg: number): RTemplate {
  let t = rTemplates.get(seg)
  if (t) return t
  const S = seg * 2 + 1
  const box = new THREE.BoxGeometry(1, 1, 1, S, S, S)
  const pos = box.attributes.position
  const half = 0.5 / S
  const sign = new Float32Array(pos.count * 3)
  const dir = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const sx = Math.sign(v.x), sy = Math.sign(v.y), sz = Math.sign(v.z)
    sign[i * 3] = sx
    sign[i * 3 + 1] = sy
    sign[i * 3 + 2] = sz
    v.set(v.x - sx * half, v.y - sy * half, v.z - sz * half)
    if (v.lengthSq() < 1e-12) v.set(sx, sy, sz)
    v.normalize()
    dir[i * 3] = v.x
    dir[i * 3 + 1] = v.y
    dir[i * 3 + 2] = v.z
  }
  t = { sign, dir, index: box.index!.array, count: pos.count }
  rTemplates.set(seg, t)
  box.dispose()
  return t
}

const _nm = new THREE.Matrix3()
const _mm = new THREE.Matrix4()
const _mx = new THREE.Matrix4()

/**
 * Collects painted parts straight into growing typed arrays (no per-part
 * geometry clones or merges) and emits ONE non-indexed geometry with
 * position / normal / color / glow.
 */
export class Builder {
  private pos = new Float32Array(3 * 4096)
  private nor = new Float32Array(3 * 4096)
  private colr = new Float32Array(3 * 4096)
  private glw = new Float32Array(4096)
  private n = 0

  private ensure(extra: number) {
    const need = this.n + extra
    if (need <= this.glw.length) return
    let cap = this.glw.length
    while (cap < need) cap *= 2
    const grow = (a: Float32Array, k: number) => {
      const b = new Float32Array(cap * k)
      b.set(a.subarray(0, this.n * k))
      return b
    }
    this.pos = grow(this.pos, 3)
    this.nor = grow(this.nor, 3)
    this.colr = grow(this.colr, 3)
    this.glw = grow(this.glw, 1)
  }

  /**
   * Append raw vertex data (index optional) transformed by `m`, painted with
   * `color` (hex / Color / Paint, or a per-source-vertex colour array).
   */
  private push(
    P: ArrayLike<number>,
    N: ArrayLike<number>,
    index: ArrayLike<number> | null,
    count: number,
    color: string | THREE.Color | Paint | ArrayLike<number> | null,
    m: THREE.Matrix4 | null,
    glow: number,
    glowArr?: ArrayLike<number>,
  ) {
    const total = index ? index.length : count
    this.ensure(total)
    const e = m ? m.elements : null
    if (m) _nm.getNormalMatrix(m)
    const ne = _nm.elements
    const flat = typeof color === 'string' ? col(color) : color instanceof THREE.Color ? color : null
    const fn = typeof color === 'function' ? (color as Paint) : null
    const arr = !flat && !fn && color ? (color as ArrayLike<number>) : null
    const pos = this.pos, nor = this.nor, cc = this.colr, gl = this.glw
    let o = this.n
    for (let k = 0; k < total; k++) {
      const i = index ? index[k] : k
      let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]
      let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2]
      if (e) {
        const tx = e[0] * x + e[4] * y + e[8] * z + e[12]
        const ty = e[1] * x + e[5] * y + e[9] * z + e[13]
        const tz = e[2] * x + e[6] * y + e[10] * z + e[14]
        x = tx
        y = ty
        z = tz
        const ux = ne[0] * nx + ne[3] * ny + ne[6] * nz
        const uy = ne[1] * nx + ne[4] * ny + ne[7] * nz
        const uz = ne[2] * nx + ne[5] * ny + ne[8] * nz
        const l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1
        nx = ux / l
        ny = uy / l
        nz = uz / l
      }
      pos[o * 3] = x
      pos[o * 3 + 1] = y
      pos[o * 3 + 2] = z
      nor[o * 3] = nx
      nor[o * 3 + 1] = ny
      nor[o * 3 + 2] = nz
      if (fn) {
        fn(x, y, z, _c, nx, ny, nz)
        cc[o * 3] = _c.r
        cc[o * 3 + 1] = _c.g
        cc[o * 3 + 2] = _c.b
      } else if (arr) {
        cc[o * 3] = arr[i * 3]
        cc[o * 3 + 1] = arr[i * 3 + 1]
        cc[o * 3 + 2] = arr[i * 3 + 2]
      } else {
        const f = flat ?? col('#ffffff')
        cc[o * 3] = f.r
        cc[o * 3 + 1] = f.g
        cc[o * 3 + 2] = f.b
      }
      gl[o] = glowArr ? glowArr[i] : glow
      o++
    }
    this.n = o
  }

  private pushGeo(geo: THREE.BufferGeometry, color: string | THREE.Color | Paint | null, m: THREE.Matrix4 | null, glow: number) {
    if (!geo.attributes.normal) geo.computeVertexNormals()
    const P = geo.attributes.position.array as ArrayLike<number>
    const N = geo.attributes.normal.array as ArrayLike<number>
    const own = color === null && geo.attributes.color ? (geo.attributes.color.array as ArrayLike<number>) : null
    const idx = geo.index ? geo.index.array : null
    this.push(P, N, idx, geo.attributes.position.count, own ?? color, m, glow)
  }

  /** Add any geometry (consumed). color null = keep the geometry's own `color` attribute. */
  add(geo: THREE.BufferGeometry, color: string | THREE.Color | Paint | null, t?: Xf | THREE.Matrix4, glow = 0) {
    const m = t ? (t instanceof THREE.Matrix4 ? t : xfMatrix(t, _mm)) : null
    this.pushGeo(geo, color, m, glow)
    geo.dispose()
    return this
  }

  /** Add an already-painted kit geometry (keeps its colours + glow; not consumed). */
  addPainted(geo: THREE.BufferGeometry, t?: Xf | THREE.Matrix4) {
    const m = t ? (t instanceof THREE.Matrix4 ? t : xfMatrix(t, _mm)) : null
    if (!geo.attributes.normal) geo.computeVertexNormals()
    const P = geo.attributes.position.array as ArrayLike<number>
    const N = geo.attributes.normal.array as ArrayLike<number>
    const Cc = geo.attributes.color ? (geo.attributes.color.array as ArrayLike<number>) : null
    const G = geo.attributes.glow ? (geo.attributes.glow.array as ArrayLike<number>) : undefined
    this.push(P, N, geo.index ? geo.index.array : null, geo.attributes.position.count, Cc ?? C_WHITE, m, 0, G)
    return this
  }

  /** Unit primitive scaled into place: m = T(xf) · S(sx, sy, sz). */
  private unitPrim(g: THREE.BufferGeometry, sx: number, sy: number, sz: number, color: string | Paint, t: Xf | undefined, glow: number) {
    _mx.makeScale(sx, sy, sz)
    if (t) _mx.premultiply(xfMatrix(t, _mm))
    this.pushGeo(g, color, _mx, glow)
    return this
  }

  box(w: number, h: number, d: number, color: string | Paint, t?: Xf, glow = 0) {
    return this.unitPrim(unit('box', () => new THREE.BoxGeometry(1, 1, 1)), w, h, d, color, t, glow)
  }

  /** Rounded box (clay edges). r = corner radius, seg = arc segments. */
  rbox(w: number, h: number, d: number, r: number, color: string | Paint, t?: Xf, seg = 2, glow = 0) {
    const tp = rTemplate(Math.max(1, Math.min(3, Math.round(seg))))
    const rr = Math.max(0, Math.min(r, w / 2, h / 2, d / 2))
    const P = new Float32Array(tp.count * 3)
    const hw = w / 2 - rr, hh = h / 2 - rr, hd = d / 2 - rr
    for (let i = 0; i < tp.count; i++) {
      P[i * 3] = tp.sign[i * 3] * hw + tp.dir[i * 3] * rr
      P[i * 3 + 1] = tp.sign[i * 3 + 1] * hh + tp.dir[i * 3 + 1] * rr
      P[i * 3 + 2] = tp.sign[i * 3 + 2] * hd + tp.dir[i * 3 + 2] * rr
    }
    const m = t ? xfMatrix(t, _mm) : null
    this.push(P, tp.dir, tp.index, tp.count, color, m, glow)
    return this
  }

  cyl(rTop: number, rBot: number, h: number, seg: number, color: string | Paint, t?: Xf, glow = 0) {
    const base = Math.max(rTop, rBot, 1e-6)
    const k = Math.round((Math.min(rTop, rBot) / base) * 40) / 40
    const topIsWide = rTop >= rBot
    const g = unit(`cyl|${k}|${topIsWide ? 1 : 0}|${seg}`, () => new THREE.CylinderGeometry(topIsWide ? 1 : k, topIsWide ? k : 1, 1, seg))
    return this.unitPrim(g, base, h, base, color, t, glow)
  }

  sphere(r: number, color: string | Paint, t?: Xf, detail = 2, glow = 0) {
    const g = unit(`ico|${detail}`, () => new THREE.IcosahedronGeometry(1, detail))
    return this.unitPrim(g, r, r, r, color, t, glow)
  }

  cone(r: number, h: number, seg: number, color: string | Paint, t?: Xf) {
    const g = unit(`cone|${seg}`, () => new THREE.ConeGeometry(1, 1, seg))
    return this.unitPrim(g, r, h, r, color, t, 0)
  }

  get empty() {
    return this.n === 0
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    const n = this.n
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, n * 3), 3))
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, n * 3), 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.colr.slice(0, n * 3), 3))
    g.setAttribute('glow', new THREE.BufferAttribute(this.glw.slice(0, n), 1))
    this.n = 0
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }
}

const C_WHITE = new THREE.Color('#ffffff')

/** Convenience: vertical gradient paint between two colours over [y0, y1]. */
export function vgrad(bottom: string, top: string, y0: number, y1: number): Paint {
  const a = col(bottom), b = col(top)
  return (_x, y, _z, out) => {
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))
    out.copy(a).lerp(b, t)
  }
}

/**
 * Two-tone "toy" shading baked into a blob: lighter where the normal faces up
 * and toward the sun side, darker underneath.
 */
export function twoTone(base: string, light: string, dark: string, y0: number, y1: number): Paint {
  const c0 = col(base), cl = col(light), cd = col(dark)
  return (_x, y, _z, out, _nx, ny) => {
    const h = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))
    const up = ny * 0.5 + 0.5
    const k = h * 0.55 + up * 0.45
    if (k > 0.5) out.copy(c0).lerp(cl, (k - 0.5) * 2 * 0.9)
    else out.copy(cd).lerp(c0, k * 2)
  }
}

/** Cheap deterministic 2D value noise in [0,1] for baking colour variation. */
export function vnoise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = ihash(xi, yi), b = ihash(xi + 1, yi), c = ihash(xi, yi + 1), d = ihash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Integer lattice hash → [0, 1). */
function ihash(a: number, b: number) {
  let n = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

export function fbm2(x: number, y: number, oct = 3) {
  let s = 0, a = 0.5, f = 1, n = 0
  for (let i = 0; i < oct; i++) {
    s += a * vnoise2(x * f + i * 17.3, y * f - i * 9.1)
    n += a
    a *= 0.5
    f *= 2.03
  }
  return s / n
}
