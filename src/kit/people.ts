import * as THREE from 'three'
import { rng } from '../core/math'
import { C, SHIRTS, clayVC } from './palette'
import { Builder } from './geo'
import { blobMaterial, makeBlob } from './street'

/*
 * Townsfolk: peg people (~0.5 tall) with shirts, trousers, skin, hair or
 * hats. They don't cast shadow-map shadows (cheap); a soft blob sits under
 * each instead. For crowds use makeCrowd (instanced, 2–7 draw calls total).
 */

const SKIN = ['#f3cfae', '#e0a982', '#b77a52', '#8a5a3b', '#f7dcc4']
const HAIR = ['#3a2a22', '#6b4a33', '#c89a5a', '#1f1d1c', '#a35a3a', '#e7d9c2']
const LEGS = ['#34465c', '#4b5563', '#2f3b36', '#6e5a4a', '#3e5f8a']

const personCache = new Map<string, THREE.BufferGeometry>()

/** Peg-person geometry (vertex-coloured, base at y = 0, faces +z). */
export function personGeometry(seed = 1, shirt?: string): THREE.BufferGeometry {
  const rand = rng(seed * 31 + 5)
  const top = shirt ?? SHIRTS[Math.floor(rand() * SHIRTS.length)]
  const skin = SKIN[Math.floor(rand() * SKIN.length)]
  const hair = HAIR[Math.floor(rand() * HAIR.length)]
  const legs = LEGS[Math.floor(rand() * LEGS.length)]
  const style = Math.floor(rand() * 4)
  const key = `${top}|${skin}|${hair}|${legs}|${style}`
  let g = personCache.get(key)
  if (g) return g
  const b = new Builder()
  b.add(new THREE.CapsuleGeometry(0.045, 0.1, 3, 8), legs, { y: 0.1, x: 0, sx: 1.7 })
  b.add(new THREE.CapsuleGeometry(0.085, 0.13, 4, 10), top, { y: 0.24 })
  b.sphere(0.082, skin, { y: 0.43 }, 2)
  if (style === 0) {
    b.add(new THREE.SphereGeometry(0.087, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, { y: 0.435, rx: -0.25 })
  } else if (style === 1) {
    // hat
    b.cyl(0.11, 0.11, 0.015, 12, C.mustard === top ? C.roofBlue : C.mustard, { y: 0.49 })
    b.cyl(0.06, 0.07, 0.07, 12, C.mustard === top ? C.roofBlue : C.mustard, { y: 0.53 })
  } else if (style === 2) {
    b.add(new THREE.SphereGeometry(0.088, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), hair, { y: 0.43, rx: -0.4 })
    b.sphere(0.04, hair, { y: 0.44, z: -0.08 }, 1)
  } else {
    // cap with a brim
    b.add(new THREE.SphereGeometry(0.086, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), top, { y: 0.45 })
    b.box(0.1, 0.012, 0.07, top, { y: 0.455, z: 0.08 })
  }
  g = b.build()
  personCache.set(key, g)
  return g
}

/** Peg figure (~0.52 units tall) with a soft blob shadow. Faces +z. */
export function makePerson(color: string = C.roofBlue, seed = 1): THREE.Group {
  const g = new THREE.Group()
  const m = new THREE.Mesh(personGeometry(seed, color), clayVC())
  m.castShadow = false
  m.receiveShadow = true
  m.name = 'body'
  g.add(m)
  g.add(makeBlob(0.26, 0.26, 0.3))
  return g
}

export interface Crowd {
  group: THREE.Group
  count: number
  /** place person i (call every frame for walkers; bob = 0..1 step lift) */
  set(i: number, x: number, y: number, z: number, heading: number, bob?: number, scale?: number): void
  /** hide person i */
  hide(i: number): void
  /** flag matrices for upload (call once after a batch of set()) */
  commit(): void
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/**
 * An instanced crowd of `count` townsfolk in a handful of outfits, plus
 * instanced blob shadows. Everyone starts hidden; place them with set().
 */
export function makeCrowd(count: number, o: { seed?: number; variants?: number } = {}): Crowd {
  const V = Math.min(o.variants ?? 6, count)
  const seed = o.seed ?? 1
  const group = new THREE.Group()
  const meshes: THREE.InstancedMesh[] = []
  const per = Math.ceil(count / V)
  for (let v = 0; v < V; v++) {
    const im = new THREE.InstancedMesh(personGeometry(seed * 10 + v), clayVC({ instanced: true }), per)
    im.castShadow = false
    im.receiveShadow = true
    im.frustumCulled = false
    meshes.push(im)
    group.add(im)
  }
  const blobGeo = new THREE.PlaneGeometry(0.26, 0.26).rotateX(-Math.PI / 2)
  const blobs = new THREE.InstancedMesh(blobGeo, blobMaterial(0.3), count)
  blobs.frustumCulled = false
  blobs.renderOrder = 1
  group.add(blobs)
  const zero = new THREE.Matrix4().makeScale(0, 0, 0)
  for (const im of meshes) for (let i = 0; i < per; i++) im.setMatrixAt(i, zero)
  for (let i = 0; i < count; i++) blobs.setMatrixAt(i, zero)
  return {
    group,
    count,
    set(i, x, y, z, heading, bob = 0, scale = 1) {
      const im = meshes[i % V]
      const k = Math.floor(i / V)
      _q.setFromAxisAngle(_up, heading)
      _s.set(scale, scale * (1 - bob * 0.06), scale)
      _p.set(x, y + bob * 0.05 * scale, z)
      im.setMatrixAt(k, _m.compose(_p, _q, _s))
      _p.set(x, y + 0.012, z)
      _s.setScalar(scale * (1 - bob * 0.15))
      _q.identity()
      blobs.setMatrixAt(i, _m.compose(_p, _q, _s))
    },
    hide(i) {
      meshes[i % V].setMatrixAt(Math.floor(i / V), zero)
      blobs.setMatrixAt(i, zero)
    },
    commit() {
      for (const im of meshes) im.instanceMatrix.needsUpdate = true
      blobs.instanceMatrix.needsUpdate = true
    },
  }
}
