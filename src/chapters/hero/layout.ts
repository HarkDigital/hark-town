import { rng } from '../../core/math'

/*
 * The HQ island plan, in island space (x, z; y up; the Hark mark at the
 * origin). Rings outward from the mark:
 *
 *   plaza   0 .. 2.0     paved circle, the mark on its plinth
 *   park    2.0 .. 3.3   green belt: trees, kiosks, benches; 4 spoke paths
 *   road    3.3 .. 4.1   the ring road (cars), Hark-green LED lamps at 4.26
 *   houses  ~5.15        a ring of cottages and shops facing the road
 *   edge    6.0 .. 6.6   trees, rocks, a pond and a windmill (nature, there
 *                        from the start)
 *
 * Every town piece carries `r`, the radius the "listen" wave must reach
 * before it pops up.
 */

export const R = 7.2
export const PLAZA = 2.0
export const ROAD_IN = 3.3
export const ROAD_OUT = 4.1
export const ROAD_C = (ROAD_IN + ROAD_OUT) / 2
export const LAMP_R = 4.27
export const HOUSE_R = 5.15
/** spoke path angles (radians, a = atan2(z, x)) */
export const SPOKES = [0.785, 2.356, 3.927, 5.498]

/** pond + windmill placement: angle a (x = cos a · r, z = sin a · r) */
export const POND = { a: 1.05, r: 5.35, rx: 1.05, rz: 0.72 }
export const MILL = { a: -2.1, r: 5.55 }

export interface Spot {
  x: number
  z: number
  /** yaw */
  ry: number
  /** radius from the mark (wave trigger) */
  r: number
  /** archetype index */
  arch: number
  s: number
  sy: number
  /** small per-item jitter for the stagger */
  j: number
}

export interface Plan {
  houses: Spot[]
  kiosks: Spot[]
  trees: Spot[]
  wildTrees: Spot[]
  bushes: Spot[]
  rocks: Spot[]
  flowers: Spot[]
  lamps: Spot[]
  benches: Spot[]
}

const TAU = Math.PI * 2
const angDist = (a: number, b: number) => {
  const d = Math.abs(((a - b) % TAU + TAU) % TAU)
  return Math.min(d, TAU - d)
}

/**
 * Build the plan. `ok(x, z, margin)` answers whether a footprint of radius
 * `margin` sits fully on the island top (raycast by the caller), so props
 * never hang off the kit's irregular coastline.
 */
