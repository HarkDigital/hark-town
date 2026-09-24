import * as THREE from 'three'
import { C, clayVC } from '../../kit/palette'
import {
  Builder,
  bushGeometry,
  islandPoints,
  makeBench,
  makeCar,
  makeCrowd,
  makeFlag,
  makeHouse,
  makeIsland,
  makePath,
  makeRoad,
  makeRock,
  makeShop,
  makeSign,
  makeStreetLamp,
  mergeStatic,
  scatter,
  treeGeometry,
  tuftGeometry,
  flowerGeometry,
} from '../../kit/props'
import type { Crowd, HouseOptions } from '../../kit/props'
import { logoGeometry } from '../../logo/logo'
import { ease, rng, segment } from '../../core/math'
import { T } from './timeline'
import { hash1, nextFrame } from './util'

/*
 * The storm island: a cosy ring of kit cottages around a stone plaza and a
 * little ring road, with the Hark beacon in the middle. Statics are baked
 * with the kit's mergeStatic (vertex-colour clay → a couple of draw calls);
 * trees sway in the wind (instanced), townsfolk are a kit crowd, and the
 * hacked houses get instanced glowing panes over their kit windows so they
 * can flicker red on their own.
 */

export interface House {
  pos: THREE.Vector3
  rotY: number
  w: number
  d: number
  h: number
  /** world point just outside the door */
  door: THREE.Vector3
  /** world point on the lawn in front of the house */
  front: THREE.Vector3
}

export interface TownKnobs {
  local: number
  /** 0..1 storm wind (trees) */
  wind: number
  /** 0..1 puddles */
  wet: number
  /** per house 0..1: windows flicker red */
  hack: number[]
  /** beacon LED level (1 = normal, >1 = charging) */
  led: number
  /** extra emblem spin (radians) */
  spin: number
  /** idle-time multiplier (reduced motion slows things down) */
  pace: number
}

type Spec = { a: number; r: number; o: HouseOptions; shop?: boolean }
const HOUSES: Spec[] = [
  { a: 200, r: 3.6, o: { w: 1.6, d: 1.2, h: 1.55, style: 'gable', wall: C.butter, roof: C.roofRed, chimney: true, flowers: true, shutters: true, seed: 4 } },
  { a: 246, r: 3.85, o: { w: 1.25, d: 1.1, h: 1.05, style: 'hip', wall: C.powder, roof: C.roofBlue, chimney: false, flowers: true, seed: 9 } },
  { a: 153, r: 3.65, o: { w: 1.45, d: 1.25, h: 1.6, wall: C.blush, roof: C.roofTeal, awning: C.coral, seed: 12 }, shop: true },
  { a: 108, r: 3.85, o: { w: 1.2, d: 1.05, h: 1.05, style: 'gable', wall: C.white, roof: C.roofYellow, chimney: true, seed: 2 } },
  { a: 292, r: 3.9, o: { w: 1.3, d: 1.1, h: 1.2, style: 'gable', wall: C.mint, roof: C.terracotta, chimney: true, shutters: true, seed: 7 } },
  { a: 62, r: 3.95, o: { w: 1.35, d: 1.1, h: 1.15, style: 'hip', wall: C.peach, roof: C.roofBlue, flowers: true, seed: 5 } },
  { a: 334, r: 4.0, o: { w: 1.15, d: 1.0, h: 1.0, style: 'gable', wall: C.lilac, roof: C.roofPink, chimney: false, seed: 3 } },
]
/** houses that get hit (their windows can flicker red) */
export const HACKED = [0, 2, 4, 5]

const BRELLAS = [C.roofRed, C.mustard, C.roofBlue, C.roofPink, C.teal, C.lavender]

const deg = (d: number) => (d * Math.PI) / 180
/** our angle convention: a = 0 faces the camera (+z) */
const polar = (a: number, r: number, y = 0) => new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r)

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()
const _o = new THREE.Vector3()
const _c = new THREE.Color()
const _axis = new THREE.Vector3(0.35, 0, -1).normalize()
const UP = new THREE.Vector3(0, 1, 0)
const X = new THREE.Vector3(1, 0, 0)

