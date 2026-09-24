import * as THREE from 'three'
import {
  makeIsland,
  treeGeometry,
  bushGeometry,
  rockGeometry,
  flowerGeometry,
  cloudGeometry,
  cloudMaterial,
  makeBirds,
  type TreeKind,
} from '../../kit/props'
import { C, MAT, clayVC } from '../../kit/palette'
import { logoGeometry, logoShapes } from '../../logo/logo'
import { clamp, lerp, rng, segment, smoothstep } from '../../core/math'
import { Batch, Pops, landCurve, flipCurve, HIDDEN, type Squash } from './util'
import { Crane } from './crane'
import * as T from './timeline'
import { CELL, cellUv, type SiteTextures } from './textures'

/*
 * Everything on the Building Site island. Static dressing is merged into a
 * handful of vertex-colored meshes drawn with the kit's clayVC() material
 * (same rim-lit clay as every other island); everything that moves is an
 * InstancedMesh (floors, scaffold, people, trees, pegs, puffs) or a small
 * group (crane, vehicles, table, tripod, sign, fence flaps).
 *
 * update(l, time) derives the whole scene from local progress `l`; real time
 * only drives idle life (walkers, sway, drum, clouds) and the length of pop
 * springs.
 */

const Y0 = new THREE.Vector3(0, 1, 0)
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _v = new THREE.Vector3()
const _x = new THREE.Vector3()
const _z = new THREE.Vector3()
const _c = new THREE.Color()
const sq: Squash = { xz: 1, y: 1 }

// palette (toy clay)
const DIRT = '#e6d3ad'
const DIRT_D = '#d6c099'
const FOUND = '#c9a47c'
const WOOD = '#d8a766'
const WOOD_D = '#b98a52'
const PLY_BACK = '#e8d9ba'
const INK = '#2a3230'
const STEEL = '#b8c6d2'
const WALL = '#f4e9d4'
const TRIM = '#fbfaf6'
const ORANGE = '#ff8a3d'
const HAT_Y = '#f6b928'
const SKIN = ['#f3cfae', '#e0a982', '#b77a52', '#8a5a3b', '#f7dcc4']

const fenceZ = (x: number) => 3.05 - 0.028 * x * x
const fenceYaw = (x: number) => Math.atan(0.056 * x)

/** set an instance from position, euler and scale (hidden when scale ~0) */
function setInst(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, rx = 0, rz = 0) {
  if (sx <= 1e-4 || sy <= 1e-4) {
    mesh.setMatrixAt(i, HIDDEN)
    return
  }
  _e.set(rx, ry, rz, 'YXZ')
  _q.setFromEuler(_e)
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))
  mesh.setMatrixAt(i, _m)
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cast = true, receive = true) {
  const m = new THREE.InstancedMesh(geo, mat, n)
  m.frustumCulled = false
  m.castShadow = cast
  m.receiveShadow = receive
  for (let i = 0; i < n; i++) m.setMatrixAt(i, HIDDEN)
  return m
}

function roundedRect(x0: number, z0: number, x1: number, z1: number, r: number) {
  // shape in the XY plane (y = -z) so rotateX(-PI/2) lays it on the ground
  const s = new THREE.Shape()
  const a = x0
  const b = -z1
  const w = x1 - x0
  const h = z1 - z0
  s.moveTo(a + r, b)
  s.lineTo(a + w - r, b)
  s.quadraticCurveTo(a + w, b, a + w, b + r)
  s.lineTo(a + w, b + h - r)
  s.quadraticCurveTo(a + w, b + h, a + w - r, b + h)
  s.lineTo(a + r, b + h)
  s.quadraticCurveTo(a, b + h, a, b + h - r)
  s.lineTo(a, b + r)
  s.quadraticCurveTo(a, b, a + r, b)
  return s
}

function slab(shape: THREE.Shape, depth: number, bevel = 0.02) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  })
  g.rotateX(-Math.PI / 2)
  return g
}

let markShapes: THREE.Shape[] | null = null
/** The Hark mark's shapes, resampled evenly (the SVG outline is far finer than a toy sign needs). */
function simpleMark(mobile: boolean) {
  if (!markShapes) {
    markShapes = logoShapes().map(sh => {
      const out = new THREE.Shape(sh.getSpacedPoints(mobile ? 90 : 140))
      out.holes = sh.holes.map(h => new THREE.Path(h.getSpacedPoints(mobile ? 48 : 72)))
      return out
    })
  }
  return markShapes
}
let markFace: THREE.BufferGeometry | null = null
/** Flat Hark mark (1 unit tall, facing +z), cached. */
function markFaceGeometry(mobile: boolean) {
  return (markFace ??= new THREE.ShapeGeometry(simpleMark(mobile), 1))
}

/** plane with its UVs remapped into one atlas cell */
function panelFace(w: number, h: number, cell: number) {
  const g = new THREE.PlaneGeometry(w, h)
  const { u0, u1, v0, v1 } = cellUv(cell)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)))
  return g
}

// ------------------------------------------------------------------ layout

interface Role {
  body: string
  hat: string
  skin: string
}
const ROLES: Role[] = [
  { body: ORANGE, hat: TRIM, skin: SKIN[0] }, // 0 surveyor at the tripod
  { body: ORANGE, hat: HAT_Y, skin: SKIN[2] }, // 1 pegging out the plot
  { body: '#16c172', hat: TRIM, skin: SKIN[1] }, // 2 Hark architect
  { body: C.coral, hat: TRIM, skin: SKIN[4] }, // 3 the client
  { body: ORANGE, hat: HAT_Y, skin: SKIN[3] }, // 4 on the scaffold
  { body: C.roofBlue, hat: HAT_Y, skin: SKIN[0] }, // 5 hooking loads at the laydown
  { body: ORANGE, hat: HAT_Y, skin: SKIN[1] }, // 6 with the wheelbarrow
  { body: C.teal, hat: '#efd9a4', skin: SKIN[2] }, // 7 gardener (straw hat)
  { body: '#16c172', hat: C.signal, skin: SKIN[3] }, // 8 Hark support tech
]

const HW = T.FOOT.w / 2
const HD = T.FOOT.d / 2
const PEGS: [number, number][] = [
  [-HW, T.B.z + HD],
  [0, T.B.z + HD],
  [HW, T.B.z + HD],
  [HW, T.B.z - HD],
  [0, T.B.z - HD],
  [-HW, T.B.z - HD],
]
const TABLE = new THREE.Vector3(1.45, 0, 1.32)
const TRIPOD = new THREE.Vector3(-1.1, 0, 1.45)
const CLIENT_AT_TABLE = new THREE.Vector3(1.86, 0, 0.92)
const ARCH_AT_TABLE = new THREE.Vector3(1.05, 0, 0.92)
const CLIENT_AT_DOOR = new THREE.Vector3(0.46, 0, 0.72)
const ARCH_AT_DOOR = new THREE.Vector3(-0.46, 0, 0.72)
const MIXER = new THREE.Vector3(3.45, 0, 0.72)
const VAN = new THREE.Vector3(3.35, 0, 0.78)

interface TreeSpot {
  kind: TreeKind
  seed: number
  x: number
  z: number
  s: number
}
/** planted in step 4, in planting order */
const TREES_NEW: TreeSpot[] = [
  { kind: 'blossom', seed: 2, x: -1.6, z: 2.05, s: 0.78 },
  { kind: 'blossom', seed: 2, x: 1.6, z: 2.05, s: 0.78 },
  { kind: 'round', seed: 4, x: -2.05, z: 0.6, s: 0.82 },
  { kind: 'round', seed: 4, x: 2.05, z: 0.6, s: 0.82 },
  { kind: 'poplar', seed: 6, x: -2.0, z: -1.75, s: 0.8 },
  { kind: 'poplar', seed: 6, x: 2.05, z: -1.8, s: 0.8 },
]
const TREES_RIM: TreeSpot[] = [
  { kind: 'round', seed: 4, x: -5.3, z: -1.6, s: 1.0 },
  { kind: 'pine', seed: 5, x: -4.35, z: -3.45, s: 1.05 },
  { kind: 'round', seed: 4, x: -2.7, z: -4.8, s: 0.95 },
  { kind: 'poplar', seed: 6, x: -0.8, z: -5.35, s: 1.0 },
  { kind: 'pine', seed: 5, x: 1.25, z: -5.25, s: 1.0 },
  { kind: 'round', seed: 4, x: 3.25, z: -4.4, s: 1.05 },
  { kind: 'pine', seed: 5, x: 5.0, z: -2.95, s: 0.95 },
  { kind: 'round', seed: 4, x: -5.4, z: 1.95, s: 0.9 },
  { kind: 'pine', seed: 5, x: -4.75, z: 3.25, s: 0.85 },
  { kind: 'round', seed: 4, x: 4.85, z: 3.2, s: 0.9 },
]
const TREE_KEYS = ['round', 'pine', 'poplar', 'blossom'] as const

/** site fence along the front edge: painted plywood + three revolving stat panels */
const FENCE: { w: number; h: number; cell: number; flap: number }[] = [
  { w: 0.9, h: 0.45, cell: CELL.endL, flap: -1 },
  { w: 1.5, h: 0.75, cell: -1, flap: 0 },
  { w: 1.1, h: 0.55, cell: CELL.hats, flap: -1 },
  { w: 1.5, h: 0.75, cell: -1, flap: 1 },
  { w: 1.1, h: 0.55, cell: CELL.dust, flap: -1 },
  { w: 1.5, h: 0.75, cell: -1, flap: 2 },
  { w: 0.9, h: 0.45, cell: CELL.endR, flap: -1 },
]
const FENCE_GAP = 0.14
const FENCE_Y = 0.08
const fenceX: number[] = []
{
  const total = FENCE.reduce((a, p) => a + p.w, 0) + FENCE_GAP * (FENCE.length - 1)
  let x = -total / 2
  for (const p of FENCE) {
    fenceX.push(x + p.w / 2)
    x += p.w + FENCE_GAP
  }
}

