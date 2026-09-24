import * as THREE from 'three'
import { KIT } from './anim'

/*
 * Hark Town palette — a sunny toy diorama. Warm creams and clay, sage and
 * leafy greens, soft pastel walls, with the brand's signal green reserved for
 * Hark things (the HQ tower, signage, LED details) so it still reads as the
 * accent.
 *
 *   C                 named colours (hex strings)
 *   WALLS / ROOFS / SHIRTS / CARS   curated pools for seeded variety
 *   clay(color, opts) cached matte MeshStandardMaterial (the default look)
 *   clayVC(opts)      cached vertex-colour clay: what every kit prop is built
 *                     from, so a whole island of props merges into one draw
 *                     call (see mergeStatic in props.ts). Vertices with a
 *                     `glow` attribute light up warm at dusk automatically.
 *   MAT.led           always-on Hark green LED (blooms)
 *   MAT.warm          always-on warm bulb (blooms)
 *   shadowed(obj)     mark a subtree as casting + receiving shadows
 *
 * All kit materials get a faint sky-tinted rim light (driven by the World)
 * so the clay reads soft and sits inside the atmosphere.
 */
export const C = {
  paper: '#f6f1e7',
  cream: '#efe5d3',
  sand: '#efdcb4',
  clay: '#d9774b',
  terracotta: '#c8603a',
  mustard: '#f0b43c',
  sky: '#6fb5e6',
  water: '#63c1e3',
  waterDeep: '#3d9fcc',
  foam: '#eefafc',
  grass: '#a0d17f',
  grassLight: '#c3e598',
  grassDeep: '#7eb964',
  meadow: '#86c46a',
  leaf: '#4fb46c',
  leafLight: '#7fcf73',
  leafDark: '#2f8f55',
  pine: '#3a8f63',
  sage: '#a8c39a',
  rock: '#c3aa94',
  rockDark: '#a18d80',
  rockLight: '#dcc8ae',
  rockShade: '#958899',
  soil: '#b8845f',
  soilDeep: '#8f604b',
  soilLight: '#d6ab7c',
  stone: '#e6dfd2',
  wood: '#c99462',
  woodDark: '#8e6547',
  bark: '#8f6b52',
  white: '#fbfaf6',
  ink: '#1d2321',
  slate: '#4b5563',
  glass: '#46606e',
  road: '#9aa1a8',
  roadLine: '#fbf4dc',
  kerb: '#e4ded2',
  path: '#e8d3a6',
  signal: '#00e27a',
  signalBright: '#00ff85',
  signalDeep: '#00a85a',
  roofRed: '#e2694a',
  roofBlue: '#4d8fd6',
  roofYellow: '#f2b63d',
  roofInk: '#2a3230',
  roofGreen: '#5aa56c',
  roofTeal: '#3a9c9b',
  roofPink: '#e98b8c',
  roofBrown: '#a35f45',
  butter: '#f8e6a6',
  blush: '#f6cdc4',
  mint: '#c4e8d2',
  powder: '#c3dcf2',
  peach: '#f8c9a0',
  lilac: '#d7cdef',
  coral: '#f2866b',
  blossom: '#f5b3c3',
  lavender: '#b7a5e0',
  teal: '#3fa7a0',
  navy: '#2f4a6d',
  plum: '#8d5a8a',
  alert: '#ff4b3e',
}

/** Wall colours for seeded variety. */
export const WALLS = [C.white, C.cream, C.butter, C.blush, C.mint, C.powder, C.peach, C.lilac, C.white, C.cream]
/** Roof colours for seeded variety. */
export const ROOFS = [C.roofRed, C.roofBlue, C.roofYellow, C.roofGreen, C.roofTeal, C.roofPink, C.terracotta, C.roofInk]
/** Clothes for townsfolk. */
export const SHIRTS = [C.roofRed, C.roofBlue, C.mustard, C.teal, C.coral, C.lavender, C.white, C.navy, C.roofPink, C.leaf]
/** Toy car paint. */
export const CARS = [C.roofRed, C.roofBlue, C.mustard, C.teal, C.coral, C.white, C.roofPink, C.mint]

// ------------------------------------------------------------------ materials

/**
 * Rim light patch shared by every kit material: a soft sky-coloured fresnel
 * (uniforms owned by KIT so the World can tint it through the day). Same
 * function object everywhere, so all patched materials share one program key.
 */
function patchRim(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uRim = KIT.uRim
  shader.uniforms.uRimStrength = KIT.uRimStrength
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimStrength;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        float kitF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * (kitF * kitF * kitF) * uRimStrength;
      }`,
    )
}

/** Vertex-colour clay patch: rim + dusk glow on vertices with `glow` > 0. */
function patchVC(shader: THREE.WebGLProgramParametersWithUniforms) {
  patchRim(shader)
  shader.uniforms.uGlow = KIT.uGlow
  shader.uniforms.uGlowColor = KIT.uGlowColor
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vKitGlow;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitGlow = glow;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uGlow;\nuniform vec3 uGlowColor;\nvarying float vKitGlow;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += uGlowColor * (vKitGlow * uGlow);`,
    )
}

const cache = new Map<string, THREE.MeshStandardMaterial>()

export interface ClayOptions {
  rough?: number
  emissive?: string
  emissiveIntensity?: number
  /** skip the rim patch (e.g. for a material you will patch yourself) */
  plain?: boolean
}

/**
 * Soft matte "clay" material (cached by colour + options). Everything in the
 * town is clay: it catches the sun, casts soft shadows, and reads as a
 * hand-made miniature under the tilt-shift. Cached: never mutate a returned
 * material unless you mean to change every user of it.
 */
export function clay(color: string, opts: ClayOptions = {}) {
  const key = `${color}|${opts.rough ?? 0.82}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}|${opts.plain ? 1 : 0}`
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.rough ?? 0.82,
      metalness: 0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    })
    if (!opts.plain) m.onBeforeCompile = patchRim
    cache.set(key, m)
  }
  return m
}

const vcCache = new Map<string, THREE.MeshStandardMaterial>()

/**
 * The kit's workhorse: a vertex-colour clay material. Kit geometry carries
 * `color` + `glow` attributes, so any number of props share this one
 * material and merge into a single draw call.
 */
export function clayVC(opts: { rough?: number; side?: THREE.Side } = {}) {
  const key = `${opts.rough ?? 0.84}|${opts.side ?? THREE.FrontSide}`
  let m = vcCache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: opts.rough ?? 0.84,
      metalness: 0,
      side: opts.side ?? THREE.FrontSide,
    })
    m.onBeforeCompile = patchVC
    m.customProgramCacheKey = () => 'kit-vc'
    vcCache.set(key, m)
  }
  return m
}

/** Shared special materials. */
export const MAT = {
  /** Hark green LED: always on, blooms. */
  get led() {
    return clay(C.signal, { emissive: C.signalBright, emissiveIntensity: 2.2, rough: 0.4 })
  },
  /** Warm always-on bulb (lighthouse lamp, festoon lights). */
  get warm() {
    return clay('#fff3d6', { emissive: '#ffd27a', emissiveIntensity: 2.4, rough: 0.4 })
  },
}

/** Mark every mesh in a subtree as casting + receiving shadows. */
export function shadowed<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse(c => {
    const m = c as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = cast
      m.receiveShadow = receive
    }
  })
  return o
}