interface Person {
  home: number
  spot: THREE.Vector3
  lane: number
  phase: number
  run: [number, number]
  out: number
}

interface Tree {
  pos: THREE.Vector3
  s: number
  ry: number
  seed: number
  mesh: number
  idx: number
}

export class Town {
  group = new THREE.Group()
  island!: THREE.Group
  ground = 0
  houses: House[] = []
  /** heart of the emblem on the beacon */
  crown = new THREE.Vector3()
  /** where each storm bolt lands */
  hits: THREE.Vector3[] = []
  /** spots where puddles can glint */
  glintSpots: THREE.Vector3[] = []

  private panes!: THREE.InstancedMesh
  private paneHouse: number[] = []
  private paneSeed: number[] = []
  private paneMats: THREE.Matrix4[] = []
  private treeMeshes: THREE.InstancedMesh[] = []
  private trees: Tree[] = []
  private crowd!: Crowd
  private brellas!: THREE.InstancedMesh
  private people: Person[] = []
  private car = new THREE.Group()
  private road!: THREE.Mesh
  private puddles!: THREE.InstancedMesh
  private puddleData: { pos: THREE.Vector3; sx: number; sz: number; rot: number; t0: number }[] = []
  private led = new THREE.MeshStandardMaterial({ color: C.signal, emissive: C.signalBright, emissiveIntensity: 1.4, roughness: 0.4 })
  private lantern = new THREE.MeshStandardMaterial({ color: '#c8ffe0', emissive: C.signal, emissiveIntensity: 1.2, roughness: 0.25 })
  private emblemMat = new THREE.MeshStandardMaterial({ color: C.signal, emissive: C.signal, emissiveIntensity: 0.6, roughness: 0.35 })
  private emblem!: THREE.Mesh
  private LANES = [
    { r: 1.1, w: 0.34 },
    { r: 1.26, w: -0.27 },
    { r: 1.42, w: 0.21 },
  ]

  async build(mobile: boolean) {
    const g = this.group
    this.island = makeIsland({ radius: 5.7, thickness: 0.95, depth: 4.2, seed: 23, wobble: 0.07, detail: mobile ? 0.6 : 1 })
    g.add(this.island)
    const G = (this.ground = 0)
    await nextFrame()

    // ---------------------------------------------------------------- statics
    const statics = new THREE.Group()
    for (let i = 0; i < HOUSES.length; i++) {
      const spec = HOUSES[i]
      if (i === 3) await nextFrame()
      const a = deg(spec.a)
      const pos = polar(a, spec.r, G)
      const rotY = a + Math.PI
      const house = spec.shop ? makeShop(spec.o) : makeHouse(spec.o)
      house.position.copy(pos)
      house.rotation.y = rotY
      statics.add(house)
      const { w = 1.4, d = 1.2, h = 1.1 } = spec.o
      const colsF = Math.max(1, Math.round(w / 0.42))
      const doorX = spec.shop ? w * 0.28 : -w / 2 + (Math.floor(colsF / 2) + 0.5) * (w / colsF)
      const toWorld = (v: THREE.Vector3) => v.applyAxisAngle(UP, rotY).add(pos)
      this.houses.push({
        pos,
        rotY,
        w,
        d,
        h,
        door: toWorld(new THREE.Vector3(doorX, 0, d / 2 + 0.22)),
        front: toWorld(new THREE.Vector3(spec.shop ? -w * 0.2 : w * 0.22, 0, d / 2 + 0.62)),
      })
      if (HACKED.includes(i)) this.addPanes(i, spec)
    }
    await nextFrame()

    // plaza (stone disc + inlay) and the beacon body, as vertex-colour clay
    const pb = new Builder()
    pb.cyl(1.58, 1.62, 0.05, 56, C.stone, { y: 0.025 })
    pb.add(new THREE.TorusGeometry(1.32, 0.03, 4, 72), C.path, { y: 0.05, rx: Math.PI / 2 })
    pb.add(new THREE.TorusGeometry(1.52, 0.022, 4, 72), C.kerb, { y: 0.05, rx: Math.PI / 2 })
    // beacon: plinth, tower, balcony, cap
    pb.cyl(0.9, 0.98, 0.2, 40, C.white, { y: 0.15 })
    pb.cyl(0.74, 0.8, 0.05, 40, C.signalDeep, { y: 0.27 })
    pb.cyl(0.36, 0.5, 2.4, 32, C.white, { y: 0.28 + 1.2 })
    pb.rbox(0.26, 0.44, 0.1, 0.04, C.navy, { y: 0.5, z: 0.47 }, 2)
    pb.cyl(0.62, 0.54, 0.1, 32, C.navy, { y: 2.73 })
    pb.add(new THREE.TorusGeometry(0.58, 0.018, 4, 36), C.navy, { y: 2.94, rx: Math.PI / 2 })
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2
      pb.cyl(0.012, 0.012, 0.2, 4, C.navy, { x: Math.sin(a) * 0.58, y: 2.85, z: Math.cos(a) * 0.58 })
    }
    pb.cyl(0.4, 0.32, 0.06, 24, C.navy, { y: 3.17 })
    pb.cone(0.36, 0.2, 24, C.navy, { y: 3.3 })
    pb.cyl(0.025, 0.025, 0.36, 6, C.navy, { y: 3.52 })
    const plaza = new THREE.Mesh(pb.build(), clayVC())
    plaza.castShadow = true
    plaza.receiveShadow = true
    statics.add(plaza)

