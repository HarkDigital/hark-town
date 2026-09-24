import * as THREE from 'three'

/*
 * The hero's drone path: a telephoto, near-isometric camera orbiting the HQ
 * island. Poses are keyframed on local progress and interpolated with a
 * monotone cubic (no overshoot, continuous velocity), then FITTED to the
 * viewport: `size` is how much of the frame the island fills and (sx, sy) is
 * where its centre sits in NDC — so the island always leaves room for the copy,
 * in landscape (island right, copy left) and portrait (island up, copy below).
 */

export interface Key {
  t: number
  /** orbit azimuth, degrees (camera at sin/cos of it) */
  az: number
  /** elevation, degrees */
  el: number
  /** fraction of the frame's height (landscape) or width (portrait) the island fills */
  size: number
  sx: number
  sy: number
  /** world-y rise of the whole rig (into the clouds) */
  lift: number
}

const k = (t: number, az: number, el: number, size: number, sx: number, sy: number, lift = 0): Key => ({ t, az, el, size, sx, sy, lift })

// island right, copy left
const LAND: Key[] = [
  k(0.0, -8, 50, 0.76, 0.24, -0.01, 1.5),
  k(0.075, 4, 45, 0.8, 0.26, -0.04),
  k(0.14, 12, 45, 0.76, 0.22, -0.02),
  k(0.3, 30, 40, 0.98, 0.08, 0.0),
  k(0.46, 50, 36, 1.06, 0.02, 0.02),
  k(0.58, 62, 33, 0.9, 0.14, -0.02),
  k(0.68, 70, 30, 0.74, 0.35, -0.14),
  k(0.9, 77, 29, 0.72, 0.35, -0.14),
  k(1.0, 88, 50, 0.56, 0.28, 0.1, 9),
]

// island up, copy below
const PORT: Key[] = [
  k(0.0, -8, 54, 0.86, 0, 0.32, 1.5),
  k(0.075, 4, 50, 0.94, 0, 0.3),
  k(0.14, 12, 50, 0.96, 0, 0.3),
  k(0.3, 30, 44, 1.25, 0, 0.12),
  k(0.46, 50, 40, 1.3, 0, 0.12),
  k(0.58, 62, 38, 1.05, 0, 0.26),
  k(0.68, 70, 36, 0.98, 0, 0.3),
  k(0.9, 77, 35, 0.98, 0, 0.3),
  k(1.0, 88, 54, 0.7, 0, 0.42, 9),
]

type Prop = 'az' | 'el' | 'size' | 'sx' | 'sy' | 'lift'
const tangents = new Map<Key[], Record<Prop, number[]>>()

/** Fritsch–Carlson monotone tangents per property (cached per key set). */
function tan(keys: Key[]) {
  let m = tangents.get(keys)
  if (m) return m
  const out = {} as Record<Prop, number[]>
  for (const p of ['az', 'el', 'size', 'sx', 'sy', 'lift'] as Prop[]) {
    const n = keys.length
    const d: number[] = []
    for (let i = 0; i < n - 1; i++) d.push((keys[i + 1][p] - keys[i][p]) / (keys[i + 1].t - keys[i].t))
    const tg: number[] = [d[0]]
    for (let i = 1; i < n - 1; i++) tg.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
    tg.push(d[n - 2])
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        tg[i] = tg[i + 1] = 0
        continue
      }
      const a = tg[i] / d[i], b = tg[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        tg[i] = t * a * d[i]
        tg[i + 1] = t * b * d[i]
      }
    }
    out[p] = tg
  }
  tangents.set(keys, out)
  return out
}

function sample(keys: Key[], t: number, p: Prop) {
  if (t <= keys[0].t) return keys[0][p]
  const n = keys.length
  if (t >= keys[n - 1].t) return keys[n - 1][p]
  let i = 0
  while (i < n - 2 && t > keys[i + 1].t) i++
  const a = keys[i], b = keys[i + 1]
  const h = b.t - a.t
  const s = (t - a.t) / h
  const tg = tan(keys)[p]
  const s2 = s * s, s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * a[p] + (s3 - 2 * s2 + s) * h * tg[i] + (-2 * s3 + 3 * s2) * b[p] + (s3 - s2) * h * tg[i + 1]
}

