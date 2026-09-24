import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { C, clay, clayVC } from '../../kit/palette'
import {
  Builder,
  cloudGeometry,
  cloudMaterial,
  flowerGeometry,
  makeBench,
  makeBirds,
  makeBoat,
  makeBush,
  makeFlag,
  makeHouse,
  makeIsland,
  makePath,
  makePerson,
  makeRock,
  makeSign,
  makeTree,
  mergeStatic,
  scatter,
} from '../../kit/props'
import { logoGeometry, logoShapes } from '../../logo/logo'
import { lerp, rng } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { beamMaterial, glowTexture } from './shaders'
import { buildCloudDeck, deckHeight, type CloudDeck } from './clouds'

/*
 * The Lighthouse island, from the shared clay kit (vertex colours, one
 * material) so the whole rock merges into a couple of draw calls:
 *
 *   a rocky islet in a sea of clouds · a striped lighthouse whose lantern
 *   holds the glowing Hark mark · the keeper's cottage (smoking chimney,
 *   Hark pennant) · a stepping-stone path with little green LED lamps · a
 *   green post box by the door (its flag goes up when you hover the email) ·
 *   a jetty with a moored rowboat · sailboats on the clouds · gulls; all on
 *   a sunset cloud deck (./clouds.ts).
 *
 * Island-local space: +z faces the camera side, +x is to the right.
 */

export const R = 4.3
/** lighthouse footprint centre (island-local) */
export const LH = new THREE.Vector3(0.55, 0, -0.95)
const H0 = 0.34
const H1 = 4.5
/** the gallery deck the lamp room stands on */
export const GALLERY_Y = H1
/** the lantern room is drawn a size up (toy proportions) so the Hark mark inside reads */
const LR = 1.3
/** lantern centre (island-local) */
export const LANTERN = new THREE.Vector3(LH.x, H1 + 0.1 + 0.43 * LR, LH.z)
export const LH_TOP = LANTERN.y + 1.3 * LR
/** gallery angle of the keeper, (sin, cos) like the camera azimuths: off to the side of every camera */
export const KEEPER_A = 2.05
/** the azimuth the lantern's glazing bars leave clear (the finale camera's) */
const CLEAR_AZ = 0.5
const JET_A = 0.374
export const JET_DIR = new THREE.Vector3(Math.cos(JET_A), 0, Math.sin(JET_A))
const JET_R0 = R * 0.9
const JET_LEN = 3.6
const JET_Y = -0.1
const COTTAGE = { x: -1.6, z: -0.62, ry: 0.12, w: 1.7, d: 1.15, h: 0.92 }

const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()

type V3 = [number, number, number]

/** Radius of the tapered tower at height y. */
const rAt = (y: number) => lerp(0.76, 0.52, (y - H0) / (H1 - H0))

/** A thin extruded outline (sails, pennants, wings). */
function slab(points: [number, number][], depth = 0.014) {
  const s = new THREE.Shape()
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 4 })
  g.translate(0, 0, -depth / 2)
  return g
}

