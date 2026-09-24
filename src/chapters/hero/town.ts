import * as THREE from 'three'
import { rng } from '../../core/math'
import { C, CARS, ROOFS, SHIRTS, clayVC, MAT } from '../../kit/palette'
import { Builder, col } from '../../kit/geo'
import { makeIsland } from '../../kit/island'
import { bushGeometry, flowerGeometry, makePond, makeWaterfall, rockGeometry, treeGeometry, type TreeKind } from '../../kit/nature'
import { makeCar, makeHouse, makeLamp, makePerson } from '../../kit/props'
import { SENTINEL, bake, tintClay, withTint } from './bake'
import { PopField, SPRING, Springs, squashOf, type SpringCfg } from './pop'
import { LAMP_R, MILL, PLAZA, POND, R, ROAD_C, ROAD_IN, ROAD_OUT, SPOKES, makePlan, type Spot } from './layout'

/*
 * The HQ island and the town that builds itself around the mark.
 *
 * Pieces pop up by one of three triggers (per instance):
 *   WAVE   when the "listen" wave front (a radius, from scroll) reaches them
 *   INTRO  a time after the loader hands over (nature: rim trees, rocks, flowers)
 *   LOCAL  at an explicit scroll position (road tiles laid in a sweep, cars)
 */

const TAU = Math.PI * 2
const WAVE = 0, INTRO = 1, LOCAL = 2

/** local → radius of the build front */
export function waveFront(local: number) {
  if (local < WAVE_A) return 0
  return 1 + Math.min(1, (local - WAVE_A) / WAVE_LEN) * 6.4
}
/** local at which the front reaches radius r */
export function waveLocal(r: number) {
  return WAVE_A + ((r - 1) / 6.4) * WAVE_LEN
}
const WAVE_A = 0.085
const WAVE_LEN = 0.43

/** road tiles are laid in a sweep once the front reaches the road */
const ROAD_A = waveLocal(ROAD_IN - 0.1)
const ROAD_B = ROAD_A + 0.075
const SWEEP_START = 1.25

class Field extends PopField {
  trig: Uint8Array
  at: Float32Array
  onPop?: (i: number) => void
  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cfg: SpringCfg, shadows: { cast?: boolean; receive?: boolean } = {}) {
    super(geo, mat, n, cfg, shadows)
    this.trig = new Uint8Array(n)
    this.at = new Float32Array(n)
  }
  when(i: number, mode: number, at: number) {
    this.trig[i] = mode
    this.at[i] = at
  }
  aim(front: number, rt: number, local: number, report: boolean) {
    const tg = this.springs.tgt
    for (let i = 0; i < this.n; i++) {
      const m = this.trig[i]
      const v = m === WAVE ? (front >= this.at[i] ? 1 : 0) : m === INTRO ? (rt >= this.at[i] ? 1 : 0) : local >= this.at[i] ? 1 : 0
      if (v > tg[i] && report) this.onPop?.(i)
      tg[i] = v
    }
  }
}

/** geometry that should be instance-tinted where it is (near) white */
function tintWhite(src: THREE.BufferGeometry) {
  const g = src.clone()
  const c = g.attributes.color
  const n = g.attributes.position.count
  const t = new Float32Array(n)
  if (c) for (let i = 0; i < n; i++) if (c.getX(i) > 0.8 && c.getY(i) > 0.8 && c.getZ(i) > 0.8) t[i] = 1
  g.setAttribute('aTint', new THREE.BufferAttribute(t, 1))
  if (!g.attributes.glow) g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n), 1))
  return g
}

