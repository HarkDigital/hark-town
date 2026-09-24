import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { rng } from '../core/math'
import { C, clay, shadowed } from './palette'

/*
 * The Hark Town toy kit: small procedural pieces in a soft "clay miniature"
 * style. Every function returns a Group (or Mesh) sitting on y = 0 with its
 * footprint centred on the origin, ready to place on an island.
 *
 *   makeIsland({ radius, seed })   floating island: grass top, soil band, rocky underside
 *   makeTree(seed, scale)          lollipop / stacked-blob tree
 *   makeHouse({ w, d, h, ... })    gabled or flat-roof house with windows and door
 *   makeTower({ h, color })        slim tower (bell / radio / lighthouse base)
 *   makeCar(color)                 rounded toy car
 *   makePerson(color, seed)        peg figure (capsule body + head)
 *   makeCloud(seed, scale)         puffy cloud of merged spheres
 *   makeBush / makeRock / makeLamp small dressing
 *
 * Kit pieces are intentionally cheap (low segment counts, shared cached
 * materials). For many copies, use InstancedMesh with the geometry of a
 * piece (e.g. `(makeTree(1).children[0] as THREE.Mesh).geometry`) or merge.
 */

export interface IslandOptions {
  radius?: number
  /** thickness of the grass/soil slab */
  thickness?: number
  /** depth of the rocky underside cone */
  depth?: number
  seed?: number
  /** irregularity of the outline, 0..0.3 */
  wobble?: number
  top?: string
  /** optional sandy beach ring width */
  beach?: number
}

/** A floating island: flat grassy top, soil band, jagged rocky underside. */
export function makeIsland(o: IslandOptions = {}): THREE.Group {
  const R = o.radius ?? 8
  const T = o.thickness ?? 0.9
  const D = o.depth ?? R * 0.9
  const rand = rng(o.seed ?? 3)
  const wob = o.wobble ?? 0.12
  const n = 48
  // irregular outline
  const radii: number[] = []
  const f1 = rand() * 6.28, f2 = rand() * 6.28, f3 = rand() * 6.28
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    radii.push(R * (1 + wob * (0.55 * Math.sin(a * 2 + f1) + 0.3 * Math.sin(a * 3 + f2) + 0.15 * Math.sin(a * 5 + f3))))
  }
  const outline = (scale: number) => {
    const s = new THREE.Shape()
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2
      const r = radii[i % n] * scale
      const x = Math.cos(a) * r, y = Math.sin(a) * r
      if (i === 0) s.moveTo(x, y)
      else s.lineTo(x, y)
    }
    return s
  }
  const g = new THREE.Group()
  const beach = o.beach ?? 0

  // grass cap (slightly bevelled slab)
  const capGeo = new THREE.ExtrudeGeometry(outline(1 - beach / R), {
    depth: 0.18, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.14, bevelSegments: 3, curveSegments: 2,
  })
  capGeo.rotateX(-Math.PI / 2)
  capGeo.translate(0, -0.18, 0)
  const cap = new THREE.Mesh(capGeo, clay(o.top ?? C.grass))
  g.add(cap)

  if (beach > 0) {
    const sandGeo = new THREE.ExtrudeGeometry(outline(1), { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.1, bevelSegments: 2 })
    sandGeo.rotateX(-Math.PI / 2)
    sandGeo.translate(0, -0.26, 0)
    g.add(new THREE.Mesh(sandGeo, clay(C.sand)))
  }

  // soil band
  const soilGeo = new THREE.ExtrudeGeometry(outline(1.0), { depth: T, bevelEnabled: false })
  soilGeo.rotateX(-Math.PI / 2)
  soilGeo.translate(0, -T - 0.2, 0)
  g.add(new THREE.Mesh(soilGeo, clay(C.soil)))

  // rocky underside: a jagged inverted cone following the outline
  const rings = 6
  const pos: number[] = []
  const idx: number[] = []
  for (let r = 0; r <= rings; r++) {
    const t = r / rings
    const y = -T - 0.2 - t * D
    const shrink = Math.pow(1 - t, 1.25)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const jag = r === 0 ? 1 : 0.82 + rand() * 0.3
      const rr = radii[i] * shrink * jag
      pos.push(Math.cos(a) * rr, y + (r > 0 && r < rings ? (rand() - 0.5) * 0.5 : 0), Math.sin(a) * rr)
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i, b = r * n + ((i + 1) % n), c2 = (r + 1) * n + i, d = (r + 1) * n + ((i + 1) % n)
      idx.push(a, c2, b, b, c2, d)
    }
  }
  const rockGeo = new THREE.BufferGeometry()
  rockGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  rockGeo.setIndex(idx)
  const flat = rockGeo.toNonIndexed()
  flat.computeVertexNormals()
  const rock = new THREE.Mesh(flat, clay(C.rock, { rough: 0.95 }))
  g.add(rock)

  shadowed(g, true, true)
  rock.castShadow = false
  g.userData.radius = R
  return g
}