export function makePlan(ok: (x: number, z: number, margin: number) => boolean, mobile: boolean, houseArchs: number, treeArchs: number): Plan {
  const rand = rng(1907)
  const spot = (x: number, z: number, ry: number, arch: number, s = 1, sy = 1): Spot => ({
    x,
    z,
    ry,
    r: Math.hypot(x, z),
    arch,
    s,
    sy,
    j: rand(),
  })
  const faceIn = (x: number, z: number) => Math.atan2(-x, -z)
  const taken: { x: number; z: number; r: number }[] = []
  const free = (x: number, z: number, r: number) => taken.every(t => Math.hypot(t.x - x, t.z - z) > t.r + r)
  const claim = (x: number, z: number, r: number) => taken.push({ x, z, r })

  // keep-outs: pond, windmill, plinth, road band handled by radius
  claim(Math.cos(POND.a) * POND.r, Math.sin(POND.a) * POND.r, 1.25)
  claim(Math.cos(MILL.a) * MILL.r, Math.sin(MILL.a) * MILL.r, 0.75)

  const plan: Plan = { houses: [], kiosks: [], trees: [], wildTrees: [], bushes: [], rocks: [], flowers: [], lamps: [], benches: [] }

  // ---- houses: a ring facing the road
  const slots = mobile ? 12 : 15
  for (let i = 0; i < slots; i++) {
    const a = (i / slots) * TAU + 0.12 + (rand() - 0.5) * 0.08
    if (angDist(a, POND.a) < 0.42 || angDist(a, MILL.a) < 0.26) continue
    const r = HOUSE_R + (rand() - 0.5) * 0.25
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!ok(x, z, 0.85) || !free(x, z, 0.62)) continue
    claim(x, z, 0.62)
    const arch = Math.floor(rand() * houseArchs)
    plan.houses.push(spot(x, z, faceIn(x, z) + (rand() - 0.5) * 0.12, arch, 0.92 + rand() * 0.12, 0.9 + rand() * 0.25))
  }

  // ---- park belt: kiosks in two quadrants, trees + benches elsewhere
  for (let q = 0; q < 4; q++) {
    const a = q * (TAU / 4)
    if (q % 2 === 0) {
      const x = Math.cos(a) * 2.72, z = Math.sin(a) * 2.72
      claim(x, z, 0.5)
      plan.kiosks.push(spot(x, z, faceIn(x, z), q / 2, 1, 1))
      // a tree either side
      for (const da of [-0.42, 0.42]) {
        const tx = Math.cos(a + da) * 2.75, tz = Math.sin(a + da) * 2.75
        claim(tx, tz, 0.3)
        plan.trees.push(spot(tx, tz, rand() * TAU, Math.floor(rand() * treeArchs), 0.62 + rand() * 0.12))
      }
    } else {
      for (const [da, rr] of [[-0.36, 2.55], [0.05, 2.95], [0.4, 2.5]] as const) {
        const tx = Math.cos(a + da) * rr, tz = Math.sin(a + da) * rr
        claim(tx, tz, 0.3)
        plan.trees.push(spot(tx, tz, rand() * TAU, Math.floor(rand() * treeArchs), 0.6 + rand() * 0.16))
      }
    }
  }
  // benches just outside the plaza rim, facing the mark
  for (let i = 0; i < 4; i++) {
    const a = SPOKES[i] + 0.42
    const x = Math.cos(a) * 1.72, z = Math.sin(a) * 1.72
    plan.benches.push(spot(x, z, faceIn(x, z) + Math.PI, 0))
  }

  // ---- lamps along the outer kerb
  const lamps = mobile ? 10 : 14
  for (let i = 0; i < lamps; i++) {
    const a = (i / lamps) * TAU + 0.1
    const x = Math.cos(a) * LAMP_R, z = Math.sin(a) * LAMP_R
    plan.lamps.push(spot(x, z, 0, 0))
  }

  // ---- trees between the houses (town trees) and wild trees on the rim
  for (let i = 0; i < 40; i++) {
    const a = rand() * TAU
    const r = 5.55 + rand() * 0.5
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!ok(x, z, 0.55) || !free(x, z, 0.32)) continue
    claim(x, z, 0.32)
    plan.trees.push(spot(x, z, rand() * TAU, Math.floor(rand() * treeArchs), 0.68 + rand() * 0.22))
    if (plan.trees.length > (mobile ? 22 : 30)) break
  }
  const wild = mobile ? 14 : 22
  for (let i = 0; i < 120 && plan.wildTrees.length < wild; i++) {
    const a = rand() * TAU
    const r = 6.05 + rand() * 0.75
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!ok(x, z, 0.42) || !free(x, z, 0.34)) continue
    claim(x, z, 0.34)
    plan.wildTrees.push(spot(x, z, rand() * TAU, Math.floor(rand() * treeArchs), 0.72 + rand() * 0.3))
  }

  // ---- bushes (town: hugging houses and the park) and rocks on the rim
  for (let i = 0; i < 200 && plan.bushes.length < (mobile ? 18 : 30); i++) {
    const inPark = rand() < 0.35
    const a = rand() * TAU
    const r = inPark ? 2.2 + rand() * 0.9 : 4.55 + rand() * 1.9
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (r < 3.3 && SPOKES.some(s => angDist(a, s) * r < 0.34)) continue
    if (!ok(x, z, 0.3) || !free(x, z, 0.16)) continue
    claim(x, z, 0.16)
    plan.bushes.push(spot(x, z, rand() * TAU, 0, 0.55 + rand() * 0.5))
  }
  for (let i = 0; i < 80 && plan.rocks.length < 10; i++) {
    const a = rand() * TAU
    const r = 6.2 + rand() * 0.7
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (!ok(x, z, 0.25) || !free(x, z, 0.2)) continue
    claim(x, z, 0.2)
    plan.rocks.push(spot(x, z, rand() * TAU, 0, 0.6 + rand() * 0.8))
  }

  // ---- flowers: tiny dabs of colour in the grass
  const flowers = mobile ? 90 : 170
  for (let i = 0; i < 900 && plan.flowers.length < flowers; i++) {
    const inPark = rand() < 0.4
    const a = rand() * TAU
    const r = inPark ? 2.12 + rand() * 1.08 : 4.45 + rand() * 2.4
    const x = Math.cos(a) * r, z = Math.sin(a) * r
    if (r < 3.3) {
      let onPath = false
      for (const s of SPOKES) if (angDist(a, s) * r < 0.3) onPath = true
      if (onPath) continue
    }
    if (!ok(x, z, 0.12) || !free(x, z, 0.02)) continue
    plan.flowers.push(spot(x, z, rand() * TAU, Math.floor(rand() * 4), 0.7 + rand() * 0.6))
  }

  return plan
}
