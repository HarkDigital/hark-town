import * as THREE from 'three'
import { rng } from '../core/math'
import { C, clayVC } from './palette'
import { Builder, col, fbm2, vnoise2 } from './geo'

/*
 * Floating island diorama: a flat grass top at y = 0 (colour-varied, with a
 * soft rolled lip that overhangs), 2–3 layered soil strata, a soft pale rock
 * underside that tapers to a point, dangling rocks and roots. One merged
 * vertex-colour mesh (one draw call). The top receives shadows; the island
 * does not cast by default (cheap).
 *
 * userData on the returned group:
 *   radius             nominal radius (options.radius)
 *   radiusAt(a)        top-edge radius at angle a (radians, a = atan2(z, x))
 *   edge(a, out?)      Vector3 on the grass edge at angle a (y = 0)
 *   contains(x, z, m)  is (x, z) on the top with margin m?
 *   randomPoint(rand, margin, out?)  uniform random point on the top
 */
export interface IslandOptions {
  radius?: number
  /** thickness of the soil strata below the grass */
  thickness?: number
  /** depth of the rocky underside (below the strata) */
  depth?: number
  seed?: number
  /** irregularity of the outline, 0..0.3 */
  wobble?: number
  /** grass colour */
  top?: string
  /** optional sandy beach ring width (world units) */
  beach?: number
  /** x/z aspect of the outline (2 = twice as long in x) */
  aspect?: number
  /** 0 round .. 1 rounded-square outline */
  square?: number
  /** size of the rolled grass lip (default 0.22) */
  lip?: number
  /** soil band colours, top → bottom (default three warm bands) */
  strata?: string[]
  /** underside rock colour (mid tone) */
  rock?: string
  /** dangling rocks under the island (default by radius) */
  hanging?: number
  /** dangling roots (default false) */
  roots?: boolean
  /** mossy grass drips hanging over the lip (default true) */
  drips?: boolean
  /** mesh detail 0.5..1.5 (use 0.6 on mobile) */
  detail?: number
  /** cast shadows (default false — tops receive; undersides rarely matter) */
  castShadow?: boolean
}

export interface IslandData {
  radius: number
  radiusAt: (a: number) => number
  edge: (a: number, out?: THREE.Vector3) => THREE.Vector3
  contains: (x: number, z: number, margin?: number) => boolean
  randomPoint: (rand: () => number, margin?: number, out?: THREE.Vector3) => THREE.Vector3
}

/** Build the outline function for an island. */
function outlineFn(R: number, o: IslandOptions, rand: () => number) {
  const wob = o.wobble ?? 0.12
  const aspect = o.aspect ?? 1
  const p = 2 + (o.square ?? 0) * 6
  const f1 = rand() * 6.28, f2 = rand() * 6.28, f3 = rand() * 6.28
  // radius (in the x/z plane) along direction a
  return (a: number) => {
    const ca = Math.cos(a), sa = Math.sin(a)
    const se = Math.pow(Math.pow(Math.abs(ca), p) + Math.pow(Math.abs(sa), p), -1 / p)
    const w = 1 + wob * (0.55 * Math.sin(a * 2 + f1) + 0.3 * Math.sin(a * 3 + f2) + 0.15 * Math.sin(a * 5 + f3))
    // ellipse radius along a for semi-axes (aspect, 1)
    const ell = aspect / Math.sqrt(ca * ca + aspect * aspect * sa * sa)
    return R * se * w * ell
  }
}