    await nextFrame()

    // ring road + footpaths to each door
    const ring: [number, number][] = []
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      ring.push([Math.sin(a) * 2.5, Math.cos(a) * 2.5])
    }
    this.road = makeRoad(ring, { closed: true, width: 0.5, line: true })
    statics.add(this.road)
    this.houses.forEach((h, i) => {
      const dir = new THREE.Vector3(h.door.x, 0, h.door.z)
      const end = dir.clone().setLength(dir.length() - 0.05)
      const start = dir.clone().setLength(2.8)
      statics.add(makePath([[start.x, start.z], [end.x, end.z]], { width: 0.28, seed: i + 2 }))
    })

    // plaza furniture: benches + Hark street lamps
    for (const a of [deg(32), deg(212)]) {
      const b = makeBench(C.wood)
      b.position.copy(polar(a, 1.2, 0.05))
      b.rotation.y = a + Math.PI
      statics.add(b)
    }
    for (let k = 0; k < 4; k++) {
      const a = deg(45 + k * 90)
      const lamp = makeStreetLamp({ hark: true })
      lamp.position.copy(polar(a, 1.9, G))
      lamp.rotation.y = a - Math.PI / 2
      statics.add(lamp)
    }
    // a little wayfinding sign on the front lawn
    const sign = makeSign('Hark Watch', { hark: true, sub: 'Open 24/7', post: 0.6, font: 'display' })
    sign.position.copy(polar(deg(-38), 3.15, G))
    sign.rotation.y = deg(-20)
    sign.userData.dynamic = true
    g.add(sign)

    // rim rocks
    const rr = rng(41)
    for (let k = 0; k < 8; k++) {
      const a = rr() * Math.PI * 2
      const rock = makeRock(k + 5, 0.9 + rr() * 1.3)
      rock.position.copy(polar(a, 4.95 + rr() * 0.4, G - 0.02))
      statics.add(rock)
    }

    await nextFrame()
    g.add(mergeStatic(statics))
    await nextFrame()

    // ---------------------------------------------------------------- the Hark flag (animated in its own shader)
    const flag = makeFlag({ color: C.signal, mark: true, pole: 1.55, w: 0.56, h: 0.34 })
    flag.position.copy(polar(deg(-26), 1.3, 0.05))
    flag.rotation.y = deg(-30)
    g.add(flag)

    // ---------------------------------------------------------------- live beacon bits
    const live = new THREE.Group()
    for (const y of [0.92, 1.62]) {
      const t = (y - 0.28) / 2.4
      const r = 0.5 + (0.36 - 0.5) * t + 0.012
      const band = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.005, r + 0.005, 0.07, 32), this.led)
      band.position.y = y
      live.add(band)
    }
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.36, 20), this.lantern)
    glass.position.y = 2.96
    live.add(glass)
    // the extruded mark costs a few frames' worth of triangulation: build it
    // when the main thread is idle rather than during the boot sequence
    const eg = new THREE.BufferGeometry()
    const buildMark = () => {
      const src = logoGeometry({ depth: 0.18, bevel: false, curveSegments: 6 })
      src.computeBoundingBox()
      const box = src.boundingBox!.clone()
      const c = box.getCenter(new THREE.Vector3())
      src.translate(-c.x, -c.y, -c.z)
      const es = 0.84 / Math.max(1e-3, box.max.y - box.min.y)
      src.scale(es, es, es)
      this.emblem.geometry = src
      eg.dispose()
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(buildMark, { timeout: 1200 })
    else setTimeout(buildMark, 250)
    this.emblem = new THREE.Mesh(eg, this.emblemMat)
    this.emblem.frustumCulled = false
    this.emblem.position.y = 4.02
    this.emblem.castShadow = true
    live.add(this.emblem)
    live.position.y = G
    g.add(live)
    this.crown.set(0, G + 4.02, 0)

    await nextFrame()

    // ---------------------------------------------------------------- hacked-window panes
    this.panes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.paneMats.length)
    this.paneMats.forEach((m, i) => {
      this.panes.setMatrixAt(i, m)
      this.panes.setColorAt(i, _c.setRGB(0, 0, 0))
    })
    this.panes.frustumCulled = false
    g.add(this.panes)

    // ---------------------------------------------------------------- trees (sway), bushes, tufts, flowers
    const avoid = [
      { x: 0, z: 0, r: 2.95 },
      ...this.houses.map(h => ({ x: h.pos.x, z: h.pos.z, r: Math.max(h.w, h.d) * 0.72 + 0.3 })),
      ...this.houses.map(h => ({ x: h.door.x, z: h.door.z, r: 0.45 })),
      { x: Math.sin(deg(-38)) * 3.15, z: Math.cos(deg(-38)) * 3.15, r: 0.5 },
    ]
    const treePts = islandPoints(this.island, mobile ? 16 : 24, { seed: 17, margin: 0.55, spacing: 0.78, avoid, minR: 3.0 })
    const kinds = [treeGeometry(3, 'round'), treeGeometry(8, 'cluster'), treeGeometry(5, 'pine'), treeGeometry(11, 'round')]
    const counts = [0, 0, 0, 0]
    const tr = rng(5)
    treePts.forEach((p, i) => {
      const mesh = i % 7 === 3 ? 2 : i % 3 === 0 ? 1 : i % 2 ? 0 : 3
      this.trees.push({ pos: p, s: 0.78 + tr() * 0.35, ry: tr() * 6.28, seed: tr() * 10, mesh, idx: counts[mesh]++ })
    })
    kinds.forEach((geo, k) => {
      const im = new THREE.InstancedMesh(geo, clayVC(), Math.max(1, counts[k]))
      im.count = counts[k]
      im.castShadow = true
      im.receiveShadow = true
      im.frustumCulled = false
      this.treeMeshes.push(im)
      g.add(im)
    })
    this.updateTrees(0, 0, 1)
    await nextFrame()

    const bushAvoid = [{ x: 0, z: 0, r: 2.95 }, ...this.houses.map(h => ({ x: h.door.x, z: h.door.z, r: 0.4 }))]
    const bushPts = islandPoints(this.island, mobile ? 14 : 26, { seed: 29, margin: 0.4, spacing: 0.45, avoid: bushAvoid.concat(this.houses.map(h => ({ x: h.pos.x, z: h.pos.z, r: Math.max(h.w, h.d) * 0.62 }))), minR: 2.95 })
    for (let v = 0; v < 3; v++) g.add(scatter(bushGeometry(v), clayVC(), bushPts.filter((_, i) => i % 3 === v), { seed: v + 3, scale: [0.8, 1.25] }))
    const tuftPts = islandPoints(this.island, mobile ? 30 : 60, { seed: 61, margin: 0.3, spacing: 0.3, avoid, minR: 2.95 })
    g.add(scatter(tuftGeometry(), clayVC(), tuftPts, { seed: 4, scale: [0.8, 1.3] }))
    const flowerPts = islandPoints(this.island, mobile ? 18 : 36, { seed: 71, margin: 0.35, spacing: 0.22, avoid, minR: 3.0 })
    g.add(scatter(flowerGeometry(), clayVC(), flowerPts, { seed: 8, colors: [C.blossom, C.white, C.mustard, C.coral, C.lavender] }))

    await nextFrame()

    // ---------------------------------------------------------------- puddles
    const pr = rng(5)
    const spots: [number, number, number][] = [
      [deg(18), 1.02, 0.056],
      [deg(160), 0.98, 0.056],
      [deg(250), 1.2, 0.056],
      [deg(84), 2.5, 0.05],
      [deg(222), 2.46, 0.05],
      [deg(328), 2.52, 0.05],
      [deg(-6), 3.9, 0.02],
      [deg(128), 4.5, 0.02],
      [deg(40), 4.25, 0.02],
      [deg(268), 4.55, 0.02],
    ]
    const pGeo = new THREE.CircleGeometry(0.5, 28)
    pGeo.rotateX(-Math.PI / 2)
    this.puddles = new THREE.InstancedMesh(
      pGeo,
      new THREE.MeshStandardMaterial({
        color: '#a9cde4',
        roughness: 0.08,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      spots.length,
    )
    for (const [a, r, y] of spots) {
      const pos = polar(a, r, G + y)
      this.puddleData.push({ pos, sx: 0.55 + pr() * 0.5, sz: 0.34 + pr() * 0.3, rot: pr() * 3, t0: pr() * 0.5 })
      this.glintSpots.push(pos.clone().add(new THREE.Vector3((pr() - 0.5) * 0.2, 0.03, (pr() - 0.5) * 0.15)))
    }
    this.puddles.receiveShadow = true
    this.puddles.frustumCulled = false
    this.puddles.renderOrder = 1
    g.add(this.puddles)

    // ---------------------------------------------------------------- townsfolk + umbrellas
    const N = mobile ? 7 : 9
    this.crowd = makeCrowd(N, { seed: 6, variants: Math.min(6, N) })
    g.add(this.crowd.group)
    const brella = new Builder()
    brella.add(new THREE.ConeGeometry(0.25, 0.12, 12, 1), C.white, { y: 0.72 })
    brella.sphere(0.02, C.white, { y: 0.79 }, 0)
    brella.cyl(0.011, 0.011, 0.34, 4, C.ink, { y: 0.52, z: 0.02 })
    this.brellas = new THREE.InstancedMesh(brella.build(), clayVC(), N)
    this.brellas.castShadow = true
    this.brellas.frustumCulled = false
    const ppl = rng(12)
    for (let i = 0; i < N; i++) {
      const home = (i * 3) % this.houses.length
      const a = deg(ppl() * 360)
      const r = ppl() < 0.5 ? 1.15 + ppl() * 0.3 : 2.05 + ppl() * 0.8
      const run0 = 0.012 + i * 0.011
      this.people.push({
        home,
        spot: polar(a, r, G),
        lane: i % 3,
        phase: (Math.floor(i / 3) / Math.ceil(N / 3)) * Math.PI * 2 + (i % 3) * 0.7,
        run: [run0, run0 + 0.085 + (i % 3) * 0.012],
        out: T.peopleOut + i * 0.011,
      })
      this.brellas.setColorAt(i, _c.set(BRELLAS[i % BRELLAS.length]))
      this.brellas.setMatrixAt(i, _m.makeScale(0, 0, 0))
    }
    g.add(this.brellas)

    // ---------------------------------------------------------------- car on the ring road
    this.car = makeCar(C.mustard, { kind: 'hatch', seed: 3 })
    g.add(this.car)

    // storm bolt landing spots (lawn in front of houses; the shop's flat roof)
    const H = this.houses
    this.hits = [H[0].front.clone(), H[2].pos.clone().setY(G + H[2].h + 0.06), H[4].front.clone(), H[5].front.clone()]
    for (const p of this.hits) p.y += 0.02
    this.glintSpots.push(H[2].pos.clone().setY(G + H[2].h + 0.08).add(new THREE.Vector3(0.25, 0, 0.1)))
  }

  /**
   * Glowing panes over a kit house's glass so this house can flicker on its
   * own. Mirrors the window layout in kit/buildings.ts makeHouse.
   */
  private addPanes(i: number, spec: Spec) {
    const h = this.houses[i]
    const { w = 1.4, d = 1.2, h: hh = 1.1 } = spec.o
    const floors = Math.max(1, Math.round((hh - 0.1) / 0.55))
    const floorH = (hh - 0.05) / floors
    const colsF = Math.max(1, Math.round(w / 0.42))
    const colsS = Math.max(1, Math.round(d / 0.46))
    const doorCol = Math.floor(colsF / 2)
    const push = (x: number, y: number, z: number, ry: number, ww: number) => {
      _p.set(x, y, z).applyAxisAngle(UP, h.rotY).add(h.pos)
      _q.setFromAxisAngle(UP, h.rotY + ry)
      this.paneMats.push(new THREE.Matrix4().compose(_p.clone(), _q.clone(), new THREE.Vector3(ww, 0.24, 0.006)))
      this.paneHouse.push(i)
      this.paneSeed.push(hash1(this.paneMats.length * 3.7 + i * 11))
    }
    const off = 0.034
    for (let f = 0; f < floors; f++) {
      const y = 0.02 + floorH * (f + 0.55)
      for (let c = 0; c < colsF; c++) {
        const x = -w / 2 + (c + 0.5) * (w / colsF)
        if (!(f === 0 && (c === doorCol || spec.shop))) push(x, y, d / 2 + off, 0, 0.2)
        push(x, y, -d / 2 - off, Math.PI, 0.2)
      }
      if (d > 0.7)
        for (let c = 0; c < colsS; c++) {
          const z = -d / 2 + (c + 0.5) * (d / colsS)
          push(w / 2 + off, y, z, Math.PI / 2, 0.18)
          push(-w / 2 - off, y, z, -Math.PI / 2, 0.18)
        }
    }
  }

  private updateTrees(time: number, wind: number, pace: number) {
    for (const t of this.trees) {
      const tt = time * pace
      const gust = 0.5 + 0.5 * Math.sin(tt * 0.9 + t.seed * 0.7)
      const ang = wind * (0.045 + 0.06 * gust) * (0.65 + 0.35 * Math.sin(tt * 3.1 + t.seed)) + 0.012 * Math.sin(tt * 1.2 + t.seed)
      _q.setFromAxisAngle(_axis, ang).multiply(_q2.setFromAxisAngle(UP, t.ry))
      _m.compose(t.pos, _q, _s.setScalar(t.s))
      this.treeMeshes[t.mesh].setMatrixAt(t.idx, _m)
    }
    for (const m of this.treeMeshes) m.instanceMatrix.needsUpdate = true
  }

  update(k: TownKnobs, time: number) {
    const t = time * k.pace
    const local = k.local

    // hacked panes: flicker red, hidden otherwise ------------------------
    const P = this.panes
    for (let i = 0; i < this.paneHouse.length; i++) {
      const hack = k.hack[this.paneHouse[i]] ?? 0
      const seed = this.paneSeed[i]
      if (hack < 0.002) {
        P.setColorAt(i, _c.setRGB(0, 0, 0))
        _m.makeScale(0, 0, 0)
      } else {
        const on = k.pace < 1 ? 0.8 : hash1(Math.floor(t * 9 + seed * 17) + seed * 31) > 0.4 ? 1 : 0.08
        P.setColorAt(i, _c.setRGB(2.8 * on * hack, 0.16 * on * hack, 0.12 * on * hack))
        _m.copy(this.paneMats[i])
      }
      P.setMatrixAt(i, _m)
    }
    P.instanceMatrix.needsUpdate = true
    if (P.instanceColor) P.instanceColor.needsUpdate = true

    this.updateTrees(time, k.wind, k.pace)

    // beacon ------------------------------------------------------------
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2)
    this.led.emissiveIntensity = 1.1 + 0.4 * pulse + (k.led - 1) * 2.4
    this.lantern.emissiveIntensity = 0.9 + 0.3 * pulse + (k.led - 1) * 3
    this.emblemMat.emissiveIntensity = 0.5 + 0.15 * pulse + (k.led - 1) * 1.6
    this.emblem.rotation.y = t * 0.55 + k.spin

    // puddles ------------------------------------------------------------
    const PD = this.puddles
    this.puddleData.forEach((p, i) => {
      const grow = ease.outCubic(Math.min(1, Math.max(0, (k.wet - p.t0 * 0.4) / 0.6)))
      const s = grow * (1 - 0.25 * segment(local, 0.82, 1))
      _m.compose(p.pos, _q.setFromAxisAngle(UP, p.rot), _s.set(p.sx * s + 1e-4, 1, p.sz * s + 1e-4))
      PD.setMatrixAt(i, _m)
    })
    PD.instanceMatrix.needsUpdate = true

    // townsfolk: run home in the rain, pop back out after it --------------
    const C0 = this.crowd
    this.people.forEach((p, i) => {
      const home = this.houses[p.home]
      let heading = 0
      let bob = 0
      let scale = 1
      let brolly = 0
      let tilt = 0
      if (local < p.out) {
        const u = segment(local, p.run[0], p.run[1])
        _p.lerpVectors(p.spot, home.door, ease.inOutQuad(u))
        heading = u > 0 ? Math.atan2(home.door.x - p.spot.x, home.door.z - p.spot.z) : i * 1.7 + Math.sin(t * 0.6 + i) * 0.3
        scale = u < 0.86 ? 1 : 1 - segment(u, 0.86, 1)
        const running = u > 0 && u < 1
        bob = running ? Math.abs(Math.sin(t * 15 + i)) : 0
        brolly = scale * segment(local, 0.0, 0.025)
        tilt = running ? 0.22 : 0.05
      } else {
        const v = segment(local, p.out, p.out + 0.05)
        const w = segment(local, p.out + 0.04, p.out + 0.1)
        const lane = this.LANES[p.lane]
        const ang = p.phase + t * lane.w
        const loop = polar(ang, lane.r, this.ground + 0.05)
        _o.copy(home.door).multiplyScalar(0.88)
        _p.copy(home.door).lerp(_o, ease.outCubic(v)).lerp(loop, ease.inOutQuad(w))
        heading = w > 0.5 ? ang + (lane.w > 0 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(loop.x - _p.x, loop.z - _p.z)
        // springy pop out of the door
        scale = v <= 0 ? 0 : 1 - Math.exp(-6 * v) * Math.cos(10 * v)
        bob = v > 0.6 ? Math.abs(Math.sin(t * 9 + i * 1.3)) * 0.8 : 0
      }
      if (scale < 0.01) C0.hide(i)
      else C0.set(i, _p.x, _p.y, _p.z, heading, bob, scale)
      const bs = brolly > 0.01 ? brolly : 0
      _q.setFromAxisAngle(UP, heading).multiply(_q2.setFromAxisAngle(X, -tilt))
      _m.compose(_o.copy(_p).setY(_p.y + bob * 0.05), _q, _s.setScalar(bs))
      this.brellas.setMatrixAt(i, _m)
    })
    C0.commit()
    this.brellas.instanceMatrix.needsUpdate = true

    // car ------------------------------------------------------------------
    const curve = this.road.userData.curve as THREE.CatmullRomCurve3
    const len = this.road.userData.length as number
    const u = (((0.1 + (t * 0.42) / len) % 1) + 1) % 1
    curve.getPointAt(u, _p)
    const tan = curve.getTangentAt(u, _o)
    this.car.position.set(_p.x - tan.z * 0.12, this.ground + 0.045 + Math.abs(Math.sin(t * 11)) * 0.004, _p.z + tan.x * 0.12)
    this.car.rotation.y = Math.atan2(-tan.z, tan.x)
  }
}
