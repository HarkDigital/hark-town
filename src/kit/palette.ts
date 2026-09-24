import * as THREE from 'three'

/*
 * Hark Town palette — a sunny toy diorama. Warm creams and clay, sage and
 * leafy greens, with the brand's signal green reserved for Hark things
 * (the HQ sculpture, signage, LED details) so it still reads as the accent.
 */
export const C = {
  paper: '#f6f1e7',
  cream: '#efe5d3',
  sand: '#ead7b1',
  clay: '#d9774b',
  terracotta: '#c8603a',
  mustard: '#f0b43c',
  sky: '#6fb5e6',
  water: '#63c1e3',
  grass: '#93cf74',
  meadow: '#7fbf64',
  leaf: '#46b36b',
  leafDark: '#2f8f55',
  sage: '#a8c39a',
  rock: '#b39a80',
  rockDark: '#8a735d',
  soil: '#9c7457',
  white: '#fbfaf6',
  ink: '#1d2321',
  slate: '#4b5563',
  signal: '#00e27a',
  signalBright: '#00ff85',
  roofRed: '#e2694a',
  roofBlue: '#4d8fd6',
  roofYellow: '#f2b63d',
  roofInk: '#2a3230',
  alert: '#ff4b3e',
}

const cache = new Map<string, THREE.MeshStandardMaterial>()

/**
 * Soft matte "clay" material (cached by colour + options). Everything in the
 * town is clay: it catches the sun, casts soft shadows, and reads as a
 * hand-made miniature under the tilt-shift.
 */
export function clay(color: string, opts: { rough?: number; emissive?: string; emissiveIntensity?: number } = {}) {
  const key = `${color}|${opts.rough ?? 0.82}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? 0}`
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: opts.rough ?? 0.82,
      metalness: 0,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    })
    cache.set(key, m)
  }
  return m
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