/** Strip of rings (each an array of n [x, y, z] points) → indexed smooth geometry, wrapped around. */
function ringStrip(rings: number[][], n: number): THREE.BufferGeometry {
  const pos = new Float32Array(rings.length * n * 3)
  let k = 0
  for (const r of rings) for (let i = 0; i < n * 3; i++) pos[k++] = r[i]
  const idx: number[] = []
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i, b = r * n + ((i + 1) % n), c = (r + 1) * n + i, d = (r + 1) * n + ((i + 1) % n)
      idx.push(a, b, c, b, d, c)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const _c = new THREE.Color()

/** A floating island: grass top (y = 0), soil strata, pale rock underside. */
export function makeIsland(o: IslandOptions = {}): THREE.Group {
  const R = o.radius ?? 8
  const T = o.thickness ?? Math.max(0.6, Math.min(1.4, R * 0.13))
  const D = o.depth ?? R * 0.9
  const L = o.lip ?? Math.min(0.26, 0.08 + R * 0.02)
  const seed = o.seed ?? 3
  const rand = rng(seed)
  const detail = o.detail ?? 1
  const n = Math.max(32, Math.round(Math.min(96, 40 + R * 4) * detail))
  const rOf = outlineFn(R, o, rand)
  const radii: number[] = []
  const dirs: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    radii.push(rOf(a))
    dirs.push([Math.cos(a), Math.sin(a)])
  }
  const b = new Builder()
  const ox = rand() * 50, oz = rand() * 50
  const grass = col(o.top ?? C.grass)
  const gLight = col(C.grassLight), gDeep = col(C.grassDeep), gMeadow = col('#cfe08e')
  const sand = col(C.sand)
  const beach = Math.min(o.beach ?? 0, R * 0.4)

  // ---------- grass top: centre fan + rings
  const beachS = beach > 0 ? 1 - beach / R : 2
  const sList: number[] = []
  const rings = Math.max(5, Math.round((6 + R * 0.6) * detail))
  const grassEnd = beach > 0 ? beachS - 0.02 : 1
  for (let k = 1; k <= rings; k++) sList.push(Math.pow(k / rings, 0.8) * grassEnd)
  if (beach > 0) sList.push(beachS, beachS + (1 - beachS) * 0.5, 1)
  const topPos: number[] = []
  const topCol: number[] = []
  const grassAt = (x: number, z: number, s: number, out: THREE.Color) => {
    const nA = fbm2(x * 0.2 + ox, z * 0.2 + oz, 3)
    const nB = vnoise2(x * 0.9 + oz, z * 0.9 + ox)
    const nC = vnoise2(x * 0.35 - oz, z * 0.35 + ox)
    out.copy(grass)
    if (nA > 0.5) out.lerp(gLight, Math.min(1, (nA - 0.5) * 3) * 0.8)
    else out.lerp(gDeep, Math.min(1, (0.5 - nA) * 3) * 0.7)
    if (nC > 0.72) out.lerp(gMeadow, (nC - 0.72) * 2.4)
    out.multiplyScalar(0.95 + nB * 0.1)
    // sun-kissed rim
    if (s > 0.9) out.lerp(gLight, (s - 0.9) * 2.5)
    return out
  }
  const pushTop = (x: number, y: number, z: number, s: number) => {
    topPos.push(x, y, z)
    if (s > beachS - 0.001) {
      _c.copy(sand).multiplyScalar(0.97 + vnoise2(x * 1.3, z * 1.3) * 0.06)
    } else grassAt(x, z, s, _c)
    topCol.push(_c.r, _c.g, _c.b)
  }
  pushTop(0, 0, 0, 0)
  for (const s of sList) {
    for (let i = 0; i < n; i++) {
      const r = radii[i] * s
      const y = s > beachS ? -0.07 * ((s - beachS) / (1 - beachS)) - 0.015 : 0
      pushTop(dirs[i][0] * r, y, dirs[i][1] * r, s)
    }
  }
  const topIdx: number[] = []
  for (let i = 0; i < n; i++) topIdx.push(0, 1 + ((i + 1) % n), 1 + i)
  for (let k = 0; k < sList.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = 1 + k * n + i, bb = 1 + k * n + ((i + 1) % n), c = 1 + (k + 1) * n + i, d = 1 + (k + 1) * n + ((i + 1) % n)
      topIdx.push(a, bb, c, bb, d, c)
    }
  }
  const topGeo = new THREE.BufferGeometry()
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topPos, 3))
  topGeo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(topPos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  topGeo.setIndex(topIdx)
  topGeo.setAttribute('color', new THREE.Float32BufferAttribute(topCol, 3))
  b.add(topGeo, null)

  // ---------- rolled lip + overhang
  const edgeY = beach > 0 ? -0.085 : 0
  const edgeCol = beach > 0 ? C.sand : C.grassLight
  const lipRings: number[][] = []
  const lipSteps = 4
  for (let j = 0; j <= lipSteps; j++) {
    const th = (j / lipSteps) * Math.PI * 0.5
    const out = L * Math.sin(th)
    const y = edgeY - L * (1 - Math.cos(th))
    const ring: number[] = []
    for (let i = 0; i < n; i++) {
      const r = radii[i] + out
      ring.push(dirs[i][0] * r, y, dirs[i][1] * r)
    }
    lipRings.push(ring)
  }
  // tuck under: the overhang's underside
  const tuck: number[] = []
  for (let i = 0; i < n; i++) {
    const r = radii[i] + L * 0.2
    tuck.push(dirs[i][0] * r, edgeY - L * 1.45, dirs[i][1] * r)
  }
  lipRings.push(tuck)
  const lipTop = col(edgeCol), lipBot = col(beach > 0 ? C.sand : C.grassDeep)
  const yLipTop = edgeY, yLipBot = edgeY - L * 1.45
  b.add(ringStrip(lipRings, n), (_x, y, _z, out) => out.copy(lipTop).lerp(lipBot, Math.min(1, (yLipTop - y) / (yLipTop - yLipBot)) ** 1.5))

  // ---------- soil strata (each band starts exactly on the ring above: no gaps)
  const strata = o.strata ?? [C.soilDeep, C.soil, C.soilLight]
  const props = strata.length === 2 ? [0.45, 0.55] : strata.length === 3 ? [0.26, 0.4, 0.34] : strata.map(() => 1 / strata.length)
  const insets = [0.0, 0.1, 0.04, 0.12]
  const baseTop = edgeY - L * 1.45
  let yTop = baseTop
  const phase = rand() * 6.28
  const wave = (a: number, k: number) => 0.07 * Math.sin(a * 3 + phase + k * 1.7) + 0.04 * Math.sin(a * 7 - phase * 2 + k)
  let prev: number[] = tuck
  for (let s = 0; s < strata.length; s++) {
    const h = T * props[s]
    const inset = insets[s % insets.length] * (L / 0.22)
    const step: number[] = [], mid: number[] = [], bot: number[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const r0 = radii[i] + L * 0.2 - inset
      const bulge = 0.03 + 0.035 * vnoise2(a * 4 + s * 3, s)
      const yT = prev[i * 3 + 1]
      const yB = s === strata.length - 1 ? baseTop - T : yTop - h + wave(a, s)
      step.push(dirs[i][0] * r0, yT - 0.015, dirs[i][1] * r0)
      mid.push(dirs[i][0] * (r0 + bulge), (yT + yB) / 2, dirs[i][1] * (r0 + bulge))
      bot.push(dirs[i][0] * (r0 - 0.03), yB, dirs[i][1] * (r0 - 0.03))
    }
    const cc = col(strata[s])
    b.add(ringStrip([prev, step, mid, bot], n), (x, y, z, out) => out.copy(cc).multiplyScalar(0.93 + vnoise2(x * 2.2 + y * 3, z * 2.2) * 0.12))
    prev = bot
    yTop -= h
  }
  const strataBottom = prev

  // ---------- rock underside: soft terraced bulges tapering to a point
  const J = Math.max(6, Math.round(10 * detail))
  const uRings: number[][] = [strataBottom]
  const y0 = edgeY - L * 1.45 - T
  const tipX = (rand() - 0.5) * R * 0.15, tipZ = (rand() - 0.5) * R * 0.15
  const ringT: number[] = [0]
  for (let j = 1; j <= J; j++) {
    const t = j / J
    ringT.push(t)
    const ring: number[] = []
    // terraces: odd rings tuck in a little so the rock reads as soft ledges
    const terrace = j % 2 ? 0.93 : 1
    const shrink = Math.pow(1 - t, 1.2) * (1 - 0.08 * t) * terrace
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const bump = 0.8 + 0.38 * vnoise2(Math.cos(a) * 1.8 + j * 0.5 + seed, Math.sin(a) * 1.8 - j * 0.35)
      const groove = 1 + 0.07 * Math.sin(a * 9 + j * 0.6 + phase) * Math.min(1, t * 3)
      const r = Math.max(0.05, (radii[i] + L * 0.1) * shrink * bump * groove)
      const cx = tipX * t * t, cz = tipZ * t * t
      ring.push(cx + dirs[i][0] * r, y0 - t * D + (j < J ? (vnoise2(a * 3, j * 2.1) - 0.5) * D * 0.06 : 0), cz + dirs[i][1] * r)
    }
    uRings.push(ring)
  }
  const tip: number[] = []
  for (let i = 0; i < n; i++) tip.push(tipX, y0 - D * 1.04, tipZ)
  uRings.push(tip)
  const rTop = col(C.rockLight), rMid = col(o.rock ?? C.rock), rBot = col(C.rockShade)
  const bandK = (y: number) => {
    // soft sedimentary banding
    const t = (y0 - y) / D
    return 0.94 + 0.08 * (Math.sin(t * 26 + phase) > 0.35 ? 1 : 0)
  }
  b.add(ringStrip(uRings, n), (x, y, z, out) => {
    const t = Math.min(1, Math.max(0, (y0 - y) / D))
    if (t < 0.3) out.copy(rTop).lerp(rMid, t / 0.3)
    else out.copy(rMid).lerp(rBot, Math.min(1, (t - 0.3) / 0.6))
    return out.multiplyScalar(bandK(y) * (0.96 + vnoise2(x * 1.4 + y, z * 1.4) * 0.08))
  })

  // ---------- dangling rocks
  const hang = o.hanging ?? Math.round(Math.min(7, 2 + R * 0.4) * Math.min(1, detail + 0.2))
  for (let h = 0; h < hang; h++) {
    const a = rand() * Math.PI * 2
    const t = h < 2 ? 0.7 + rand() * 0.15 : 0.25 + rand() * 0.45
    const i = Math.floor((a / (Math.PI * 2)) * n) % n
    const r = radii[i] * Math.pow(1 - t, 1.25) * 0.8
    const len = (0.35 + rand() * 0.7) * Math.max(0.8, D * 0.18)
    const w = len * (0.28 + rand() * 0.12)
    const yA = y0 - t * D
    const tint = (_x: number, y: number, _z: number, out: THREE.Color) => out.copy(rMid).lerp(rBot, Math.min(1, Math.max(0, (yA - y) / len + 0.3)))
    b.cone(w, len, 6, tint, { x: Math.cos(a) * r, y: yA - len * 0.42, z: Math.sin(a) * r, rx: Math.PI, ry: rand() * 3, rz: (rand() - 0.5) * 0.25 })
  }

  // ---------- roots curling off the strata
  if (o.roots) {
    const count = Math.round(Math.min(7, 2 + R * 0.4) * detail)
    const bark = col(C.bark), barkDark = col(C.woodDark)
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2
      const i = Math.floor((a / (Math.PI * 2)) * n) % n
      const r = radii[i] + L * 0.12
      const len = 0.5 + rand() * 0.7
      const yA = edgeY - L * 1.45 - rand() * T * 0.4
      const out = 0.12 + rand() * 0.15
      const side = (rand() - 0.5) * 0.4
      const ca = Math.cos(a), sa = Math.sin(a)
      const pts = [0, 0.33, 0.66, 1].map(t => {
        const rr = r + Math.sin(t * Math.PI * 0.8) * out
        const lat = side * t * t
        return new THREE.Vector3(ca * rr - sa * lat, yA - t * len, sa * rr + ca * lat)
      })
      const curve = new THREE.CatmullRomCurve3(pts)
      const segs = 8
      const tube = new THREE.TubeGeometry(curve, segs, 0.035, 5, false)
      const pos = tube.attributes.position
      const c = new THREE.Vector3(), v = new THREE.Vector3()
      for (let vi = 0; vi < pos.count; vi++) {
        const seg = Math.floor(vi / 6)
        const t = seg / segs
        curve.getPointAt(Math.min(1, t), c)
        v.fromBufferAttribute(pos, vi).sub(c).multiplyScalar(1 - t * 0.8).add(c)
        pos.setXYZ(vi, v.x, v.y, v.z)
      }
      tube.computeVertexNormals()
      b.add(tube, (_x, y, _z, o2) => o2.copy(bark).lerp(barkDark, Math.min(1, (yA - y) / len)))
    }
  }

  // ---------- mossy drips over the lip
  if (o.drips !== false && beach <= 0) {
    const count = Math.round(Math.min(26, 6 + R * 2) * detail)
    const gTop = col(C.grassDeep), gTip = col('#6aa65a')
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2
      const r = rOf(a) + L * 0.55
      const len = (0.04 + rand() * 0.2) * (0.7 + L * 1.5)
      const w = 0.07 + rand() * 0.07
      const yA = edgeY - L * 1.1
      b.sphere(1, (_x, y, _z, o2) => o2.copy(gTop).lerp(gTip, Math.min(1, Math.max(0, (yA - y) / (len + w)))), {
        x: Math.cos(a) * r,
        y: yA - len * 0.35,
        z: Math.sin(a) * r,
        sx: w * 0.5,
        sy: len * 0.6 + w,
        sz: w * 1.5,
        ry: -a,
      }, 1)
    }
  }

  const geo = b.build()
  const mesh = new THREE.Mesh(geo, clayVC())
  mesh.name = 'island'
  mesh.receiveShadow = true
  mesh.castShadow = !!o.castShadow
  const g = new THREE.Group()
  g.add(mesh)

  const radiusAt = (a: number) => rOf(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2))
  const data: IslandData = {
    radius: R,
    radiusAt,
    edge: (a, out = new THREE.Vector3()) => {
      const r = radiusAt(a)
      return out.set(Math.cos(a) * r, edgeY, Math.sin(a) * r)
    },
    contains: (x, z, m = 0) => Math.hypot(x, z) <= radiusAt(Math.atan2(z, x)) - m,
    randomPoint: (rr, m = 0, out = new THREE.Vector3()) => {
      for (let tries = 0; tries < 40; tries++) {
        const a = rr() * Math.PI * 2
        const rad = Math.sqrt(rr()) * (radiusAt(a) - m)
        if (rad >= 0) return out.set(Math.cos(a) * rad, 0, Math.sin(a) * rad)
      }
      return out.set(0, 0, 0)
    },
  }
  Object.assign(g.userData, data)
  return g
}

/**
 * Scatter-friendly points on an island top (rejection sampled, min spacing).
 * `avoid` = circles to keep clear (roads, buildings).
 */
export function islandPoints(
  island: THREE.Object3D,
  count: number,
  opts: { seed?: number; margin?: number; spacing?: number; avoid?: { x: number; z: number; r: number }[]; minR?: number } = {},
): THREE.Vector3[] {
  const d = island.userData as IslandData
  const rand = rng(opts.seed ?? 11)
  const out: THREE.Vector3[] = []
  const sp = opts.spacing ?? 0.5
  const avoid = opts.avoid ?? []
  for (let tries = 0; tries < count * 30 && out.length < count; tries++) {
    const p = d.randomPoint(rand, opts.margin ?? 0.4)
    if (opts.minR && Math.hypot(p.x, p.z) < opts.minR) continue
    if (avoid.some(c => Math.hypot(p.x - c.x, p.z - c.z) < c.r)) continue
    if (out.some(q => Math.hypot(p.x - q.x, p.z - q.z) < sp)) continue
    out.push(p)
  }
  return out
}
