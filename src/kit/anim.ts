import * as THREE from 'three'

/*
 * Kit runtime: shared uniforms and a tiny spinner registry, ticked once per
 * frame by the World (World.update → tickKit). Everything here is derived
 * from absolute time, so it looks right after any jump.
 *
 *   KIT.uTime      kit clock in seconds (slowed under reduced motion) —
 *                  drives flags, water shimmer, waterfalls, birds
 *   KIT.uGlow      0..1 evening lights (windows, lamp bulbs); follows the
 *                  time of day and storm automatically
 *   KIT.uWind      0..1+ flutter strength (storm raises it)
 *   KIT.uCloudLift sky-tinted emissive lift on cloudMaterial()
 *   spin(obj, speed, axis)  rotate an object continuously (windmill sails,
 *                  propellers, a weather vane). Deterministic: angle = phase
 *                  + time * speed.
 */
export const KIT = {
  uTime: { value: 0 },
  uGlow: { value: 0 },
  uGlowColor: { value: new THREE.Color('#ffc46e').multiplyScalar(1.6) },
  uWind: { value: 1 },
  uRim: { value: new THREE.Color('#dfeefc') },
  uRimStrength: { value: 0.14 },
  /** luminous sky-tinted lift for clouds (so they never go muddy) */
  uCloudLift: { value: new THREE.Color('#ffffff').multiplyScalar(0.3) },
  /** motion scale (0.25 under reduced motion) */
  motion: 1,
}

interface Spinner {
  o: THREE.Object3D
  speed: number
  axis: 'x' | 'y' | 'z'
  phase: number
}
const spinners = new Set<Spinner>()

/** Spin an object around a local axis forever (radians / second). Returns a disposer. */
export function spin(o: THREE.Object3D, speed: number, axis: 'x' | 'y' | 'z' = 'z', phase = 0) {
  const s: Spinner = { o, speed, axis, phase }
  spinners.add(s)
  return () => spinners.delete(s)
}

/** Called by the World every frame. */
export function tickKit(time: number, reducedMotion: boolean) {
  KIT.motion = reducedMotion ? 0.25 : 1
  const t = time * KIT.motion
  KIT.uTime.value = t
  for (const s of spinners) s.o.rotation[s.axis] = s.phase + t * s.speed
}
