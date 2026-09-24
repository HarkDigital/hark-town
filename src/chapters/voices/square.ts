import * as THREE from 'three'
import { C, clay } from '../../kit/palette'
import { makeHouse, makeIsland, makeTower, makeTree, makeBush } from '../../kit/props'
import { logoGeometry, logoShapes } from '../../logo/logo'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, rng, smoothstep } from '../../core/math'
import { StaticBatch, breathe, paint } from './batch'

/*
 * THE TOWN SQUARE — a round cobbled plaza on its own floating island: a
 * two-tier fountain crowned with a slowly turning Hark mark, café tables
 * under striped umbrellas, a little market, a flower cart, a noticeboard, a
 * town hall with a clock tower, bunting strung between lamp posts, and eight
 * "soapbox" spots around the square where the client voices stand.
 *
 * Coordinates: island centred on the origin, plaza top at y = Y0. Polar
 * angles are degrees, 0 = +z, 90 = +x.
 */

export const Y0 = 0.08
export const PLAZA_R = 4.85

export const pol = (deg: number, r: number) => {
  const a = THREE.MathUtils.degToRad(deg)
  return { x: Math.sin(a) * r, z: Math.cos(a) * r }
}
/** yaw that turns a +z-facing prop at (x, z) to face the plaza centre */
export const faceCentre = (x: number, z: number) => Math.atan2(-x, -z)

export interface SpeakerSpot {
  /** feet position (standing surface) */
  pos: THREE.Vector3
  yaw: number
  /** polar angle of the spot (deg) and radius */
  theta: number
  r: number
}

/** The eight voices' spots, in TESTIMONIALS order (the camera sweeps clockwise). */
const SPOTS: { theta: number; r: number; stand: number; out?: boolean }[] = [
  { theta: 180, r: 4.0, stand: 0.24 }, // soapbox by the town hall steps
  { theta: 225, r: 3.92, stand: 0.24 }, // crate between the market stalls
  { theta: 270, r: 4.08, stand: 0.18 }, // up on the park bench
  { theta: 315, r: 4.0, stand: 0.24 }, // the little bandstand
  { theta: 180, r: 1.25, stand: 0.36, out: true }, // on the fountain rim
  { theta: 45, r: 4.02, stand: 0.24 }, // crate by the café tables
  { theta: 90, r: 4.0, stand: 0.24 }, // next to the flower cart
  { theta: 135, r: 4.02, stand: 0.24 }, // by the noticeboard
]

const WALLS = {
  peach: '#f7d8c4',
  mint: '#d5e8d3',
  butter: '#f6e6a9',
  powder: '#d3e0f2',
  cream: '#f4ead8',
  white: '#fbfaf6',
  blush: '#f3c9c4',
}
const WOOD = '#c69063'
const WOOD_DARK = '#9c6b45'
const STONE = '#efe3cc'
const STONE_DARK = '#d8c6a6'

export interface Seat {
  x: number
  z: number
  y: number
  yaw: number
}