const D2R = Math.PI / 180
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _Y = new THREE.Vector3(0, 1, 0)
const _fwd = new THREE.Vector3()

export interface HeroPose {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
  /** radians */
  az: number
  el: number
  dist: number
  /** screen-space centre of the island (NDC) */
  sx: number
  sy: number
  portrait: boolean
}

export const ISLAND_R = 7.6
/** grass top to the tip of the rocky underside */
const UNDER = 8.2

export function isPortrait(aspect: number) {
  return aspect < 0.85
}

/**
 * Write the camera pose for `local` at this aspect. `keepLeft` (landscape):
 * NDC x of the welcome plate's right edge — during the opening the island is
 * nudged right (and, if it must, shrunk) so it never tucks under the plate.
 */
export function heroPose(local: number, aspect: number, out: HeroPose, keepLeft = -1) {
  const portrait = isPortrait(aspect)
  const keys = portrait ? PORT : LAND
  const az = sample(keys, local, 'az') * D2R
  const el = sample(keys, local, 'el') * D2R
  // short phones: the signage takes a bigger share of the height, so the island gives way
  const short = portrait ? Math.min(1, Math.max(0, (aspect - 0.47) / 0.1)) : 0
  const size = sample(keys, local, 'size') * (1 - short * 0.12)
  let sx = sample(keys, local, 'sx')
  const sy = sample(keys, local, 'sy') + short * 0.05
  const lift = sample(keys, local, 'lift')
  const fov = portrait ? 17 : 15
  const tanH = Math.tan((fov / 2) * D2R)

  // the island's projected extent in view-plane units
  const se = Math.sin(el), ce = Math.cos(el)
  const top = Math.max(ISLAND_R * se + 1.3 * ce, 3.9 * ce)
  const bottom = -Math.max(ISLAND_R * se, UNDER * ce * 0.92)
  const hh = (top - bottom) / 2
  const hc = (top + bottom) / 2
  let dist = portrait ? ISLAND_R / (size * tanH * aspect) : Math.max(hh / (size * tanH), ISLAND_R / (Math.min(0.7, size * 0.85) * tanH * aspect))

  // opening keep-out: the island's left rim stays clear of the welcome plate
  const w = portrait || keepLeft <= -1 ? 0 : 1 - Math.min(1, Math.max(0, (local - 0.1) / 0.05))
  if (w > 0) {
    const edge = keepLeft + 0.03
    let half = (ISLAND_R * 0.97) / (dist * tanH * aspect)
    let nsx = sx
    if (nsx - half < edge) nsx = Math.min(edge + half, 0.99 - half)
    if (nsx - half < edge) {
      half = (0.99 - edge) / 2
      nsx = edge + half
      dist = Math.max(dist, (ISLAND_R * 0.97) / (half * tanH * aspect))
    }
    sx += (nsx - sx) * w
    // blend the distance too (w < 1 only across the hand-off)
    const d0 = portrait ? dist : Math.max(hh / (size * tanH), ISLAND_R / (Math.min(0.7, size * 0.85) * tanH * aspect))
    dist = d0 + (dist - d0) * w
  }

  _dir.set(Math.sin(az) * ce, se, Math.cos(az) * ce)
  _fwd.copy(_dir).negate()
  _right.crossVectors(_fwd, _Y).normalize()
  _up.crossVectors(_right, _fwd)
  out.tgt
    .set(0, 0, 0)
    .addScaledVector(_up, hc)
    .addScaledVector(_right, -sx * dist * tanH * aspect)
    .addScaledVector(_up, -sy * dist * tanH)
  out.tgt.y += lift
  out.pos.copy(out.tgt).addScaledVector(_dir, dist)
  out.pos.y += lift * 0.6
  out.fov = fov
  out.az = az
  out.el = el
  out.dist = dist
  out.sx = sx
  out.sy = sy
  out.portrait = portrait
  return out
}