/** Lollipop or stacked-blob tree. */
export function makeTree(seed = 1, scale = 1): THREE.Group {
  const rand = rng(seed)
  const g = new THREE.Group()
  const h = (0.55 + rand() * 0.35) * scale
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.09 * scale, h, 6), clay(C.soil))
  trunk.position.y = h / 2
  g.add(trunk)
  const kind = rand()
  const leaf = rand() < 0.7 ? C.leaf : rand() < 0.5 ? C.meadow : C.leafDark
  if (kind < 0.55) {
    const r = (0.42 + rand() * 0.18) * scale
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), clay(leaf))
    top.position.y = h + r * 0.75
    g.add(top)
  } else if (kind < 0.8) {
    for (let i = 0; i < 3; i++) {
      const r = (0.36 - i * 0.08) * scale
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), clay(leaf))
      b.position.set((rand() - 0.5) * 0.12 * scale, h + 0.18 * scale + i * 0.3 * scale, (rand() - 0.5) * 0.12 * scale)
      g.add(b)
    }
  } else {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.38 * scale, 1.1 * scale, 7), clay(C.leafDark))
    cone.position.y = h + 0.45 * scale
    g.add(cone)
  }
  return shadowed(g)
}

export interface HouseOptions {
  w?: number
  d?: number
  h?: number
  wall?: string
  roof?: string
  /** 'gable' | 'flat' | 'shed' */
  style?: 'gable' | 'flat' | 'shed'
  seed?: number
}

/** A small house or shop with windows, a door and a roof. */
export function makeHouse(o: HouseOptions = {}): THREE.Group {
  const w = o.w ?? 1.4, d = o.d ?? 1.2, h = o.h ?? 1.1
  const rand = rng(o.seed ?? 5)
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), clay(o.wall ?? C.white))
  body.position.y = h / 2
  g.add(body)
  const style = o.style ?? 'gable'
  const roofCol = o.roof ?? [C.roofRed, C.roofBlue, C.roofYellow, C.roofInk][Math.floor(rand() * 4)]
  if (style === 'gable') {
    const shape = new THREE.Shape()
    const rh = Math.min(w, d) * 0.45
    shape.moveTo(-w / 2 - 0.08, 0)
    shape.lineTo(0, rh)
    shape.lineTo(w / 2 + 0.08, 0)
    shape.closePath()
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: d + 0.16, bevelEnabled: false })
    roofGeo.translate(0, 0, -(d + 0.16) / 2)
    const roof = new THREE.Mesh(roofGeo, clay(roofCol))
    roof.position.y = h
    g.add(roof)
  } else if (style === 'flat') {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.1, d + 0.1), clay(roofCol))
    lip.position.y = h + 0.05
    g.add(lip)
  } else {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, 0.08, d + 0.12), clay(roofCol))
    roof.position.y = h + 0.12
    roof.rotation.z = 0.18
    g.add(roof)
  }
  // windows + door on the front (+z) face
  const winMat = clay(C.ink, { rough: 0.4 })
  const cols = Math.max(1, Math.round(w / 0.5))
  const floors = Math.max(1, Math.round(h / 0.6))
  const winGeo = new THREE.BoxGeometry(0.2, 0.22, 0.04)
  const wins: THREE.BufferGeometry[] = []
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      if (f === 0 && c === Math.floor(cols / 2)) continue
      const gg = winGeo.clone()
      gg.translate(-w / 2 + (c + 0.5) * (w / cols), 0.38 + f * 0.55, d / 2 + 0.01)
      wins.push(gg)
    }
  }
  if (wins.length) g.add(new THREE.Mesh(mergeGeometries(wins), winMat))
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.05), clay(roofCol))
  door.position.set(-w / 2 + (Math.floor(cols / 2) + 0.5) * (w / cols), 0.21, d / 2 + 0.01)
  g.add(door)
  return shadowed(g)
}

