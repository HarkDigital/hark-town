import * as THREE from 'three'
import { clamp, lerp } from '../../core/math'
import type { CameraPose } from '../../core/types'
import { ACROSS, DEEP } from './layout'

/*
 * Drone camera. A shot frames a rounded box of world (a superellipse
 * footprint in the archipelago's across/deep axes, between two heights)
 * from an azimuth + elevation with a telephoto lens, and is solved every
 * frame so the box fills a screen region (the space the signage plate
 * leaves free) exactly, at any aspect ratio.
 */

export interface Shot {
  /** framed center */
  cx: number
  cy: number
  cz: number
  /** half extents along ACROSS / DEEP */
  eu: number
  ev: number
  /** heights (relative to cy) */
  y0: number
  y1: number
  /** superellipse exponent (2 = circle, 6 = rounded rectangle) */
  n: number
  az: number
  el: number
  fov: number
  /** how much of the region the box fills (1 = touching) */
  fill: number
  /** region blend: 0 = beside the plate, 1 = beside the intro (ri), 1 = full frame (rf) */
  ri: number
  rf: number
  /** vertical anchor inside the region, -1 bottom .. 1 top */
  ay: number
}

export const SHOT_KEYS = ['cx', 'cy', 'cz', 'eu', 'ev', 'y0', 'y1', 'n', 'az', 'el', 'fov', 'fill', 'ri', 'rf', 'ay'] as const

export function shot(o: Partial<Shot> = {}): Shot {
  return { cx: 0, cy: 0, cz: 0, eu: 3, ev: 3, y0: -0.3, y1: 1.5, n: 2, az: 0.6, el: 0.7, fov: 16, fill: 0.9, ri: 0, rf: 0, ay: 0, ...o }
}

export function lerpShot(a: Shot, b: Shot, t: number, out: Shot) {
  for (const k of SHOT_KEYS) out[k] = lerp(a[k], b[k], t)
  return out
}

export interface Region {
  l: number
  r: number
  b: number
  t: number
}

const NP = 16
const pa = new Float64Array(NP * 2)
const pb = new Float64Array(NP * 2)
const pc = new Float64Array(NP * 2)
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _back = new THREE.Vector3()

/** Solve the pose for a shot; returns the camera distance. */
export function solveShot(s: Shot, reg: Region, aspect: number, out: CameraPose) {
  const tanY = Math.tan(THREE.MathUtils.degToRad(s.fov) / 2)
  const tanX = tanY * aspect
  const ce = Math.cos(s.el)
  _back.set(Math.sin(s.az) * ce, Math.sin(s.el), Math.cos(s.az) * ce)
  _right.set(Math.cos(s.az), 0, -Math.sin(s.az))
  _up.crossVectors(_back, _right)
  let n = 0
  let dMin = 0
  const ex = 2 / Math.max(2, s.n)
  for (let i = 0; i < NP; i++) {
    const th = (i / NP) * Math.PI * 2
    const c = Math.cos(th), sn = Math.sin(th)
    const u = Math.sign(c) * Math.pow(Math.abs(c), ex) * s.eu
    const v = Math.sign(sn) * Math.pow(Math.abs(sn), ex) * s.ev
    const wx = ACROSS.x * u + DEEP.x * v
    const wz = ACROSS.z * u + DEEP.z * v
    for (const y of [s.y0, s.y1]) {
      pa[n] = wx * _right.x + y * _right.y + wz * _right.z
      pb[n] = wx * _up.x + y * _up.y + wz * _up.z
      const d = -(wx * _back.x + y * _back.y + wz * _back.z)
      pc[n] = d
      dMin = Math.max(dMin, -d + 0.5)
      n++
    }
  }
  const fy = (s.ay + 1) / 2
  let dx = 0, dy = 0
  const measure = (d: number) => {
    let dxL = Infinity, dxR = -Infinity, dyB = Infinity, dyT = -Infinity
    for (let i = 0; i < n; i++) {
      const z = pc[i] + d
      dxL = Math.min(dxL, pa[i] - reg.l * z * tanX)
      dxR = Math.max(dxR, pa[i] - reg.r * z * tanX)
      dyB = Math.min(dyB, pb[i] - reg.b * z * tanY)
      dyT = Math.max(dyT, pb[i] - reg.t * z * tanY)
    }
    dx = (dxL + dxR) / 2
    dy = lerp(dyB, dyT, fy)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < n; i++) {
      const z = pc[i] + d
      const X = (pa[i] - dx) / (z * tanX)
      const Y = (pb[i] - dy) / (z * tanY)
      x0 = Math.min(x0, X)
      x1 = Math.max(x1, X)
      y0 = Math.min(y0, Y)
      y1 = Math.max(y1, Y)
    }
    return Math.max((x1 - x0) / (s.fill * Math.max(0.05, reg.r - reg.l)), (y1 - y0) / (s.fill * Math.max(0.05, reg.t - reg.b)))
  }
  let lo = Math.log(Math.max(0.5, dMin)), hi = Math.log(2000)
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2
    if (measure(Math.exp(mid)) > 1) lo = mid
    else hi = mid
  }
  const d = Math.exp(hi)
  measure(d)
  out.target.set(s.cx, s.cy, s.cz).addScaledVector(_right, dx).addScaledVector(_up, dy)
  out.position.copy(out.target).addScaledVector(_back, d)
  out.fov = s.fov
  return d
}

export function mixRegion(a: Region, b: Region, t: number, out: Region) {
  const k = clamp(t)
  out.l = lerp(a.l, b.l, k)
  out.r = lerp(a.r, b.r, k)
  out.b = lerp(a.b, b.b, k)
  out.t = lerp(a.t, b.t, k)
  return out
}