export class TownSquare {
  group = new THREE.Group()
  speakers: SpeakerSpot[] = []
  /** café chairs: where sitters go */
  seats: Seat[] = []
  /** footprints people must not stand in (x, z, radius) */
  obstacles: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: 1.38 }]
  /** behind the market counters / cart */
  keepers: Seat[] = []
  /** the balloon seller */
  balloonSeller = new THREE.Vector3()

  private finial!: THREE.Mesh
  private drops!: THREE.InstancedMesh
  private dropCount = 0
  private ripples: THREE.Mesh[] = []
  private flags!: THREE.InstancedMesh
  private flagBase: { p: THREE.Vector3; yaw: number; tilt: number; seed: number }[] = []
  private bulbs!: THREE.InstancedMesh
  private bulbBase: { p: THREE.Vector3; s: number; order: number; lamp: boolean }[] = []
  private umbrellas: THREE.InstancedMesh[] = []
  private umbrellaBase: { p: THREE.Vector3; delay: number }[] = []
  private balloons!: THREE.InstancedMesh
  private balloonBase: { p: THREE.Vector3; seed: number }[] = []
  private strings!: THREE.LineSegments
  private cloudRing = new THREE.Group()
  private flagPennant!: THREE.Mesh
  private ring!: THREE.Mesh
  private ringPulse!: THREE.Mesh
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private col = new THREE.Color()
  private lastLamp = -1
  private pigeons!: THREE.InstancedMesh
  private pigeonBase: { a: number; r: number; seed: number }[] = []
  private birds!: THREE.InstancedMesh
  private wings!: THREE.InstancedMesh
  private birdBase: { r: number; y: number; speed: number; phase: number; seed: number }[] = []

  constructor(private mobile: boolean) {}

  async build() {
    const batch = new StaticBatch()
    const mobile = this.mobile

    // ---------------------------------------------------------- island
    const island = makeIsland({ radius: 8.4, thickness: 1.0, depth: 7.2, seed: 21, wobble: 0.07 })
    batch.add(island)

    // plaza: cobbled disc + stone rim + kerb
    const tex = cobbleTexture(mobile ? 1024 : 2048)
    const plazaGeo = new THREE.CircleGeometry(PLAZA_R, 96)
    plazaGeo.rotateX(-Math.PI / 2)
    plazaGeo.translate(0, Y0, 0)
    const plaza = new THREE.Mesh(
      plazaGeo,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }),
    )
    plaza.receiveShadow = true
    plaza.matrixAutoUpdate = false
    this.group.add(plaza)
    const side = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R, PLAZA_R, Y0 + 0.02, 96, 1, true), clay(STONE_DARK))
    side.position.y = (Y0 - 0.02) / 2
    batch.add(side, { cast: false, receive: true })
    const kerbGeo = new THREE.RingGeometry(PLAZA_R, PLAZA_R + 0.16, 96, 1)
    kerbGeo.rotateX(-Math.PI / 2)
    const kerb = new THREE.Mesh(kerbGeo, clay(STONE))
    kerb.position.y = Y0 - 0.025
    batch.add(kerb, { cast: false, receive: true })
    const kerbSide = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_R + 0.16, PLAZA_R + 0.16, Y0, 96, 1, true), clay(STONE_DARK))
    kerbSide.position.y = Y0 / 2 - 0.025
    batch.add(kerbSide, { cast: false, receive: true })

    await breathe()

    // ---------------------------------------------------------- fountain
    this.buildFountain(batch)
    await breathe()

    // ---------------------------------------------------------- buildings
    await this.buildTown(batch)
    await breathe()

    // ---------------------------------------------------------- spots + dressing
    this.buildSpots(batch)
    this.buildCafe(batch)
    this.buildMarket(batch)
    await breathe()
    this.buildTrees(batch)
    this.buildLampsAndBunting(batch)
    this.buildBalloons()
    this.buildWildlife()
    await breathe()

    // ---------------------------------------------------------- sky dressing
    this.buildSky(batch)
    await breathe()

    batch.build(this.group)

    // the listener ring: a green pin-ring under whoever has the floor
    const ringGeo = new THREE.RingGeometry(0.33, 0.4, 44)
    ringGeo.rotateX(-Math.PI / 2)
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(C.signal).multiplyScalar(1.25), toneMapped: false }),
    )
    this.ring.renderOrder = 2
    this.group.add(this.ring)
    const pulseGeo = new THREE.RingGeometry(0.38, 0.42, 44)
    pulseGeo.rotateX(-Math.PI / 2)
    this.ringPulse = new THREE.Mesh(
      pulseGeo,
      new THREE.MeshBasicMaterial({ color: C.signal, transparent: true, depthWrite: false, toneMapped: false }),
    )
    this.ringPulse.renderOrder = 3
    this.group.add(this.ringPulse)
  }

  /* ------------------------------------------------------------ fountain */

  private buildFountain(batch: StaticBatch) {
    const lathe = (pts: [number, number][], seg = 48) =>
      new THREE.LatheGeometry(
        pts.map(([r, y]) => new THREE.Vector2(r, y)),
        seg,
      )
    // lower basin: outer wall with a rounded lip, water inside at 0.26
    const basin = new THREE.Mesh(
      lathe([
        [1.32, Y0],
        [1.34, Y0 + 0.05],
        [1.34, 0.3],
        [1.3, 0.36],
        [1.22, 0.38],
        [1.15, 0.35],
        [1.14, 0.24],
        [0.01, 0.24],
      ]),
      clay(STONE),
    )
    batch.add(basin, { cast: true, receive: true })
    // pedestal + upper bowl
    const pedestal = new THREE.Mesh(
      lathe([
        [0.001, 0.24],
        [0.24, 0.24],
        [0.2, 0.32],
        [0.13, 0.46],
        [0.11, 0.78],
        [0.15, 0.88],
        [0.5, 0.95],
        [0.56, 1.02],
        [0.54, 1.07],
        [0.48, 1.07],
        [0.46, 1.03],
        [0.001, 1.03],
      ]),
      clay(STONE),
    )
    batch.add(pedestal, { cast: true, receive: true })
    const spire = new THREE.Mesh(
      lathe([
        [0.001, 1.03],
        [0.09, 1.03],
        [0.07, 1.14],
        [0.05, 1.32],
        [0.07, 1.36],
        [0.001, 1.38],
      ], 16),
      clay(STONE_DARK),
    )
    batch.add(spire, { cast: true, receive: true })

    // water surfaces
    const water = new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.14, metalness: 0.05 })
    const w1 = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48).rotateX(-Math.PI / 2), water)
    w1.position.y = 0.3
    batch.add(w1, { cast: false, receive: true })
    const w2 = new THREE.Mesh(new THREE.CircleGeometry(0.47, 32).rotateX(-Math.PI / 2), water)
    w2.position.y = 1.04
    batch.add(w2, { cast: false, receive: true })

    // the Hark mark on top, green, slowly turning like a weather vane
    // the mark's outlines are densely pre-sampled; resample them for a tiny finial
    const low = logoShapes().map(sh => {
      if (sh.curves.length < 12) return sh
      const ns = new THREE.Shape(sh.getSpacedPoints(96))
      ns.holes = sh.holes.map(h => new THREE.Path(h.getSpacedPoints(48)))
      return ns
    })
    const logo = logoGeometry({ shapes: low, depth: 0.22, curveSegments: 1, bevelSize: 0.012, bevelThickness: 0.02 })
    logo.computeBoundingBox()
    const bb = logo.boundingBox!
    logo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
    this.finial = new THREE.Mesh(
      logo,
      clay(C.signal, { rough: 0.45, emissive: C.signal, emissiveIntensity: 0.28 }),
    )
    this.finial.scale.setScalar(0.42)
    this.finial.position.y = 1.37
    this.finial.castShadow = true
    this.group.add(this.finial)

    // droplet streams: beads arcing from the upper bowl into the basin
    const streams = this.mobile ? 8 : 12
    const beads = this.mobile ? 4 : 5
    this.dropCount = streams * beads
    this.drops = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.032, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#e6f7fc', roughness: 0.2, emissive: '#bfeaf7', emissiveIntensity: 0.35 }),
      this.dropCount,
    )
    this.drops.frustumCulled = false
    this.group.add(this.drops)

    // ripples on both pools
    const rippleMat = () =>
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false })
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), rippleMat())
      r.position.y = i < 2 ? 0.305 : 1.045
      r.renderOrder = 1
      this.ripples.push(r)
      this.group.add(r)
    }
  }

  /* ------------------------------------------------------------ buildings */

  private async buildTown(batch: StaticBatch) {
    const put = (o: THREE.Object3D, theta: number, r: number, yawOff = 0) => {
      const p = pol(theta, r)
      o.position.set(p.x, 0, p.z)
      o.rotation.y = faceCentre(p.x, p.z) + yawOff
      batch.add(o)
      return o
    }
    const R = 6.55
    // town hall with a clock tower (behind the first voice)
    const hall = makeHouse({ w: 2.8, d: 1.7, h: 1.9, wall: WALLS.cream, roof: C.roofBlue, style: 'gable', seed: 3 })
    put(hall, 180, R + 0.1)
    const tower = makeTower({ h: 1.5, r: 0.38, color: C.white, band: C.roofBlue })
    const tp = pol(180, R + 0.35)
    tower.position.set(tp.x, 1.9 + 0.35, tp.z)
    batch.add(tower)
    // clock face toward the square
    const clock = new THREE.Group()
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 24).rotateX(Math.PI / 2), clay(C.white, { rough: 0.5 }))
    clock.add(face)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 24), clay(C.ink))
    clock.add(rim)
    const hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.02), clay(C.ink))
    hand1.position.set(0, 0.06, 0.03)
    clock.add(hand1)
    const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), clay(C.ink))
    hand2.position.set(0.045, 0, 0.03)
    clock.add(hand2)
    const cp = pol(180, R + 0.35 - 0.36)
    clock.position.set(cp.x, 1.9 + 0.35 + 1.1, cp.z)
    clock.rotation.y = faceCentre(cp.x, cp.z)
    batch.add(clock)
    // spire cap
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.62, 8), clay(C.roofBlue))
    cap.position.set(tp.x, 1.9 + 0.35 + 1.5 + 0.12 + 0.31, tp.z)
    batch.add(cap)
    // flagpole with the green pennant (flutters)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.55, 6), clay(C.ink))
    pole.position.set(tp.x, cap.position.y + 0.55, tp.z)
    batch.add(pole)
    const pen = new THREE.BufferGeometry()
    pen.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.34, -0.07, 0, 0, -0.16, 0], 3))
    pen.computeVertexNormals()
    this.flagPennant = new THREE.Mesh(
      pen,
      new THREE.MeshStandardMaterial({ color: C.signal, side: THREE.DoubleSide, roughness: 0.7, emissive: C.signal, emissiveIntensity: 0.2 }),
    )
    this.flagPennant.position.set(tp.x, cap.position.y + 0.8, tp.z)
    this.group.add(this.flagPennant)
    // steps up to the hall
    for (let i = 0; i < 2; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.3 - i * 0.25, 0.08, 0.3 - i * 0.1), clay(STONE))
      const sp = pol(180, R - 0.85 - 0.18 + i * 0.08)
      step.position.set(sp.x, 0.04 + i * 0.08, sp.z)
      step.rotation.y = faceCentre(sp.x, sp.z)
      batch.add(step)
    }

    const houses: [number, number, number, number, string, string, 'gable' | 'flat' | 'shed', number?][] = [
      // theta, w, h, d, wall, roof, style
      [148, 1.4, 1.35, 1.3, WALLS.peach, C.roofRed, 'gable'],
      [212, 1.5, 1.55, 1.3, WALLS.mint, C.roofYellow, 'gable'],
      [242, 1.2, 1.95, 1.2, WALLS.butter, C.roofRed, 'gable'],
      [300, 1.6, 1.2, 1.3, WALLS.powder, C.roofYellow, 'gable'],
      [331, 1.3, 1.65, 1.2, WALLS.white, C.roofBlue, 'gable'],
      [0, 2.1, 1.05, 1.2, WALLS.blush, C.roofRed, 'flat'],
      [30, 1.4, 1.45, 1.3, WALLS.butter, C.roofBlue, 'gable'],
      [95, 1.3, 1.75, 1.2, WALLS.mint, C.roofRed, 'gable'],
      [123, 1.5, 1.3, 1.3, WALLS.powder, C.roofInk, 'gable'],
    ]
    await breathe()
    for (let i = 0; i < houses.length; i++) {
      const [theta, w, h, d, wall, roof, style] = houses[i]
      if (i === 5) await breathe()
      put(makeHouse({ w, h, d, wall, roof, style, seed: 11 + i }), theta, R + (i % 2) * 0.15)
      // chimneys on some gables
      if (style === 'gable' && i % 3 !== 1) {
        const ch = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 0.16), clay(C.terracotta))
        const p = pol(theta + (i % 2 ? 4 : -4), R + (i % 2) * 0.15 + 0.2)
        ch.position.set(p.x, h + Math.min(w, d) * 0.3, p.z)
        batch.add(ch)
      }
    }

    // café: a white shop with a flat roof and a striped awning
    const cafe = makeHouse({ w: 1.9, h: 1.25, d: 1.4, wall: WALLS.white, roof: C.roofRed, style: 'flat', seed: 7 })
    put(cafe, 62, R)
    const awning = stripes(1.95, 0.52, 7, C.roofRed, C.white)
    const ap = pol(62, R - 0.7 - 0.22)
    awning.position.set(ap.x, 0.98, ap.z)
    awning.rotation.set(0, faceCentre(ap.x, ap.z), 0)
    awning.rotateX(0.5)
    batch.add(awning)
  }

  /* ------------------------------------------------------------ speaker spots */

  private buildSpots(batch: StaticBatch) {
    SPOTS.forEach((s, i) => {
      const p = pol(s.theta, s.r)
      const yaw = s.out ? Math.atan2(p.x, p.z) : faceCentre(p.x, p.z)
      const standY = s.out ? s.stand : Y0 + (i === 2 ? 0.17 : i === 3 ? 0.22 : 0.24)
      this.speakers.push({ pos: new THREE.Vector3(p.x, standY, p.z), yaw, theta: s.theta, r: s.r })
      if (i === 2) {
        // park bench (the speaker stands on the seat)
        this.obstacles.push({ x: p.x, z: p.z, r: 0.5 })
        const bench = makeBench()
        bench.position.set(p.x, Y0, p.z)
        bench.rotation.y = yaw
        batch.add(bench)
      } else if (i === 3) {
        // little round bandstand stage with a railing at the back
        const stage = new THREE.Group()
        const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.22, 28), clay(WOOD))
        deck.position.y = 0.11
        stage.add(deck)
        const trim = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.03, 6, 28).rotateX(Math.PI / 2), clay(C.white))
        trim.position.y = 0.2
        stage.add(trim)
        for (let k = 0; k < 5; k++) {
          const a = Math.PI + (k - 2) * 0.42
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), clay(C.white))
          post.position.set(Math.sin(a) * 0.58, 0.37, Math.cos(a) * 0.58)
          stage.add(post)
        }
        const rail = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.018, 5, 20, 1.75), clay(C.white))
        rail.rotation.set(Math.PI / 2, 0, Math.PI / 2 + 0.66)
        rail.position.y = 0.52
        stage.add(rail)
        // two potted shrubs either side
        for (const sgn of [-1, 1]) {
          const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.08, 0.16, 10), clay(C.terracotta))
          pot.position.set(sgn * 0.82, 0.08, 0.1)
          stage.add(pot)
          const b = makeBush(40 + sgn, 0.9)
          b.position.set(sgn * 0.82, 0.22, 0.1)
          stage.add(b)
        }
        this.obstacles.push({ x: p.x, z: p.z, r: 0.95 })
        stage.position.set(p.x, Y0, p.z)
        stage.rotation.y = yaw
        batch.add(stage)
      } else if (!s.out) {
        this.obstacles.push({ x: p.x, z: p.z, r: 0.28 })
        batch.add(soapbox(p.x, Y0, p.z, yaw))
      }
    })

    // noticeboard behind voice 8
    {
      const p = pol(135, 4.62)
      this.obstacles.push({ x: p.x, z: p.z, r: 0.5 })
      const g = new THREE.Group()
      for (const sgn of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.95, 0.06), clay(WOOD_DARK))
        leg.position.set(sgn * 0.42, 0.47, 0)
        g.add(leg)
      }
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.55, 0.05), clay(WOOD))
      board.position.y = 0.68
      g.add(board)
      const roof = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.05, 0.22), clay(C.roofInk))
      roof.position.set(0, 0.98, 0.02)
      g.add(roof)
      const notes = [C.white, C.mustard, C.sky, C.white, '#f5b7c5', C.signal]
      notes.forEach((c, k) => {
        const n = new THREE.Mesh(new THREE.BoxGeometry(0.19, k === 5 ? 0.24 : 0.17, 0.012), clay(c, { rough: 0.9 }))
        n.position.set(-0.32 + (k % 3) * 0.31 + (k === 1 ? 0.03 : 0), 0.78 - Math.floor(k / 3) * 0.23, 0.032)
        n.rotation.z = ((k * 37) % 11) / 60 - 0.08
        g.add(n)
      })
      g.position.set(p.x, Y0, p.z)
      g.rotation.y = faceCentre(p.x, p.z)
      batch.add(g)
    }

    // flower cart next to voice 7
    {
      const p = pol(99, 4.55)
      this.obstacles.push({ x: p.x, z: p.z, r: 0.55 })
      const g = new THREE.Group()
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.28, 0.45), clay(C.roofBlue))
      box.position.y = 0.3
      g.add(box)
      for (const sx of [-0.28, 0.28]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14).rotateX(Math.PI / 2), clay(C.ink))
        wheel.position.set(sx, 0.13, 0.25)
        g.add(wheel)
        const w2 = wheel.clone()
        w2.position.z = -0.25
        g.add(w2)
      }
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), clay(WOOD_DARK))
      handle.position.set(0.55, 0.42, 0)
      g.add(handle)
      const rand = rng(99)
      const cols = ['#f5b7c5', C.mustard, C.roofRed, C.white, '#b99be0', '#f7a35c']
      for (let k = 0; k < 16; k++) {
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + rand() * 0.03, 0), clay(cols[k % cols.length]))
        f.position.set(-0.3 + (k % 6) * 0.12 + rand() * 0.04, 0.5 + rand() * 0.08, -0.14 + Math.floor(k / 6) * 0.13)
        g.add(f)
      }
      for (let k = 0; k < 6; k++) {
        const lf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), clay(C.leaf))
        lf.position.set(-0.32 + k * 0.13, 0.46, (k % 2 ? 0.14 : -0.16))
        g.add(lf)
      }
      g.position.set(p.x, Y0, p.z)
      g.rotation.y = faceCentre(p.x, p.z) + Math.PI / 2
      batch.add(g)
      const kp = pol(104, 5.12)
      this.keepers.push({ x: kp.x, z: kp.z, y: 0, yaw: faceCentre(kp.x, kp.z) })
    }
  }

  /* ------------------------------------------------------------ café */

  private buildCafe(batch: StaticBatch) {
    const tables: [number, number][] = [
      [29, 3.3],
      [60, 3.28],
      [80, 3.55],
      [66, 4.32],
    ]
    const cols = [C.mustard, C.roofRed, C.roofBlue, C.mustard]
    const segs = 12
    // umbrella canopy split into coloured + white gores (instanced, they pop open)
    const gores = (odd: boolean) => {
      const g = new THREE.ConeGeometry(0.46, 0.16, segs, 1, true).toNonIndexed()
      const pos = g.attributes.position
      const keep: number[] = []
      const nrm: number[] = []
      g.computeVertexNormals()
      const n = g.attributes.normal
      for (let t = 0; t < pos.count; t += 3) {
        let cx = 0
        let cz = 0
        for (let k = 0; k < 3; k++) {
          cx += pos.getX(t + k)
          cz += pos.getZ(t + k)
        }
        const a = Math.atan2(cx, cz) + Math.PI
        const seg = Math.floor((a / (Math.PI * 2)) * segs) % segs
        if ((seg % 2 === 1) === odd) {
          for (let k = 0; k < 3; k++) {
            keep.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k))
            nrm.push(n.getX(t + k), n.getY(t + k), n.getZ(t + k))
          }
        }
      }
      const out = new THREE.BufferGeometry()
      out.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3))
      out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
      out.translate(0, 0.08, 0)
      return out
    }
    const umA = new THREE.InstancedMesh(gores(false), new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide }), tables.length)
    const umB = new THREE.InstancedMesh(gores(true), clay(C.white, { rough: 0.75 }), tables.length)
    ;(umB.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    for (const u of [umA, umB]) {
      u.castShadow = true
      u.receiveShadow = true
      u.frustumCulled = false
      this.group.add(u)
      this.umbrellas.push(u)
    }
    tables.forEach(([theta, r], i) => {
      const p = pol(theta, r)
      const g = new THREE.Group()
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16), clay(C.white, { rough: 0.5 }))
      top.position.y = 0.22
      g.add(top)
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.22, 8), clay(C.ink))
      leg.position.y = 0.11
      g.add(leg)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6), clay(C.ink))
      pole.position.y = 0.52
      g.add(pole)
      // a cup and a little plate
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.04, 8), clay(C.white, { rough: 0.4 }))
      cup.position.set(0.06, 0.255, 0.03)
      g.add(cup)
      const yaw = faceCentre(p.x, p.z) + i
      // two chairs
      for (const sgn of [-1, 1]) {
        const chair = new THREE.Group()
        const seat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.16), clay(C.roofInk, { rough: 0.6 }))
        seat.position.y = 0.12
        chair.add(seat)
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.02), clay(C.roofInk, { rough: 0.6 }))
        back.position.set(0, 0.2, -0.08)
        chair.add(back)
        for (const lx of [-0.065, 0.065])
          for (const lz of [-0.065, 0.065]) {
            const l = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.12, 0.018), clay(C.roofInk, { rough: 0.6 }))
            l.position.set(lx, 0.06, lz)
            chair.add(l)
          }
        const cx = Math.sin(yaw + (sgn > 0 ? 0 : Math.PI)) * 0.3
        const cz = Math.cos(yaw + (sgn > 0 ? 0 : Math.PI)) * 0.3
        chair.position.set(cx, 0, cz)
        // chair faces the table
        chair.rotation.y = Math.atan2(-cx, -cz)
        g.add(chair)
        this.seats.push({ x: p.x + cx, z: p.z + cz, y: Y0 + 0.11, yaw: Math.atan2(-cx, -cz) })
      }
      g.position.set(p.x, Y0, p.z)
      batch.add(g)
      this.umbrellaBase.push({ p: new THREE.Vector3(p.x, Y0 + 0.74, p.z), delay: i * 0.18 })
      this.obstacles.push({ x: p.x, z: p.z, r: 0.48 })
      this.col.set(cols[i])
      umA.setColorAt(i, this.col)
    })
    if (umA.instanceColor) umA.instanceColor.needsUpdate = true
  }

  /* ------------------------------------------------------------ market */

  private buildMarket(batch: StaticBatch) {
    const stalls: [number, string, string[]][] = [
      [213, C.roofRed, ['#f7a35c', '#f7a35c', '#e2694a', '#9bd06c']],
      [237, C.roofBlue, ['#f2d45c', '#9bd06c', '#e2694a', '#f7a35c']],
    ]
    stalls.forEach(([theta, col, fruit], i) => {
      const p = pol(theta, 4.55)
      this.obstacles.push({ x: p.x, z: p.z, r: 0.6 })
      const g = new THREE.Group()
      const counter = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.36, 0.42), clay(WOOD))
      counter.position.y = 0.18
      g.add(counter)
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.1, 0.44), clay(col))
      front.position.y = 0.3
      g.add(front)
      for (const sx of [-0.44, 0.44]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6), clay(C.white))
        post.position.set(sx, 0.5, -0.24)
        g.add(post)
      }
      const aw = stripes(1.08, 0.62, 6, col, C.white)
      aw.position.set(0, 0.98, -0.02)
      aw.rotation.x = 0.42
      g.add(aw)
      // fruit crates on the counter
      const rand = rng(5 + i)
      for (let c = 0; c < 3; c++) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.24), clay(WOOD_DARK))
        crate.position.set(-0.3 + c * 0.3, 0.395, 0.04)
        g.add(crate)
        for (let k = 0; k < 5; k++) {
          const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), clay(fruit[(c + k) % fruit.length]))
          f.position.set(-0.3 + c * 0.3 + (rand() - 0.5) * 0.16, 0.45, 0.04 + (rand() - 0.5) * 0.14)
          g.add(f)
        }
      }
      g.position.set(p.x, Y0, p.z)
      g.rotation.y = faceCentre(p.x, p.z)
      batch.add(g)
      const kp = pol(theta, 4.95)
      this.keepers.push({ x: kp.x, z: kp.z, y: 0, yaw: faceCentre(kp.x, kp.z) })
    })
  }

  /* ------------------------------------------------------------ trees + garden */

  private buildTrees(batch: StaticBatch) {
    const rand = rng(77)
    const ring = [163, 196, 228, 258, 285, 316, 346, 15, 46, 78, 110, 137]
    ring.forEach((theta, i) => {
      const p = pol(theta + (rand() - 0.5) * 6, 7.35 + (rand() - 0.5) * 0.3)
      const t = makeTree(200 + i, 1.05 + rand() * 0.35)
      t.position.set(p.x, 0, p.z)
      t.rotation.y = rand() * 6
      batch.add(t)
    })
    // a little park behind the bench voice
    const park: [number, number, number][] = [
      [262, 5.45, 1.25],
      [280, 5.7, 1.1],
      [271, 6.55, 1.35],
      [255, 6.3, 1.0],
      [289, 6.6, 1.2],
    ]
    park.forEach(([theta, r, s], i) => {
      const p = pol(theta, r)
      const t = makeTree(300 + i, s)
      t.position.set(p.x, 0, p.z)
      t.rotation.y = i
      batch.add(t)
    })
    // bushes along the plaza edge and the building fronts
    for (let i = 0; i < (this.mobile ? 18 : 30); i++) {
      const theta = rand() * 360
      // keep the spots and streets clear
      const r = 5.2 + rand() * 0.35
      const p = pol(theta, r)
      const b = makeBush(500 + i, 0.8 + rand() * 0.6)
      b.position.x += p.x
      b.position.z += p.z
      batch.add(b, { cast: false, receive: true })
    }
    // flower beds: tiny coloured dots round two trees
    const cols = ['#f5b7c5', C.mustard, C.white, '#b99be0']
    for (let k = 0; k < 24; k++) {
      const theta = 262 + (rand() - 0.5) * 30
      const p = pol(theta, 5.2 + rand() * 0.9)
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 0), clay(cols[k % cols.length]))
      f.position.set(p.x, 0.06, p.z)
      batch.add(f, { cast: false, receive: false })
    }
  }

  /* ------------------------------------------------------------ lamps + bunting */

  private buildLampsAndBunting(batch: StaticBatch) {
    const posts: THREE.Vector3[] = []
    const n = 8
    const H = 1.42
    for (let i = 0; i < n; i++) {
      const theta = 22.5 + i * 45
      const p = pol(theta, PLAZA_R + 0.06)
      const g = new THREE.Group()
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 8), clay(C.ink))
      base.position.y = 0.05
      g.add(base)
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, H, 6), clay(C.ink))
      pole.position.y = H / 2
      g.add(pole)
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 8), clay(C.ink))
      hat.position.y = H + 0.12
      g.add(hat)
      g.position.set(p.x, Y0 - 0.02, p.z)
      batch.add(g, { cast: true, receive: false })
      posts.push(new THREE.Vector3(p.x, Y0 + H + 0.02, p.z))
      // lantern glass (lit with the bunting at dusk)
      this.bulbBase.push({ p: new THREE.Vector3(p.x, Y0 + H + 0.03, p.z), s: 2.4, order: i / n, lamp: true })
    }
    // strings: each post to the next, sagging
    const flagCols = [C.roofRed, C.mustard, C.roofBlue, C.white, C.signal, C.sky, '#f5b7c5']
    const linePts: number[] = []
    const rand = rng(8)
    let fi = 0
    const spacing = 0.23
    const pts: THREE.Vector3[] = []
    for (let i = 0; i < n; i++) {
      const a = posts[i]
      const b = posts[(i + 1) % n]
      const len = a.distanceTo(b)
      const steps = 24
      const sag = 0.36
      const at = (t: number, out: THREE.Vector3) =>
        out.copy(a).lerp(b, t).setY(a.y + (b.y - a.y) * t - Math.sin(Math.PI * t) * sag)
      for (let k = 0; k < steps; k++) {
        const p0 = at(k / steps, new THREE.Vector3())
        const p1 = at((k + 1) / steps, new THREE.Vector3())
        linePts.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
      const count = Math.floor(len / spacing)
      const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize()
      const yaw = Math.atan2(dir.x, dir.z)
      for (let k = 1; k < count; k++) {
        const t = k / count
        const p = at(t, new THREE.Vector3())
        // flag hangs just under the string; bulbs sit between flags
        this.flagBase.push({ p, yaw, tilt: (rand() - 0.5) * 0.1, seed: fi })
        pts.push(p)
        fi++
        const tb = (k + 0.5) / count
        if (k < count - 1) {
          this.bulbBase.push({ p: at(tb, new THREE.Vector3()).setY(at(tb, new THREE.Vector3()).y - 0.03), s: 1, order: (i + tb) / n, lamp: false })
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry()
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3))
    this.strings = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: '#5b524a', transparent: true, opacity: 0.8 }))
    this.group.add(this.strings)

    // triangular flags (instanced, flutter)
    const tri = new THREE.BufferGeometry()
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.075, 0, 0, 0.075, 0, 0, 0, -0.17, 0], 3))
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
    this.flags = new THREE.InstancedMesh(
      tri,
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }),
      this.flagBase.length,
    )
    this.flags.frustumCulled = false
    this.flagBase.forEach((f, i) => {
      // mostly warm colours, a sprinkle of Hark green
      const c = flagCols[(i * 5 + (i >> 2)) % flagCols.length]
      this.col.set(c)
      this.flags.setColorAt(i, this.col)
    })
    this.flags.castShadow = false
    this.group.add(this.flags)

    // bulbs + lanterns (instanced, unlit; HDR colour when lit so they bloom)
    this.bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.03, 8, 6),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      this.bulbBase.length,
    )
    this.bulbs.frustumCulled = false
    this.bulbBase.forEach((b, i) => {
      this.m.compose(b.p, this.q.identity(), this.s.setScalar(b.s))
      this.bulbs.setMatrixAt(i, this.m)
      this.bulbs.setColorAt(i, this.col.set('#e9e1cf'))
    })
    this.group.add(this.bulbs)
  }

  /* ------------------------------------------------------------ balloons */

  private buildBalloons() {
    const p = pol(160, 3.45)
    this.balloonSeller.set(p.x, Y0, p.z)
    this.obstacles.push({ x: p.x, z: p.z, r: 0.2 })
    const cols = [C.roofRed, C.mustard, C.roofBlue, C.signal, '#f5b7c5', C.white]
    const n = 6
    this.balloons = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.1, 14, 10).scale(1, 1.18, 1),
      new THREE.MeshStandardMaterial({ roughness: 0.35 }),
      n,
    )
    this.balloons.castShadow = true
    this.balloons.frustumCulled = false
    const lines: number[] = []
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const bp = new THREE.Vector3(p.x + Math.sin(a) * 0.14, Y0 + 0.95 + (i % 3) * 0.1, p.z + Math.cos(a) * 0.14)
      this.balloonBase.push({ p: bp, seed: i })
      this.balloons.setColorAt(i, this.col.set(cols[i]))
      lines.push(p.x + 0.1, Y0 + 0.3, p.z, bp.x, bp.y - 0.11, bp.z)
    }
    this.group.add(this.balloons)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#6b645c', transparent: true, opacity: 0.7 }))
    ls.name = 'balloonStrings'
    this.group.add(ls)
  }

  /* ------------------------------------------------------------ pigeons + birds */

  private buildWildlife() {
    const rand = rng(64)
    // pigeon: plump body, darker head, tiny orange beak (vertex coloured)
    const parts: THREE.BufferGeometry[] = []
    const body = new THREE.SphereGeometry(0.055, 10, 7)
    body.scale(0.85, 0.8, 1.25)
    body.translate(0, 0.05, 0)
    parts.push(paint(body, 0.66, 0.69, 0.74))
    const head = new THREE.SphereGeometry(0.032, 8, 6)
    head.translate(0, 0.1, 0.06)
    parts.push(paint(head, 0.42, 0.46, 0.52))
    const beak = new THREE.ConeGeometry(0.01, 0.03, 5)
    beak.rotateX(Math.PI / 2)
    beak.translate(0, 0.098, 0.1)
    parts.push(paint(beak, 0.95, 0.62, 0.28))
    const tail = new THREE.BoxGeometry(0.05, 0.012, 0.06)
    tail.rotateX(-0.35)
    tail.translate(0, 0.055, -0.085)
    parts.push(paint(tail, 0.5, 0.53, 0.58))
    const geo = mergeGeometries(parts.map(g => (g.index ? g.toNonIndexed() : g)).map(g => {
      g.deleteAttribute('uv')
      return g
    }))!
    const n = this.mobile ? 6 : 10
    this.pigeons = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), n)
    this.pigeons.frustumCulled = false
    this.pigeons.receiveShadow = true
    // (keeping clear of the fountain speaker's side at 180°)
    for (let i = 0; i < n; i++) this.pigeonBase.push({ a: 0.95 + (i / n) * Math.PI * 1.4 + rand() * 0.3, r: 1.56 + rand() * 0.22, seed: rand() * 100 })
    this.group.add(this.pigeons)

    // a small flock wheeling high over the square
    const nb = this.mobile ? 4 : 6
    const bodyG = new THREE.SphereGeometry(0.06, 8, 6)
    bodyG.scale(0.7, 0.6, 1.6)
    this.birds = new THREE.InstancedMesh(bodyG, clay(C.white, { rough: 0.7 }), nb)
    const wingG = new THREE.BoxGeometry(0.26, 0.012, 0.09)
    wingG.translate(0.13, 0, 0)
    this.wings = new THREE.InstancedMesh(wingG, clay(C.white, { rough: 0.7 }), nb * 2)
    for (const m of [this.birds, this.wings]) {
      m.frustumCulled = false
      this.group.add(m)
    }
    for (let i = 0; i < nb; i++)
      this.birdBase.push({ r: 5.2 + rand() * 2.2, y: 3.4 + rand() * 1.4, speed: 0.16 + rand() * 0.05, phase: (i / nb) * 1.4 + rand() * 0.3, seed: rand() * 10 })
  }

  /* ------------------------------------------------------------ sky */

  private buildSky(batch: StaticBatch) {
    // clouds drifting below and around the island
    const rand = rng(31)
    const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#fff8ee', emissiveIntensity: 0.3 })
    const n = this.mobile ? 6 : 9
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(softCloud(60 + i, this.mobile ? 12 : 16), cloudMat)
      c.scale.setScalar(2.6 + rand() * 2.2)
      c.scale.y *= 0.8
      const a = (i / n) * Math.PI * 2 + rand() * 0.4
      const r = 13 + rand() * 7
      c.position.set(Math.sin(a) * r, -4.5 - rand() * 5 + (i % 3 === 0 ? 2 : 0), Math.cos(a) * r)
      c.rotation.y = rand() * 6
      this.cloudRing.add(c)
    }
    this.group.add(this.cloudRing)

    // distant islets for depth (they blur out under the tilt-shift)
    const islets: [number, number, number, number, number][] = [
      [-23, -6, -17, 2.4, 1],
      [25, -3, -24, 1.8, 2],
      [-17, -9, 21, 2.0, 3],
      [21, -7, 15, 1.5, 4],
    ]
    islets.forEach(([x, y, z, r, seed]) => {
      const g = new THREE.Group()
      const isl = makeIsland({ radius: r, thickness: 0.5, depth: r * 1.6, seed: 40 + seed, wobble: 0.1 })
      g.add(isl)
      const tr = makeTree(90 + seed, 1.2)
      tr.position.set(r * 0.3, 0, -r * 0.2)
      g.add(tr)
      const t2 = makeTree(95 + seed, 0.9)
      t2.position.set(-r * 0.35, 0, r * 0.25)
      g.add(t2)
      if (seed % 2 === 0) {
        const h = makeHouse({ w: 0.9, d: 0.8, h: 0.8, wall: seed === 2 ? WALLS.peach : WALLS.powder, seed })
        h.position.set(-r * 0.15, 0, -r * 0.15)
        g.add(h)
      }
      g.position.set(x, y, z)
      batch.add(g, { cast: false, receive: false })
    })
  }

  /* ------------------------------------------------------------ per frame */

  /**
   * @param t      idle clock (s)
   * @param local  chapter progress (drives the umbrella pop + lamps)
   * @param lamps  0..1 how far along the lamp-lighting sequence is
   * @param ring   active speaker for the green ring (-1 none) and its 0..1 scale
   */
  /** where the green ring sits for speaker k: on the ground round a crate, at the feet otherwise */
  ringFor(k: number, out: THREE.Vector3) {
    const s = this.speakers[k]
    const onProp = k === 2 || k === 3 || k === 4
    out.set(s.pos.x, onProp ? s.pos.y : Y0, s.pos.z)
    return out
  }

  update(t: number, calm: boolean, pop: number, lamps: number, ringAt: THREE.Vector3 | null, ringScale: number) {
    const k = calm ? 0.35 : 1
    const tt = t * k
    // Hark finial turns slowly
    this.finial.rotation.y = tt * 0.45
    // pennant flutter
    this.flagPennant.rotation.y = Math.sin(tt * 2.1) * 0.35 + 0.4
    this.flagPennant.scale.x = 1 + Math.sin(tt * 5.3) * 0.08

    // droplets: beads on parabolic arcs from the upper bowl into the basin
    const beads = this.mobile ? 4 : 5
    const streams = this.dropCount / beads
    for (let s = 0; s < streams; s++) {
      const a = (s / streams) * Math.PI * 2 + 0.2
      const sa = Math.sin(a)
      const ca = Math.cos(a)
      for (let b = 0; b < beads; b++) {
        const ph = (tt * 0.75 + b / beads + s * 0.13) % 1
        const r = 0.54 + ph * 0.46
        const y = 1.06 + 0.3 * ph - 1.06 * ph * ph
        const sc = 1 - ph * 0.35
        this.v.set(sa * r, y, ca * r)
        this.m.compose(this.v, this.q.identity(), this.s.set(sc, sc * 1.25, sc))
        this.drops.setMatrixAt(s * beads + b, this.m)
      }
    }
    this.drops.instanceMatrix.needsUpdate = true

    // ripples
    this.ripples.forEach((r, i) => {
      const ph = (tt * 0.32 + i * 0.5) % 1
      const upper = i === 2
      const sc = upper ? 0.12 + ph * 0.34 : 0.62 + ph * 0.5
      r.scale.set(sc, 1, sc)
      ;(r.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * ph * (upper ? 1.2 : 1.6)
    })

    // bunting flutter
    for (let i = 0; i < this.flagBase.length; i++) {
      const f = this.flagBase[i]
      const sway = calm ? 0.05 * Math.sin(t * 0.6 + f.seed) : Math.sin(t * 3.1 + f.seed * 0.7) * 0.28 + Math.sin(t * 7.3 + f.seed) * 0.08
      this.e.set(sway + f.tilt, f.yaw, 0, 'YXZ')
      this.q.setFromEuler(this.e)
      this.m.compose(f.p, this.q, this.s.setScalar(1))
      this.flags.setMatrixAt(i, this.m)
    }
    this.flags.instanceMatrix.needsUpdate = true

    // umbrellas pop open with a spring
    for (let i = 0; i < this.umbrellaBase.length; i++) {
      const u = this.umbrellaBase[i]
      const x = clamp((pop - u.delay) / 0.45)
      const open = spring(x)
      const squash = 1 + Math.sin(x * Math.PI) * 0.35
      this.m.compose(u.p, this.q.identity(), this.s.set(Math.max(0.001, open), Math.max(0.001, open * squash), Math.max(0.001, open)))
      for (const m of this.umbrellas) m.setMatrixAt(i, this.m)
    }
    for (const m of this.umbrellas) m.instanceMatrix.needsUpdate = true

    // balloons bob on their strings
    for (let i = 0; i < this.balloonBase.length; i++) {
      const b = this.balloonBase[i]
      this.v.copy(b.p)
      this.v.y += Math.sin(tt * 1.3 + b.seed) * 0.03
      this.v.x += Math.sin(tt * 0.9 + b.seed * 2) * 0.02
      this.m.compose(this.v, this.q.identity(), this.s.setScalar(1))
      this.balloons.setMatrixAt(i, this.m)
    }
    this.balloons.instanceMatrix.needsUpdate = true

    // lamps: bulbs flick on one by one around the square
    const lampKey = Math.round(lamps * 400)
    if (lampKey !== this.lastLamp) {
      this.lastLamp = lampKey
      for (let i = 0; i < this.bulbBase.length; i++) {
        const b = this.bulbBase[i]
        const on = smoothstep(b.order * 0.8, b.order * 0.8 + 0.08, lamps)
        const off = b.lamp ? '#f3ecd9' : '#e9e1cf'
        this.col.set(off).lerp(LIT, on)
        if (on > 0) this.col.multiplyScalar(1 + on * (b.lamp ? 2.4 : 1.9))
        this.bulbs.setColorAt(i, this.col)
      }
      if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true
    }

    // clouds drift
    this.cloudRing.rotation.y = tt * 0.006

    // pigeons: shuffle about the fountain, peck, now and then hop
    for (let i = 0; i < this.pigeonBase.length; i++) {
      const pg = this.pigeonBase[i]
      const wander = Math.sin(tt * 0.23 + pg.seed) * 0.35
      const a = pg.a + wander
      const r = pg.r + Math.sin(tt * 0.31 + pg.seed * 2) * 0.08
      const pk = Math.max(0, Math.sin(tt * 3.1 + pg.seed * 5))
      const peck = calm ? 0 : pk * pk * pk * 0.7
      const hopPh = (tt * 0.4 + pg.seed) % 3
      const hop = !calm && hopPh < 0.25 ? Math.sin((hopPh / 0.25) * Math.PI) * 0.06 : 0
      this.v.set(Math.sin(a) * r, Y0 + hop, Math.cos(a) * r)
      // face along the wander, mostly tangential
      this.e.set(peck, a + Math.PI / 2 * Math.sign(Math.cos(tt * 0.23 + pg.seed)) + Math.sin(tt * 0.7 + pg.seed) * 0.4, 0, 'YXZ')
      this.q.setFromEuler(this.e)
      this.m.compose(this.v, this.q, this.s.setScalar(1))
      this.pigeons.setMatrixAt(i, this.m)
    }
    this.pigeons.instanceMatrix.needsUpdate = true

    // birds: a loose flock circling, wings flapping then gliding
    for (let i = 0; i < this.birdBase.length; i++) {
      const b = this.birdBase[i]
      const ang = b.phase + tt * b.speed
      const r = b.r + Math.sin(tt * 0.3 + b.seed) * 0.5
      this.v.set(Math.sin(ang) * r, b.y + Math.sin(tt * 0.5 + b.seed) * 0.25, Math.cos(ang) * r)
      const yaw = ang + Math.PI / 2
      this.e.set(0, yaw, -0.25, 'YXZ')
      this.q.setFromEuler(this.e)
      this.m.compose(this.v, this.q, this.s.setScalar(1))
      this.birds.setMatrixAt(i, this.m)
      const flapOn = calm ? 0.2 : 0.5 + 0.5 * Math.sin(tt * 0.8 + b.seed)
      const flap = Math.sin(tt * 11 + b.seed * 3) * 0.55 * flapOn + 0.12
      for (let w = 0; w < 2; w++) {
        // the left wing is the right one turned round (no mirrored instances)
        if (w === 0) this.e.set(0, yaw, -0.25 + flap, 'YXZ')
        else this.e.set(0, yaw + Math.PI, 0.25 + flap, 'YXZ')
        this.q.setFromEuler(this.e)
        this.m.compose(this.v, this.q, this.s.setScalar(1))
        this.wings.setMatrixAt(i * 2 + w, this.m)
      }
    }
    this.birds.instanceMatrix.needsUpdate = true
    this.wings.instanceMatrix.needsUpdate = true

    // green ring under the active speaker
    const show = ringAt && ringScale > 0.002
    this.ring.visible = this.ringPulse.visible = !!show
    if (show && ringAt) {
      this.ring.position.set(ringAt.x, ringAt.y + 0.012, ringAt.z)
      this.ring.scale.setScalar(ringScale * (1 + Math.sin(t * 3) * 0.04))
      const ph = (t * 0.8) % 1
      this.ringPulse.position.copy(this.ring.position)
      this.ringPulse.scale.setScalar(ringScale * (1 + ph * 1.2))
      ;(this.ringPulse.material as THREE.MeshBasicMaterial).opacity = (1 - ph) * 0.8 * ringScale
    }
  }
}