/** annular sector slab centred on its own middle (local x = radial) */
function sector(r0: number, r1: number, span: number, h: number, y0: number, rc: number, color: string, b: Builder) {
  const s = new THREE.Shape()
  const seg = 5
  for (let i = 0; i <= seg; i++) {
    const a = -span / 2 + (span * i) / seg
    const p = [Math.cos(a) * r1 - rc, Math.sin(a) * r1]
    if (i === 0) s.moveTo(p[0], p[1])
    else s.lineTo(p[0], p[1])
  }
  for (let i = seg; i >= 0; i--) {
    const a = -span / 2 + (span * i) / seg
    s.lineTo(Math.cos(a) * r0 - rc, Math.sin(a) * r0)
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  g.translate(0, y0, 0)
  b.add(g, color)
}

interface Walker {
  mesh: number
  i: number
  r: number
  a0: number
  /** rad/s along the ring (0 = standing) */
  w: number
  ph: number
  /** standing: face this yaw */
  face: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _sq = { g: 0, xz: 0, y: 0 }
const _c = new THREE.Color()

/** People and cars: pop in, then move along rings (time-driven idle motion). */
class Movers {
  meshes: THREE.InstancedMesh[] = []
  springs: Springs
  list: Walker[] = []
  at: Float32Array
  mode: Uint8Array
  constructor(
    geos: THREE.BufferGeometry[],
    mat: THREE.Material,
    specs: (Omit<Walker, 'mesh' | 'i'> & { color: string; mode: number; at: number })[],
    cfg: SpringCfg,
    private kind: 'person' | 'car',
    private scale: number,
    cast: boolean,
  ) {
    const counts = geos.map(() => 0)
    specs.forEach((s, k) => counts[k % geos.length]++)
    this.meshes = geos.map((g, k) => {
      const im = new THREE.InstancedMesh(g, mat, Math.max(1, counts[k]))
      im.count = counts[k]
      im.frustumCulled = false
      im.castShadow = cast
      im.receiveShadow = true
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      return im
    })
    const idx = geos.map(() => 0)
    specs.forEach((s, k) => {
      const mesh = k % geos.length
      const i = idx[mesh]++
      this.list.push({ mesh, i, r: s.r, a0: s.a0, w: s.w, ph: s.ph, face: s.face })
      this.meshes[mesh].setColorAt(i, _c.set(s.color))
    })
    this.springs = new Springs(specs.length, cfg)
    this.at = new Float32Array(specs.map(s => s.at))
    this.mode = new Uint8Array(specs.map(s => s.mode))
  }

  aim(front: number, local: number) {
    for (let k = 0; k < this.list.length; k++) this.springs.tgt[k] = (this.mode[k] === WAVE ? front : local) >= this.at[k] ? 1 : 0
  }

  /** how many are out and about (for the population sign) */
  out() {
    let n = 0
    for (let k = 0; k < this.list.length; k++) if (this.springs.tgt[k] > 0.5) n++
    return n
  }

  update(time: number, dt: number, motion: number, reduced: boolean) {
    this.springs.step(dt, reduced)
    const t = time * motion
    for (let k = 0; k < this.list.length; k++) {
      const w = this.list[k]
      squashOf(this.springs, k, _sq)
      const a = w.a0 + t * w.w
      const x = Math.cos(a) * w.r, z = Math.sin(a) * w.r
      let yaw: number, bob = 0, roll = 0
      if (this.kind === 'car') {
        // kit cars face +x; drive tangentially
        yaw = w.w >= 0 ? -a - Math.PI / 2 : -a + Math.PI / 2
        bob = Math.sin(t * 14 + w.ph) * 0.004
      } else if (w.w !== 0) {
        // kit people face +z
        yaw = w.w >= 0 ? -a : -a + Math.PI
        const step = t * 9 * motion + w.ph
        bob = Math.abs(Math.sin(step)) * 0.04 * motion
        roll = Math.sin(step) * 0.09 * motion
      } else {
        yaw = w.face + Math.sin(t * 0.7 + w.ph) * 0.25 * motion
        bob = Math.sin(t * 2.2 + w.ph) * 0.006
      }
      _q.setFromEuler(_e.set(0, yaw, roll, 'YXZ'))
      const s = this.scale
      _m.compose(_p.set(x, bob, z), _q, _s.set(s * _sq.xz, s * _sq.y, s * _sq.xz))
      this.meshes[w.mesh].setMatrixAt(w.i, _m)
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true
  }
}

/** Dust puffs when something lands: a little ring of soft balls that swell and vanish. */
class Puffs {
  mesh: THREE.InstancedMesh
  private born: Float32Array
  private pos: Float32Array
  private size: Float32Array
  private next = 0
  constructor(n: number) {
    const g = new Builder().sphere(0.1, C.white, {}, 1).build()
    const mat = clayVC({ rough: 1 }).clone()
    mat.onBeforeCompile = clayVC().onBeforeCompile
    mat.customProgramCacheKey = () => 'kit-vc'
    mat.emissive = new THREE.Color('#ffffff')
    mat.emissiveIntensity = 0.25
    this.mesh = new THREE.InstancedMesh(g, mat, n)
    this.mesh.frustumCulled = false
    this.mesh.castShadow = false
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.born = new Float32Array(n).fill(-99)
    this.pos = new Float32Array(n * 3)
    this.size = new Float32Array(n)
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0))
  }
  spawn(x: number, z: number, radius: number, time: number, count = 6) {
    for (let k = 0; k < count; k++) {
      const i = this.next
      this.next = (this.next + 1) % this.born.length
      const a = (k / count) * TAU + x * 3.1
      this.pos[i * 3] = x + Math.cos(a) * radius
      this.pos[i * 3 + 1] = 0.05
      this.pos[i * 3 + 2] = z + Math.sin(a) * radius
      this.born[i] = time + k * 0.012
      this.size[i] = 0.7 + ((k * 7) % 5) * 0.12
    }
  }
  update(time: number) {
    let any = false
    for (let i = 0; i < this.born.length; i++) {
      const age = (time - this.born[i]) / 0.6
      if (age < 0 || age > 1) {
        if (age > 1 && age < 1.2) this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0))
        continue
      }
      any = true
      const s = Math.sin(age * Math.PI) * this.size[i] * (1 - age * 0.3)
      _p.set(this.pos[i * 3], this.pos[i * 3 + 1] + age * 0.12, this.pos[i * 3 + 2])
      _m.compose(_p, _q.identity(), _s.set(s, s * 0.8, s))
      this.mesh.setMatrixAt(i, _m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    return any
  }
}

export class Town {
  group = new THREE.Group()
  island!: THREE.Group
  private fields: Field[] = []
  private bulbs: { src: Field; mesh: THREE.InstancedMesh }[] = []
  private people!: Movers
  private cars!: Movers
  private plaza!: THREE.Mesh
  private plazaSpring = new Springs(1, SPRING.road)
  private mill = new THREE.Group()
  private millSpring = new Springs(1, SPRING.house)
  private blades!: THREE.Mesh
  private puffs!: Puffs
  private duck!: THREE.Mesh
  /** fields that can be poked (houses, trees, kiosks) */
  pokeable: Field[] = []
  plan!: ReturnType<typeof makePlan>
  private lastTime = -1

  constructor(private mobile: boolean) {}

  /** Build in slices so the loader keeps breathing. */
  async build(yieldFrame: () => Promise<void>) {
    const g = this.group
    const mobile = this.mobile
    // ---- the island
    this.island = makeIsland({ radius: R, seed: 11, wobble: 0.07, depth: R * 1.05, detail: mobile ? 0.7 : 1, hanging: mobile ? 3 : 6 })
    g.add(this.island)
    const contains = this.island.userData.contains as ((x: number, z: number, m?: number) => boolean) | undefined
    const ok = (x: number, z: number, m: number) => (contains ? contains(x, z, m) : Math.hypot(x, z) < R * 0.9 - m)
    await yieldFrame()

    // ---- archetypes
    const tint = tintClay()
    const vc = clayVC()
    const houseDefs: { w: number; d: number; h: number; wall: string; style: 'gable' | 'flat' | 'shed'; seed: number }[] = [
      { w: 1.0, d: 0.9, h: 0.78, wall: C.white, style: 'gable', seed: 2 },
      { w: 0.84, d: 0.84, h: 1.3, wall: C.butter, style: 'gable', seed: 5 },
      { w: 1.25, d: 0.95, h: 0.86, wall: C.cream, style: 'flat', seed: 8 },
      { w: 1.05, d: 0.9, h: 0.98, wall: C.blush, style: 'shed', seed: 3 },
      { w: 0.96, d: 0.9, h: 0.82, wall: C.powder, style: 'gable', seed: 6 },
      { w: 1.1, d: 0.86, h: 1.08, wall: C.mint, style: 'gable', seed: 9 },
    ]
    const houseGeos = houseDefs.map(d => bake(makeHouse({ ...d, roof: SENTINEL })))
    const kinds: TreeKind[] = ['round', 'cluster', 'pine', 'round', 'blossom', 'poplar']
    const treeGeos = kinds.map((k, i) => treeGeometry(i * 3 + 1, k))
    this.plan = makePlan(ok, mobile, houseGeos.length, treeGeos.length)
    const plan = this.plan
    await yieldFrame()

    const rand = rng(404)
    const roofs = ROOFS.filter(c => c !== C.roofInk)

    // houses (per archetype)
    houseGeos.forEach((geo, k) => {
      if (!geo) return
      const spots = plan.houses.filter(h => h.arch === k)
      if (!spots.length) return
      const f = new Field(geo, tint, spots.length, SPRING.house)
      spots.forEach((s, i) => {
        f.set(i, s.x, 0, s.z, s.ry, s.s, s.sy)
        f.color(i, _c.set(roofs[Math.floor(rand() * roofs.length)]))
        f.when(i, WAVE, s.r + (s.j - 0.5) * 0.4)
      })
      this.add(f, true, true)
    })

    // trees: town (wave) + wild (intro) share per-kind fields
    treeGeos.forEach((geo, k) => {
      const town = plan.trees.filter(t => t.arch === k)
      const wild = plan.wildTrees.filter(t => t.arch === k)
      const n = town.length + wild.length
      if (!n) return
      const f = new Field(geo, vc, n, SPRING.tree)
      let i = 0
      for (const s of town) {
        f.set(i, s.x, 0, s.z, s.ry, s.s)
        f.when(i++, WAVE, s.r + 0.15 + s.j * 0.35)
      }
      for (const s of wild) {
        f.set(i, s.x, 0, s.z, s.ry, s.s)
        f.when(i++, INTRO, 0.55 + (s.r / R) * 0.5 + s.j * 0.35)
      }
      this.add(f, true)
    })
    await yieldFrame()

    // bushes (two looks), rocks, flowers
    for (const v of [0, 2]) {
      const spots = plan.bushes.filter((_, i) => (i % 2 === 0) === (v === 0))
      const f = new Field(bushGeometry(v), vc, spots.length, SPRING.small, { cast: false })
      spots.forEach((s, i) => {
        f.set(i, s.x, 0, s.z, s.ry, s.s * 1.1)
        f.when(i, WAVE, s.r + 0.2 + s.j * 0.3)
      })
      this.add(f)
    }
    {
      const f = new Field(rockGeometry(1), vc, plan.rocks.length, SPRING.small, { cast: false })
      plan.rocks.forEach((s, i) => {
        f.set(i, s.x, 0, s.z, s.ry, s.s)
        f.when(i, INTRO, 0.5 + s.j * 0.5)
      })
      this.add(f)
    }
    {
      const fc = [C.white, C.butter, C.blossom, C.lavender, C.coral]
      const f = new Field(tintWhite(flowerGeometry()), tint, plan.flowers.length, SPRING.small, { cast: false })
      plan.flowers.forEach((s, i) => {
        f.set(i, s.x, 0, s.z, s.ry, s.s * 1.25)
        f.color(i, _c.set(fc[i % fc.length]))
        f.when(i, INTRO, 0.6 + (s.r / R) * 0.6 + s.j * 0.4)
      })
      this.add(f)
    }
    await yieldFrame()

    // ---- plaza: concentric paving + kerb (pops as a stamp when the wave starts)
    {
      const b = new Builder()
      const stone = col(C.stone), cream = col(C.cream), sand = col(C.sand)
      b.add(new THREE.CylinderGeometry(PLAZA, PLAZA + 0.04, 0.05, 72, 6), (x, _y, z, out) => {
        const r = Math.hypot(x, z)
        const ring = Math.floor(r * 2.4)
        out.copy(ring % 2 ? stone : cream)
        if (r > PLAZA - 0.12) out.copy(sand)
      }, { y: 0.025 })
      b.add(new THREE.TorusGeometry(PLAZA - 0.02, 0.045, 6, 72), C.kerb, { y: 0.05, rx: Math.PI / 2 })
      this.plaza = new THREE.Mesh(b.build(), vc)
      this.plaza.receiveShadow = true
      g.add(this.plaza)
    }

    // ---- spoke paths: laid outward from the plaza
    {
      const len = ROAD_IN - PLAZA + 0.08
      const b = new Builder()
      b.box(len, 0.03, 0.46, C.path, { x: len / 2, y: 0.015 })
      // stepping-stone edge dots
      for (let k = 0; k < 4; k++) {
        b.box(0.12, 0.032, 0.05, C.kerb, { x: 0.2 + k * 0.34, y: 0.016, z: 0.25 })
        b.box(0.12, 0.032, 0.05, C.kerb, { x: 0.2 + k * 0.34, y: 0.016, z: -0.25 })
      }
      const f = new Field(b.build(), vc, 4, SPRING.road, { cast: false })
      SPOKES.forEach((a, i) => {
        f.set(i, Math.cos(a) * (PLAZA - 0.04), 0, Math.sin(a) * (PLAZA - 0.04), -a)
        f.when(i, WAVE, 2.2 + i * 0.12)
      })
      this.add(f)
    }

    // ---- ring road tiles, laid in a sweep
    {
      const N = mobile ? 28 : 36
      const span = TAU / N
      const b = new Builder()
      sector(ROAD_IN + 0.06, ROAD_OUT - 0.06, span * 1.01, 0.045, 0, ROAD_C, C.road, b)
      sector(ROAD_IN - 0.02, ROAD_IN + 0.07, span * 1.01, 0.075, 0, ROAD_C, C.kerb, b)
      sector(ROAD_OUT - 0.07, ROAD_OUT + 0.02, span * 1.01, 0.075, 0, ROAD_C, C.kerb, b)
      b.box(0.05, 0.012, ROAD_C * span * 0.45, C.roadLine, { y: 0.05 })
      const f = new Field(b.build(), vc, N, SPRING.road, { cast: false })
      for (let i = 0; i < N; i++) {
        const a = (i + 0.5) * span
        f.set(i, Math.cos(a) * ROAD_C, 0, Math.sin(a) * ROAD_C, -a)
        const k = (((a - SWEEP_START) % TAU) + TAU) % TAU / TAU
        f.when(i, LOCAL, ROAD_A + k * (ROAD_B - ROAD_A))
      }
      this.add(f)
    }

    // ---- Hark-green LED lamps along the kerb
    {
      const lamp = makeLamp()
      const pole = bake(lamp, { include: m => m.name !== 'bulb' })
      let bulb = bake(lamp, { include: m => m.name === 'bulb', color: C.signal })
      lamp.updateMatrixWorld(true)
      const top = pole ? pole.boundingBox!.max.y : 0.9
      if (!bulb) bulb = withTint(new Builder().sphere(0.075, C.signal, { y: top }, 1).build())
      if (pole) {
        const f = new Field(pole, vc, plan.lamps.length, SPRING.small, { cast: true })
        plan.lamps.forEach((s, i) => {
          const a = Math.atan2(s.z, s.x)
          f.set(i, s.x, 0, s.z, -a, 0.72)
          const k = (((a - SWEEP_START) % TAU) + TAU) % TAU / TAU
          f.when(i, LOCAL, ROAD_A + k * (ROAD_B - ROAD_A) + 0.012)
        })
        this.add(f)
        const bm = new THREE.InstancedMesh(bulb, MAT.led, plan.lamps.length)
        bm.frustumCulled = false
        bm.castShadow = false
        bm.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        g.add(bm)
        this.bulbs.push({ src: f, mesh: bm })
      }
    }

    // ---- benches + Hark kiosks in the park
    {
      const b = new Builder()
      b.rbox(0.44, 0.045, 0.15, 0.015, C.wood, { y: 0.13 })
      b.rbox(0.44, 0.1, 0.035, 0.012, C.wood, { y: 0.22, z: -0.065, rx: -0.15 })
      for (const x of [-0.17, 0.17]) b.box(0.04, 0.13, 0.13, C.ink, { x, y: 0.065 })
      const f = new Field(b.build(), vc, plan.benches.length, SPRING.small, { cast: false })
      plan.benches.forEach((s, i) => {
        f.set(i, s.x, 0, s.z, s.ry)
        f.when(i, WAVE, 1.6 + i * 0.1)
      })
      this.add(f)
    }
    {
      const b = new Builder()
      const stripe = (x: number, _y: number, _z: number, out: THREE.Color) => out.copy(col(Math.floor((x + 0.4) * 10) % 2 ? C.white : C.signal))
      b.rbox(0.62, 0.44, 0.46, 0.05, C.white, { y: 0.22 })
      b.rbox(0.66, 0.06, 0.5, 0.03, C.signalDeep, { y: 0.47 })
      b.add(new THREE.BoxGeometry(0.7, 0.025, 0.24), stripe, { y: 0.42, z: 0.32, rx: 0.42 })
      b.box(0.5, 0.05, 0.1, C.wood, { y: 0.24, z: 0.26 })
      b.box(0.44, 0.16, 0.02, C.glass, { y: 0.34, z: 0.232 })
      b.rbox(0.3, 0.12, 0.04, 0.02, C.signal, { y: 0.58, z: 0.05 })
      const geo = withTint(b.build())
      const f = new Field(geo, vc, plan.kiosks.length, SPRING.house)
      plan.kiosks.forEach((s, i) => {
        f.set(i, s.x, 0, s.z, s.ry, 1.05)
        f.when(i, WAVE, s.r)
      })
      this.add(f, true, true)
    }
    await yieldFrame()

    // ---- pond + waterfall off the rim (nature)
    {
      const pond = makePond({ radius: 0.72, aspect: 1.45, seed: 6, lilies: true })
      const px = Math.cos(POND.a) * POND.r, pz = Math.sin(POND.a) * POND.r
      pond.position.set(px, 0, pz)
      pond.rotation.y = -POND.a - Math.PI / 2
      g.add(pond)
      const edge = this.island.userData.edge as ((a: number, out?: THREE.Vector3) => THREE.Vector3) | undefined
      if (edge) {
        const e = edge(POND.a)
        const fall = makeWaterfall({ height: 4.5, width: 0.5, seed: 3 })
        fall.position.copy(e)
        fall.rotation.y = Math.PI / 2 - POND.a
        g.add(fall)
      }
      // a duck
      const d = new Builder()
      d.sphere(0.07, C.white, { y: 0.05, sx: 1.3 }, 1)
      d.sphere(0.045, C.white, { x: 0.07, y: 0.12 }, 1)
      d.cone(0.02, 0.05, 5, C.mustard, { x: 0.12, y: 0.115, rz: -Math.PI / 2 })
      this.duck = new THREE.Mesh(d.build(), vc)
      this.duck.position.set(px, 0.03, pz)
      g.add(this.duck)
    }

    // ---- windmill (pops with the wave; sails turn)
    {
      const b = new Builder()
      b.cyl(0.24, 0.38, 1.5, 12, C.cream, { y: 0.75 })
      b.cyl(0.4, 0.42, 0.08, 12, C.stone, { y: 0.04 })
      b.cone(0.36, 0.48, 12, C.roofRed, { y: 1.74 })
      b.box(0.16, 0.28, 0.06, C.woodDark, { y: 0.14, z: 0.36, rx: -0.08 })
      b.box(0.12, 0.12, 0.04, C.glass, { y: 0.92, z: 0.29, rx: -0.09 })
      b.cyl(0.05, 0.05, 0.24, 8, C.woodDark, { y: 1.52, z: 0.26, rx: Math.PI / 2 })
      const tower = new THREE.Mesh(b.build(), vc)
      tower.castShadow = tower.receiveShadow = true
      const s = new Builder()
      s.sphere(0.07, C.woodDark, {}, 1)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU
        s.box(0.035, 0.78, 0.02, C.woodDark, { x: Math.sin(a) * 0.4, y: Math.cos(a) * 0.4, rz: -a })
        s.box(0.15, 0.6, 0.012, C.white, { x: Math.sin(a) * 0.48 + Math.cos(a) * 0.09, y: Math.cos(a) * 0.48 - Math.sin(a) * 0.09, rz: -a, z: 0.012 })
      }
      this.blades = new THREE.Mesh(s.build(), vc)
      this.blades.castShadow = true
      this.blades.position.set(0, 1.52, 0.4)
      this.mill.add(tower, this.blades)
      this.mill.position.set(Math.cos(MILL.a) * MILL.r, 0, Math.sin(MILL.a) * MILL.r)
      this.mill.rotation.y = 1.1
      g.add(this.mill)
    }

    // ---- townsfolk + cars
    {
      const pg = [bake(makePerson(SENTINEL, 1)), bake(makePerson(SENTINEL, 3))].filter((x): x is THREE.BufferGeometry => !!x)
      const specs: ConstructorParameters<typeof Movers>[2] = []
      const shirt = () => SHIRTS[Math.floor(rand() * SHIRTS.length)]
      // plaza: a few admirers + strollers
      for (let i = 0; i < (mobile ? 4 : 6); i++) {
        const stand = i % 2 === 0
        const a = rand() * TAU
        specs.push({ r: stand ? 1.55 + rand() * 0.25 : 1.4 + rand() * 0.2, a0: a, w: stand ? 0 : (rand() < 0.5 ? -1 : 1) * (0.16 + rand() * 0.06), ph: rand() * 9, face: Math.atan2(-Math.cos(a), -Math.sin(a)), color: shirt(), mode: WAVE, at: 1.8 + rand() * 0.8 })
      }
      // inner + outer sidewalks
      for (let i = 0; i < (mobile ? 3 : 5); i++) {
        specs.push({ r: 3.12, a0: rand() * TAU, w: (rand() < 0.5 ? -1 : 1) * (0.09 + rand() * 0.03), ph: rand() * 9, face: 0, color: shirt(), mode: WAVE, at: 3.3 + rand() * 0.8 })
      }
      for (let i = 0; i < (mobile ? 6 : 10); i++) {
        specs.push({ r: 4.5 + rand() * 0.1, a0: rand() * TAU, w: (rand() < 0.5 ? -1 : 1) * (0.06 + rand() * 0.025), ph: rand() * 9, face: 0, color: shirt(), mode: WAVE, at: 4.6 + rand() * 1.8 })
      }
      this.people = new Movers(pg, tint, specs, SPRING.small, 'person', 0.74, !mobile)
      for (const m of this.people.meshes) g.add(m)

      const cg = bake(makeCar(SENTINEL))
      if (cg) {
        const cars: ConstructorParameters<typeof Movers>[2] = []
        const paint = [C.signal, ...CARS]
        const nCars = mobile ? 4 : 6
        for (let i = 0; i < nCars; i++) {
          const inner = i % 2 === 0
          cars.push({
            r: inner ? ROAD_C - 0.19 : ROAD_C + 0.19,
            a0: (i / nCars) * TAU + rand() * 0.3,
            w: inner ? 0.24 : -0.21,
            ph: rand() * 9,
            face: 0,
            color: paint[i % paint.length],
            mode: LOCAL,
            at: ROAD_B + 0.004 + i * 0.011,
          })
        }
        this.cars = new Movers([cg], tint, cars, SPRING.small, 'car', 0.7, true)
        g.add(this.cars.meshes[0])
      }
    }

    // ---- dust puffs
    this.puffs = new Puffs(mobile ? 36 : 60)
    g.add(this.puffs.mesh)
  }

  private add(f: Field, poke = false, home = false) {
    this.fields.push(f)
    this.group.add(f.mesh)
    if (poke) this.pokeable.push(f)
    // houses and kiosks kick up a little dust when they land
    if (home) {
      this.homes.push(f)
      f.onPop = i => {
        const sz = f.mesh.geometry.boundingSphere?.radius ?? 0.5
        this.pendingPuffs.push([f.x[i], f.z[i], Math.min(0.55, sz * 0.55 * f.s[i])])
      }
    }
  }
  private pendingPuffs: [number, number, number][] = []
  private homes: Field[] = []

  /** population for the town sign */
  population() {
    let n = this.people ? this.people.out() : 0
    for (const f of this.homes) for (let i = 0; i < f.n; i++) if (f.springs.tgt[i] > 0.5) n += 3
    return n
  }

  /**
   * @param local  scroll 0..1
   * @param rt     seconds since reveal (-1 before)
   * @param jump   snap springs (a nav jump, first frame)
   */
  update(local: number, rt: number, time: number, dt: number, motion: number, reduced: boolean, jump: boolean) {
    const step = time === this.lastTime ? 0 : dt
    this.lastTime = time
    const front = waveFront(local)
    const report = !jump && step > 0
    for (const f of this.fields) {
      f.aim(front, rt, local, report)
      if (jump) f.springs.snap()
      f.update(step, reduced)
    }
    for (const b of this.bulbs) {
      ;(b.mesh.instanceMatrix.array as Float32Array).set(b.src.mesh.instanceMatrix.array as Float32Array)
      b.mesh.instanceMatrix.needsUpdate = true
    }
    // plaza stamp
    this.plazaSpring.tgt[0] = front >= 1 ? 1 : 0
    if (jump) this.plazaSpring.snap()
    this.plazaSpring.step(step, reduced)
    squashOf(this.plazaSpring, 0, _sq)
    this.plaza.scale.set(Math.max(0.0001, _sq.xz), Math.max(0.0001, _sq.g), Math.max(0.0001, _sq.xz))
    this.plaza.visible = _sq.g > 0.001

    // windmill
    this.millSpring.tgt[0] = front >= MILL.r - 0.3 ? 1 : 0
    if (jump) this.millSpring.snap()
    this.millSpring.step(step, reduced)
    squashOf(this.millSpring, 0, _sq)
    this.mill.scale.set(Math.max(0.0001, _sq.xz), Math.max(0.0001, _sq.y), Math.max(0.0001, _sq.xz))
    this.mill.visible = _sq.g > 0.001
    this.blades.rotation.z = -time * 0.9 * motion

    // movers
    this.people.aim(front, local)
    this.cars?.aim(front, local)
    if (jump) {
      this.people.springs.snap()
      this.cars?.springs.snap()
    }
    this.people.update(time, step, motion, reduced)
    this.cars?.update(time, step, motion, reduced)

    // duck paddles around the pond
    const px = Math.cos(POND.a) * POND.r, pz = Math.sin(POND.a) * POND.r
    const da = time * 0.25 * motion
    this.duck.position.set(px + Math.cos(da) * 0.45, 0.03 + Math.sin(time * 3) * 0.006, pz + Math.sin(da) * 0.3)
    this.duck.rotation.y = -da - Math.PI / 2
    this.duck.visible = rt > 0.9

    // dust
    if (!reduced) for (const [x, z, r] of this.pendingPuffs) this.puffs.spawn(x, z, r, time)
    this.pendingPuffs.length = 0
    this.puffs.update(time)
  }

  /** Poke whatever is under the ray: it squashes and springs back. */
  poke(ray: THREE.Raycaster) {
    let best: { f: Field; i: number; d: number } | null = null
    for (const f of this.pokeable) {
      f.mesh.computeBoundingSphere()
      const hits = ray.intersectObject(f.mesh, false)
      const h = hits[0]
      if (h && h.instanceId != null && (!best || h.distance < best.d)) best = { f, i: h.instanceId, d: h.distance }
    }
    if (best) {
      best.f.springs.kick(best.i, -3.2)
      return true
    }
    return false
  }
}

export { LAMP_R, ROAD_OUT }
export type { Spot }