// ------------------------------------------------------------------ the lighthouse
function lighthouse(b: Builder) {
  const x = LH.x
  const z = LH.z
  const red = C.terracotta
  const ink = C.roofInk
  b.cyl(1.02, 1.14, H0, 12, C.stone, { x, y: H0 / 2, z })
  b.cyl(1.06, 1.06, 0.05, 12, '#d9d0c1', { x, y: H0 + 0.01, z })
  // tower: stacked segments so the red bands stay crisp
  const bands: [number, number, string][] = [
    [H0, 1.25, C.white],
    [1.25, 1.85, red],
    [1.85, 2.75, C.white],
    [2.75, 3.35, red],
    [3.35, 4.1, C.white],
    [4.1, H1, red],
  ]
  for (const [y0, y1, c] of bands) {
    b.add(new THREE.CylinderGeometry(rAt(y1), rAt(y0), y1 - y0, 32, 1, true), c, { x, y: (y0 + y1) / 2, z })
  }
  // a spiral of little windows (they glow at dusk)
  for (const [y, a] of [
    [1.0, 0.3],
    [2.3, -0.55],
    [3.72, 0.65],
  ] as [number, number][]) {
    const r = rAt(y)
    const px = x + Math.sin(a) * r
    const pz = z + Math.cos(a) * r
    b.rbox(0.2, 0.3, 0.06, 0.02, C.white, { x: px, y, z: pz, ry: a }, 1)
    b.box(0.14, 0.23, 0.05, C.glass, { x: x + Math.sin(a) * (r + 0.012), y, z: z + Math.cos(a) * (r + 0.012), ry: a }, 1)
  }
  // Hark-green door with an arched top, a step and a brass knob
  const dz = z + rAt(0.6) - 0.02
  b.rbox(0.44, 0.62, 0.08, 0.02, C.white, { x, y: H0 + 0.3, z: dz }, 1)
  b.box(0.34, 0.5, 0.08, C.signalDeep, { x, y: H0 + 0.25, z: dz + 0.02 })
  b.add(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16, 1, false, -Math.PI / 2, Math.PI), C.signalDeep, {
    x,
    y: H0 + 0.5,
    z: dz + 0.02,
    rx: -Math.PI / 2,
  })
  b.sphere(0.022, C.mustard, { x: x + 0.1, y: H0 + 0.26, z: dz + 0.07 }, 1)
  b.rbox(0.56, 0.08, 0.34, 0.02, C.stone, { x, y: H0 - 0.02, z: dz + 0.2 }, 1)
  // gallery deck + railing
  b.cyl(0.98, 0.86, 0.1, 32, ink, { x, y: H1 + 0.05, z })
  b.add(new THREE.TorusGeometry(0.95, 0.018, 5, 48), ink, { x, y: H1 + 0.37, z, rx: Math.PI / 2 })
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2
    b.cyl(0.013, 0.013, 0.3, 5, ink, { x: x + Math.cos(a) * 0.95, y: H1 + 0.23, z: z + Math.sin(a) * 0.95 })
  }
  // lantern (a size up): base ring, four glazing bars that leave the finale's
  // view of the mark clear, cap ring, dome roof, ball + weather vane
  const k = LR
  const Y = LANTERN.y
  b.cyl(0.47 * k, 0.5 * k, 0.2 * k, 24, red, { x, y: H1 + 0.1 + 0.1 * k, z })
  const clear = Math.PI / 2 - CLEAR_AZ
  for (let i = 0; i < 4; i++) {
    const a = clear + Math.PI / 4 + (i * Math.PI) / 2
    b.box(0.026, 0.74 * k, 0.026, ink, { x: x + Math.cos(a) * 0.43 * k, y: Y, z: z + Math.sin(a) * 0.43 * k, ry: -a })
  }
  b.cyl(0.53 * k, 0.46 * k, 0.08 * k, 24, ink, { x, y: Y + 0.41 * k, z })
  b.add(new THREE.SphereGeometry(0.5 * k, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), red, { x, y: Y + 0.44 * k, z, sy: 0.78 })
  b.sphere(0.08 * k, ink, { x, y: Y + 0.87 * k, z }, 2)
  b.cyl(0.012 * k, 0.012 * k, 0.42 * k, 5, ink, { x, y: Y + 1.08 * k, z })
  b.box(0.28 * k, 0.018 * k, 0.02 * k, ink, { x: x + 0.03, y: Y + 1.18 * k, z, ry: 0.6 })
  b.add(slab([[0.14 * k, 0.035 * k], [0.14 * k, -0.035 * k], [0.22 * k, 0]], 0.02 * k), ink, { x: x + 0.03, y: Y + 1.18 * k, z, ry: 0.6, rx: Math.PI / 2 })
}

/**
 * The Hark mark for the lantern: a light extrusion of a decimated outline
 * (every other outline point: it fills the lantern, and the finale pushes in
 * on it, but the triangulation stays cheap).
 */
function markGeometry() {
  const thin = (pts: THREE.Vector2[]) => pts.filter((_, i) => i % 2 === 0)
  const shapes = logoShapes().map(sh => {
    const s = new THREE.Shape(thin(sh.getPoints()))
    for (const h of sh.holes) s.holes.push(new THREE.Path(thin(h.getPoints())))
    return s
  })
  return logoGeometry({ shapes, depth: 0.1, bevel: false, curveSegments: 1 })
}

