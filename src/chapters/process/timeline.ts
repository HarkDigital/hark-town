import * as THREE from 'three'
import { clamp, lerp, segment, smoothstep } from '../../core/math'

/*
 * THE BUILDING SITE — "We listen first. Then we build."
 *
 * One plot on a floating island, one building going up in four steps:
 *
 *   0.00–0.07  descend out of the clouds onto the site (cloud wipe in)
 *   0.07–0.25  1 LISTEN     surveyors peg out the plot; the client talks, a
 *                           green listening cone on a survey tripod listens;
 *                           the blueprint unrolls on a trestle table
 *   0.25–0.41  2 PROTOTYPE  scaffold wireframe sprouts; a cardboard mock-up
 *                           of the building stacks up inside it
 *   0.41–0.62  3 BUILD      the mock-up folds away, the ground floor pops up,
 *                           the tower crane lifts three floors into place
 *   0.62–0.77  4 SUPPORT    topping out, scaffold comes down, the site clutter
 *                           flattens away and the yard turns to lawn, the green
 *                           sign lights, windows glow, a gardener plants trees,
 *                           the mixer leaves and the Hark maintenance van parks
 *   0.775–0.95 the hoarding panels revolve to show the three stats (the
 *              engine's cloud wipe starts rolling in around 0.9)
 *   0.92–1.00  rise into the clouds (cloud wipe out)
 */

export const STEPS: [number, number][] = [
  [0.07, 0.25],
  [0.25, 0.41],
  [0.41, 0.62],
  [0.62, 0.77],
]
export const STATS_AT = [0.775, 0.79, 0.805]
export const HEAD_IN = 0.045
export const HUD_OUT = 0.95

// ---- step 1
export const TRIPOD_AT = 0.07
export const UNROLL: [number, number] = [0.08, 0.13]
export const PEG_AT = (i: number) => 0.09 + i * 0.012
export const STRING_AT = (i: number): [number, number] => [0.105 + i * 0.012, 0.122 + i * 0.012]
export const PEGS_OUT = 0.265
export const LISTEN_OUT = 0.41

// ---- step 2
export const STANDARD_AT = (i: number, n: number) => 0.26 + (i / Math.max(1, n - 1)) * 0.045
export const LEDGER_AT = (level: number, i: number) => 0.285 + level * 0.011 + i * 0.002
export const BRACE_AT = (i: number) => 0.32 + i * 0.003
export const BOARD_AT = (i: number) => 0.325 + i * 0.004
export const CARD_AT = (i: number) => 0.335 + i * 0.014
export const CARD_OUT = 0.415

// ---- step 3
export const GROUND_AT = 0.425
export const LIFTS: [number, number][] = [
  [0.44, 0.5],
  [0.5, 0.56],
  [0.56, 0.62],
]
/** fraction of a lift window where the floor touches down */
export const LAND_P = 0.85
export const landAt = (k: number) => lerp(LIFTS[k][0], LIFTS[k][1], LAND_P)

// ---- step 4
export const ROOF_AT = 0.625
/** construction clutter flattens away; the yard turns to lawn */
export const CLUTTER_OUT = 0.636
export const GRASS_AT = 0.646
export const SCAFF_OUT = (order: number, n: number) => 0.63 + (order / Math.max(1, n - 1)) * 0.04
export const SIGN_AT = 0.655
export const SIGN_ON = 0.67
export const WINDOWS_ON: [number, number] = [0.66, 0.7]
export const MIXER_OUT: [number, number] = [0.625, 0.66]
export const VAN_IN: [number, number] = [0.66, 0.725]
export const LAWN_AT = 0.67
export const TREE_AT = (i: number) => 0.685 + i * 0.011
export const ENTRANCE_AT = 0.705
export const BUNTING_AT = 0.712
export const TECH_AT = 0.73

/** keyboard stops, one per step (step 3 lands with the last floor swinging over) */
export const ANCHORS = [0.18, 0.385, lerp(LIFTS[2][0], LIFTS[2][1], 0.6), 0.76]

// ------------------------------------------------------------------ site layout (site-local units)