export class Site {
  /** chapter content, island top at y = groundY */
  root = new THREE.Group()
  /** everything standing on the island (y = 0 is the ground) */
  site = new THREE.Group()
  groundY = 0

  private pops!: Pops
  private flips!: Pops
  private ids: Record<string, number> = {}
  private crane!: Crane
  private craneState: T.CraneState = { yaw: 0, r: 2, cable: 1, carrying: -1 }

  private floors!: THREE.InstancedMesh
  private glass!: THREE.InstancedMesh
  private glassMat!: THREE.MeshStandardMaterial
  private door!: THREE.Mesh
  private roof!: THREE.Mesh
  private sign!: THREE.Group
  private signMat!: THREE.MeshStandardMaterial
  private cards!: THREE.InstancedMesh
  private tubes!: THREE.InstancedMesh
  private boards!: THREE.InstancedMesh
  private tubeDefs: { a: THREE.Vector3; b: THREE.Vector3; t: number; at: number; out: number }[] = []
  private boardDefs: { c: THREE.Vector3; w: number; d: number; at: number; out: number }[] = []
  private pegs!: THREE.InstancedMesh
  private strings!: THREE.InstancedMesh
  private tripod!: THREE.Group
  private table!: THREE.Group
  private sheet!: THREE.Mesh
  private roll!: THREE.Mesh
  private rings!: THREE.InstancedMesh
  private talk!: THREE.Sprite
  private idea!: THREE.Sprite
  private people!: THREE.InstancedMesh[]
  private barrow!: THREE.Mesh
  private mixer!: THREE.Group
  private drum!: THREE.Mesh
  private van!: THREE.Group
  private lawn!: THREE.Mesh
  private bunting!: THREE.Mesh
  private clutter!: THREE.Group
  private grass!: THREE.Mesh
  private trees = new Map<string, THREE.InstancedMesh>()
  private treeSlots: number[] = []
  private puffs!: THREE.InstancedMesh
  private fenceFaces!: THREE.Mesh
  private flaps: THREE.Group[] = []
  private cloudRing!: THREE.Group
  /** the cloud bank the camera descends out of and climbs back into */
  private bank!: THREE.Object3D
  private bankDir = new THREE.Vector3(0.14, 0.92, 0.37).normalize()

  /** touchdowns: ground floor, three craned floors, the van */
  private events: { at: number; t0: number; x: number; y: number; z: number; hw: number; hd: number }[] = []
  private lPrev = -1

  constructor(
    private mobile: boolean,
    private tex: SiteTextures,
  ) {}

  /** Build in a few slices so the loader keeps breathing. */
  async build(yieldFrame: () => Promise<void>) {
    const vc = clayVC()
    const mobile = this.mobile

    // ---- island
    const island = makeIsland({ radius: 6.3, thickness: 0.9, depth: 4.6, seed: 23, wobble: 0.06, detail: mobile ? 0.6 : 1 })
    this.root.add(island)
    island.updateMatrixWorld(true)
    const hit = new THREE.Raycaster(new THREE.Vector3(0.2, 60, 0.4), new THREE.Vector3(0, -1, 0)).intersectObject(island, true)[0]
    this.groundY = hit ? hit.point.y : 0
    this.site.position.y = this.groundY
    this.root.add(this.site)
    await yieldFrame()

    let n = 0
    const alloc = (key: string, count: number) => {
      this.ids[key] = n
      n += count
    }

    // ---- ground (receives shadows, casts none)
    const ground = new Batch()
    ground.add(slab(roundedRect(-4.85, -3.75, 4.7, 2.55, 1.4), 0.005, 0.012), DIRT)
    ground.add(slab(roundedRect(-HW - 0.1, T.B.z - HD - 0.1, HW + 0.1, T.B.z + HD + 0.1, 0.08), 0.008, 0.008), FOUND, new THREE.Matrix4().makeTranslation(0, 0.012, 0))
    for (const z of [0.52, 0.92, 1.14, 1.54]) ground.box(2.6, 0.008, 0.09, DIRT_D, 4.55, 0.02, z)
    ground.add(slab(roundedRect(-4.75, -0.85, -2.15, 1.3, 0.2), 0.005, 0.006), '#d8c6a0', new THREE.Matrix4().makeTranslation(0, 0.012, 0))
    this.site.add(ground.build(vc, false, true))
    // the Hark mark (parsed from SVG, resampled) is used by the cabin, van and sign
    markFaceGeometry(mobile)
    await yieldFrame()

    // ---- static props + fence; construction clutter in its own group
    const props = new Batch()
    const clutter = new Batch()
    this.buildProps(props, clutter, mobile)
    await yieldFrame()
    this.buildFence(props)
    this.site.add(props.build(vc))
    this.clutter = new THREE.Group()
    this.clutter.add(clutter.build(vc))
    this.site.add(this.clutter)
    alloc('clutter', 1)
    await yieldFrame()

    // Hark-green LEDs on the fence posts and the floodlight
    const leds = new Batch()
    const ledGeo = new THREE.SphereGeometry(0.036, 8, 6)
    for (const [x, top] of this.postTops()) leds.put(ledGeo, C.signal, x, top + 0.03, fenceZ(x))
    this.site.add(leds.build(MAT.led, false, false))
    const flood = new Batch()
    flood.put(new THREE.SphereGeometry(0.06, 10, 8), C.signal, -4.28, 1.62, -1.15)
    flood.put(new THREE.SphereGeometry(0.06, 10, 8), C.signal, -4.12, 1.62, -1.25)
    this.clutter.add(flood.build(MAT.led, false, false))

    // step 4: the yard turns to lawn, spreading out from the new building
    const grass = new Batch()
    grass.add(slab(roundedRect(-4.9, -3.8, 4.75, 2.6, 1.42), 0.005, 0.012), '#a3d27f', new THREE.Matrix4().makeTranslation(-T.B.x, 0.02, -T.B.z))
    this.grass = grass.build(vc, false, true)
    this.grass.position.copy(T.B)
    this.site.add(this.grass)
    alloc('grass', 1)

    // ---- the building: floors (vc) + glass (lit when finished), instanced
    const wW = T.FOOT.w - 0.1
    const wD = T.FOOT.d - 0.1
    const fb = new Batch()
    fb.box(wW, 0.53, wD, WALL, 0, 0.265, 0)
    fb.box(T.FOOT.w + 0.04, 0.07, T.FOOT.d + 0.04, TRIM, 0, 0.565, 0)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) fb.box(0.1, 0.53, 0.1, TRIM, sx * (wW / 2 - 0.02), 0.265, sz * (wD / 2 - 0.02))
    const gb = new Batch()
    for (const x of [-0.86, -0.42, 0.42, 0.86]) {
      for (const sz of [1, -1]) {
        gb.box(0.32, 0.3, 0.03, '#ffffff', x, 0.3, sz * (wD / 2 + 0.005))
        fb.box(0.38, 0.025, 0.06, TRIM, x, 0.14, sz * (wD / 2 + 0.01))
      }
    }
    for (const z of [-0.5, 0, 0.5]) for (const sx of [1, -1]) gb.box(0.03, 0.3, 0.3, '#ffffff', sx * (wW / 2 + 0.005), 0.3, z)
    this.floors = instanced(fb.geometry(), vc, T.FLOORS)
    this.glassMat = new THREE.MeshStandardMaterial({
      color: '#4b6679',
      roughness: 0.24,
      metalness: 0.05,
      emissive: new THREE.Color('#ffc46e'),
      emissiveIntensity: 0,
    })
    this.glass = instanced(gb.geometry(), this.glassMat, T.FLOORS, false, true)
    this.site.add(this.floors, this.glass)
    alloc('ground', 1)
    alloc('stack', 3)

    // ground-floor entrance: door, green awning, step
    const db = new Batch()
    db.box(0.38, 0.45, 0.03, TRIM, 0, 0.225, wD / 2 + 0.015)
    db.box(0.3, 0.39, 0.035, '#2c3e50', 0, 0.195, wD / 2 + 0.02, 0, 0, 0, 1)
    db.box(0.62, 0.035, 0.22, C.signal, 0, 0.49, wD / 2 + 0.1)
    db.box(0.52, 0.03, 0.2, '#ded7ca', 0, 0.015, wD / 2 + 0.1)
    this.door = db.build(vc)
    this.door.position.copy(T.B)
    this.site.add(this.door)