const LIT = new THREE.Color('#ffc978')

/**
 * A soft, smooth-shaded cloud about 2 units wide (radius ~1): a row of
 * overlapping spheres with a flattened underside.
 */
export function softCloud(seed: number, segs = 18) {
  const rand = rng(seed)
  const parts: THREE.BufferGeometry[] = []
  const n = 5 + Math.floor(rand() * 3)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5
    const r = 0.36 + (1 - Math.abs(t) * 1.4) * 0.3 + rand() * 0.12
    const g = new THREE.SphereGeometry(r, segs, Math.round(segs * 0.7))
    g.translate(t * 1.45 + (rand() - 0.5) * 0.12, r * 0.45 + rand() * 0.12, (rand() - 0.5) * 0.4)
    parts.push(g)
  }
  const geo = mergeGeometries(parts)!
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.02) pos.setY(i, 0.02 + (pos.getY(i) - 0.02) * 0.25)
  pos.needsUpdate = true
  geo.computeBoundingSphere()
  return geo
}

/** springy 0→1 with overshoot (umbrellas, pops) */
export function spring(x: number) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return 1 - Math.cos(x * Math.PI * 2.2) * Math.exp(-x * 5.2) * (1 - x * 0.2)
}

/** striped awning: alternating coloured / white slats (for batching) */
function stripes(w: number, d: number, n: number, a: string, b: string) {
  const g = new THREE.Group()
  const sw = w / n
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(sw + 0.002, 0.03, d), clay(i % 2 ? b : a, { rough: 0.8 }))
    s.position.x = -w / 2 + sw * (i + 0.5)
    g.add(s)
    // scalloped front edge
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(sw / 2, sw / 2, 0.03, 10, 1, false, 0, Math.PI), clay(i % 2 ? b : a, { rough: 0.8 }))
    sc.rotation.y = -Math.PI / 2
    sc.position.set(-w / 2 + sw * (i + 0.5), 0, d / 2)
    g.add(sc)
  }
  return g
}