/** the building's footprint centre and size */
export const B = new THREE.Vector3(0, 0, -0.5)
export const FOOT = { w: 2.4, d: 1.8 }
export const FLOOR_H = 0.6
export const FLOORS = 4
/** tower crane base */
export const CRANE = new THREE.Vector3(-2.5, 0, -2.5)
export const JIB_Y = 4.85
/** the prefab floors wait here, stacked on a pallet */
export const LAYDOWN = new THREE.Vector3(-3.45, 0, 0.2)
export const PALLET_H = 0.08
export const SLING = 0.42

const polar = (p: THREE.Vector3) => {
  const dx = p.x - CRANE.x
  const dz = p.z - CRANE.z
  return { yaw: Math.atan2(-dz, dx), r: Math.hypot(dx, dz) }
}
const AT_B = polar(B)
const AT_L = polar(LAYDOWN)
const REST = { yaw: AT_L.yaw + 0.5, r: AT_L.r + 0.3 }
const PARK = { yaw: AT_B.yaw + 1.25, r: 1.7 }

export interface CraneState {
  yaw: number
  r: number
  /** hook drop below the jib */
  cable: number
  /** index of the floor on the hook (1..3), or -1 */
  carrying: number
}

/** hook drop that sits a floor with its base at y on the hook */
const dropFor = (baseY: number) => JIB_Y - 0.06 - (baseY + FLOOR_H + SLING)
const HIGH = 0.85

const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** The crane, as a pure function of local progress. */
export function craneAt(l: number, out: CraneState): CraneState {
  out.carrying = -1
  if (l < LIFTS[0][0]) {
    // idle, ready over the laydown; nudges round to it as Build begins
    const k = smoothstep(STEPS[2][0], LIFTS[0][0], l)
    out.yaw = lerpAngle(REST.yaw, AT_L.yaw, k)
    out.r = lerp(REST.r, AT_L.r, k)
    out.cable = HIGH
    return out
  }
  const last = LIFTS.length - 1
  if (l >= LIFTS[last][1]) {
    // park, swung clear of the finished building
    const k = smoothstep(LIFTS[last][1], LIFTS[last][1] + 0.05, l)
    out.yaw = lerpAngle(AT_B.yaw, PARK.yaw, k)
    out.r = lerp(AT_B.r, PARK.r, k)
    out.cable = lerp(HIGH, 0.55, k)
    return out
  }
  let i = 0
  while (i < last && l >= LIFTS[i][1]) i++
  const p = segment(l, LIFTS[i][0], LIFTS[i][1])
  const stackLevel = 2 - i
  const pick = dropFor(LAYDOWN.y + PALLET_H + stackLevel * FLOOR_H)
  const land = dropFor(B.y + (i + 1) * FLOOR_H)
  const from = i === 0 ? AT_L : AT_B
  // 0–.16 swing back to the stack · .16–.28 lower · .28 hook on · .28–.42 hoist
  // .42–.68 swing over the building · .68–.85 lower · .85 set down · .85–1 hoist clear
  const sw1 = smoothstep(0, 0.16, p)
  const sw2 = smoothstep(0.42, 0.68, p)
  out.yaw = lerpAngle(lerpAngle(from.yaw, AT_L.yaw, sw1), AT_B.yaw, sw2)
  out.r = lerp(lerp(from.r, AT_L.r, sw1), AT_B.r, sw2)
  if (p < 0.16) out.cable = HIGH
  else if (p < 0.28) out.cable = lerp(HIGH, pick, smoothstep(0.16, 0.28, p))
  else if (p < 0.42) out.cable = lerp(pick, HIGH, smoothstep(0.28, 0.42, p))
  else if (p < 0.68) out.cable = HIGH
  else if (p < LAND_P) out.cable = lerp(HIGH, land, smoothstep(0.68, LAND_P, p))
  else out.cable = lerp(land, HIGH, smoothstep(LAND_P + 0.02, 1, p))
  if (p >= 0.28 && p < LAND_P) out.carrying = i + 1
  return out
}

/** Which step (0..3) is showing on the HUD at l, or -1. */
export function stepAt(l: number) {
  if (l < STEPS[0][0] || l >= STEPS[3][1]) return -1
  for (let i = 3; i >= 0; i--) if (l >= STEPS[i][0]) return i
  return -1
}

