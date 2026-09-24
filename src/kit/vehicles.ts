import * as THREE from 'three'
import { rng } from '../core/math'
import { C, CARS, MAT, clayVC } from './palette'
import { Builder, col, vgrad } from './geo'

/*
 * Vehicles: toy cars, a tram, boats and hot-air balloons. Cars and trams face
 * +x; headlights and windows glow at dusk. Each is one vertex-colour mesh.
 */

const glass = (y0: number, y1: number) => vgrad('#3d5664', '#9fbccb', y0, y1)

/** Rounded toy car (faces +x), ~0.62 long. Casts shadows. */
export function makeCar(color: string = C.roofRed, o: { seed?: number; kind?: 'hatch' | 'van' | 'taxi' } = {}): THREE.Group {
  const rand = rng(o.seed ?? 1)
  const kind = o.kind ?? (['hatch', 'hatch', 'van'] as const)[Math.floor(rand() * 3)]
  const b = new Builder()
  const van = kind === 'van'
  const L = van ? 0.66 : 0.62
  b.rbox(L, 0.17, 0.32, 0.06, color, { y: 0.165 }, 2)
  // cabin: glass band with a body-colour roof
  const cabL = van ? 0.5 : 0.36
  const cabX = van ? -0.05 : -0.05
  b.rbox(cabL, 0.14, 0.28, 0.05, glass(0.25, 0.38), { x: cabX, y: 0.31 }, 2, 0.6)
  b.rbox(cabL + 0.02, 0.04, 0.3, 0.02, kind === 'taxi' ? C.mustard : color, { x: cabX, y: 0.38 }, 1)
  if (kind === 'taxi') b.rbox(0.1, 0.05, 0.06, 0.015, C.white, { x: cabX, y: 0.42 }, 1)
  // bumpers, lights
  b.rbox(0.04, 0.05, 0.3, 0.015, C.stone, { x: L / 2, y: 0.11 }, 1)
  b.rbox(0.04, 0.05, 0.3, 0.015, C.stone, { x: -L / 2, y: 0.11 }, 1)
  for (const z of [-0.1, 0.1]) {
    b.sphere(0.03, '#fff6d8', { x: L / 2 - 0.005, y: 0.19, z }, 1, 2)
    b.sphere(0.025, '#ff6a5a', { x: -L / 2 + 0.005, y: 0.19, z }, 1, 1)
  }
  const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12)
  wheel.rotateX(Math.PI / 2)
  for (const [x, z] of [[0.19, 0.155], [-0.19, 0.155], [0.19, -0.155], [-0.19, -0.155]]) {
    b.add(wheel.clone(), C.ink, { x, y: 0.075, z })
    b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.065, 8).rotateX(Math.PI / 2), C.stone, { x, y: 0.075, z })
  }
  wheel.dispose()
  const m = new THREE.Mesh(b.build(), clayVC({ rough: 0.55 }))
  m.castShadow = true
  m.receiveShadow = true
  const g = new THREE.Group()
  g.add(m)
  return g
}

/** Random toy car colour for a seed. */
export const carColor = (seed: number) => CARS[Math.abs(Math.floor(seed)) % CARS.length]

/** A rounded little tram (faces +x), ~1.6 long, with a pantograph. */
export function makeTram(color: string = C.signal, o: { length?: number; stripe?: string } = {}): THREE.Group {
  const L = o.length ?? 1.6
  const b = new Builder()
  const cream = C.white
  b.rbox(L, 0.2, 0.46, 0.08, color, { y: 0.18 }, 2)
  b.rbox(L - 0.02, 0.22, 0.44, 0.08, cream, { y: 0.39 }, 2)
  b.rbox(L, 0.06, 0.46, 0.03, o.stripe ?? color, { y: 0.52 }, 1)
  b.rbox(L - 0.1, 0.06, 0.38, 0.03, C.stone, { y: 0.575 }, 1)
  // windows along both sides + the ends
  const n = Math.max(3, Math.round(L / 0.26))
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.16 + (i * (L - 0.32)) / (n - 1)
    for (const s of [-1, 1]) b.add(new THREE.BoxGeometry(0.17, 0.14, 0.02), glass(0.33, 0.47), { x, y: 0.4, z: s * 0.225 }, 0.9)
  }
  for (const s of [-1, 1]) {
    b.add(new THREE.BoxGeometry(0.02, 0.15, 0.34), glass(0.33, 0.48), { x: s * (L / 2 - 0.005), y: 0.41 }, 0.9)
    b.sphere(0.03, '#fff6d8', { x: s * (L / 2 + 0.005), y: 0.2, z: 0.13 }, 1, 2)
    b.sphere(0.03, '#fff6d8', { x: s * (L / 2 + 0.005), y: 0.2, z: -0.13 }, 1, 2)
  }
  // bogies
  for (const x of [-L * 0.3, L * 0.3]) b.rbox(0.36, 0.08, 0.36, 0.03, C.ink, { x, y: 0.05 }, 1)
  // pantograph
  b.box(0.02, 0.2, 0.02, C.ink, { y: 0.68, rz: 0.5 })
  b.box(0.02, 0.2, 0.02, C.ink, { y: 0.68, x: 0.08, rz: -0.5 })
  b.box(0.04, 0.02, 0.3, C.ink, { y: 0.78, x: 0.04 })
  const m = new THREE.Mesh(b.build(), clayVC({ rough: 0.6 }))
  m.castShadow = true
  m.receiveShadow = true
  const g = new THREE.Group()
  g.add(m)
  return g
}