function soapbox(x: number, y: number, z: number, yaw: number) {
  const g = new THREE.Group()
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.24, 0.32), clay(WOOD))
  box.position.y = 0.12
  g.add(box)
  for (const yy of [0.06, 0.18]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.018, 0.33), clay(WOOD_DARK))
    slat.position.y = yy
    g.add(slat)
  }
  // a Hark-green stencil stripe on the front
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.01), clay(C.signal, { rough: 0.6 }))
  band.position.set(0, 0.12, 0.162)
  g.add(band)
  g.position.set(x, y, z)
  g.rotation.y = yaw
  return g
}

function makeBench() {
  const g = new THREE.Group()
  const wood = clay(WOOD)
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.025, 0.07), wood)
    slat.position.set(0, 0.16, -0.08 + i * 0.08)
    g.add(slat)
  }
  for (let i = 0; i < 2; i++) {
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.025), wood)
    back.position.set(0, 0.26 + i * 0.09, -0.15)
    g.add(back)
  }
  for (const sx of [-0.38, 0.38]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.24), clay(C.ink))
    leg.position.set(sx, 0.08, -0.03)
    g.add(leg)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), clay(C.ink))
    arm.position.set(sx, 0.26, -0.15)
    g.add(arm)
  }
  return g
}

/**
 * The plaza's cobbles, drawn once into a canvas: concentric rings of rounded
 * setts around the fountain, eight darker spokes pointing at the eight voices'
 * spots, and a soft worn patch where the crowd walks.
 */
