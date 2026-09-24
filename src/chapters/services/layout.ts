import * as THREE from 'three'
import { SERVICES } from '../../content'

/*
 * THE WORKS — layout + run sheet.
 *
 * Eleven workshop islands laid out like a board-game map: a serpentine of
 * three rows (4 · 3 · 4) seen from one friendly near-isometric azimuth, each
 * island linked to the next by a little plank bridge. Every island faces the
 * camera that visits it, so its workshop is always shown from the front.
 *
 * Run sheet (local progress 0..1 of the chapter, 4.0 viewport heights):
 *   0.000–0.095  in-beat + intro. The clouds part over the whole
 *                archipelago, the workshops pop up island by island, and
 *                "Eleven ways to be heard." settles (nav landing 0.08).
 *   0.095–0.898  eleven beats (0.073 each): the camera glides across the
 *                bridge to the next island (first 40%), then drifts slowly
 *                round it while the signage plate names it.
 *   0.898–0.935  finale: pull back to the whole archipelago; every pin
 *                shows its workshop's name.
 *   0.958–1.000  out-beat: rise into the clouds for the cut.
 */

export const N = SERVICES.length
export const INTRO_END = 0.095
export const BEAT = 0.073
export const SVC_END = INTRO_END + N * BEAT
/** fraction of a beat spent gliding to the island */
export const GLIDE = 0.4
/** the plate switches to the new island here (mid-glide) */
export const SWITCH = 0.2
/** settled point inside a beat (keyboard / index anchors) */
export const ANCHOR = 0.64
export const FIN_END = 0.935
export const OUT_START = 0.958

export const beatStart = (k: number) => INTRO_END + k * BEAT
export const ANCHORS = SERVICES.map((_, k) => Math.round((beatStart(k) + ANCHOR * BEAT) * 10000) / 10000)

/** Intro build wave: island k pops up over [start, start + BUILD_LEN] of local. */
export const BUILD_LEN = 0.022
export const buildStart = (k: number) => 0.018 + k * 0.004

/** base azimuth of the tour camera (camera sits at +z/+x of its target) */
export const AZ0 = 0.62
/** screen-right on the ground plane */
export const ACROSS = new THREE.Vector3(Math.cos(AZ0), 0, -Math.sin(AZ0))
/** away from the camera on the ground plane */
export const DEEP = new THREE.Vector3(-Math.sin(AZ0), 0, -Math.cos(AZ0))

export interface IslandDef {
  k: number
  /** world center of the grass top */
  pos: THREE.Vector3
  radius: number
  /** island yaw = the azimuth its camera visits from */
  az: number
  seed: number
  top: string
  /** local angles (atan2(z, x) in island space) toward the previous / next island (NaN at the ends) */
  aIn: number
  aOut: number
  /** where the van parks, local angle on the lane */
  aStop: number
  /** lane radius */
  lane: number
}

// u (across), v (deep), y, radius, azimuth offset, grass
const RAW: [number, number, number, number, number, string][] = [
  [-11.2, 0.0, 0.0, 2.75, -0.1, '#97d077'],
  [-3.8, 0.9, 0.55, 2.6, 0.06, '#9ad37a'],
  [3.7, -0.4, -0.15, 2.6, -0.04, '#93cf74'],
  [11.1, 0.7, 0.45, 2.55, 0.12, '#9bd27b'],
  [8.9, 8.3, 0.95, 2.95, 0.02, '#8fcc70'],
  [1.3, 7.5, 0.35, 2.6, -0.1, '#97d077'],
  [-6.3, 8.5, 0.8, 2.75, 0.08, '#9ad37a'],
  [-11.0, 15.6, 1.3, 2.75, -0.06, '#93cf74'],
  [-3.4, 16.3, 0.7, 2.85, 0.1, '#97d077'],
  [4.3, 15.3, 1.2, 2.8, -0.08, '#9bd27b'],
  [11.6, 16.5, 1.6, 2.65, 0.05, '#97d077'],
]

const _v = new THREE.Vector3()

function localAngle(from: THREE.Vector3, to: THREE.Vector3, az: number) {
  _v.subVectors(to, from).setY(0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -az)
  return Math.atan2(_v.z, _v.x)
}

export const ISLANDS: IslandDef[] = RAW.map(([u, v, y, r, off, top], k) => ({
  k,
  pos: new THREE.Vector3().addScaledVector(ACROSS, u).addScaledVector(DEEP, v).setY(y),
  radius: r,
  az: AZ0 + off,
  seed: 40 + k * 7,
  top,
  aIn: NaN,
  aOut: NaN,
  aStop: Math.PI / 2 - 0.32,
  lane: r * 0.8,
}))
for (const d of ISLANDS) {
  const prev = ISLANDS[d.k - 1]
  const next = ISLANDS[d.k + 1]
  if (prev) d.aIn = localAngle(d.pos, prev.pos, d.az)
  if (next) d.aOut = localAngle(d.pos, next.pos, d.az)
}

/** center + half-extents of the whole archipelago in (across, deep) terms */
export const OVERVIEW = (() => {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [u, v, y, r] of RAW) {
    u0 = Math.min(u0, u - r)
    u1 = Math.max(u1, u + r)
    v0 = Math.min(v0, v - r)
    v1 = Math.max(v1, v + r)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2
  return {
    center: new THREE.Vector3().addScaledVector(ACROSS, cu).addScaledVector(DEEP, cv).setY((y0 + y1) / 2),
    eu: (u1 - u0) / 2,
    ev: (v1 - v0) / 2,
    y0: y0 - 0.5,
    y1: y1 + 1.6,
  }
})()

/** shortest signed angular difference b - a */
export function angDiff(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/**
 * The lane round an island as a list of local angles: in from the previous
 * bridge, round the front to the stop, and out toward the next bridge
 * (shortest arcs). Ends get a short stub.
 */
export function laneArcs(d: IslandDef): [number, number][] {
  const arcs: [number, number][] = []
  const a0 = Number.isNaN(d.aIn) ? d.aStop - 0.9 : d.aIn
  const a1 = Number.isNaN(d.aOut) ? d.aStop + 0.9 : d.aOut
  arcs.push([a0, a0 + angDiff(a0, d.aStop)])
  arcs.push([d.aStop, d.aStop + angDiff(d.aStop, a1)])
  return arcs
}

/** Is local angle a (on the lane radius) covered by the lane? */
export function onLane(d: IslandDef, a: number, pad = 0.18) {
  for (const [s, e] of laneArcs(d)) {
    const lo = Math.min(s, e) - pad, hi = Math.max(s, e) + pad
    const x = s + angDiff(s, a)
    if (x >= lo && x <= hi) return true
  }
  return false
}