/**
 * A little boat (faces +x): a rowing boat, or a sailboat when `sail` is set
 * (sail colour; Hark green works nicely). Sits with its waterline at y = 0.
 */
export function makeBoat(o: { color?: string; sail?: string | false; seed?: number } = {}): THREE.Group {
  const color = o.color ?? C.roofBlue
  const b = new Builder()
  // hull: a pointed-bow plan extruded + bevelled, squashed toward the keel
  const plan = new THREE.Shape()
  plan.moveTo(-0.3, -0.13)
  plan.lineTo(0.12, -0.13)
  plan.quadraticCurveTo(0.34, -0.1, 0.4, 0)
  plan.quadraticCurveTo(0.34, 0.1, 0.12, 0.13)
  plan.lineTo(-0.3, 0.13)
  plan.quadraticCurveTo(-0.36, 0, -0.3, -0.13)
  const hull = new THREE.ExtrudeGeometry(plan, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 6 })
  hull.rotateX(-Math.PI / 2)
  const pos = hull.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const k = 0.72 + 0.28 * Math.min(1, Math.max(0, (y + 0.03) / 0.18))
    pos.setX(i, pos.getX(i) * k)
    pos.setZ(i, pos.getZ(i) * k)
  }
  hull.computeVertexNormals()
  const white = col(C.white), body = col(color)
  b.add(hull, (_x, y, _z, out) => out.copy(y > 0.09 ? white : body), { y: -0.04 })
  b.rbox(0.5, 0.02, 0.2, 0.01, C.wood, { y: 0.09, x: 0.0 }, 1)
  b.rbox(0.05, 0.03, 0.22, 0.01, C.woodDark, { y: 0.12, x: -0.08 }, 1)
  const g = new THREE.Group()
  if (o.sail) {
    b.cyl(0.012, 0.014, 0.75, 6, C.woodDark, { y: 0.45, x: 0.05 })
    b.box(0.34, 0.015, 0.015, C.woodDark, { y: 0.16, x: -0.11 })
    const tri = new THREE.Shape()
    tri.moveTo(0, 0)
    tri.lineTo(0, 0.62)
    tri.lineTo(-0.34, 0)
    tri.closePath()
    const sail = new THREE.ExtrudeGeometry(tri, { depth: 0.012, bevelEnabled: false })
    sail.translate(0, 0, -0.006)
    b.add(sail, o.sail, { x: 0.04, y: 0.18 })
  } else {
    for (const s of [-1, 1]) b.box(0.3, 0.012, 0.012, C.woodDark, { x: -0.02, y: 0.13, z: s * 0.2, ry: s * 0.4 })
  }
  const m = new THREE.Mesh(b.build(), clayVC())
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
  return g
}

/**
 * Hot-air balloon (~2.4 tall, basket bottom at y = 0) with vertical stripes.
 * hark: true = Hark green + white with a green LED band on the basket.
 */
export function makeBalloon(o: { color?: string; stripe?: string; seed?: number; hark?: boolean } = {}): THREE.Group {
  const rand = rng(o.seed ?? 3)
  const c1 = o.hark ? C.signal : o.color ?? [C.roofRed, C.mustard, C.teal, C.coral, C.roofBlue][Math.floor(rand() * 5)]
  const c2 = o.stripe ?? (o.hark ? C.white : C.white)
  const b = new Builder()
  // envelope: teardrop lathe
  const prof: THREE.Vector2[] = []
  const N = 14
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const a = t * Math.PI
    let r = Math.sin(a) * (0.72 + 0.1 * Math.cos(a))
    if (t < 0.28) r *= 0.5 + (t / 0.28) * 0.5
    r = Math.max(r, 0.14 * (1 - t))
    prof.push(new THREE.Vector2(Math.max(0.001, r), 0.05 + t * 1.55))
  }
  prof[prof.length - 1].x = 0.001
  const env = new THREE.LatheGeometry(prof, 16)
  const cc1 = col(c1), cc2 = col(c2)
  b.add(env, (x, y, z, out) => {
    const a = Math.atan2(z, x)
    const band = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 8 + 0.5) % 2
    out.copy(band ? cc1 : cc2)
    if (y > 1.46 + 0.7) out.copy(cc1)
  }, { y: 0.62 })
  // skirt + ropes + basket
  b.cyl(0.13, 0.16, 0.1, 12, c1, { y: 0.68 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    b.cyl(0.006, 0.006, 0.44, 3, C.woodDark, { x: Math.cos(a) * 0.12, y: 0.42, z: Math.sin(a) * 0.12, rx: Math.sin(a) * 0.08, rz: -Math.cos(a) * 0.08 })
  }
  b.rbox(0.24, 0.18, 0.24, 0.03, C.wood, { y: 0.09 }, 1)
  b.rbox(0.26, 0.03, 0.26, 0.012, C.woodDark, { y: 0.18 }, 1)
  const m = new THREE.Mesh(b.build(), clayVC())
  m.castShadow = true
  m.receiveShadow = true
  const g = new THREE.Group()
  g.add(m)
  if (o.hark) {
    const led = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.01, 6, 20), MAT.led)
    led.rotation.x = Math.PI / 2
    led.position.y = 0.13
    g.add(led)
  }
  return g
}
