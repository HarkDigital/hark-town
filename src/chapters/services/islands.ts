import * as THREE from 'three'
import { rng } from '../../core/math'
import { C, clayVC } from '../../kit/palette'
import { paint } from '../../kit/geo'
import { makeBench, makeIsland } from '../../kit/props'
import { treeGeometry, bushGeometry, rockGeometry, tuftGeometry, type TreeKind } from '../../kit/nature'
import { PopBuilder, popDepthMaterial, popMaterial, popScale, popUniforms, type PopUniforms } from './bake'
import { CELL } from './atlas'
import { K, SHOPS, type Actor, type Puffs, type ShopKit } from './workshops'
import { angDiff, laneArcs, onLane, type IslandDef } from './layout'
import { stripGeo } from './shapes'

/*
 * One workshop island, assembled: the kit's floating island, a sandy lane
 * round the front (bridge to bridge, past the stop where the Hark van
 * parks), the workshop diorama, a green number signpost, two LED lamps and
 * seeded trees, bushes, rocks and flowers — all merged into ONE popping
 * mesh. Moving parts sit in wrappers that pop with the same spring.
 */

export interface Part {
  wrap: THREE.Group
  o: THREE.Object3D
  delay: number
  pivot: [number, number] | null
}

export interface IslandRT {
  def: IslandDef
  group: THREE.Group
  mesh: THREE.Mesh
  u: PopUniforms
  parts: Part[]
  ticks: ((t: number) => void)[]
  actors: Actor[]
  /** outline radius at a local angle */
  rimAt: (a: number) => number
  /** frame.time of the last poke / hello */
  poke: number
  /** current build value (0..1.8) */
  build: number
  /** true while the island is near the camera (ticks run) */
  awake: boolean
}

const _s = new THREE.Vector3()
let puffGeo: THREE.BufferGeometry | null = null

function makeShopKit(rt: IslandRT, mobile: boolean, keeps: { x: number; z: number; r: number }[]): ShopKit {
  return {
    R: rt.def.radius,
    mobile,
    part<T extends THREE.Object3D>(o: T, delay: number, pivot?: [number, number]) {
      const wrap = new THREE.Group()
      wrap.add(o)
      rt.group.add(wrap)
      rt.parts.push({ wrap, o, delay, pivot: pivot ?? null })
      return o
    },
    tick(fn) {
      rt.ticks.push(fn)
    },
    actor(a) {
      if (!mobile || rt.actors.length < 2) rt.actors.push(a)
    },
    keep(x, z, r) {
      keeps.push({ x, z, r })
    },
    puffs(x, y, z, o = {}) {
      const n = o.n ?? 4
      puffGeo ??= paint(new THREE.IcosahedronGeometry(1, 1), C.white)
      const mesh = new THREE.InstancedMesh(puffGeo, clayVC({ rough: 1 }), n)
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      const color = new THREE.Color(o.color ?? '#f4f2ee')
      for (let i = 0; i < n; i++) mesh.setColorAt(i, color)
      const out: Puffs = { mesh, strength: 1 }
      const size = o.size ?? 0.14, rise = o.rise ?? 1, period = o.period ?? 4
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
      this.part(mesh, o.delay ?? 0.3, [x, z])
      this.tick(t => {
        for (let i = 0; i < n; i++) {
          const f = (((t / period + i / n) % 1) + 1) % 1
          p.set(x + f * 0.35 + Math.sin(t * 1.3 + i) * 0.03, y + f * rise, z - f * 0.1)
          const k = Math.sin(Math.min(1, f * 1.15) * Math.PI) * size * (0.55 + f * 0.9) * out.strength
          sc.setScalar(Math.max(1e-4, k))
          mesh.setMatrixAt(i, m4.compose(p, q, sc))
        }
        mesh.instanceMatrix.needsUpdate = true
      })
      return out
    },
  }
}

/** a small pile of flower heads (painted, merged) */
function flowers(b: PopBuilder, x: number, z: number, rand: () => number) {
  const cols = [C.blossom, C.white, C.mustard, C.coral, C.lavender]
  const c = cols[Math.floor(rand() * cols.length)]
  for (let i = 0; i < 4; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.1
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r
    b.cyl(0.006, 0.008, 0.1, 3, '#6fae5a', { x: px, z: pz })
    b.sphere(0.034, c, { x: px, y: 0.11, z: pz, sy: 0.75 }, 0)
  }
}