// ------------------------------------------------------------------ the jetty
function jetty(b: Builder, leds: THREE.Vector3[]) {
  const yaw = -JET_A
  const n = 15
  const side = new THREE.Vector3(-JET_DIR.z, 0, JET_DIR.x)
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const r = JET_R0 + t * JET_LEN
    b.rbox(JET_LEN / n - 0.035, 0.055, 0.62, 0.012, i % 2 ? C.wood : '#d4a06c', { x: JET_DIR.x * r, y: JET_Y, z: JET_DIR.z * r, ry: yaw }, 1)
  }
  for (let i = 0; i < 4; i++) {
    const r = JET_R0 + 0.55 + (i / 3) * (JET_LEN - 0.75)
    for (const s of [-1, 1]) {
      b.cyl(0.05, 0.055, 0.8, 8, C.woodDark, { x: JET_DIR.x * r + side.x * 0.34 * s, y: JET_Y - 0.28, z: JET_DIR.z * r + side.z * 0.34 * s })
    }
  }
  const end = JET_DIR.clone().multiplyScalar(JET_R0 + JET_LEN - 0.18)
  const L = side.clone().multiplyScalar(0.25)
  // lamp post with a green LED (instanced bulb, lit by the chapter)
  b.cyl(0.022, 0.028, 0.66, 6, C.roofInk, { x: end.x + L.x, y: JET_Y + 0.33, z: end.z + L.z })
  b.cyl(0.06, 0.06, 0.03, 8, C.roofInk, { x: end.x + L.x, y: JET_Y + 0.67, z: end.z + L.z })
  leds.push(new THREE.Vector3(end.x + L.x, JET_Y + 0.72, end.z + L.z))
  // bollard + a coil of rope + a crate
  b.cyl(0.06, 0.07, 0.16, 10, C.roofInk, { x: end.x - L.x, y: JET_Y + 0.1, z: end.z - L.z })
  b.add(new THREE.TorusGeometry(0.09, 0.03, 5, 14), C.sand, { x: end.x - L.x - JET_DIR.x * 0.42, y: JET_Y + 0.05, z: end.z - L.z - JET_DIR.z * 0.42, rx: Math.PI / 2 })
  const c = JET_DIR.clone().multiplyScalar(JET_R0 + 0.9)
  b.rbox(0.24, 0.2, 0.24, 0.02, C.woodDark, { x: c.x + L.x * 0.9, y: JET_Y + 0.12, z: c.z + L.z * 0.9, ry: 0.3 }, 1)
}

// ------------------------------------------------------------------ scene
export interface LighthouseScene {
  island: THREE.Group
  beamPivot: THREE.Group
  beamMat: THREE.ShaderMaterial
  spots: THREE.SpotLight[]
  mark: THREE.Mesh
  markMat: THREE.MeshStandardMaterial
  glassMat: THREE.MeshStandardMaterial
  glow: THREE.Sprite
  leds: THREE.InstancedMesh
  /** turn-on order 0..1 for each LED */
  ledOrder: number[]
  mailbox: THREE.Group
  mailFlag: THREE.Group
  smoke: THREE.InstancedMesh
  smokeOrigin: THREE.Vector3
  keeper: THREE.Group
  walker: THREE.Group
  walkPath: THREE.CatmullRomCurve3
  sailboat: THREE.Group
  farBoat: THREE.Group | null
  rowboat: THREE.Group
  rowboatAt: THREE.Vector3
  deck: CloudDeck
  upper: THREE.InstancedMesh
  /** island-local points that must stay inside the art rect */
  fitPoints: THREE.Vector3[]
}