function cobbleTexture(size: number) {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  const S = size
  const k = S / (2 * PLAZA_R)
  const cx = S / 2
  const rand = rng(12)
  g.fillStyle = '#cdbb9b'
  g.fillRect(0, 0, S, S)
  const stone = (r: number) => {
    const base = [236, 224, 202]
    const d = (rand() - 0.5) * 18
    return `rgb(${Math.round(base[0] + d + r * 4)},${Math.round(base[1] + d + r * 2)},${Math.round(base[2] + d)})`
  }
  const spokeAngles = SPOTS.map(s => THREE.MathUtils.degToRad(s.theta))
  const inSpoke = (a: number, rr: number) => {
    if (rr < 1.55 || rr > 3.75) return false
    for (const sa of spokeAngles) {
      let d = Math.abs(a - sa)
      d = Math.min(d, Math.PI * 2 - d)
      if (d * rr < 0.13) return true
    }
    return false
  }
  // concentric setts
  const sett = 0.2
  for (let rr = 1.36; rr < PLAZA_R + 0.1; rr += sett) {
    const n = Math.max(8, Math.round((Math.PI * 2 * rr) / (sett * 1.15)))
    const off = rand() * Math.PI * 2
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2
      const x = cx + Math.sin(a) * rr * k
      const y = cx + Math.cos(a) * rr * k
      const ring = rr < 1.6 || (rr > 3.78 && rr < 3.98)
      const spoke = inSpoke(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), rr)
      g.fillStyle = ring ? `rgb(${200 + Math.round(rand() * 14)},${178 + Math.round(rand() * 12)},${146})` : spoke ? `rgb(${214 + Math.round(rand() * 10)},${196 + Math.round(rand() * 8)},${164})` : stone(rr / PLAZA_R)
      g.save()
      g.translate(x, y)
      g.rotate(-a)
      g.beginPath()
      g.ellipse(0, 0, (sett * 1.15 * rr * k * 0.44) / rr, sett * k * 0.42, 0, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
  }
  // soft wear where the crowd walks
  const grd = g.createRadialGradient(cx, cx, 1.8 * k, cx, cx, 3.2 * k)
  grd.addColorStop(0, 'rgba(255,248,232,0)')
  grd.addColorStop(0.5, 'rgba(255,248,232,0.14)')
  grd.addColorStop(1, 'rgba(255,248,232,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.generateMipmaps = true
  return tex
}