export function buildIsland(def: IslandDef, atlas: THREE.Texture, mobile: boolean): IslandRT {
  const R = def.radius
  const group = new THREE.Group()
  group.position.copy(def.pos)
  group.rotation.y = def.az
  const u = popUniforms()
  const rt: IslandRT = {
    def,
    group,
    mesh: null as unknown as THREE.Mesh,
    u,
    parts: [],
    ticks: [],
    actors: [],
    rimAt: () => R * 0.92,
    poke: -10,
    build: 2,
    awake: true,
  }
  const b = new PopBuilder()
  const keeps: { x: number; z: number; r: number }[] = []

  // ---------------------------------------------------------------- the floating island
  const island = makeIsland({ radius: R, thickness: 0.75, depth: R * 0.95, seed: def.seed, wobble: 0.08, top: def.top, detail: mobile ? 0.6 : 0.85 })
  const data = island.userData as { radiusAt?: (a: number) => number }
  if (typeof data.radiusAt === 'function') rt.rimAt = data.radiusAt
  // grass top height (older kit islands sit a bevel above y = 0)
  island.updateMatrixWorld(true)
  const ray = new THREE.Raycaster(new THREE.Vector3(R * 0.3, 20, R * 0.1), new THREE.Vector3(0, -1, 0))
  const hit = ray.intersectObject(island, true)[0]
  const topY = hit ? hit.point.y : 0
  b.object(island, { y: -topY })

  // ---------------------------------------------------------------- the lane
  const rl = def.lane
  const LW = 0.3
  for (const [s0, s1] of laneArcs(def)) {
    const n = Math.max(2, Math.ceil((Math.abs(s1 - s0) * rl) / 0.1))
    const pts: [number, number][] = []
    for (let i = 0; i <= n; i++) {
      const a = s0 + ((s1 - s0) * i) / n
      pts.push([Math.cos(a) * rl, Math.sin(a) * rl])
    }
    b.add(stripGeo(pts, LW, 0.024), C.path)
  }
  for (const a of [def.aIn, def.aOut]) {
    if (Number.isNaN(a)) continue
    const r1 = rt.rimAt(a) + 0.06
    b.add(stripGeo([[Math.cos(a) * (rl - 0.05), Math.sin(a) * (rl - 0.05)], [Math.cos(a) * r1, Math.sin(a) * r1]], LW, 0.024), C.path)
  }
  // lane ends round off (and mark the stop with a little parking bay)
  b.cyl(LW / 2, LW / 2, 0.012, 16, C.path, { x: Math.cos(def.aStop) * rl, y: 0.014, z: Math.sin(def.aStop) * rl })

  // ---------------------------------------------------------------- the workshop
  const kit = makeShopKit(rt, mobile, keeps)
  const extras: THREE.Object3D[] = []
  SHOPS[def.k](b, kit, extras)
  for (const e of extras) group.add(e)

  // ---------------------------------------------------------------- signpost + LED lamps
  const aSign = Math.PI / 2 + 0.62
  const rs = Math.min(rl + 0.36, rt.rimAt(aSign) - 0.2)
  const sx = Math.cos(aSign) * rs, sz = Math.sin(aSign) * rs
  b.piece(sx, sz, 0.3, () => {
    b.at({ x: sx, z: sz, ry: 0.18 }, () => {
      b.cyl(0.022, 0.028, 0.62, 6, C.wood, {})
      b.rbox(0.42, 0.3, 0.05, 0.03, K.harkDeep, { y: 0.4 })
      b.face(0.36, 0.25, CELL.number(def.k), { y: 0.55, z: 0.027 })
    })
  })
  keeps.push({ x: sx, z: sz, r: 0.3 })
  for (const da of [-0.85, 0.85]) {
    const a = def.aStop + da
    let r = rl + 0.3
    if (r > rt.rimAt(a) - 0.16) r = rl - 0.3
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (keeps.some(k => Math.hypot(k.x - x, k.z - z) < k.r)) continue
    b.piece(x, z, 0.42, () => {
      b.cyl(0.016, 0.022, 0.6, 6, C.ink, { x, z })
      b.rbox(0.09, 0.035, 0.09, 0.014, C.ink, { x, y: 0.62, z })
      b.ledBall(0.038, C.signalBright, { x, y: 0.6, z })
    })
    keeps.push({ x, z, r: 0.2 })
  }

  // ---------------------------------------------------------------- dressing
  const rand = rng(def.seed * 3 + 1)
  // a bench by the lane, facing the view
  for (const da of [1.2, -1.25, 1.75]) {
    const a = def.aStop + da
    const r = rl - 0.34
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (onLane(def, a, 0.1) && Math.abs(r - rl) < 0.3) continue
    if (keeps.some(k => Math.hypot(k.x - x, k.z - z) < k.r + 0.2)) continue
    b.piece(x, z, 0.46, () => b.object(makeBench(), { x, z, ry: Math.PI / 2 - a }))
    keeps.push({ x, z, r: 0.35 })
    break
  }
  const free = (x: number, z: number, pad: number, lanePad = 0.4) => {
    const a = Math.atan2(z, x), r = Math.hypot(x, z)
    if (r > rt.rimAt(a) - 0.28) return false
    if (Math.abs(r - rl) < lanePad && onLane(def, a, 0.3)) return false
    // keep the bridge mouths clear
    for (const e of [def.aIn, def.aOut]) if (!Number.isNaN(e) && Math.abs(angDiff(e, a)) < 0.3 && r > rl - 0.5) return false
    return !keeps.some(k => Math.hypot(k.x - x, k.z - z) < k.r + pad)
  }
  const trees: [number, number][] = []
  const nTrees = mobile ? 3 : 5
  for (let tries = 0; tries < 200 && trees.length < nTrees; tries++) {
    const a = rand() * Math.PI * 2
    // not in front of the workshop (the camera's side)
    if (Math.abs(angDiff(Math.PI / 2, a)) < 0.95) continue
    const r = R * (0.5 + rand() * 0.45)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!free(x, z, 0.3)) continue
    if (trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 0.62)) continue
    trees.push([x, z])
    const kinds: TreeKind[] = ['round', 'cluster', 'pine', 'poplar', 'round', 'blossom']
    const kind = kinds[Math.floor(rand() * kinds.length)]
    b.piece(x, z, 0.28 + trees.length * 0.07, () => b.painted(treeGeometry(def.seed + tries, kind), { x, z, s: 0.58 + rand() * 0.2, ry: rand() * 6.28 }))
    keeps.push({ x, z, r: 0.3 })
  }
  const nBush = mobile ? 3 : 6
  for (let tries = 0, n = 0; tries < 160 && n < nBush; tries++) {
    const a = rand() * Math.PI * 2
    const r = R * (0.35 + rand() * 0.6)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!free(x, z, 0.1)) continue
    n++
    b.piece(x, z, 0.5 + n * 0.04, () => b.painted(bushGeometry(def.seed + tries), { x, z, s: 0.75 + rand() * 0.35, ry: rand() * 6 }))
    keeps.push({ x, z, r: 0.2 })
  }
  for (let tries = 0, n = 0; tries < 80 && n < 2; tries++) {
    const a = rand() * Math.PI * 2
    const r = R * (0.62 + rand() * 0.3)
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!free(x, z, 0.05)) continue
    n++
    b.piece(x, z, 0.55, () => b.painted(rockGeometry(def.seed + n), { x, z, s: 0.45 + rand() * 0.35, ry: rand() * 6 }))
  }
  if (!mobile) {
    for (let tries = 0, n = 0; tries < 120 && n < 5; tries++) {
      const a = rand() * Math.PI * 2
      const r = R * (0.3 + rand() * 0.62)
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (!free(x, z, 0.05, 0.3)) continue
      n++
      b.piece(x, z, 0.6 + n * 0.03, () => flowers(b, x, z, rand))
    }
    for (let tries = 0, n = 0; tries < 120 && n < 9; tries++) {
      const a = rand() * Math.PI * 2
      const r = R * (0.25 + rand() * 0.68)
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      if (!free(x, z, 0.0, 0.25)) continue
      n++
      b.painted(tuftGeometry(), { x, z, s: 0.7 + rand() * 0.5, ry: rand() * 6 })
    }
  }

  // ---------------------------------------------------------------- the one mesh
  const geo = b.build()
  if (geo.boundingSphere) geo.boundingSphere.radius *= 1.15
  const mesh = new THREE.Mesh(geo, popMaterial(atlas, u))
  mesh.customDepthMaterial = popDepthMaterial(u)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = `workshop-${def.k}`
  group.add(mesh)
  rt.mesh = mesh
  return rt
}

/** Apply the island's pop / jiggle to its shader + wrapped parts. */
export function applyBuild(rt: IslandRT, build: number, jig: number) {
  rt.build = build
  rt.u.uBuild.value = build
  rt.u.uJig.value = jig
  for (const p of rt.parts) {
    const pt = build - p.delay
    popScale(pt, _s, pt >= 1 ? jig : 0)
    const w = p.wrap
    const hidden = _s.y < 0.01
    if (w.visible === hidden) w.visible = !hidden
    if (hidden) continue
    const px = p.pivot ? p.pivot[0] : p.o.position.x
    const pz = p.pivot ? p.pivot[1] : p.o.position.z
    w.scale.copy(_s)
    w.position.set(px * (1 - _s.x), 0, pz * (1 - _s.z))
  }
}