export async function buildScene(root: THREE.Group, mobile: boolean): Promise<LighthouseScene> {
  const rand = rng(1907)
  const island = new THREE.Group()
  island.name = 'lighthouse-island'
  root.add(island)

  // ---------------- the rock
  const rock = makeIsland({
    radius: R,
    thickness: 0.7,
    depth: 2.2,
    seed: 21,
    wobble: 0.1,
    top: C.meadow,
    hanging: 0,
    roots: false,
    detail: mobile ? 0.6 : 0.9,
  })
  island.add(rock)
  await nextFrame()

  const decor = new THREE.Group()
  const put = (o: THREE.Object3D, x: number, y: number, z: number, ry = 0, s = 1) => {
    o.position.set(x, y, z)
    o.rotation.y = ry
    o.scale.setScalar(s)
    decor.add(o)
    return o
  }

  // ---------------- lighthouse + jetty + lamp posts (one vertex-colour build)
  const ledPos: THREE.Vector3[] = []
  const ledOrder: number[] = []
  const b = new Builder()
  lighthouse(b)
  const doorZ = LH.z + rAt(0.6)
  ledPos.push(new THREE.Vector3(LH.x + 0.32, H0 + 0.78, doorZ + 0.04))
  ledOrder.push(0)
  b.box(0.05, 0.05, 0.08, C.roofInk, { x: LH.x + 0.32, y: H0 + 0.72, z: doorZ })
  jetty(b, ledPos)
  ledOrder.push(1)

  const walkPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(LH.x, 0.02, doorZ + 0.35),
    new THREE.Vector3(1.05, 0.02, 0.62),
    new THREE.Vector3(1.9, 0.02, 1.25),
    new THREE.Vector3(2.95, 0.02, 1.22),
    JET_DIR.clone().multiplyScalar(JET_R0 - 0.05).setY(0.02),
  ])
  ;[0.2, 0.46, 0.72, 0.94].forEach((t, i) => {
    const p = walkPath.getPointAt(t)
    const tan = walkPath.getTangentAt(t)
    const s = i % 2 ? 0.36 : -0.36
    const x = p.x - tan.z * s
    const z = p.z + tan.x * s
    b.cyl(0.05, 0.06, 0.05, 8, C.roofInk, { x, y: 0.025, z })
    b.cyl(0.02, 0.024, 0.54, 6, C.roofInk, { x, y: 0.29, z })
    b.cyl(0.06, 0.05, 0.03, 8, C.roofInk, { x, y: 0.57, z })
    b.cone(0.07, 0.06, 8, C.roofInk, { x, y: 0.69, z })
    ledPos.push(new THREE.Vector3(x, 0.625, z))
    ledOrder.push(0.2 + i * 0.2)
  })
  const lhMesh = new THREE.Mesh(b.build(), clayVC())
  lhMesh.castShadow = true
  lhMesh.receiveShadow = true
  decor.add(lhMesh)

  // ---------------- keeper's cottage (own chimney so we know where the smoke goes)
  const cottage = makeHouse({
    w: COTTAGE.w,
    d: COTTAGE.d,
    h: COTTAGE.h,
    wall: C.cream,
    roof: C.roofRed,
    style: 'gable',
    seed: 4,
    chimney: false,
    flowers: true,
    shutters: true,
    accent: C.roofBlue,
  })
  put(cottage, COTTAGE.x, 0, COTTAGE.z, COTTAGE.ry)
  const cottageM = new THREE.Matrix4().compose(
    new THREE.Vector3(COTTAGE.x, 0, COTTAGE.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), COTTAGE.ry),
    new THREE.Vector3(1, 1, 1),
  )
  const rise = (COTTAGE.d / 2) * Math.tan(0.62)
  const chim = new THREE.Vector3(COTTAGE.w * 0.28, COTTAGE.h + rise * 0.6, -COTTAGE.d * 0.2)
  {
    const cb = new Builder()
    cb.rbox(0.2, rise * 0.9 + 0.3, 0.2, 0.03, C.stone, { x: chim.x, y: chim.y, z: chim.z }, 1)
    cb.box(0.25, 0.05, 0.25, C.slate, { x: chim.x, y: chim.y + (rise * 0.9 + 0.3) / 2 + 0.02, z: chim.z })
    const m = new THREE.Mesh(cb.build(), clayVC())
    m.castShadow = true
    m.receiveShadow = true
    m.applyMatrix4(cottageM)
    decor.add(m)
  }
  const smokeOrigin = chim.clone().setY(chim.y + (rise * 0.9 + 0.3) / 2 + 0.08).applyMatrix4(cottageM)
  const porch = new THREE.Vector3(0.33, 0.66, COTTAGE.d / 2 + 0.06).applyMatrix4(cottageM)
  ledPos.push(porch)
  ledOrder.push(0.1)
  await nextFrame()

  // ---------------- path, garden, trees, rocks
  decor.add(makePath(walkPath.points.map(p => p.clone().setY(0)), { width: 0.44, stones: true, seed: 5 }))
  for (const [x, z, s, seed] of [
    [-2.75, -2.0, 1.0, 3],
    [-1.95, -2.75, 0.9, 5],
    [-3.35, -0.7, 0.8, 7],
    [-0.7, -2.95, 0.78, 9],
    [2.5, -2.35, 0.72, 11],
    [-3.0, -1.6, 0.62, 13],
  ] as [number, number, number, number][]) {
    put(makeTree(seed, s, 'pine'), x, 0, z)
  }
  put(makeTree(21, 0.7, 'round'), 2.95, 0, -1.25)
  for (let i = 0, placed = 0; i < 40 && placed < 11; i++) {
    const a = rand() * Math.PI * 2
    const rr = R * lerp(0.35, 0.84, rand())
    const x = Math.cos(a) * rr
    const z = Math.sin(a) * rr
    if (Math.hypot(x - LH.x, z - LH.z) < 1.35 || Math.hypot(x - COTTAGE.x, z - COTTAGE.z) < 1.25) continue
    let near = false
    for (let t = 0; t <= 1.001; t += 0.1) if (walkPath.getPointAt(t).distanceTo(_p.set(x, 0.02, z)) < 0.55) near = true
    if (near || Math.abs(Math.atan2(Math.sin(a - JET_A), Math.cos(a - JET_A))) < 0.3) continue
    put(makeBush(placed, 0.9 + rand() * 0.6), x, 0, z, rand() * 6)
    placed++
  }
  // boulders round the shore (heavier at the back and left), clear of the jetty
  for (let i = 0; i < 30; i++) {
    const a = rand() * Math.PI * 2
    if (Math.abs(Math.atan2(Math.sin(a - JET_A), Math.cos(a - JET_A))) < 0.34) continue
    const back = 0.5 - 0.5 * Math.sin(a)
    const s = lerp(1.3, 2.9, rand()) * lerp(0.8, 1.3, back)
    const edge = (rock.userData.edge as (a: number, out?: THREE.Vector3) => THREE.Vector3)(a, new THREE.Vector3())
    const k = lerp(0.9, 1.04, rand())
    const r = put(makeRock(i, s), edge.x * k, -0.12, edge.z * k, rand() * 6)
    r.rotation.x = (rand() - 0.5) * 0.5
    r.castShadow = true
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3
    if (Math.abs(Math.sin(a) - 1) < 0.25) continue // keep the door clear
    put(makeRock(i + 40, 1.8 + rand()), LH.x + Math.cos(a) * 1.08, -0.02, LH.z + Math.sin(a) * 1.08, rand() * 6)
  }
  put(makeBench(), -0.4, 0, 2.3, -0.35)
  await nextFrame()

  island.add(mergeStatic(decor))
  await nextFrame()
  if (!mobile) {
    // wild flowers in the grass
    const pts: { x: number; z: number; s: number }[] = []
    for (let i = 0; i < 60 && pts.length < 34; i++) {
      const x = lerp(-3.3, -0.2, rand())
      const z = lerp(0.2, 2.9, rand())
      if (Math.hypot(x, z) > R * 0.86 || Math.hypot(x + 0.4, z - 2.3) < 0.45) continue
      pts.push({ x, z, s: 0.9 + rand() * 0.5 })
    }
    island.add(scatter(flowerGeometry(), clayVC(), pts, { seed: 4, colors: [C.blossom, C.mustard, C.white, C.coral] }))
  }

  // ---------------- a little Hark wayfinding sign pointing to the post box
  const sign = makeSign('Say hello', { hark: true, arrow: 'right', h: 0.26, post: 0.42, font: 'display' })
  sign.position.set(-0.05, 0, 0.62)
  sign.rotation.y = 0.12
  sign.scale.setScalar(0.95)
  island.add(sign)

  // ---------------- a Hark pennant by the cottage (flutters by itself)
  const flag = makeFlag({ color: C.signal, mark: true, pole: 1.55, w: 0.56, h: 0.34 })
  flag.position.set(-2.62, 0, 0.62)
  flag.rotation.y = 0.5
  island.add(flag)

  // ---------------- lantern: glass, the Hark mark, glow, beams, spotlights
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#e6fff2',
    roughness: 0.08,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    emissive: new THREE.Color('#c8ffe2'),
    emissiveIntensity: 0,
  })
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * LR, 0.42 * LR, 0.74 * LR, 24, 1, true), glassMat)
  glass.position.copy(LANTERN)
  glass.renderOrder = 3
  island.add(glass)

  const markMat = new THREE.MeshStandardMaterial({
    color: '#0c3a26',
    roughness: 0.35,
    emissive: new THREE.Color(C.signalBright),
    emissiveIntensity: 0,
  })
  await nextFrame()
  // the mark fills the lantern and turns to face the camera (the chapter
  // yaws it each frame); only the beams spin
  const mark = new THREE.Mesh(markGeometry(), markMat)
  mark.scale.setScalar(0.74)
  mark.position.copy(LANTERN)
  island.add(mark)

  await nextFrame()
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
  )
  glow.position.copy(LANTERN)
  glow.renderOrder = 4
  island.add(glow)

  const beamPivot = new THREE.Group()
  beamPivot.position.copy(LANTERN)
  island.add(beamPivot)
  const TILT = 0.1
  const LEN = 30
  const cone = (side: number) => {
    const g = new THREE.CylinderGeometry(0.1, 3.3, LEN, 28, 1, true)
    g.translate(0, -LEN / 2, 0)
    g.rotateZ(Math.PI / 2 - TILT)
    if (side === 0) g.rotateY(Math.PI)
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(side), 1))
    return g
  }
  const beamMat = beamMaterial()
  const beam = new THREE.Mesh(mergeGeometries([cone(0), cone(1)], false)!, beamMat)
  beam.renderOrder = 5
  beam.frustumCulled = false
  beamPivot.add(beam)
  const spots: THREE.SpotLight[] = []
  for (const [side, colr] of [
    [1, '#ffd49a'],
    [-1, '#8dffc0'],
  ] as [number, string][]) {
    const s = new THREE.SpotLight(colr, 0, 70, 0.13, 0.75, 1)
    s.castShadow = false
    s.target.position.set(side * Math.cos(TILT) * 20, -Math.sin(TILT) * 20, 0)
    beamPivot.add(s, s.target)
    spots.push(s)
  }

  // ---------------- LEDs (unlit, HDR instance colours so they bloom)
  const leds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), ledPos.length)
  ledPos.forEach((p, i) => {
    leds.setMatrixAt(i, _m.makeTranslation(p.x, p.y, p.z))
    leds.setColorAt(i, new THREE.Color(0.05, 0.08, 0.06))
  })
  leds.frustumCulled = false
  island.add(leds)

  // ---------------- post box (Hark green, red flag) beside the door
  const mailbox = new THREE.Group()
  mailbox.position.set(LH.x + 1.02, 0, LH.z + 1.18)
  mailbox.rotation.y = -0.55
  mailbox.scale.setScalar(1.35)
  {
    const mb = new Builder()
    mb.rbox(0.07, 0.5, 0.07, 0.015, C.wood, { y: 0.25 }, 1)
    mb.rbox(0.19, 0.13, 0.32, 0.03, C.signal, { y: 0.56 }, 2)
    mb.add(new THREE.CylinderGeometry(0.095, 0.095, 0.32, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), C.signal, { y: 0.62 })
    mb.box(0.17, 0.16, 0.012, C.signalDeep, { y: 0.6, z: 0.162 })
    mb.box(0.12, 0.018, 0.014, C.white, { y: 0.63, z: 0.168 })
    const m = new THREE.Mesh(mb.build(), clayVC())
    m.castShadow = true
    m.receiveShadow = true
    mailbox.add(m)
  }
  const mailFlag = new THREE.Group()
  mailFlag.position.set(0.11, 0.56, -0.08)
  // down: lying forward along the side; the chapter raises it (rotation.x → 0)
  mailFlag.rotation.x = Math.PI / 2
  {
    const fb = new Builder()
    fb.box(0.016, 0.24, 0.02, C.roofInk, { y: 0.11 })
    fb.box(0.018, 0.1, 0.13, C.alert, { y: 0.2, z: 0.065 })
    const m = new THREE.Mesh(fb.build(), clayVC())
    m.castShadow = true
    mailFlag.add(m)
  }
  mailbox.add(mailFlag)
  island.add(mailbox)

  // ---------------- chimney smoke: little clay puffs that rise and shrink
  const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), clay(C.white, { rough: 1 }), 5)
  smoke.frustumCulled = false
  island.add(smoke)

  // ---------------- people
  const keeper = makePerson(C.roofBlue, 4)
  keeper.scale.setScalar(0.85)
  // on the gallery, round the side (never between a camera and the mark)
  keeper.position.set(LH.x + Math.sin(KEEPER_A) * 0.8, H1 + 0.1, LH.z + Math.cos(KEEPER_A) * 0.8)
  keeper.rotation.y = KEEPER_A
  island.add(keeper)
  const walker = makePerson(C.coral, 9)
  island.add(walker)

  // ---------------- boats on the clouds + gulls round the lantern
  const sailboat = makeBoat({ color: C.white, sail: C.signal })
  sailboat.scale.setScalar(1.6)
  root.add(sailboat)
  const farBoat = mobile ? null : makeBoat({ color: C.roofBlue, sail: C.white })
  if (farBoat) {
    farBoat.traverse(o => ((o as THREE.Mesh).castShadow = false))
    root.add(farBoat)
  }
  const rowboat = makeBoat({ color: C.roofRed })
  rowboat.scale.setScalar(1.5)
  const rowboatAt = JET_DIR.clone()
    .multiplyScalar(JET_R0 + JET_LEN - 0.55)
    .add(new THREE.Vector3(-JET_DIR.z, 0, JET_DIR.x).multiplyScalar(-0.72))
    .setY(-0.34)
  // afloat on the deck (under the jetty's planks)
  rowboatAt.setY(Math.min(-0.3, deckHeight(rowboatAt.x, rowboatAt.z) + 0.1))
  rowboat.position.copy(rowboatAt)
  rowboat.rotation.y = -JET_A + 0.1
  island.add(rowboat)

  const gulls = makeBirds({ count: mobile ? 4 : 7, radius: 2.6, height: 0.6, seed: 5, size: 0.17 })
  gulls.position.set(LANTERN.x, LANTERN.y, LANTERN.z)
  island.add(gulls)
  await nextFrame()

  // ---------------- the sea of clouds: a continuous floor and a few big heaps
  const deck = await buildCloudDeck(root, mobile)

  // the cloud bank the camera sinks through at the start (placed by the chapter after fitting)
  const upper = new THREE.InstancedMesh(cloudGeometry(2), cloudMaterial(), mobile ? 10 : 16)
  upper.frustumCulled = false
  upper.castShadow = false
  upper.receiveShadow = false
  root.add(upper)

  await nextFrame()
  // ---------------- fit points (island-local): shore ring, lighthouse top, jetty end
  const fitPoints: THREE.Vector3[] = []
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    fitPoints.push(new THREE.Vector3(Math.cos(a) * R * 1.02, -0.45, Math.sin(a) * R * 1.02))
    fitPoints.push(new THREE.Vector3(Math.cos(a) * R * 0.9, 0.35, Math.sin(a) * R * 0.9))
  }
  for (const dx of [-0.55, 0.55]) fitPoints.push(new THREE.Vector3(LH.x + dx, LH_TOP - 0.3, LH.z))
  fitPoints.push(new THREE.Vector3(LH.x, LH_TOP, LH.z))
  const jEnd = JET_DIR.clone().multiplyScalar(JET_R0 + JET_LEN)
  fitPoints.push(jEnd.clone().setY(-0.4), jEnd.clone().setY(0.6))

  return {
    island,
    beamPivot,
    beamMat,
    spots,
    mark,
    markMat,
    glassMat,
    glow,
    leds,
    ledOrder,
    mailbox,
    mailFlag,
    smoke,
    smokeOrigin,
    keeper,
    walker,
    walkPath,
    sailboat,
    farBoat,
    rowboat,
    rowboatAt,
    deck,
    upper,
    fitPoints,
  }
}