/** A slim tower: base for a bell tower, radio mast or lighthouse. */
export function makeTower(o: { h?: number; r?: number; color?: string; band?: string } = {}): THREE.Group {
  const h = o.h ?? 3, r = o.r ?? 0.45
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, h, 16), clay(o.color ?? C.white))
  body.position.y = h / 2
  g.add(body)
  if (o.band) {
    for (let i = 1; i <= 2; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r * (1 - i * 0.07) + 0.01, r * (1 - i * 0.07 + 0.03) + 0.01, h * 0.12, 16), clay(o.band))
      band.position.y = h * (i / 3)
      g.add(band)
    }
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.85, 0.12, 16), clay(C.ink))
  cap.position.y = h + 0.06
  g.add(cap)
  return shadowed(g)
}

/** Rounded toy car (faces +x). */
export function makeCar(color = C.roofRed): THREE.Group {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.32), clay(color, { rough: 0.5 }))
  body.position.y = 0.17
  g.add(body)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.28), clay(C.white, { rough: 0.3 }))
  cabin.position.set(-0.04, 0.34, 0)
  g.add(cabin)
  const wheelGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.06, 10)
  wheelGeo.rotateX(Math.PI / 2)
  for (const [x, z] of [[0.19, 0.17], [-0.19, 0.17], [0.19, -0.17], [-0.19, -0.17]]) {
    const wheel = new THREE.Mesh(wheelGeo, clay(C.ink))
    wheel.position.set(x, 0.08, z)
    g.add(wheel)
  }
  return shadowed(g)
}

/** Peg figure: capsule body + round head. ~0.5 units tall. */
export function makePerson(color = C.roofBlue, seed = 1): THREE.Group {
  const rand = rng(seed)
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.18, 4, 8), clay(color))
  body.position.y = 0.2
  g.add(body)
  const skin = ['#f1c9a5', '#d9a07a', '#a8704a', '#7a4f33'][Math.floor(rand() * 4)]
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), clay(skin))
  head.position.y = 0.42
  g.add(head)
  return shadowed(g)
}

/** Puffy cloud of merged spheres (no shadow receive, soft white). */
export function makeCloud(seed = 1, scale = 1): THREE.Mesh {
  const rand = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const count = 5 + Math.floor(rand() * 4)
  for (let i = 0; i < count; i++) {
    const r = (0.5 + rand() * 0.6) * scale
    const s = new THREE.IcosahedronGeometry(r, 2)
    s.translate((i - count / 2) * 0.55 * scale + (rand() - 0.5) * 0.3, rand() * 0.35 * scale, (rand() - 0.5) * 0.6 * scale)
    parts.push(s)
  }
  const geo = mergeGeometries(parts)
  const m = new THREE.Mesh(geo, clay(C.white, { rough: 1 }))
  m.castShadow = true
  return m
}

export function makeBush(seed = 1, scale = 1): THREE.Mesh {
  const rand = rng(seed)
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 * scale, 1), clay(rand() < 0.5 ? C.leaf : C.meadow))
  m.scale.set(1.2, 0.8, 1)
  m.position.y = 0.14 * scale
  m.castShadow = m.receiveShadow = true
  return m
}

export function makeRock(seed = 1, scale = 1): THREE.Mesh {
  const rand = rng(seed)
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 * scale, 0), clay(rand() < 0.5 ? C.rock : C.rockDark, { rough: 0.95 }))
  m.rotation.set(rand() * 3, rand() * 3, rand() * 3)
  m.position.y = 0.1 * scale
  m.castShadow = m.receiveShadow = true
  return m
}

export function makeLamp(): THREE.Group {
  const g = new THREE.Group()
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.9, 6), clay(C.ink))
  pole.position.y = 0.45
  g.add(pole)
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), clay(C.white, { emissive: '#ffe7a8', emissiveIntensity: 0 }))
  bulb.position.y = 0.93
  bulb.name = 'bulb'
  g.add(bulb)
  return shadowed(g)
}