export const stepProgress = (l: number, i: number) => clamp((l - STEPS[i][0]) / (STEPS[i][1] - STEPS[i][0]))

// ------------------------------------------------------------------ camera shots

export interface Shot {
  /** subject centre (site-local, y up) */
  p: [number, number, number]
  /** azimuth from +z toward +x, degrees */
  az: number
  /** elevation, degrees */
  el: number
  /** subject size (world units) to fit inside the free screen band */
  w: number
  h: number
  fov: number
}

type Key = [number, Shot]

const k = (t: number, p: [number, number, number], az: number, el: number, w: number, h: number, fov = 15): Key => [
  t,
  { p, az, el, w, h, fov },
]

/** Landscape: copy column on the left, the island fills the right. */
export const WIDE: Key[] = [
  k(0.0, [0.2, 1.4, -0.6], 34, 64, 30, 26, 17),
  k(0.1, [0.2, 1.1, -0.5], 26, 36, 14.5, 11.5),
  k(0.18, [0.3, 0.6, 0.2], 18, 35, 12, 8.8),
  k(0.26, [0.2, 1.0, -0.2], 12, 34, 11.6, 8.8),
  k(0.385, [0, 1.2, -0.5], 6, 31, 10.2, 8.2),
  k(0.44, [-0.6, 1.9, -0.9], -4, 29, 13.2, 11),
  k(0.596, [-0.6, 2.0, -0.9], -12, 28, 12.6, 11),
  k(0.67, [0.2, 1.4, -0.6], -20, 30, 13.8, 11.2),
  k(0.76, [0.3, 1.3, -0.4], -25, 31, 13.2, 10.6),
  k(0.84, [0.1, 1.0, 1.5], -6, 21, 9.4, 6.4),
  k(0.92, [0.1, 1.05, 1.2], -3, 25, 10.8, 7.6),
  k(1.0, [0.1, 1.8, -0.4], 4, 64, 30, 26, 17),
]

/** Portrait: the island in the upper band, a little more top-down. */
export const TALL: Key[] = [
  k(0.0, [0.2, 1.4, -0.6], 34, 66, 26, 26, 17),
  k(0.1, [0.2, 1.1, -0.5], 26, 40, 13.4, 11),
  k(0.18, [0.3, 0.6, 0.2], 18, 38, 11.2, 9.4),
  k(0.26, [0.2, 1.0, -0.2], 12, 37, 11, 9.4),
  k(0.385, [0, 1.2, -0.5], 6, 35, 9.8, 9),
  k(0.44, [-0.6, 1.9, -0.9], -4, 33, 12.4, 11.6),
  k(0.596, [-0.6, 2.0, -0.9], -12, 32, 12, 11.6),
  k(0.67, [0.2, 1.4, -0.6], -20, 34, 12.8, 11.4),
  k(0.76, [0.3, 1.3, -0.4], -25, 35, 12.4, 11),
  k(0.84, [0.1, 1.3, 1.2], -6, 27, 10, 9.6),
  k(0.92, [0, 0.95, 0.9], -3, 31, 11.2, 9.4),
  k(1.0, [0.1, 1.8, -0.4], 4, 66, 26, 26, 17),
]

/** Shot at l: eased between keys (settles on each key, glides between). */
export function shotAt(keys: Key[], l: number, out: Shot): Shot {
  let i = 0
  while (i < keys.length - 2 && l >= keys[i + 1][0]) i++
  const [ta, a] = keys[i]
  const [tb, b] = keys[i + 1]
  const t = clamp((l - ta) / Math.max(1e-6, tb - ta))
  // in/out beats accelerate like a drone climbing; the rest glides
  const e = i === 0 ? 1 - Math.pow(1 - t, 3) : i === keys.length - 2 ? t * t * t : t * t * (3 - 2 * t)
  out.p[0] = lerp(a.p[0], b.p[0], e)
  out.p[1] = lerp(a.p[1], b.p[1], e)
  out.p[2] = lerp(a.p[2], b.p[2], e)
  out.az = lerp(a.az, b.az, e)
  out.el = lerp(a.el, b.el, e)
  out.w = lerp(a.w, b.w, e)
  out.h = lerp(a.h, b.h, e)
  out.fov = lerp(a.fov, b.fov, e)
  return out
}