    // roof cap: slab, parapet, plant, stair hut
    const rb = new Batch()
    const pw = T.FOOT.w + 0.04
    const pd = T.FOOT.d + 0.04
    rb.box(wW, 0.04, wD, '#a8afb4', 0, 0.02, 0)
    rb.box(pw, 0.12, 0.07, TRIM, 0, 0.06, pd / 2 - 0.035)
    rb.box(pw, 0.12, 0.07, TRIM, 0, 0.06, -pd / 2 + 0.035)
    rb.box(0.07, 0.12, pd, TRIM, pw / 2 - 0.035, 0.06, 0)
    rb.box(0.07, 0.12, pd, TRIM, -pw / 2 + 0.035, 0.06, 0)
    rb.box(0.44, 0.3, 0.4, WALL, -0.66, 0.15, -0.42)
    rb.box(0.48, 0.04, 0.44, TRIM, -0.66, 0.32, -0.42)
    for (const x of [0.36, 0.74]) {
      rb.box(0.26, 0.16, 0.22, '#d3d8dc', x, 0.1, -0.44)
      rb.put(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), '#4b5563', x, 0.19, -0.44)
    }
    this.roof = rb.build(vc)
    this.site.add(this.roof)
    alloc('roof', 1)

    // the sign: the Hark mark, lit green, on two little posts
    this.signMat = new THREE.MeshStandardMaterial({ color: C.signal, emissive: C.signalBright, emissiveIntensity: 0, roughness: 0.45 })
    this.sign = new THREE.Group()
    // the mark's SVG outline is very finely discretised (a bevelled
    // extrusion runs to ~100k triangles): resampled for a ~70px sign
    const mark = new THREE.Mesh(logoGeometry({ shapes: simpleMark(mobile), depth: 0.14, bevel: false }), this.signMat)
    mark.castShadow = true
    mark.scale.setScalar(0.56)
    mark.position.y = 0.46
    const sp = new Batch()
    sp.box(0.03, 0.22, 0.03, INK, -0.15, 0.11, -0.06)
    sp.box(0.03, 0.22, 0.03, INK, 0.15, 0.11, -0.06)
    sp.box(0.52, 0.03, 0.06, INK, 0, 0.2, -0.06)
    this.sign.add(mark, sp.build(vc))
    this.site.add(this.sign)
    alloc('sign', 1)
    await yieldFrame()

    // cardboard mock-up: four stacked boxes with marker windows
    const cg = new THREE.BoxGeometry(wW - 0.02, 0.56, wD - 0.02)
    const cuv = cg.attributes.uv as THREE.BufferAttribute
    for (let i = 8; i < 16; i++) cuv.setXY(i, 0.5 + (i % 2) * 0.01, 0.8 + (i % 4 > 1 ? 0.01 : 0))
    cg.translate(0, 0.28, 0)
    const cardMat = new THREE.MeshStandardMaterial({ map: this.tex.cardboard, roughness: 0.95 })
    this.cards = instanced(cg, cardMat, 4)
    this.site.add(this.cards)
    alloc('cards', 4)

    // ---- scaffold (tubes + boards)
    this.buildScaffold()
    this.tubes = instanced(new Batch().box(1, 1, 1, STEEL, 0, 0, 0).geometry(), vc, this.tubeDefs.length)
    this.boards = instanced(new Batch().box(1, 1, 1, WOOD, 0, 0, 0).geometry(), vc, this.boardDefs.length)
    this.site.add(this.tubes, this.boards)
    alloc('tubes', this.tubeDefs.length)
    alloc('boards', this.boardDefs.length)

    // ---- crane
    const flagMat = new THREE.MeshStandardMaterial({ color: C.signal, roughness: 0.6, side: THREE.DoubleSide })
    this.crane = new Crane(vc, MAT.led, flagMat, mobile)
    this.site.add(this.crane.root)
    await yieldFrame()

    // ---- step 1: pegs, strings, tripod, table
    const pg = new Batch()
    pg.box(0.035, 0.24, 0.035, WOOD_D, 0, 0.12, 0)
    pg.box(0.05, 0.05, 0.05, '#ff5d8f', 0, 0.22, 0)
    this.pegs = instanced(pg.geometry(), vc, PEGS.length)
    this.strings = instanced(new Batch().box(1, 1, 1, '#ff5d8f', 0, 0, 0).geometry(), vc, PEGS.length, false, false)
    this.site.add(this.pegs, this.strings)
    alloc('pegs', PEGS.length)

    this.tripod = new THREE.Group()
    const tp = new Batch()
    const apex = new THREE.Vector3(0, 0.46, 0)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.4
      tp.strut(new THREE.Vector3(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18), apex, 0.024, WOOD_D)
    }
    tp.box(0.1, 0.06, 0.1, INK, 0, 0.49, 0)
    // the listening cone: a green ear trumpet pointed at the client
    const horn = new THREE.CylinderGeometry(0.16, 0.026, 0.34, 20, 1, true)
    horn.rotateZ(-Math.PI / 2)
    tp.put(horn, C.signal, 0.19, 0.56, 0)
    tp.put(new THREE.CylinderGeometry(0.15, 0.024, 0.33, 20, 1, true), '#0a8f55', 0.19, 0.56, 0, 0, 1, 1, 1, 0, -Math.PI / 2)
    tp.put(new THREE.TorusGeometry(0.16, 0.016, 6, 22), INK, 0.36, 0.56, 0, Math.PI / 2)
    tp.put(new THREE.SphereGeometry(0.032, 8, 6), INK, 0.02, 0.56, 0)
    this.tripod.add(tp.build(vc))
    this.tripod.position.copy(TRIPOD)
    this.tripod.rotation.y = Math.atan2(-(CLIENT_AT_TABLE.z - TRIPOD.z), CLIENT_AT_TABLE.x - TRIPOD.x)
    this.site.add(this.tripod)
    alloc('tripod', 1)

    this.table = new THREE.Group()
    const tt = new Batch()
    tt.box(0.7, 0.03, 0.44, WOOD, 0, 0.31, 0)
    for (const x of [-0.28, 0.28]) {
      tt.strut(new THREE.Vector3(x, 0, -0.18), new THREE.Vector3(x, 0.3, 0), 0.026, WOOD_D)
      tt.strut(new THREE.Vector3(x, 0, 0.18), new THREE.Vector3(x, 0.3, 0), 0.026, WOOD_D)
    }
    tt.put(new THREE.CylinderGeometry(0.032, 0.026, 0.065, 10), TRIM, 0.28, 0.358, 0.15)
    tt.put(new THREE.CylinderGeometry(0.026, 0.026, 0.005, 10), '#6b4a2e', 0.28, 0.391, 0.15)
    this.table.add(tt.build(vc))
    const sheetGeo = new THREE.PlaneGeometry(0.58, 0.36)
    sheetGeo.rotateX(-Math.PI / 2)
    sheetGeo.translate(0.29, 0, 0)
    this.sheet = new THREE.Mesh(sheetGeo, new THREE.MeshStandardMaterial({ map: this.tex.blueprint, roughness: 0.9 }))
    this.sheet.position.set(-0.31, 0.328, -0.02)
    this.sheet.receiveShadow = true
    const rollGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.37, 10)
    rollGeo.rotateX(Math.PI / 2)
    this.roll = new THREE.Mesh(rollGeo, new THREE.MeshStandardMaterial({ color: '#2a64a8', roughness: 0.8 }))
    this.roll.castShadow = true
    this.table.add(this.sheet, this.roll)
    this.table.position.copy(TABLE)
    this.table.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh && m !== this.sheet) m.castShadow = m.receiveShadow = true
    })
    this.site.add(this.table)
    alloc('table', 1)

    // sound arcs traveling from the client into the cone: ")))"
    const arc = new THREE.TorusGeometry(1, 0.11, 6, 18, (Math.PI * 2) / 3)
    arc.rotateZ(-Math.PI / 3)
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.signal).multiplyScalar(1.6) })
    this.rings = instanced(arc, ringMat, 4, false, false)
    this.site.add(this.rings)
    alloc('rings', 1)

    const bubble = (map: THREE.Texture) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }))
      s.center.set(0.28, 0.02)
      s.renderOrder = 5
      return s
    }
    this.talk = bubble(this.tex.talk)
    this.idea = bubble(this.tex.idea)
    this.site.add(this.talk, this.idea)
    alloc('idea', 1)
    await yieldFrame()

    // ---- people: legs, shirt, head, hard hat (kit proportions, ~0.52 tall)
    const legs = new Batch().put(new THREE.CapsuleGeometry(0.045, 0.1, 3, 8), '#34465c', 0, 0.1, 0, 0, 1.7, 1, 1).geometry()
    const body = new Batch().put(new THREE.CapsuleGeometry(0.085, 0.13, 4, 10), '#ffffff', 0, 0.24, 0).geometry()
    const head = new Batch().put(new THREE.IcosahedronGeometry(0.082, 2), '#ffffff', 0, 0.43, 0).geometry()
    const hat = new Batch()
      .put(new THREE.SphereGeometry(0.092, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', 0, 0.45, 0)
      .put(new THREE.CylinderGeometry(0.108, 0.108, 0.016, 14), '#ffffff', 0, 0.455, 0.012)
      .geometry()
    const N = ROLES.length
    this.people = [instanced(legs, vc, N), instanced(body, vc, N), instanced(head, vc, N, true, false), instanced(hat, vc, N, true, false)]
    ROLES.forEach((r, i) => {
      this.people[1].setColorAt(i, _c.set(r.body))
      this.people[2].setColorAt(i, _c.set(r.skin))
      this.people[3].setColorAt(i, _c.set(r.hat))
    })
    for (const p of this.people) {
      if (p.instanceColor) p.instanceColor.needsUpdate = true
      this.site.add(p)
    }
    alloc('people', N)
    const wb = new Batch()
    wb.box(0.26, 0.1, 0.18, C.roofBlue, 0.08, 0.13, 0, 0, 0, -0.12)
    wb.put(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 10), INK, 0.2, 0.05, 0, 0, 1, 1, 1, Math.PI / 2)
    wb.strut(new THREE.Vector3(-0.06, 0.12, -0.07), new THREE.Vector3(-0.2, 0.2, -0.08), 0.015, INK)
    wb.strut(new THREE.Vector3(-0.06, 0.12, 0.07), new THREE.Vector3(-0.2, 0.2, 0.08), 0.015, INK)
    wb.box(0.14, 0.05, 0.14, '#a9adb1', 0.09, 0.19, 0)
    this.barrow = wb.build(vc)
    this.site.add(this.barrow)

    // ---- vehicles
    this.buildVehicles(vc, mobile)
    await yieldFrame()

    // ---- garden (step 4): path, van bay, flower beds, bushes (the lawn itself spreads over the yard)
    const lb = new Batch()
    for (let i = 0; i < 7; i++) lb.box(0.38, 0.03, 0.24, C.stone, 0, 0.045, T.B.z + HD + 0.28 + i * 0.3 - 1.5)
    // a paved bay for the Hark van
    lb.add(slab(roundedRect(VAN.x - 0.62, VAN.z - 0.36, VAN.x + 0.62, VAN.z + 0.36, 0.12), 0.006, 0.01), C.stone, new THREE.Matrix4().makeTranslation(0, 0.03, -1.5))
    for (const dx of [-0.52, 0.52]) lb.box(0.04, 0.012, 0.6, C.white, VAN.x + dx, 0.048, VAN.z - 1.5)
    const lr = rng(5)
    const blossom = new THREE.IcosahedronGeometry(0.036, 0)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        _m.compose(_p.set(side * (0.55 + i * 0.38), 0.04, T.B.z + HD + 0.18 - 1.5), _q.setFromAxisAngle(Y0, lr() * 3), _s.setScalar(0.62))
        lb.add(bushGeometry(i + (side > 0 ? 3 : 0)), null, _m)
      }
      for (let i = 0; i < 8; i++) {
        const colr = [C.blossom, C.butter, C.white, C.coral][Math.floor(lr() * 4)]
        lb.put(blossom, colr, side * (0.5 + lr() * 1.5), 0.09, T.B.z + HD + 0.5 + lr() * 1.4 - 1.5)
      }
    }
    this.lawn = lb.build(vc, false, true)
    this.lawn.position.set(0, 0, 1.5)
    this.site.add(this.lawn)
    alloc('lawn', 1)

    // opening-day bunting across the new entrance
    const bu = new Batch()
    const px = 0.78
    const pz = T.B.z + HD + 0.52
    for (const sx of [-1, 1]) {
      bu.box(0.03, 0.9, 0.03, TRIM, sx * px, 0.45, pz)
      bu.put(new THREE.SphereGeometry(0.03, 8, 6), C.mustard, sx * px, 0.91, pz)
    }
    const sag = (u: number) => 0.86 - Math.sin(Math.PI * u) * 0.16
    const segs = 10
    for (let i = 0; i < segs; i++) {
      const u0 = i / segs
      const u1 = (i + 1) / segs
      bu.strut(new THREE.Vector3(lerp(-px, px, u0), sag(u0), pz), new THREE.Vector3(lerp(-px, px, u1), sag(u1), pz), 0.008, INK)
    }
    const pennant = new THREE.ConeGeometry(0.05, 0.11, 3)
    pennant.rotateX(Math.PI)
    const cols = [C.signal, C.mustard, C.coral, C.white, C.roofBlue]
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.5) / 9
      bu.put(pennant, cols[i % cols.length], lerp(-px, px, u), sag(u) - 0.06, pz, 0, 1, 1, 0.25)
    }
    this.bunting = bu.build(vc, true, true)
    this.site.add(this.bunting)
    alloc('bunting', 1)

    // ---- trees (kit two-tone trees, instanced per kind): rim + planted
    const all = [...TREES_NEW, ...TREES_RIM]
    const counts: Record<string, number> = {}
    for (const t of all) counts[t.kind] = (counts[t.kind] ?? 0) + 1
    for (const key of TREE_KEYS) {
      if (!counts[key]) continue
      const seed = all.find(t => t.kind === key)!.seed
      const im = instanced(treeGeometry(seed, key), vc, counts[key])
      this.trees.set(key, im)
      this.site.add(im)
    }
    const used: Record<string, number> = {}
    const treeSlot = (t: TreeSpot) => {
      used[t.kind] = (used[t.kind] ?? 0) + 1
      return used[t.kind] - 1
    }
    this.treeSlots = TREES_NEW.map(treeSlot)
    TREES_RIM.forEach((t, i) => setInst(this.trees.get(t.kind)!, treeSlot(t), t.x, 0, t.z, i * 1.7, t.s, t.s, t.s))
    alloc('trees', TREES_NEW.length)

    await yieldFrame()

    // ---- dust puffs at every touchdown
    const puffGeo = new Batch().put(new THREE.IcosahedronGeometry(0.1, 1), '#f7f2ea', 0, 0, 0).geometry()
    this.puffs = instanced(puffGeo, cloudMaterial(), 40, false, false)
    this.site.add(this.puffs)
    this.events = [
      { at: T.GROUND_AT + 0.004, t0: -1e9, x: T.B.x, y: 0.02, z: T.B.z, hw: HW + 0.1, hd: HD + 0.1 },
      ...T.LIFTS.map((_, k) => ({ at: T.landAt(k), t0: -1e9, x: T.B.x, y: (k + 1) * T.FLOOR_H, z: T.B.z, hw: HW + 0.1, hd: HD + 0.1 })),
      { at: T.VAN_IN[1] - 0.01, t0: -1e9, x: VAN.x, y: 0.02, z: VAN.z, hw: 0.45, hd: 0.25 },
    ]

    // ---- fence flaps (revolve to show the stats)
    this.buildFlaps(vc)
    alloc('flaps', 3)

    // ---- birds + clouds
    const birds = makeBirds({ count: mobile ? 4 : 6, radius: 3.2, height: 5.2, seed: 31, size: 0.14 })
    birds.position.set(-0.3, 0, -0.8)
    this.site.add(birds)

    this.cloudRing = new THREE.Group()
    const cr = new Batch()
    const crr = rng(9)
    const ringN = mobile ? 7 : 11
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2 + crr() * 0.35
      const r = 12 + crr() * 7
      const s = 1.4 + crr() * 1.3
      _m.compose(_p.set(Math.cos(a) * r, -6.5 + crr() * 5, Math.sin(a) * r), _q.setFromAxisAngle(Y0, crr() * 6), _s.setScalar(s))
      cr.add(cloudGeometry(i), null, _m)
    }
    this.cloudRing.add(cr.build(cloudMaterial(), false, false))
    this.root.add(this.cloudRing)
    // a bank of cloud the camera descends out of / climbs into
    const bank = new Batch()
    const dir = this.bankDir
    const br = rng(17)
    for (let i = 0; i < (mobile ? 6 : 9); i++) {
      const dist = 13 + i * 2.8
      _p.copy(dir).multiplyScalar(dist).add(_v.set((br() - 0.5) * 10, (br() - 0.5) * 2, (br() - 0.5) * 8))
      _m.compose(_p, _q.setFromAxisAngle(Y0, br() * 6), _s.setScalar(2.8 + br() * 1.8))
      bank.add(cloudGeometry(20 + i), null, _m)
    }
    this.bank = bank.build(cloudMaterial(), false, false)
    this.root.add(this.bank)

    this.pops = new Pops(n)
    this.flips = new Pops(3, 1.1, 0.8)
  }

  // ------------------------------------------------------------------ builders

  /** x and top height of every fence post */
  private postTops(): [number, number][] {
    const out: [number, number][] = []
    for (let i = 0; i <= FENCE.length; i++) {
      const left = FENCE[i - 1]
      const right = FENCE[i]
      const x = right ? fenceX[i] - right.w / 2 - FENCE_GAP / 2 : fenceX[i - 1] + left.w / 2 + FENCE_GAP / 2
      const h = Math.max(left?.h ?? 0, right?.h ?? 0)
      out.push([x, FENCE_Y + h + 0.06])
    }
    return out
  }

  /** `b`: what stays (cabin, rim dressing); `c`: construction clutter that flattens away in step 4 */
  private buildProps(b: Batch, c: Batch, mobile: boolean) {
    const r = rng(31)
    // site office cabin with a Hark mark (windows glow at dusk)
    const cab = new Batch()
    cab.box(1.5, 0.6, 0.72, '#f4f1ea', 0, 0.38, 0)
    cab.box(1.58, 0.05, 0.8, C.slate, 0, 0.705, 0)
    cab.box(1.5, 0.07, 0.725, C.signal, 0, 0.12, 0)
    cab.box(1.4, 0.08, 0.6, INK, 0, 0.04, 0)
    for (const x of [-0.45, -0.05]) cab.box(0.28, 0.2, 0.02, '#35516b', x, 0.46, 0.365, 0, 0, 0, 1)
    cab.box(0.22, 0.4, 0.02, C.roofBlue, 0.5, 0.33, 0.365)
    cab.box(0.3, 0.06, 0.24, '#a9adb1', 0.5, 0.05, 0.5)
    cab.box(0.3, 0.06, 0.12, '#a9adb1', 0.5, 0.11, 0.45)
    cab.put(markFaceGeometry(mobile), C.signal, 0.2, 0.52, 0.372, 0, 0.16)
    b.add(cab.geometry(), null, new THREE.Matrix4().compose(_p.set(3.55, 0, -1.75), _q.setFromAxisAngle(Y0, -0.32), _s.setScalar(1)))

    // porta-loo (with a moon)
    const loo = new Batch()
    loo.box(0.3, 0.52, 0.3, C.roofBlue, 0, 0.26, 0)
    loo.box(0.34, 0.04, 0.34, '#f4f1ea', 0, 0.54, 0)
    loo.put(new THREE.CircleGeometry(0.03, 10), C.mustard, 0, 0.44, 0.152)
    c.add(loo.geometry(), null, new THREE.Matrix4().compose(_p.set(4.75, 0, -0.55), _q.setFromAxisAngle(Y0, -0.6), _s.setScalar(1)))

    // skip with rubble
    const skipGeo = new THREE.CylinderGeometry(0.62, 0.46, 0.34, 4, 1)
    skipGeo.rotateY(Math.PI / 4)
    c.put(skipGeo, '#e8a531', 1.75, 0.17, -3.2, 0.1, 1, 1, 0.62)
    const rubble = new THREE.DodecahedronGeometry(0.1, 0)
    for (let i = 0; i < 9; i++) c.put(rubble, r() < 0.5 ? C.rockDark : '#a9adb1', 1.75 + (r() - 0.5) * 0.6, 0.34, -3.2 + (r() - 0.5) * 0.35, r() * 3, 0.8 + r() * 0.6)
    // pallet of bricks
    c.box(0.56, 0.06, 0.44, WOOD_D, -0.85, 0.03, -3.25)
    c.box(0.5, 0.3, 0.4, C.terracotta, -0.85, 0.21, -3.25)
    c.box(0.51, 0.02, 0.41, '#f4f1ea', -0.85, 0.28, -3.25)
    c.box(0.52, 0.3, 0.02, '#f4f1ea', -0.85, 0.21, -3.25)
    // pipes
    const pipe = new THREE.CylinderGeometry(0.06, 0.06, 1.1, 10)
    for (let i = 0; i < 5; i++) {
      const row = i < 3 ? 0 : 1
      const x = 0.55 + (row ? (i - 3) * 0.13 + 0.065 : i * 0.13)
      c.put(pipe, '#a9adb1', x, 0.06 + row * 0.11, -3.1, 0, 1, 1, 1, Math.PI / 2)
    }
    // sand pile + cement bags
    c.put(new THREE.SphereGeometry(0.5, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), '#ecd29c', -3.95, 0, -2.0, 0, 1, 0.55, 1)
    for (let i = 0; i < 4; i++) c.box(0.22, 0.08, 0.14, '#ece6d8', -1.35 + (i % 2) * 0.24, 0.04 + Math.floor(i / 2) * 0.08, -2.5)
    // laydown pad (floors pop onto it, one at a time, for the crane):
    // pale concrete with painted hazard corners
    const lw = T.FOOT.w + 0.14
    const ld = T.FOOT.d + 0.14
    c.box(lw, T.PALLET_H, ld, '#dcd6cb', T.LAYDOWN.x, T.PALLET_H / 2, T.LAYDOWN.z)
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const cx = T.LAYDOWN.x + sx * (lw / 2 - 0.2)
        const cz = T.LAYDOWN.z + sz * (ld / 2 - 0.2)
        c.box(0.34, 0.01, 0.06, C.mustard, cx - sx * 0.02, T.PALLET_H + 0.005, cz + sz * 0.14)
        c.box(0.06, 0.01, 0.34, C.mustard, cx + sx * 0.14, T.PALLET_H + 0.005, cz - sz * 0.02)
      }
    // a toolbox + a coil of hose on the pad's edge
    c.box(0.22, 0.1, 0.12, C.alert, T.LAYDOWN.x - lw / 2 + 0.25, T.PALLET_H + 0.05, T.LAYDOWN.z + ld / 2 + 0.12)
    c.put(new THREE.TorusGeometry(0.1, 0.03, 6, 14), C.teal, T.LAYDOWN.x - lw / 2 + 0.6, 0.03, T.LAYDOWN.z + ld / 2 + 0.16, 0, 1, 1, 1, Math.PI / 2)
    // traffic cones
    const coneGeo = new THREE.ConeGeometry(0.07, 0.2, 10)
    const cones: [number, number][] = [
      [-3.9, 2.0],
      [-3.55, 2.15],
      [2.75, 2.3],
      [3.95, 2.0],
      [-1.95, -3.35],
    ]
    const band = new THREE.CylinderGeometry(0.045, 0.052, 0.035, 10)
    for (const [x, z] of cones) {
      c.put(coneGeo, '#ff7a2f', x, 0.1, z)
      c.put(band, C.white, x, 0.1, z)
      c.box(0.16, 0.02, 0.16, '#ff7a2f', x, 0.01, z)
    }
    // striped barrier by the vehicle bay
    c.box(0.03, 0.26, 0.03, '#f4f1ea', 4.05, 0.13, 2.0)
    c.box(0.03, 0.26, 0.03, '#f4f1ea', 4.55, 0.13, 1.65)
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4
      c.box(0.16, 0.06, 0.03, i % 2 ? C.white : C.alert, lerp(4.05, 4.55, t), 0.22, lerp(2.0, 1.65, t), Math.atan2(0.35, 0.5))
    }
    // floodlight mast by the laydown
    c.strut(new THREE.Vector3(-4.2, 0, -1.2), new THREE.Vector3(-4.2, 1.56, -1.2), 0.04, INK)
    c.box(0.3, 0.04, 0.06, INK, -4.2, 1.56, -1.2, 0.5)
    c.box(0.4, 0.1, 0.4, '#a9adb1', -4.2, 0.05, -1.2)

    // grass rim: kit bushes, rocks, flowers
    const n = mobile ? 14 : 26
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2
      const rr = 5.3 + r() * 0.45
      const x = Math.cos(a) * rr
      const z = Math.sin(a) * rr
      if (z > 2.1 && Math.abs(x) < 4.4) continue
      const s = 0.8 + r() * 0.6
      _m.compose(_p.set(x, 0, z), _q.setFromAxisAngle(Y0, r() * 6), _s.setScalar(s))
      b.add(r() < 0.72 ? bushGeometry(i) : rockGeometry(i), null, _m)
    }
    if (!mobile) {
      const fl = flowerGeometry()
      const bud = new THREE.IcosahedronGeometry(0.035, 0)
      for (let i = 0; i < 46; i++) {
        const a = r() * Math.PI * 2
        const rr = 4.95 + r() * 1.0
        const x = Math.cos(a) * rr
        const z = Math.sin(a) * rr
        if (z > 2.2 && Math.abs(x) < 4.8) continue
        if (r() < 0.5) {
          _m.compose(_p.set(x, 0, z), _q.identity(), _s.setScalar(1))
          b.add(fl, null, _m)
        } else b.put(bud, [C.blossom, C.butter, C.lavender][Math.floor(r() * 3)], x, 0.06, z)
      }
    }
  }

  private buildFence(b: Batch) {
    // plywood backs + posts; the painted faces are one textured batch
    const faces = new Batch({ uv: true, color: false })
    FENCE.forEach((p, i) => {
      if (p.flap >= 0) return
      const x = fenceX[i]
      const z = fenceZ(x)
      const yaw = fenceYaw(x)
      const cy = FENCE_Y + p.h / 2
      b.box(p.w, p.h, 0.04, PLY_BACK, x, cy, z, yaw)
      _m.compose(_p.set(x + Math.sin(yaw) * 0.021, cy, z + Math.cos(yaw) * 0.021), _q.setFromAxisAngle(Y0, yaw), _s.set(1, 1, 1))
      faces.add(panelFace(p.w, p.h, p.cell), null, _m)
    })
    for (const [x, top] of this.postTops()) {
      const z = fenceZ(x)
      b.box(0.07, top, 0.07, '#3a4240', x, top / 2, z, fenceYaw(x))
      b.box(0.05, 0.03, 0.22, '#3a4240', x, 0.015, z - 0.09, fenceYaw(x))
    }
    const atlas = new THREE.MeshStandardMaterial({ map: this.tex.fence, roughness: 0.85 })
    this.fenceFaces = faces.build(atlas, false, true)
    this.site.add(this.fenceFaces)
  }

  private buildFlaps(vc: THREE.Material) {
    const atlas = this.fenceFaces.material as THREE.Material
    FENCE.forEach((p, i) => {
      if (p.flap < 0) return
      const k = p.flap
      const x = fenceX[i]
      const g = new THREE.Group()
      g.position.set(x, FENCE_Y + p.h / 2, fenceZ(x))
      g.rotation.y = fenceYaw(x)
      const fb = new Batch({ uv: true, color: false })
      _m.makeTranslation(0, 0, 0.021)
      fb.add(panelFace(p.w, p.h, CELL.front[k]), null, _m)
      _m.makeRotationY(Math.PI).setPosition(0, 0, -0.021)
      fb.add(panelFace(p.w, p.h, CELL.back[k]), null, _m)
      const face = fb.build(atlas, true, true)
      const edge = new Batch().box(p.w + 0.03, p.h + 0.03, 0.036, WOOD, 0, 0, 0).build(vc, true, true)
      const inner = new THREE.Group()
      inner.add(face, edge)
      g.add(inner)
      this.flaps[k] = g
      this.site.add(g)
    })
  }

  private buildVehicles(vc: THREE.Material, mobile: boolean) {
    // cement mixer (faces -x), drum spinning
    this.mixer = new THREE.Group()
    const mx = new Batch()
    mx.box(1.12, 0.1, 0.36, INK, 0, 0.16, 0)
    mx.box(0.32, 0.34, 0.38, C.roofRed, -0.42, 0.37, 0)
    mx.box(0.02, 0.14, 0.3, '#2c3e50', -0.585, 0.45, 0)
    mx.box(0.24, 0.12, 0.395, '#2c3e50', -0.42, 0.46, 0)
    const tire = new THREE.CylinderGeometry(0.085, 0.085, 0.07, 12)
    for (const x of [-0.4, 0.18, 0.4]) for (const z of [-0.18, 0.18]) mx.put(tire, INK, x, 0.085, z, 0, 1, 1, 1, Math.PI / 2)
    mx.box(0.1, 0.05, 0.12, '#a9adb1', 0.56, 0.3, 0, 0, 0, -0.5)
    this.mixer.add(mx.build(vc))
    const prof: THREE.Vector2[] = []
    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      prof.push(new THREE.Vector2(0.06 + Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.13 + (1 - t) * 0.02, t * 0.62 - 0.31))
    }
    const drumGeo = new THREE.LatheGeometry(prof, mobile ? 14 : 20).toNonIndexed()
    drumGeo.deleteAttribute('uv')
    drumGeo.computeVertexNormals()
    const dp = drumGeo.attributes.position as THREE.BufferAttribute
    const dcol = new Float32Array(dp.count * 3)
    const red = new THREE.Color(C.roofRed)
    const wht = new THREE.Color('#f4efe6')
    for (let i = 0; i < dp.count; i += 3) {
      // color per face so the spiral stripes stay crisp
      const x = (dp.getX(i) + dp.getX(i + 1) + dp.getX(i + 2)) / 3
      const y = (dp.getY(i) + dp.getY(i + 1) + dp.getY(i + 2)) / 3
      const z = (dp.getZ(i) + dp.getZ(i + 1) + dp.getZ(i + 2)) / 3
      const a = Math.atan2(z, x) / (Math.PI * 2)
      const k = (((a * 2 + y * 2.2) % 1) + 1) % 1
      const col = k < 0.35 ? red : wht
      for (let j = 0; j < 3; j++) {
        dcol[(i + j) * 3] = col.r
        dcol[(i + j) * 3 + 1] = col.g
        dcol[(i + j) * 3 + 2] = col.b
      }
    }
    drumGeo.setAttribute('color', new THREE.BufferAttribute(dcol, 3))
    drumGeo.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(dp.count), 1))
    this.drum = new THREE.Mesh(drumGeo, vc)
    const pivot = new THREE.Group()
    pivot.rotation.z = -Math.PI / 2 + 0.28
    pivot.position.set(0.14, 0.44, 0)
    pivot.add(this.drum)
    this.mixer.add(pivot)
    this.mixer.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.castShadow = m.receiveShadow = true
    })
    this.mixer.position.copy(MIXER)
    this.site.add(this.mixer)

    // the Hark maintenance van (faces -x)
    this.van = new THREE.Group()
    const vb = new Batch()
    vb.box(0.56, 0.34, 0.36, TRIM, 0.1, 0.27, 0)
    vb.box(0.26, 0.24, 0.36, TRIM, -0.3, 0.22, 0)
    vb.box(0.03, 0.12, 0.3, '#2c3e50', -0.435, 0.29, 0, 0, 0, -0.3, 1)
    vb.box(0.16, 0.1, 0.365, '#2c3e50', -0.27, 0.3, 0, 0, 0, 0, 1)
    vb.box(0.84, 0.05, 0.365, C.signal, -0.02, 0.2, 0)
    vb.box(0.86, 0.06, 0.34, INK, -0.02, 0.1, 0)
    const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12)
    for (const x of [-0.26, 0.22]) for (const z of [-0.17, 0.17]) vb.put(wheel, INK, x, 0.075, z, 0, 1, 1, 1, Math.PI / 2)
    vb.box(0.5, 0.02, 0.3, '#a9adb1', 0.1, 0.46, 0)
    vb.box(0.56, 0.025, 0.05, '#d3d8dc', 0.1, 0.48, 0.06)
    vb.box(0.56, 0.025, 0.05, '#d3d8dc', 0.1, 0.48, -0.06)
    for (const side of [1, -1]) vb.put(markFaceGeometry(mobile), C.signal, 0.12, 0.33, side * 0.1815, side > 0 ? 0 : Math.PI, 0.14)
    this.van.add(vb.build(vc))
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), MAT.led)
    beacon.position.set(-0.12, 0.48, 0)
    this.van.add(beacon)
    this.van.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh) m.castShadow = m.receiveShadow = true
    })
    this.site.add(this.van)
  }

  private buildScaffold() {
    const X = HW + 0.3
    const zf = T.B.z + HD + 0.3
    const zb = T.B.z - HD - 0.3
    const H = T.FLOORS * T.FLOOR_H + 0.35
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const std: THREE.Vector3[] = []
    for (const x of [-X, -X / 2, 0, X / 2, X]) std.push(v(x, 0, zf))
    std.push(v(X, 0, T.B.z))
    for (const x of [X, X / 2, 0, -X / 2, -X]) std.push(v(x, 0, zb))
    std.push(v(-X, 0, T.B.z))
    const defs = this.tubeDefs
    std.forEach((p, i) => defs.push({ a: p, b: v(p.x, H, p.z), t: 0.04, at: T.STANDARD_AT(i, std.length), out: 0 }))
    const levels = [0.6, 1.2, 1.8, 2.4, 2.72]
    levels.forEach((y, li) => {
      defs.push({ a: v(-X, y, zf), b: v(X, y, zf), t: 0.03, at: T.LEDGER_AT(li, 0), out: 0 })
      defs.push({ a: v(X, y, zf), b: v(X, y, zb), t: 0.03, at: T.LEDGER_AT(li, 1), out: 0 })
      defs.push({ a: v(X, y, zb), b: v(-X, y, zb), t: 0.03, at: T.LEDGER_AT(li, 2), out: 0 })
      defs.push({ a: v(-X, y, zb), b: v(-X, y, zf), t: 0.03, at: T.LEDGER_AT(li, 3), out: 0 })
    })
    const braces: [number, number, number, number][] = [
      [-X, 0, -X / 2, 1.2],
      [X / 2, 0, X, 1.2],
      [-X / 2, 1.2, -X, 2.4],
      [X, 1.2, X / 2, 2.4],
    ]
    braces.forEach(([x0, y0, x1, y1], i) => defs.push({ a: v(x0, y0, zf), b: v(x1, y1, zf), t: 0.025, at: T.BRACE_AT(i), out: 0 }))
    defs.push({ a: v(X, 0, zf), b: v(X, 1.2, T.B.z), t: 0.025, at: T.BRACE_AT(4), out: 0 })
    defs.push({ a: v(-X, 1.2, zb), b: v(-X, 2.4, T.B.z), t: 0.025, at: T.BRACE_AT(5), out: 0 })
    // boards: front + right side, each lift
    const bd = this.boardDefs
    const inF = T.B.z + HD + 0.02
    ;[0.6, 1.2, 1.8, 2.4].forEach((y, li) => {
      bd.push({ c: v(0, y + 0.03, (inF + zf) / 2), w: X * 2, d: zf - inF - 0.02, at: T.BOARD_AT(li * 2), out: 0 })
      bd.push({ c: v((HW + 0.02 + X) / 2, y + 0.03, (zf + zb) / 2), w: X - HW - 0.04, d: zf - zb, at: T.BOARD_AT(li * 2 + 1), out: 0 })
    })
    // strike order: boards first, then top-down, standards last
    const all: { y: number; set: (o: number) => void }[] = []
    for (const b of bd) all.push({ y: b.c.y + 10, set: o => (b.out = o) })
    for (const d of defs) {
      const standard = d.a.y === 0 && d.b.x === d.a.x && d.b.z === d.a.z
      all.push({ y: Math.max(d.a.y, d.b.y) - (standard ? 5 : 0), set: o => (d.out = o) })
    }
    all.sort((p, q) => q.y - p.y)
    all.forEach((e, i) => e.set(T.SCAFF_OUT(i, all.length)))
  }

  // ------------------------------------------------------------------ update

  update(l: number, time: number, calm: boolean) {
    const jump = this.lPrev < 0 || Math.abs(l - this.lPrev) > 0.04
    const pops = this.pops
    const id = this.ids
    const t = calm ? 0 : time
    pops.begin()
    this.flips.begin()

    // ---- step 1: tripod, pegs, strings, blueprint, sound arcs, speech
    pops.item(id.tripod, l >= T.TRIPOD_AT && l < T.LISTEN_OUT, time, calm)
    this.tripod.scale.set(pops.xz[id.tripod], pops.y[id.tripod], pops.xz[id.tripod])
    this.tripod.visible = pops.y[id.tripod] > 0.001

    let anyPeg = false
    let anyString = false
    for (let i = 0; i < PEGS.length; i++) {
      const k = id.pegs + i
      pops.item(k, l >= T.PEG_AT(i) && l < T.PEGS_OUT, time, calm)
      const [ax, az] = PEGS[i]
      setInst(this.pegs, i, ax, 0, az, 0, pops.xz[k], pops.y[k], pops.xz[k])
      anyPeg ||= pops.y[k] > 1e-4
      // strings: drawn peg to peg (scrubbed), gone with the pegs
      const [a0, a1] = T.STRING_AT(i)
      const s = segment(l, a0, a1) * clamp(pops.y[k] * 1.2)
      const [bx, bz] = PEGS[(i + 1) % PEGS.length]
      const full = Math.hypot(bx - ax, bz - az)
      const len = full * s
      if (len < 1e-3) this.strings.setMatrixAt(i, HIDDEN)
      else {
        const dx = (bx - ax) / full
        const dz = (bz - az) / full
        _q.setFromAxisAngle(Y0, Math.atan2(-dz, dx))
        _m.compose(_p.set(ax + (dx * len) / 2, 0.19, az + (dz * len) / 2), _q, _s.set(len, 0.012, 0.012))
        this.strings.setMatrixAt(i, _m)
        anyString = true
      }
    }
    this.pegs.instanceMatrix.needsUpdate = true
    this.strings.instanceMatrix.needsUpdate = true
    this.pegs.visible = anyPeg
    this.strings.visible = anyString

    pops.item(id.table, l < T.ROOF_AT, time, calm)
    const ts = pops.y[id.table]
    this.table.visible = ts > 0.001
    this.table.scale.set(pops.xz[id.table], ts, pops.xz[id.table])
    const u = smoothstep(T.UNROLL[0], T.UNROLL[1], l)
    this.sheet.scale.x = Math.max(0.04, u)
    this.roll.position.set(-0.31 + 0.58 * u, 0.352, -0.02)
    this.roll.rotation.z = -u * 12
    this.roll.visible = u < 0.995

    // sound arcs: client -> cone
    const listenOn = l >= T.STEPS[0][0] + 0.01 && l < T.STEPS[1][0] + 0.06
    pops.item(id.rings, listenOn, time, calm)
    const ringAmt = pops.y[id.rings]
    this.rings.visible = ringAmt > 0.01
    _a.set(CLIENT_AT_TABLE.x - 0.12, 0.44, CLIENT_AT_TABLE.z + 0.02)
    _b.set(TRIPOD.x, 0.56, TRIPOD.z).add(_v.set(0.4, 0, 0).applyAxisAngle(Y0, this.tripod.rotation.y))
    _x.subVectors(_b, _a)
    const dist = _x.length()
    _x.divideScalar(dist)
    _z.crossVectors(_x, Y0).normalize()
    _v.crossVectors(_z, _x)
    _m.makeBasis(_x, _v, _z)
    _q.setFromRotationMatrix(_m)
    for (let i = 0; i < 4; i++) {
      const ph = calm ? (i + 0.5) / 4 : (((t * 0.3 + i / 4) % 1) + 1) % 1
      const r = lerp(0.26, 0.13, ph) * ringAmt * Math.sin(Math.PI * Math.min(1, ph * 1.1))
      if (r < 0.006) {
        this.rings.setMatrixAt(i, HIDDEN)
        continue
      }
      _m.compose(_p.copy(_a).addScaledVector(_x, dist * ph), _q, _s.set(r, r, r))
      this.rings.setMatrixAt(i, _m)
    }
    this.rings.instanceMatrix.needsUpdate = true

    // ---- step 2: scaffold + cardboard
    let anyTube = false
    let anyBoard = false
    let anyCard = false
    this.tubeDefs.forEach((d, i) => {
      const k = id.tubes + i
      pops.item(k, l >= d.at && l < d.out, time, calm)
      const s = pops.y[k]
      const th = pops.xz[k]
      if (s < 1e-3) {
        this.tubes.setMatrixAt(i, HIDDEN)
        return
      }
      anyTube = true
      _a.subVectors(d.b, d.a)
      const len = _a.length()
      _a.divideScalar(len)
      _q.setFromUnitVectors(Y0, _a)
      _m.compose(_p.copy(d.a).addScaledVector(_a, (len * s) / 2), _q, _s.set(d.t * th, len * s, d.t * th))
      this.tubes.setMatrixAt(i, _m)
    })
    this.tubes.instanceMatrix.needsUpdate = true
    this.boardDefs.forEach((d, i) => {
      const k = id.boards + i
      pops.item(k, l >= d.at && l < d.out, time, calm)
      setInst(this.boards, i, d.c.x, d.c.y, d.c.z, 0, d.w * pops.xz[k], 0.03 * pops.y[k], d.d * pops.xz[k])
      anyBoard ||= pops.y[k] > 1e-4
    })
    this.boards.instanceMatrix.needsUpdate = true
    this.tubes.visible = anyTube
    this.boards.visible = anyBoard

    for (let i = 0; i < 4; i++) {
      const k = id.cards + i
      pops.item(k, l >= T.CARD_AT(i) && l < T.CARD_OUT, time, calm)
      const p = pops.p[k]
      let y = i * T.FLOOR_H
      let sxz = 1
      let sy = 1
      if (pops.isOn(k)) {
        // dropped in: falls, lands with a squash
        const tt = p * 0.72
        if (p <= 0) sy = 0
        else if (tt < 0.22 && !calm) {
          const f = tt / 0.22
          y += (1 - f * f) * 0.9
          sy = 1.08
          sxz = 0.96
        } else {
          landCurve((tt - 0.22) / 0.5, calm, sq)
          sy = sq.y
          sxz = sq.xz
        }
      } else {
        // folds flat
        sy = p >= 1 ? 0 : (1 - p) * (1 - p)
        sxz = 1 + 0.12 * p
      }
      setInst(this.cards, i, T.B.x, y, T.B.z, 0, sxz, sy, sxz)
      anyCard ||= sy > 1e-4
    }
    this.cards.instanceMatrix.needsUpdate = true
    this.cards.visible = anyCard

    // ---- step 3: floors + crane
    const cs = T.craneAt(l, this.craneState)
    let swing = 0.25
    if (cs.carrying > 0) {
      const lift = T.LIFTS[cs.carrying - 1]
      const p = segment(l, lift[0], lift[1])
      swing = Math.sin(Math.PI * clamp((p - 0.28) / (T.LAND_P - 0.28)))
    }
    this.crane.pose(cs, t, calm, swing)

    pops.item(id.ground, l >= T.GROUND_AT, time, calm)
    setInst(this.floors, 0, T.B.x, 0, T.B.z, 0, pops.xz[id.ground], pops.y[id.ground], pops.xz[id.ground])
    setInst(this.glass, 0, T.B.x, 0, T.B.z, 0, pops.xz[id.ground], pops.y[id.ground], pops.xz[id.ground])
    this.door.scale.set(pops.xz[id.ground], pops.y[id.ground], pops.xz[id.ground])
    this.door.visible = pops.y[id.ground] > 0.001

    // touchdowns (only when scrolled through, not jumped over)
    for (const e of this.events) {
      if (l < e.at) e.t0 = -1e9
      else if (!jump && this.lPrev < e.at && e.t0 < 0) e.t0 = time
    }

    let carriedBase: THREE.Vector3 | null = null
    for (let k = 1; k <= 3; k++) {
      const lift = T.LIFTS[k - 1]
      const pick = lerp(lift[0], lift[1], 0.28)
      const land = T.landAt(k - 1)
      // each prefab floor pops onto the pallet just before its lift
      const si = id.stack + k - 1
      pops.item(si, l >= lift[0] - 0.012, time, calm)
      let x: number
      let y: number
      let z: number
      let sxz = pops.xz[si]
      let sy = pops.y[si]
      if (l < pick) {
        x = T.LAYDOWN.x
        y = T.PALLET_H + 0.012
        z = T.LAYDOWN.z
      } else if (l < land) {
        x = this.crane.hookPos.x
        y = this.crane.hookPos.y - T.FLOOR_H - T.SLING + 0.02
        z = this.crane.hookPos.z
        carriedBase = _b.set(x, y, z)
      } else {
        x = T.B.x
        y = k * T.FLOOR_H
        z = T.B.z
        landCurve((time - this.events[k].t0) / 0.6, calm, sq)
        sxz = sq.xz
        sy = sq.y
      }
      setInst(this.floors, k, x, y, z, 0, sxz, sy, sxz)
      setInst(this.glass, k, x, y, z, 0, sxz, sy, sxz)
    }
    this.floors.instanceMatrix.needsUpdate = true
    this.glass.instanceMatrix.needsUpdate = true
    this.crane.setSlings(carriedBase)

    // ---- step 4: roof, sign, windows, landscaping
    pops.item(id.roof, l >= T.ROOF_AT, time, calm)
    const topY = T.FLOORS * T.FLOOR_H
    this.roof.position.set(T.B.x, topY, T.B.z)
    this.roof.scale.set(pops.xz[id.roof], pops.y[id.roof], pops.xz[id.roof])
    this.roof.visible = pops.y[id.roof] > 0.001

    pops.item(id.sign, l >= T.SIGN_AT, time, calm)
    this.sign.position.set(T.B.x, topY + 0.02, T.B.z + HD - 0.38)
    this.sign.scale.set(pops.xz[id.sign], pops.y[id.sign], pops.xz[id.sign])
    this.sign.visible = pops.y[id.sign] > 0.001
    // lights on: a quick fluorescent stutter, then steady (and a slow breath)
    let on = smoothstep(T.SIGN_ON, T.SIGN_ON + 0.012, l)
    if (!calm && on > 0 && on < 1) on *= 0.35 + 0.65 * (Math.sin(time * 60) > 0 ? 1 : 0)
    this.signMat.emissiveIntensity = on * (1.9 + (calm ? 0 : Math.sin(time * 2.2) * 0.12))
    this.glassMat.emissiveIntensity = 0.7 * smoothstep(T.WINDOWS_ON[0], T.WINDOWS_ON[1], l)

    // construction clutter flattens into the ground, then the lawn spreads
    pops.item(id.clutter, l < T.CLUTTER_OUT, time, calm)
    this.clutter.scale.set(1, Math.max(0.001, pops.y[id.clutter]), 1)
    this.clutter.visible = pops.y[id.clutter] > 0.002
    pops.item(id.grass, l >= T.GRASS_AT, time, calm)
    // spreads with an ease-out (no overshoot: it must not spill past the rim)
    const gp = pops.p[id.grass]
    const gs = pops.isOn(id.grass) ? 1 - Math.pow(1 - gp, 3) : 1 - gp * gp
    this.grass.scale.set(Math.max(0.001, gs), 1, Math.max(0.001, gs))
    this.grass.visible = gs > 0.002

    pops.item(id.lawn, l >= T.LAWN_AT, time, calm)
    this.lawn.scale.set(pops.xz[id.lawn], Math.max(0.001, pops.y[id.lawn]), pops.xz[id.lawn])
    this.lawn.visible = pops.y[id.lawn] > 0.001
    pops.item(id.bunting, l >= T.BUNTING_AT, time, calm)
    this.bunting.scale.set(pops.xz[id.bunting], pops.y[id.bunting], pops.xz[id.bunting])
    this.bunting.visible = pops.y[id.bunting] > 0.001

    for (let i = 0; i < TREES_NEW.length; i++) {
      const k = id.trees + i
      pops.item(k, l >= T.TREE_AT(i), time, calm)
      const tr = TREES_NEW[i]
      setInst(this.trees.get(tr.kind)!, this.treeSlots[i], tr.x, 0, tr.z, i * 2.1, pops.xz[k] * tr.s, pops.y[k] * tr.s, pops.xz[k] * tr.s)
    }
    for (const im of this.trees.values()) im.instanceMatrix.needsUpdate = true

    // ---- vehicles (scrubbed)
    const mo = segment(l, T.MIXER_OUT[0], T.MIXER_OUT[1])
    const mixScale = 1 - smoothstep(0.72, 1, mo)
    this.mixer.visible = mixScale > 0.001
    this.mixer.position.set(MIXER.x + mo * mo * 2.2, 0, MIXER.z)
    this.mixer.rotation.set(0, Math.PI, calm ? 0 : Math.sin(mo * Math.PI * 3) * 0.02)
    this.mixer.scale.setScalar(mixScale)
    this.drum.rotation.y = calm ? 0 : -time * 2.2

    const vi = segment(l, T.VAN_IN[0], T.VAN_IN[1])
    const vs = smoothstep(0, 0.14, vi)
    const drive = 1 - Math.pow(1 - smoothstep(0.05, 0.9, vi), 2.2)
    this.van.visible = vs > 0.001
    this.van.scale.setScalar(vs)
    this.van.position.set(lerp(5.35, VAN.x, drive), 0, VAN.z)
    const rock = vi > 0.86 && !calm ? Math.sin((vi - 0.86) * 60) * Math.exp(-(vi - 0.86) * 30) * 0.08 : 0
    this.van.rotation.set(0, 0, rock)

    // ---- people
    this.updatePeople(l, time, calm)

    // ---- speech bubble (step 1–2) and the next idea (step 4)
    const talkOn = l >= T.STEPS[0][0] && l < T.STEPS[1][1] - 0.04
    const cyc = calm ? 0.3 : (time % 2.8) / 2.8
    const talkP = talkOn ? (cyc < 0.62 ? cyc / 0.62 : -1) : -1
    this.setBubble(this.talk, talkP, CLIENT_AT_TABLE.x, 0.58, CLIENT_AT_TABLE.z, calm)
    pops.item(id.idea, l >= T.TECH_AT, time, calm)
    const ip = pops.isOn(id.idea) ? pops.p[id.idea] : -1
    this.setBubble(this.idea, ip, CLIENT_AT_DOOR.x + 0.02, 0.58, CLIENT_AT_DOOR.z, calm)

    // ---- stats: fence panels revolve
    for (let k = 0; k < 3; k++) {
      this.flips.item(k, l >= T.STATS_AT[k], time, calm)
      const isOn = this.flips.isOn(k)
      const p = this.flips.p[k]
      const f = isOn ? flipCurve(p, calm) : 1 - flipCurve(p, calm)
      const inner = this.flaps[k].children[0]
      inner.rotation.y = Math.PI * f
      inner.position.y = calm ? 0 : Math.sin(Math.PI * clamp(isOn ? p * 1.6 : p)) * 0.1
    }

    this.updatePuffs(time, calm)

    // the bank only matters on the way in and out: it drifts up out of the sky
    // while the site is on show (tall screens would otherwise see it over the site)
    const clear = smoothstep(0.07, 0.16, l) * (1 - smoothstep(0.9, 0.97, l))
    this.bank.position.copy(this.bankDir).multiplyScalar(clear * 18)

    this.cloudRing.rotation.y = t * 0.01
    this.cloudRing.position.y = calm ? 0 : Math.sin(t * 0.15) * 0.2

    this.lPrev = l
  }

  private setBubble(s: THREE.Sprite, p: number, x: number, y: number, z: number, calm: boolean) {
    if (p < 0) {
      s.visible = false
      return
    }
    s.visible = true
    const k = calm ? 1 : Math.min(1, 1 - Math.exp(-p * 10) * Math.cos(p * 16))
    const sz = 0.38 * Math.max(0, k)
    s.scale.set(sz, sz * 0.875, 1)
    s.position.set(x, y, z)
  }

  private updatePuffs(time: number, calm: boolean) {
    const P = 8
    let n = 0
    let any = false
    for (let e = 0; e < this.events.length && n + P <= this.puffs.count; e++) {
      const ev = this.events[e]
      const age = time - ev.t0
      const live = !calm && age >= 0 && age < 1.1
      any ||= live
      for (let j = 0; j < P; j++, n++) {
        if (!live) {
          this.puffs.setMatrixAt(n, HIDDEN)
          continue
        }
        const a = (j / P) * Math.PI * 2 + e
        const k = age / 1.1
        const spread = 1 + k * 0.5
        const x = ev.x + Math.cos(a) * ev.hw * spread
        const z = ev.z + Math.sin(a) * ev.hd * spread
        const s = Math.sin(Math.PI * Math.min(1, k * 1.2)) * (0.9 + (j % 3) * 0.2) * (1 - k * 0.3)
        setInst(this.puffs, n, x, ev.y + 0.05 + k * 0.16, z, a, s, s * 0.8, s)
      }
    }
    for (; n < this.puffs.count; n++) this.puffs.setMatrixAt(n, HIDDEN)
    this.puffs.instanceMatrix.needsUpdate = true
    this.puffs.visible = any
  }

  private updatePeople(l: number, time: number, calm: boolean) {
    const pops = this.pops
    const base = this.ids.people
    const t = calm ? 0 : time
    const put = (i: number, on: boolean, x: number, z: number, yaw: number, walking: boolean, y = 0) => {
      const k = base + i
      pops.item(k, on, time, calm)
      const bob = calm ? 0 : walking ? Math.abs(Math.sin(t * 9 + i)) * 0.03 : Math.sin(t * 2 + i) * 0.006
      const roll = calm || !walking ? 0 : Math.sin(t * 9 + i) * 0.07
      const look = calm || walking ? 0 : Math.sin(t * 0.7 + i * 1.3) * 0.35
      for (const m of this.people) setInst(m, i, x, y + bob, z, yaw + look, pops.xz[k], pops.y[k], pops.xz[k], 0, roll)
    }
    // people face +z; heading toward (tx, tz)
    const face = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz)

    // 0 surveyor behind the tripod, eye to the cone
    {
      const x = TRIPOD.x - 0.32
      const z = TRIPOD.z + 0.14
      put(0, l < T.LISTEN_OUT, x, z, face(x, z, CLIENT_AT_TABLE.x, CLIENT_AT_TABLE.z), false)
    }

    // 1 pegs out the plot, peg by peg (scrubbed)
    {
      const u = clamp((l - T.PEG_AT(0) + 0.006) / 0.014, 0, PEGS.length - 1)
      const j = Math.min(PEGS.length - 2, Math.floor(u))
      const f = smoothstep(0.35, 1, u - j)
      const off = (pz: number) => (pz > T.B.z ? 0.22 : -0.22)
      const ax = PEGS[j][0]
      const az = PEGS[j][1] + off(PEGS[j][1])
      const bx = PEGS[j + 1][0]
      const bz = PEGS[j + 1][1] + off(PEGS[j + 1][1])
      const x = lerp(ax, bx, f)
      const z = lerp(az, bz, f)
      const walking = f > 0.02 && f < 0.98 && l > T.PEG_AT(0) && l < T.PEG_AT(PEGS.length - 1)
      put(1, l >= T.TRIPOD_AT && l < T.PEGS_OUT + 0.02, x, z, walking ? face(ax, az, bx, bz) : face(x, z, T.B.x, T.B.z), walking)
    }

    // 2 architect + 3 client: at the table, then at the new front door
    if (l >= T.ENTRANCE_AT) {
      put(2, true, ARCH_AT_DOOR.x, ARCH_AT_DOOR.z, face(ARCH_AT_DOOR.x, ARCH_AT_DOOR.z, 0.3, 2.4), false)
      put(3, true, CLIENT_AT_DOOR.x, CLIENT_AT_DOOR.z, face(CLIENT_AT_DOOR.x, CLIENT_AT_DOOR.z, -0.3, 2.4), false)
    } else {
      const atTable = l < T.ROOF_AT
      put(2, atTable, ARCH_AT_TABLE.x, ARCH_AT_TABLE.z, face(ARCH_AT_TABLE.x, ARCH_AT_TABLE.z, TABLE.x, TABLE.z + 0.2), false)
      put(3, atTable, CLIENT_AT_TABLE.x, CLIENT_AT_TABLE.z, face(CLIENT_AT_TABLE.x, CLIENT_AT_TABLE.z, ARCH_AT_TABLE.x, ARCH_AT_TABLE.z + 0.3), false)
    }

    // 4 on the first lift of the scaffold, pacing the boards
    {
      const ph = calm ? 0.3 : (((t * 0.06) % 1) + 1) % 1
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2
      const x = lerp(-HW + 0.1, HW - 0.1, tri)
      const zf = T.B.z + HD + 0.16
      put(4, l >= T.BOARD_AT(0) + 0.012 && l < T.SCAFF_OUT(0, 2) - 0.002, x, zf, ph < 0.5 ? Math.PI / 2 : -Math.PI / 2, !calm, 0.6 + 0.045)
    }

    // 5 hooking the floors on at the laydown
    {
      const x = T.LAYDOWN.x + 1.4
      const z = T.LAYDOWN.z + 1.18
      put(5, l >= T.STEPS[2][0] && l < T.ROOF_AT, x, z, face(x, z, T.LAYDOWN.x, T.LAYDOWN.z), false)
    }

    // 6 wheelbarrow runs across the yard
    {
      const on = l >= T.STEPS[1][0] + 0.02 && l < T.ROOF_AT
      const ph = calm ? 0.35 : (((t * 0.07) % 1) + 1) % 1
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2
      const x = lerp(-1.9, 1.05, tri)
      const z = 1.98
      const yaw = ph < 0.5 ? Math.PI / 2 : -Math.PI / 2
      put(6, on, x, z, yaw, !calm)
      const k = base + 6
      if (pops.y[k] > 0.001) {
        this.barrow.visible = true
        this.barrow.position.set(x + Math.sin(yaw) * 0.28, calm ? 0 : Math.abs(Math.sin(t * 9 + 6)) * 0.01, z)
        this.barrow.rotation.y = yaw - Math.PI / 2
        this.barrow.scale.set(pops.xz[k], pops.y[k], pops.xz[k])
      } else this.barrow.visible = false
    }

    // 7 gardener hops from tree to tree (scrubbed)
    {
      const u = clamp((l - T.TREE_AT(0) + 0.01) / 0.012, 0, TREES_NEW.length - 1)
      const j = Math.min(TREES_NEW.length - 2, Math.floor(u))
      const f = smoothstep(0.45, 1, u - j)
      const ox = (x: number) => (x > 0 ? -0.34 : 0.34)
      const ax = TREES_NEW[j].x + ox(TREES_NEW[j].x)
      const az = TREES_NEW[j].z + 0.14
      const bx = TREES_NEW[j + 1].x + ox(TREES_NEW[j + 1].x)
      const bz = TREES_NEW[j + 1].z + 0.14
      const x = lerp(ax, bx, f)
      const z = lerp(az, bz, f)
      const walking = f > 0.02 && f < 0.98 && l < T.TREE_AT(TREES_NEW.length - 1)
      const tx = TREES_NEW[f > 0.5 ? j + 1 : j]
      put(7, l >= T.LAWN_AT, x, z, walking ? face(ax, az, bx, bz) : face(x, z, tx.x, tx.z), walking)
    }

    // 8 Hark support tech steps out of the van
    {
      const x = VAN.x - 0.52
      const z = VAN.z + 0.46
      put(8, l >= T.TECH_AT, x, z, face(x, z, CLIENT_AT_DOOR.x, CLIENT_AT_DOOR.z), false)
    }

    for (const m of this.people) m.instanceMatrix.needsUpdate = true
  }

  /** Forget the last local (entering the chapter is a jump, not a scrub). */
  resetScrub() {
    this.lPrev = -1
  }
}
