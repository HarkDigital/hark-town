import * as THREE from 'three'
import { C, MAT, clayVC } from '../../kit/palette'
import { Builder, col, paint } from '../../kit/geo'
import { rockGeometry, makePond } from '../../kit/nature'
import { PopBuilder, cellUV, gearGeo, rboxGeo, vcMesh } from './bake'
import { CELL } from './atlas'
import { flagDownGeo, halfCylGeo, pennantGeo, stadium, stripGeo, wedgeGeo } from './shapes'

/*
 * The eleven workshop dioramas. Each builder paints its static pieces into
 * the island's PopBuilder (they pop in the vertex shader) and registers its
 * moving parts, idle ticks and townsfolk on the ShopKit. Island-local frame:
 * grass top at y = 0, +z faces the visiting camera, +x is screen-right.
 * The lane runs round the island at ~0.8 R, so workshops stay inside ~1.7.
 */

export interface ActorPose {
  x: number
  y: number
  z: number
  yaw: number
  /** 0..1 scale (0 = hidden) */
  s: number
}
export interface Actor {
  shirt: string
  pose(t: number, out: ActorPose): void
  seated?: boolean
}

export interface Puffs {
  mesh: THREE.InstancedMesh
  /** 0..1 how much smoke */
  strength: number
}

export interface ShopKit {
  R: number
  mobile: boolean
  /** an animated object; pops with the island after `delay` (scaled about `pivot`, default its own x/z) */
  part<T extends THREE.Object3D>(o: T, delay: number, pivot?: [number, number]): T
  tick(fn: (t: number) => void): void
  actor(a: Actor): void
  keep(x: number, z: number, r: number): void
  puffs(x: number, y: number, z: number, o?: { n?: number; color?: string; size?: number; rise?: number; period?: number; delay?: number }): Puffs
}

export const K = {
  hark: '#00d873',
  harkDeep: C.signalDeep,
  glassLight: '#a9d6ea',
  glassDark: '#3f5866',
  cardboard: '#d2a46c',
  tape: '#efd9a6',
  steel: '#b9c2c8',
  brick: '#c9553b',
  asphalt: '#5f666d',
  orange: '#ff8a3d',
  silver: '#dfe4e8',
  fireRed: '#e0402c',
}

// ------------------------------------------------------------------ actor paths

const _tmp = { x: 0, z: 0, yaw: 0 }

export function pingPong(ax: number, az: number, bx: number, bz: number, speed = 0.35, pause = 1.2, phase = 0, y = 0) {
  const len = Math.hypot(bx - ax, bz - az)
  const walk = len / speed
  const P = 2 * (walk + pause)
  const yawAB = Math.atan2(bx - ax, bz - az)
  return (t: number, o: ActorPose) => {
    const u = (((t + phase * P) % P) + P) % P
    let f: number
    let moving = true
    let yaw = yawAB
    if (u < walk) f = u / walk
    else if (u < walk + pause) {
      f = 1
      moving = false
    } else if (u < 2 * walk + pause) {
      f = 1 - (u - walk - pause) / walk
      yaw = yawAB + Math.PI
    } else {
      f = 0
      moving = false
      yaw = yawAB + Math.PI
    }
    const e = f * f * (3 - 2 * f) * 0.3 + f * 0.7
    o.x = ax + (bx - ax) * e
    o.z = az + (bz - az) * e
    o.y = y + (moving ? Math.abs(Math.sin(t * 9 + phase * 5)) * 0.035 : 0)
    o.yaw = yaw
    o.s = 1
  }
}

export function loopWalk(cx: number, cz: number, r: number, speed = 0.3, phase = 0, y = 0) {
  return (t: number, o: ActorPose) => {
    const a = phase + (t * speed) / r
    o.x = cx + Math.cos(a) * r
    o.z = cz + Math.sin(a) * r
    o.y = y + Math.abs(Math.sin(t * 9 + phase * 3)) * 0.035
    o.yaw = Math.atan2(-Math.sin(a), Math.cos(a))
    o.s = 1
  }
}

export function idle(x: number, z: number, yaw = 0, y = 0, phase = 0) {
  return (t: number, o: ActorPose) => {
    o.x = x
    o.z = z
    o.y = y + Math.max(0, Math.sin(t * 1.6 + phase)) * 0.012
    o.yaw = yaw + Math.sin(t * 0.5 + phase) * 0.3
    o.s = 1
  }
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// ------------------------------------------------------------------ small shared pieces

function windowPane(b: PopBuilder, w: number, h: number, x: number, y: number, z: number, glass = K.glassDark, frame: string = C.white, ry = 0) {
  b.at({ x, y, z, ry }, () => {
    b.rbox(w + 0.06, h + 0.06, 0.03, 0.012, frame, { y: -0.03 })
    b.rbox(w, h, 0.04, 0.01, glass, {})
  })
}

function door(b: PopBuilder, w: number, h: number, x: number, z: number, color: string, ry = 0, y = 0) {
  b.at({ x, y, z, ry }, () => {
    b.rbox(w + 0.06, h + 0.04, 0.03, 0.015, C.white, {})
    b.rbox(w, h, 0.045, 0.02, color, {})
    b.sphere(0.014, C.mustard, { x: w * 0.3, y: h * 0.48, z: 0.03 }, 0)
  })
}

// ------------------------------------------------------------------ 01 Software Development: the gear works

function software(b: PopBuilder, s: ShopKit) {
  const W = 1.9, D = 1.15, H = 0.92, x0 = -0.22, z0 = -0.38
  const zf = z0 + D / 2
  s.keep(x0, z0, 1.2)
  s.keep(1.2, -0.05, 0.6)
  b.piece(x0, z0, 0, () => {
    b.rbox(W + 0.08, 0.14, D + 0.08, 0.04, C.stone, { x: x0, z: z0 })
    b.rbox(W, H, D, 0.06, C.cream, { x: x0, z: z0 })
    const tw = W / 3
    for (let i = 0; i < 3; i++) {
      const cx = x0 - W / 2 + tw * (i + 0.5)
      b.add(wedgeGeo(tw, 0.42, D + 0.06), C.terracotta, { x: cx, y: H - 0.01, z: z0 })
      b.rbox(0.04, 0.32, D - 0.14, 0.01, '#9fd0ea', { x: cx + tw / 2 + 0.01, y: H + 0.04, z: z0 })
    }
    // roller door + awning
    b.rbox(0.52, 0.62, 0.03, 0.02, C.white, { x: x0 + 0.5, z: zf })
    b.rbox(0.46, 0.58, 0.05, 0.015, C.slate, { x: x0 + 0.5, z: zf })
    for (let i = 1; i < 5; i++) b.box(0.44, 0.012, 0.012, '#6b7684', { x: x0 + 0.5, y: i * 0.115, z: zf + 0.03 })
    b.box(0.64, 0.035, 0.24, C.mustard, { x: x0 + 0.5, y: 0.7, z: zf + 0.1, rx: 0.28 })
    windowPane(b, 0.26, 0.24, x0 - 0.62, 0.36, zf + 0.005)
    windowPane(b, 0.26, 0.24, x0 - 0.2, 0.36, zf + 0.005)
    // side opening for the conveyor
    b.rbox(0.04, 0.26, 0.34, 0.01, '#2c3238', { x: x0 + W / 2 + 0.005, y: 0.3, z: -0.05 })
  })
  // chimney
  b.piece(0.42, -0.78, 0.12, () => {
    b.cyl(0.11, 0.14, 1.72, 14, K.brick, { x: 0.42, z: -0.78 })
    b.cyl(0.13, 0.13, 0.07, 14, C.white, { x: 0.42, y: 0.95, z: -0.78 })
    b.cyl(0.125, 0.125, 0.07, 14, C.white, { x: 0.42, y: 1.32, z: -0.78 })
    b.cyl(0.13, 0.12, 0.08, 14, C.ink, { x: 0.42, y: 1.68, z: -0.78 })
  })
  s.puffs(0.42, 1.8, -0.78, { n: 5, color: '#f4f2ee', size: 0.16, rise: 1.2, period: 4.2, delay: 0.3 })
  // conveyor
  b.piece(1.18, -0.05, 0.28, () => {
    b.rbox(0.9, 0.07, 0.3, 0.03, '#39424b', { x: 1.18, y: 0.3, z: -0.05 })
    b.box(0.9, 0.05, 0.03, C.mustard, { x: 1.18, y: 0.35, z: 0.115 })
    b.box(0.9, 0.05, 0.03, C.mustard, { x: 1.18, y: 0.35, z: -0.215 })
    for (const x of [0.82, 1.2, 1.56]) {
      b.box(0.04, 0.3, 0.04, C.ink, { x, y: 0.15, z: 0.08 })
      b.box(0.04, 0.3, 0.04, C.ink, { x, y: 0.15, z: -0.18 })
    }
    b.cyl(0.045, 0.045, 0.3, 10, K.steel, { x: 1.62, y: 0.29, z: -0.2, rx: Math.PI / 2 })
  })
  // pallet + stack
  b.piece(1.78, 0.12, 0.4, () => {
    b.box(0.42, 0.06, 0.42, C.wood, { x: 1.78, y: 0.03, z: 0.12 })
    b.rbox(0.18, 0.18, 0.18, 0.02, K.cardboard, { x: 1.7, y: 0.06, z: 0.05 })
    b.rbox(0.18, 0.18, 0.18, 0.02, K.cardboard, { x: 1.86, y: 0.06, z: 0.2, ry: 0.3 })
    b.box(0.19, 0.012, 0.04, K.tape, { x: 1.7, y: 0.24, z: 0.05 })
  })

  // gears on the facade: big mustard + small Hark green, meshing
  const big = s.part(vcMesh(bb => {
    bb.add(gearGeo(0.4, 11, 0.09), C.mustard)
    bb.cyl(0.07, 0.07, 0.14, 12, C.ink, { rx: Math.PI / 2 })
  }), 0.3)
  big.position.set(x0 - 0.5, H + 0.06, zf + 0.09)
  const small = s.part(vcMesh(bb => {
    bb.add(gearGeo(0.23, 7, 0.09), K.hark)
    bb.cyl(0.05, 0.05, 0.14, 10, C.ink, { rx: Math.PI / 2 })
  }), 0.36)
  small.position.set(x0 - 0.5 + 0.4 + 0.2, H + 0.36, zf + 0.1)
  s.tick(t => {
    big.rotation.z = t * 0.7
    small.rotation.z = -t * 0.7 * (11 / 7) + 0.2
  })

  // boxes riding the conveyor
  const boxGeo = (() => {
    const bb = new Builder()
    bb.add(rboxGeo(0.16, 0.14, 0.16, 0.02), K.cardboard)
    bb.box(0.165, 0.012, 0.04, K.tape, { y: 0.14 })
    return bb.build()
  })()
  const NB = 5
  const boxes = s.part(new THREE.InstancedMesh(boxGeo, clayVC(), NB), 0.45, [0, 0])
  boxes.castShadow = true
  boxes.receiveShadow = true
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
  s.tick(t => {
    for (let i = 0; i < NB; i++) {
      const f = (((t / 6 + i / NB) % 1) + 1) % 1
      let x = 0.76 + f * 0.95, y = 0.335, rot = 0, k = 1
      if (f < 0.08) k = f / 0.08
      if (f > 0.9) {
        const g = (f - 0.9) / 0.1
        x = 1.71 + g * 0.1
        y = 0.335 + 0.06 * Math.sin(g * Math.PI) - g * 0.1
        rot = g * 0.6
        k = 1 - g
      }
      p.set(x, y, -0.05)
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot)
      sc.setScalar(Math.max(0.001, k))
      boxes.setMatrixAt(i, m4.compose(p, q, sc))
    }
    boxes.instanceMatrix.needsUpdate = true
  })

  s.actor({ shirt: C.roofBlue, pose: pingPong(x0 + 0.5, zf + 0.35, 1.45, 0.42, 0.3, 1.5) })
  s.actor({ shirt: C.mustard, pose: idle(-1.35, 0.35, 0.4) })
}

// ------------------------------------------------------------------ 02 Web Design: the studio with an easel

function webDesign(b: PopBuilder, s: ShopKit) {
  const x0 = -0.38, z0 = -0.5, W = 1.35, D = 1.05, H = 0.92
  const zf = z0 + D / 2
  s.keep(x0, z0, 1.05)
  s.keep(0.72, 0.4, 0.5)
  s.keep(1.25, -0.2, 0.3)
  b.piece(x0, z0, 0, () => {
    b.rbox(W, H, D, 0.06, C.white, { x: x0, z: z0 })
    b.gable(W, 0.58, D + 0.08, C.roofYellow, { x: x0, y: H - 0.01, z: z0 })
    // big studio window + round gable window
    b.at({ x: x0 - 0.2, y: 0.24, z: zf + 0.005 }, () => {
      b.rbox(0.78, 0.56, 0.03, 0.015, C.white, { y: -0.03 })
      b.rbox(0.72, 0.5, 0.04, 0.01, '#8fc4dc', {})
      b.box(0.02, 0.5, 0.05, C.white, { y: 0.25 })
      b.box(0.72, 0.02, 0.05, C.white, { y: 0.25 })
    })
    b.cyl(0.13, 0.13, 0.04, 20, C.white, { x: x0, y: H + 0.12, z: zf + 0.02, rx: Math.PI / 2 })
    b.cyl(0.1, 0.1, 0.05, 20, '#8fc4dc', { x: x0, y: H + 0.12, z: zf + 0.03, rx: Math.PI / 2 })
    door(b, 0.22, 0.44, x0 + 0.47, zf + 0.01, C.coral)
    // paint splats
    b.sphere(0.07, K.hark, { x: x0 + 0.52, y: 0.72, z: zf + 0.02, sz: 0.2 }, 1)
    b.sphere(0.05, C.sky, { x: x0 - 0.58, y: 0.82, z: zf + 0.02, sz: 0.2 }, 1)
    b.sphere(0.04, C.coral, { x: x0 + 0.62, y: 0.2, z: zf + 0.02, sz: 0.2 }, 1)
  })
  // easel
  const ex = 0.72, ez = 0.4, ery = -0.3
  b.piece(ex, ez, 0.22, () => {
    b.at({ x: ex, z: ez, ry: ery }, () => {
      b.box(0.035, 1.02, 0.035, C.wood, { x: -0.2, y: 0.5, z: 0.02, rz: -0.12, rx: -0.1 })
      b.box(0.035, 1.02, 0.035, C.wood, { x: 0.2, y: 0.5, z: 0.02, rz: 0.12, rx: -0.1 })
      b.box(0.03, 0.95, 0.03, C.woodDark, { y: 0.45, z: -0.2, rx: 0.36 })
      b.box(0.6, 0.035, 0.09, C.wood, { y: 0.4, z: 0.05 })
      b.rbox(0.58, 0.44, 0.03, 0.01, C.white, { y: 0.42, z: 0.03, rx: -0.12 })
    })
  })
  // stool with paint pots
  b.piece(1.25, -0.2, 0.34, () => {
    b.cyl(0.13, 0.13, 0.04, 14, C.wood, { x: 1.25, y: 0.28, z: -0.2 })
    b.cyl(0.03, 0.05, 0.28, 8, C.woodDark, { x: 1.25, z: -0.2 })
    const pots = [C.coral, C.sky, C.mustard, K.hark]
    pots.forEach((c, i) => {
      const a = i * 1.57 + 0.4
      b.cyl(0.035, 0.035, 0.07, 10, C.white, { x: 1.25 + Math.cos(a) * 0.07, y: 0.32, z: -0.2 + Math.sin(a) * 0.07 })
      b.cyl(0.03, 0.03, 0.01, 10, c, { x: 1.25 + Math.cos(a) * 0.07, y: 0.39, z: -0.2 + Math.sin(a) * 0.07 })
    })
  })
  // rainbow planter along the studio front
  b.piece(x0 - 0.2, zf + 0.26, 0.45, () => {
    b.rbox(0.9, 0.1, 0.18, 0.03, C.woodDark, { x: x0 - 0.2, z: zf + 0.26 })
    const cols = [C.coral, C.mustard, K.hark, C.sky, C.lavender, C.blossom, C.coral, C.mustard]
    cols.forEach((c, i) => {
      const x = x0 - 0.58 + i * 0.108
      b.cyl(0.006, 0.008, 0.1, 3, '#6fae5a', { x, y: 0.1, z: zf + 0.26 })
      b.sphere(0.04, c, { x, y: 0.2, z: zf + 0.26, sy: 0.8 }, 1)
    })
  })

  // the website being painted on the canvas
  const easel = s.part(new THREE.Group(), 0.3)
  easel.position.set(ex, 0, ez)
  easel.rotation.y = ery
  const canvas = new THREE.Group()
  canvas.position.set(0, 0.64, 0.05)
  canvas.rotation.x = -0.12
  easel.add(canvas)
  const blocks: [number, number, number, number, string][] = [
    // x-left, y, w, h, colour (canvas coords, centre origin)
    [-0.25, 0.155, 0.5, 0.055, K.hark],
    [-0.25, 0.03, 0.27, 0.15, C.mustard],
    [0.05, 0.03, 0.2, 0.15, C.sky],
    [-0.25, -0.085, 0.34, 0.026, C.slate],
    [-0.25, -0.13, 0.25, 0.026, C.slate],
    [0.12, -0.11, 0.13, 0.05, C.coral],
  ]
  const blockGeo = paint(new THREE.BoxGeometry(1, 1, 1), C.white)
  const blockMesh = new THREE.InstancedMesh(blockGeo, clayVC(), blocks.length)
  blockMesh.castShadow = false
  blocks.forEach(([, , , , c], i) => blockMesh.setColorAt(i, new THREE.Color(c)))
  canvas.add(blockMesh)
  const brush = vcMesh(bb => {
    bb.cyl(0.007, 0.009, 0.22, 6, C.woodDark, { y: 0.0 })
    bb.cyl(0.012, 0.006, 0.05, 6, C.ink, { y: -0.13 })
  }, false)
  canvas.add(brush)
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
  s.tick(t => {
    const P = 8, u = ((t % P) + P) % P
    const clear = smooth(7.2, 7.8, u)
    let bx = 0.34, by = -0.05, painting = false
    blocks.forEach(([x, y, w, h], i) => {
      const a = 0.5 + i * 0.95
      const f = smooth(a, a + 0.8, u) * (1 - clear)
      if (u > a && u < a + 0.8) {
        painting = true
        bx = x + w * f
        by = y + Math.sin(u * 22) * h * 0.35
      }
      p.set(x + (w * f) / 2, y, 0.022)
      sc.set(Math.max(0.001, w * f), h, 0.01)
      blockMesh.setMatrixAt(i, m4.compose(p, q, sc))
    })
    blockMesh.instanceMatrix.needsUpdate = true
    brush.position.set(bx + 0.03, by + 0.13, painting ? 0.07 : 0.1)
    brush.rotation.z = painting ? -0.5 + Math.sin(u * 22) * 0.2 : -0.2
  })

  s.actor({ shirt: C.lavender, pose: idle(0.3, 0.72, 0.9) })
  s.actor({ shirt: C.coral, pose: pingPong(-1.1, 0.35, -0.4, 0.48, 0.25, 2.2, 0.3) })
}

// ------------------------------------------------------------------ 03 Ecommerce: the market stall

function ecommerce(b: PopBuilder, s: ShopKit) {
  const sx = 0.25, sz = 0.05
  s.keep(sx, sz, 0.85)
  s.keep(-0.85, -0.85, 0.7)
  s.keep(1.1, -0.65, 0.35)
  s.keep(-1.25, 0.5, 0.25)
  b.piece(sx, sz, 0, () => {
    b.rbox(1.3, 0.42, 0.5, 0.03, C.wood, { x: sx, z: sz })
    b.rbox(1.34, 0.12, 0.52, 0.03, K.hark, { x: sx, y: 0.14, z: sz + 0.002 })
    b.rbox(1.38, 0.05, 0.58, 0.02, C.cream, { x: sx, y: 0.42, z: sz })
    for (const [dx, dz] of [[-0.64, 0.27], [0.64, 0.27], [-0.64, -0.27], [0.64, -0.27]]) b.cyl(0.028, 0.03, 1.18, 8, C.white, { x: sx + dx, z: sz + dz })
    // striped awning, sloping to the front
    const n = 7, sw = 1.44 / n
    for (let i = 0; i < n; i++) b.box(sw + 0.002, 0.035, 0.84, i % 2 ? C.white : C.roofRed, { x: sx - 0.72 + sw * (i + 0.5), y: 1.12, z: sz + 0.02, rx: 0.3 })
    for (let i = 0; i < n; i++) b.sphere(0.1, i % 2 ? C.white : C.roofRed, { x: sx - 0.72 + sw * (i + 0.5), y: 0.97, z: sz + 0.41, sy: 0.7, sz: 0.25 }, 1)
    // produce crates
    const fruit = [C.coral, C.mustard, C.leafLight]
    ;[-0.4, 0.05, 0.5].forEach((dx, i) => {
      b.rbox(0.3, 0.13, 0.22, 0.02, C.woodDark, { x: sx + dx, y: 0.46, z: sz + 0.08 })
      for (let j = 0; j < 6; j++) b.sphere(0.045, fruit[i], { x: sx + dx - 0.09 + (j % 3) * 0.09, y: 0.6, z: sz + 0.03 + Math.floor(j / 3) * 0.09 }, 1)
    })
  })
  // the shop behind
  b.piece(-0.85, -0.85, 0.12, () => {
    b.rbox(0.95, 0.8, 0.78, 0.05, C.blush, { x: -0.85, z: -0.85 })
    b.rbox(1.02, 0.08, 0.85, 0.03, C.roofTeal, { x: -0.85, y: 0.8, z: -0.85 })
    door(b, 0.22, 0.4, -0.72, -0.45, C.roofTeal)
    b.box(0.5, 0.03, 0.22, K.hark, { x: -0.72, y: 0.52, z: -0.36, rx: 0.3 })
    windowPane(b, 0.22, 0.2, -1.08, 0.3, -0.455)
  })
  // parcels ready to ship
  b.piece(1.1, -0.65, 0.3, () => {
    const box = (x: number, y: number, z: number, w: number, ry: number) => {
      b.rbox(w, w * 0.8, w, 0.02, K.cardboard, { x, y, z, ry })
      b.box(w + 0.004, 0.012, 0.04, K.tape, { x, y: y + w * 0.8, z, ry })
    }
    box(1.02, 0, -0.62, 0.26, 0.2)
    box(1.26, 0, -0.72, 0.2, -0.3)
    box(1.1, 0.21, -0.66, 0.18, 0.5)
  })
  // bunting pole + flags
  b.piece(-1.25, 0.5, 0.35, () => {
    b.cyl(0.025, 0.03, 1.2, 8, C.white, { x: -1.25, z: 0.5 })
    b.sphere(0.04, C.mustard, { x: -1.25, y: 1.22, z: 0.5 }, 1)
    const ax = -1.25, az = 0.5, bx = sx - 0.64, bz = sz + 0.27
    const cols = [K.hark, C.mustard, C.coral, C.sky, C.white]
    const nF = 7
    for (let i = 0; i < nF; i++) {
      const f = (i + 0.5) / nF
      const x = ax + (bx - ax) * f, z = az + (bz - az) * f
      const y = 1.16 - Math.sin(f * Math.PI) * 0.16
      b.add(flagDownGeo(0.11, 0.14), cols[i % cols.length], { x, y, z, ry: Math.atan2(bz - az, bx - ax) * -1 })
    }
    for (let i = 0; i < 12; i++) {
      const f0 = i / 12, f1 = (i + 1) / 12
      const x = ax + (bx - ax) * (f0 + f1) / 2, z = az + (bz - az) * (f0 + f1) / 2
      const y = 1.16 - Math.sin(((f0 + f1) / 2) * Math.PI) * 0.16
      b.box(Math.hypot(bx - ax, bz - az) / 12 + 0.01, 0.008, 0.008, C.ink, { x, y, z, ry: -Math.atan2(bz - az, bx - ax) })
    }
  })

  // balloons tied to the front-right post
  const tie = new THREE.Vector3(sx + 0.64, 1.16, sz + 0.27)
  const cols = [K.hark, C.mustard, C.coral]
  cols.forEach((c, i) => {
    const L = 0.42 + i * 0.1
    const bl = s.part(vcMesh(bb => {
      bb.cyl(0.004, 0.004, L, 3, C.ink, { y: L / 2 })
      bb.sphere(0.12, c, { y: L + 0.11, sy: 1.18 }, 2)
      bb.cone(0.03, 0.04, 6, c, { y: L - 0.03 })
    }), 0.5 + i * 0.05, [tie.x, tie.z])
    bl.position.copy(tie)
    const ph = i * 2.1
    s.tick(t => {
      bl.rotation.z = -0.25 + (i - 1) * 0.28 + Math.sin(t * 1.1 + ph) * 0.12
      bl.rotation.x = Math.sin(t * 0.8 + ph) * 0.14
    })
  })

  // a coin flips up from the till now and then (cha-ching)
  const coin = s.part(vcMesh(bb => {
    bb.cyl(0.06, 0.06, 0.016, 16, C.mustard, { rx: Math.PI / 2 })
    bb.cyl(0.04, 0.04, 0.02, 16, '#f7cf6a', { rx: Math.PI / 2 })
  }), 0.5)
  s.tick(t => {
    const P = 3.2, u = ((t % P) + P) % P
    const f = u < 0.9 ? u / 0.9 : 0
    coin.visible = u < 0.9
    coin.position.set(sx + 0.05, 0.62 + Math.sin(f * Math.PI) * 0.5, sz - 0.1)
    coin.rotation.y = f * Math.PI * 4
  })

  s.actor({ shirt: C.teal, pose: idle(sx - 0.2, sz - 0.4, Math.PI) })
  s.actor({ shirt: C.roofPink, pose: pingPong(-0.95, 0.8, 0.0, 0.62, 0.28, 1.6) })
  s.actor({ shirt: C.navy, pose: pingPong(1.25, 0.2, 0.75, 0.52, 0.22, 2.4, 0.5) })
}

// ------------------------------------------------------------------ 04 SEO / GEO: the beacon

function seo(b: PopBuilder, s: ShopKit) {
  const tx = -0.35, tz = -0.4, TH = 2.1
  s.keep(tx, tz, 0.75)
  s.keep(0.7, -0.75, 0.55)
  s.keep(0.95, 0.5, 0.35)
  b.piece(tx, tz, 0, () => {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + 0.4
      b.painted(rockGeometry(i + 2), { x: tx + Math.cos(a) * 0.46, z: tz + Math.sin(a) * 0.46, s: 0.75 + (i % 2) * 0.3, ry: a })
    }
    b.cyl(0.28, 0.4, TH, 24, C.white, { x: tx, z: tz })
    for (const [y, h] of [[0.5, 0.2], [1.3, 0.2]]) {
      const r0 = 0.4 - (0.12 * y) / TH, r1 = 0.4 - (0.12 * (y + h)) / TH
      b.cyl(r1 + 0.012, r0 + 0.012, h, 24, '#18c070', { x: tx, y, z: tz })
    }
    b.rbox(0.17, 0.3, 0.05, 0.02, C.woodDark, { x: tx, z: tz + 0.39 })
    b.rbox(0.08, 0.12, 0.04, 0.01, K.glassDark, { x: tx, y: 0.95, z: tz + 0.35 })
    b.rbox(0.08, 0.12, 0.04, 0.01, K.glassDark, { x: tx, y: 1.7, z: tz + 0.31 })
    b.cyl(0.42, 0.4, 0.06, 24, C.ink, { x: tx, y: TH, z: tz })
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      b.cyl(0.008, 0.008, 0.18, 4, C.ink, { x: tx + Math.cos(a) * 0.39, y: TH + 0.06, z: tz + Math.sin(a) * 0.39 })
    }
    b.add(new THREE.TorusGeometry(0.39, 0.012, 4, 32), C.ink, { x: tx, y: TH + 0.24, z: tz, rx: Math.PI / 2 })
    b.cyl(0.21, 0.21, 0.34, 20, '#cfeaf3', { x: tx, y: TH + 0.05, z: tz })
    b.cone(0.28, 0.26, 20, C.ink, { x: tx, y: TH + 0.39, z: tz })
    b.sphere(0.045, C.mustard, { x: tx, y: TH + 0.68, z: tz }, 1)
    b.ledBall(0.13, C.signalBright, { x: tx, y: TH + 0.22, z: tz })
  })
  b.piece(0.7, -0.75, 0.14, () => {
    b.rbox(0.78, 0.55, 0.6, 0.04, C.white, { x: 0.7, z: -0.75 })
    b.gable(0.78, 0.36, 0.66, C.roofRed, { x: 0.7, y: 0.54, z: -0.75 })
    door(b, 0.18, 0.34, 0.85, -0.44, C.navy)
    windowPane(b, 0.16, 0.16, 0.52, 0.26, -0.445)
  })

  // sweeping beam: two soft additive cones from the lamp
  const beamMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color('#9dffc9') } },
    vertexShader: /* glsl */ `
      varying float vT;
      void main() {
        vT = clamp(position.x / 3.4, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vT;
      void main() {
        float a = (1.0 - vT) * (1.0 - vT) * 0.42;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
  })
  const coneGeo = new THREE.ConeGeometry(0.55, 3.4, 20, 1, true)
  coneGeo.translate(0, -1.7, 0)
  coneGeo.rotateZ(Math.PI / 2)
  const beam = s.part(new THREE.Group(), 0.6)
  beam.position.set(tx, TH + 0.22, tz)
  const c1 = new THREE.Mesh(coneGeo, beamMat)
  const c2 = new THREE.Mesh(coneGeo, beamMat)
  c2.rotation.y = Math.PI
  c1.renderOrder = c2.renderOrder = 3
  c1.frustumCulled = c2.frustumCulled = false
  beam.add(c1, c2)
  s.tick(t => {
    beam.rotation.y = t * 0.9
    beam.rotation.z = -0.08
  })

  // the GEO pin, hovering and turning
  const pin = s.part(vcMesh(bb => {
    bb.sphere(0.24, K.hark, { y: 0.0 }, 2)
    bb.cone(0.2, 0.4, 20, K.hark, { y: -0.43, rx: Math.PI })
    bb.cyl(0.095, 0.095, 0.5, 20, C.white, { rx: Math.PI / 2, y: 0 })
  }), 0.45)
  s.tick(t => {
    pin.position.set(0.95, 0.9 + Math.sin(t * 1.8) * 0.07, 0.5)
    pin.rotation.y = t * 0.9
  })

  s.actor({ shirt: C.navy, pose: loopWalk(tx, tz, 0.72, 0.22, 0.6) })
  s.actor({ shirt: C.mustard, pose: idle(0.55, 0.85, 0.3) })
}

// ------------------------------------------------------------------ 05 Page Speed: the speedway

function pageSpeed(b: PopBuilder, s: ShopKit) {
  const LS = 0.72, RT = 0.86, TW = 0.36, cz = -0.12
  s.keep(0, cz, 1.9)
  s.keep(0, -1.62, 0.7)
  const pts: [number, number][] = []
  const tmp = { x: 0, z: 0, yaw: 0 }
  const NS = 84
  const sample = (o: number) => {
    const out: [number, number][] = []
    for (let i = 0; i < NS; i++) {
      stadium(LS, RT, i / NS, o, tmp)
      out.push([tmp.x, tmp.z + cz])
    }
    return out
  }
  pts.push(...sample(0))
  b.piece(0, cz, 0, () => {
    b.add(stripGeo(pts, TW, 0.022, true), K.asphalt)
    b.add(stripGeo(sample(TW / 2 - 0.015), 0.022, 0.026, true), C.white)
    b.add(stripGeo(sample(-TW / 2 + 0.015), 0.022, 0.026, true), C.white)
    // kerbs on the turns (inside)
    for (let i = 0; i < NS; i++) {
      stadium(LS, RT, i / NS, -TW / 2 - 0.035, tmp)
      if (Math.abs(tmp.x) < LS + 0.05) continue
      b.box(0.07, 0.03, 0.05, i % 2 ? C.white : C.roofRed, { x: tmp.x, y: 0.015, z: tmp.z + cz, ry: tmp.yaw })
    }
    // start / finish line
    b.face(0.34, 0.12, CELL.checker, { x: 0.25, y: 0.03, z: cz + RT, rx: -Math.PI / 2, rz: Math.PI / 2 })
    // winners' podium in the infield
    b.rbox(0.2, 0.2, 0.2, 0.03, K.hark, { x: 0, z: cz })
    b.rbox(0.2, 0.13, 0.2, 0.03, C.white, { x: -0.21, z: cz })
    b.rbox(0.2, 0.09, 0.2, 0.03, C.white, { x: 0.21, z: cz })
    b.cyl(0.03, 0.05, 0.05, 10, C.mustard, { x: 0, y: 0.2, z: cz })
    b.cyl(0.08, 0.03, 0.1, 14, C.mustard, { x: 0, y: 0.25, z: cz })
  })
  // grandstand behind the back straight
  b.piece(0, -1.55, 0.12, () => {
    for (let i = 0; i < 3; i++) b.rbox(1.3, 0.12 * (i + 1), 0.18, 0.02, i === 2 ? C.cream : C.white, { x: 0, z: -1.4 - i * 0.17 })
    b.box(1.42, 0.04, 0.62, C.roofRed, { x: 0, y: 0.72, z: -1.58, rx: -0.12 })
    for (const x of [-0.66, 0.66]) b.cyl(0.02, 0.02, 0.72, 6, C.ink, { x, z: -1.8 })
    const fans = [C.coral, C.sky, K.hark, C.mustard, C.lavender, C.roofBlue, C.white, C.roofPink]
    for (let i = 0; i < 12; i++) {
      const row = i % 3, col = Math.floor(i / 3)
      const x = -0.5 + col * 0.33 + (row % 2) * 0.1
      b.sphere(0.05, fans[(i * 3) % fans.length], { x, y: 0.12 * (row + 1) + 0.05, z: -1.4 - row * 0.17, sy: 1.3 }, 1)
      b.sphere(0.04, '#f1c9a5', { x, y: 0.12 * (row + 1) + 0.14, z: -1.4 - row * 0.17 }, 1)
    }
  })
  // start gantry
  const gx = -0.35, gz = cz + RT
  b.piece(gx, gz, 0.25, () => {
    b.cyl(0.02, 0.02, 0.62, 6, C.ink, { x: gx, z: gz + 0.25 })
    b.cyl(0.02, 0.02, 0.62, 6, C.ink, { x: gx, z: gz - 0.25 })
    b.box(0.05, 0.05, 0.56, C.ink, { x: gx, y: 0.6, z: gz })
    b.rbox(0.085, 0.26, 0.07, 0.02, C.ink, { x: gx, y: 0.34, z: gz + 0.03 })
  })
  // tyre stacks
  for (const [x, z] of [[-1.95, cz + 0.45], [1.95, cz - 0.45]] as [number, number][]) {
    b.piece(x, z, 0.35, () => {
      for (let i = 0; i < 3; i++) b.add(new THREE.TorusGeometry(0.07, 0.035, 6, 14), C.ink, { x, y: 0.035 + i * 0.07, z, rx: Math.PI / 2 })
    })
  }
  // lights: red → amber → green
  const lights = ['#ff4b3e', '#ffb020', C.signalBright].map((c, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(c) }))
    m.position.set(gx + 0.04, 0.53 - i * 0.075, gz + 0.03)
    s.part(m, 0.3)
    return m
  })
  const ON = [new THREE.Color('#ff4b3e').multiplyScalar(3), new THREE.Color('#ffb020').multiplyScalar(3), new THREE.Color(C.signalBright).multiplyScalar(3)]
  const OFF = new THREE.Color('#2a2f33')
  // two cars: Hark green on the inside line overtakes the red one
  const car = (paint1: string, stripe: string) =>
    vcMesh(bb => {
      bb.add(rboxGeo(0.34, 0.07, 0.15, 0.03), paint1, { y: 0.03 })
      bb.box(0.06, 0.012, 0.155, stripe, { x: 0.02, y: 0.1 })
      bb.sphere(0.045, C.ink, { x: -0.03, y: 0.1, sy: 0.7 }, 1)
      bb.box(0.04, 0.05, 0.17, paint1, { x: -0.16, y: 0.12 })
      bb.box(0.05, 0.015, 0.2, C.ink, { x: -0.17, y: 0.15 })
      bb.box(0.04, 0.012, 0.18, C.ink, { x: 0.17, y: 0.035 })
      for (const [x, z] of [[0.1, 0.085], [-0.1, 0.085], [0.1, -0.085], [-0.1, -0.085]]) bb.cyl(0.036, 0.036, 0.04, 10, C.ink, { x, y: 0.036, z, rx: Math.PI / 2 })
    })
  const green = s.part(car(K.hark, C.white), 0.5, [0, cz])
  const red = s.part(car(C.roofRed, C.white), 0.55, [0, cz])
  const flag = s.part(new THREE.Group(), 0.4)
  flag.position.set(0.55, 0, cz + RT + 0.34)
  const pole = vcMesh(bb => bb.cyl(0.012, 0.014, 0.7, 6, C.ink, { y: 0.35 }), false)
  flag.add(pole)
  const cloth = new THREE.Mesh(checkerGeo(0.22, 0.15), checkerMaterial())
  cloth.geometry.translate(0.11, 0, 0)
  cloth.position.set(0, 0.62, 0)
  flag.add(cloth)
  const lap = { x: 0, z: 0, yaw: 0 }
  s.tick(t => {
    const u = ((t % 4) + 4) % 4
    const phase = u < 1 ? 0 : u < 2 ? 1 : 2
    lights.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.copy(i === phase ? ON[i] : OFF))
    stadium(LS, RT, t / 2.4, -0.07, lap)
    green.position.set(lap.x, 0.02, lap.z + cz)
    green.rotation.set(0, lap.yaw, Math.abs(lap.x) > LS ? 0.08 : 0)
    stadium(LS, RT, t / 3.3 + 0.3, 0.07, lap)
    red.position.set(lap.x, 0.02, lap.z + cz)
    red.rotation.set(0, lap.yaw, Math.abs(lap.x) > LS ? 0.06 : 0)
    cloth.rotation.y = Math.sin(t * 5) * 0.35 - 0.3
    cloth.scale.x = 1 - Math.abs(Math.sin(t * 5)) * 0.15
  })
  s.actor({ shirt: C.white, pose: idle(0.72, cz + RT + 0.42, -0.4) })
}

let _checker: THREE.MeshStandardMaterial | null = null
let _atlas: THREE.Texture | null = null
export function setAtlas(t: THREE.Texture) {
  _atlas = t
  _checker = null
}
function checkerMaterial() {
  if (!_checker) _checker = new THREE.MeshStandardMaterial({ color: 0xffffff, map: _atlas, roughness: 0.8, side: THREE.DoubleSide })
  return _checker
}
/** a plane whose uvs sample the atlas's chequer cell */
function checkerGeo(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h)
  const [u0, v0, u1, v1] = cellUV(CELL.checker)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * (0.05 + uv.getX(i) * 0.5), v0 + (v1 - v0) * (0.05 + uv.getY(i) * 0.38))
  return g
}

// ------------------------------------------------------------------ 06 AI Consulting: the observatory

function ai(b: PopBuilder, s: ShopKit) {
  const ox = -0.28, oz = -0.4, OR = 0.72, OH = 0.74
  s.keep(ox, oz, 1.0)
  s.keep(0.8, -0.45, 0.55)
  b.piece(ox, oz, 0, () => {
    b.cyl(OR + 0.05, OR + 0.07, 0.1, 32, C.stone, { x: ox, z: oz })
    b.cyl(OR, OR, OH, 32, C.white, { x: ox, z: oz })
    b.cyl(OR + 0.04, OR + 0.04, 0.06, 32, C.stone, { x: ox, y: OH - 0.02, z: oz })
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i - 2) * 0.55
      b.rbox(0.1, 0.16, 0.04, 0.015, K.glassDark, { x: ox + Math.cos(a) * (OR + 0.005), y: 0.42, z: oz + Math.sin(a) * (OR + 0.005), ry: Math.PI / 2 - a })
    }
    door(b, 0.2, 0.36, ox, oz + OR + 0.005, C.navy)
  })
  b.piece(0.8, -0.45, 0.12, () => {
    b.rbox(0.72, 0.5, 0.62, 0.04, C.powder, { x: 0.8, z: -0.45 })
    b.rbox(0.78, 0.06, 0.68, 0.02, C.roofInk, { x: 0.8, y: 0.5, z: -0.45 })
    door(b, 0.18, 0.34, 0.9, -0.135, C.mustard)
    windowPane(b, 0.16, 0.14, 0.66, 0.24, -0.135)
    b.cyl(0.02, 0.02, 0.2, 6, C.ink, { x: 0.9, y: 0.56, z: -0.55 })
  })
  // telescope on a tripod out front (for visitors)
  b.piece(0.62, 0.5, 0.35, () => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2
      b.box(0.018, 0.38, 0.018, C.ink, { x: 0.62 + Math.cos(a) * 0.07, y: 0.18, z: 0.5 + Math.sin(a) * 0.07, rx: Math.sin(a) * 0.35, rz: -Math.cos(a) * 0.35 })
    }
    b.cyl(0.035, 0.028, 0.3, 10, C.mustard, { x: 0.62, y: 0.4, z: 0.5, rz: 1.1, rx: 0.3 })
  })

  // rotating dome with a slit + telescope
  const dome = s.part(new THREE.Group(), 0.2)
  dome.position.set(ox, OH + 0.02, oz)
  const shell = vcMesh(bb => {
    bb.add(new THREE.SphereGeometry(OR - 0.01, 28, 10, 0.28, Math.PI * 2 - 0.56, 0, Math.PI / 2), K.silver)
    bb.add(new THREE.SphereGeometry(OR - 0.06, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#2c3440')
    bb.add(new THREE.TorusGeometry(OR - 0.005, 0.03, 6, 36), C.stone, { rx: Math.PI / 2 })
  })
  dome.add(shell)
  const scope = vcMesh(bb => {
    bb.cyl(0.085, 0.07, 0.86, 14, C.ink, { y: 0.1 })
    bb.cyl(0.095, 0.095, 0.08, 14, C.mustard, { y: 0.78 })
    bb.cyl(0.09, 0.09, 0.02, 14, '#9fd0ea', { y: 0.97 })
  })
  scope.position.set(0, 0.12, 0)
  dome.add(scope)
  // sparkles of "insight" orbiting above
  const NSP = 4
  const spark = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.06, 0), MAT.led, NSP)
  spark.castShadow = false
  spark.frustumCulled = false
  s.part(spark, 0.6, [ox, oz])
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
  const e = new THREE.Euler()
  s.tick(t => {
    dome.rotation.y = t * 0.22
    // SphereGeometry phi = 0 sits at -x: the slit faces -x in dome space
    scope.rotation.set(0, 0, 0.95 + Math.sin(t * 0.4) * 0.12)
    for (let i = 0; i < NSP; i++) {
      const a = t * 0.5 + (i / NSP) * Math.PI * 2
      p.set(ox + Math.cos(a) * 0.95, OH + 1.15 + Math.sin(t * 1.3 + i * 2) * 0.12, oz + Math.sin(a) * 0.95)
      q.setFromEuler(e.set(t * 1.5 + i, t * 2 + i, 0))
      sc.setScalar(0.6 + 0.4 * Math.abs(Math.sin(t * 2.2 + i * 1.7)))
      spark.setMatrixAt(i, m4.compose(p, q, sc))
    }
    spark.instanceMatrix.needsUpdate = true
  })
  s.actor({ shirt: C.lavender, pose: pingPong(ox + 0.1, oz + OR + 0.25, 0.45, 0.4, 0.22, 2.5) })
  s.actor({ shirt: C.roofBlue, pose: idle(0.42, 0.62, 1.2) })
}

// ------------------------------------------------------------------ 07 Aerial Photography & Video: the helipad

function aerial(b: PopBuilder, s: ShopKit) {
  const px = 0.45, pz = 0.12, PR = 0.78
  s.keep(px, pz, PR + 0.12)
  s.keep(-0.85, -0.6, 0.75)
  s.keep(1.45, -0.62, 0.2)
  b.piece(px, pz, 0, () => {
    b.cyl(PR, PR + 0.02, 0.06, 40, C.slate, { x: px, z: pz })
    b.add(new THREE.TorusGeometry(PR * 0.8, 0.022, 4, 48), C.white, { x: px, y: 0.062, z: pz, rx: Math.PI / 2, sz: 0.4 })
    b.box(0.07, 0.012, 0.38, C.white, { x: px - 0.12, y: 0.066, z: pz })
    b.box(0.07, 0.012, 0.38, C.white, { x: px + 0.12, y: 0.066, z: pz })
    b.box(0.2, 0.012, 0.07, C.white, { x: px, y: 0.066, z: pz })
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      b.ledBall(0.024, C.signalBright, { x: px + Math.cos(a) * (PR - 0.05), y: 0.075, z: pz + Math.sin(a) * (PR - 0.05) })
    }
  })
  // quonset hangar
  b.piece(-0.85, -0.6, 0.12, () => {
    b.add(halfCylGeo(0.52, 1.05, 20), K.silver, { x: -0.85, z: -0.6 })
    for (const dz of [-0.35, 0, 0.35]) b.add(new THREE.TorusGeometry(0.525, 0.012, 4, 24, Math.PI), '#c4cbd1', { x: -0.85, z: -0.6 + dz })
    b.add(new THREE.TorusGeometry(0.53, 0.03, 6, 24, Math.PI), K.hark, { x: -0.85, z: -0.6 + 0.5 })
    b.add(halfCylGeo(0.36, 0.02, 16), '#2c3238', { x: -0.85, z: -0.6 + 0.53 })
  })
  // windsock pole + cones
  b.piece(1.45, -0.62, 0.3, () => {
    b.cyl(0.018, 0.022, 1.05, 6, C.white, { x: 1.45, z: -0.62 })
    b.cyl(0.024, 0.024, 0.08, 6, C.roofRed, { x: 1.45, y: 0.98, z: -0.62 })
  })
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2
    const x = px + Math.cos(a) * (PR + 0.14), z = pz + Math.sin(a) * (PR + 0.14)
    b.piece(x, z, 0.4 + i * 0.04, () => {
      b.cone(0.05, 0.14, 10, K.orange, { x, z })
      b.cyl(0.035, 0.04, 0.03, 10, C.white, { x, y: 0.05, z })
    })
  }
  // the drone
  const drone = s.part(new THREE.Group(), 0.45, [px, pz])
  const body = vcMesh(bb => {
    bb.add(rboxGeo(0.24, 0.07, 0.2, 0.03), C.white, { y: -0.035 })
    bb.box(0.5, 0.022, 0.03, C.ink, { ry: Math.PI / 4 })
    bb.box(0.5, 0.022, 0.03, C.ink, { ry: -Math.PI / 4 })
    for (const [x, z] of [[0.177, 0.177], [-0.177, 0.177], [0.177, -0.177], [-0.177, -0.177]]) {
      bb.cyl(0.025, 0.025, 0.05, 10, C.ink, { x, y: 0.0, z })
      bb.box(0.018, 0.08, 0.018, C.ink, { x, y: -0.06, z })
    }
    bb.sphere(0.045, C.ink, { y: -0.08, x: 0.06 }, 1)
    bb.sphere(0.02, '#9fd0ea', { y: -0.085, x: 0.1 }, 1)
  })
  drone.add(body)
  const rotorMat = new THREE.MeshBasicMaterial({ color: '#d9dee3', transparent: true, opacity: 0.45, depthWrite: false })
  const rotorGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.004, 20)
  for (const [x, z] of [[0.177, 0.177], [-0.177, 0.177], [0.177, -0.177], [-0.177, -0.177]]) {
    const r = new THREE.Mesh(rotorGeo, rotorMat)
    r.position.set(x, 0.03, z)
    r.renderOrder = 2
    drone.add(r)
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), MAT.led)
  led.position.set(0.13, 0.0, 0)
  drone.add(led)
  // windsock
  const sock = s.part(vcMesh(bb => {
    const g = new THREE.ConeGeometry(0.075, 0.38, 12, 4, true)
    g.rotateZ(-Math.PI / 2)
    g.translate(0.19, 0, 0)
    bb.add(g, (x, _y, _z, out) => out.copy(col(Math.floor(x / 0.095) % 2 ? C.white : K.orange)))
  }), 0.5)
  sock.position.set(1.45, 0.96, -0.62)
  s.tick(t => {
    const a = t * 0.42
    const r = 0.62
    drone.position.set(px + Math.cos(a) * r, 1.35 + Math.sin(t * 1.7) * 0.08, pz + Math.sin(a) * r * 0.8)
    drone.rotation.set(Math.sin(t * 1.1) * 0.06, -a - Math.PI / 2, -0.12)
    sock.rotation.set(0, 0.5 + Math.sin(t * 1.3) * 0.25, -0.18 - Math.sin(t * 2.1) * 0.08)
  })
  s.actor({ shirt: C.mustard, pose: idle(-0.3, 0.85, 0.6) })
  s.actor({ shirt: C.teal, pose: pingPong(-0.85, -0.02, -0.2, 0.5, 0.2, 2.8, 0.2) })
}

// ------------------------------------------------------------------ 08 Hack Remediation: the fire station

function hack(b: PopBuilder, s: ShopKit) {
  const x0 = -0.3, z0 = -0.48, W = 1.55, D = 0.98, H = 1.0
  const zf = z0 + D / 2
  s.keep(x0, z0, 1.0)
  s.keep(0.68, -0.8, 0.35)
  s.keep(0.2, 0.52, 0.5)
  s.keep(-1.2, 0.55, 0.3)
  b.piece(x0, z0, 0, () => {
    b.rbox(W, H, D, 0.05, K.brick, { x: x0, z: z0 })
    b.rbox(W + 0.06, 0.1, D + 0.06, 0.03, C.cream, { x: x0, y: H, z: z0 })
    b.box(W - 0.2, 0.12, 0.02, C.cream, { x: x0, y: 0.8, z: zf + 0.005 })
    for (const [dx, open] of [[-0.36, false], [0.3, true]] as [number, boolean][]) {
      b.rbox(0.56, 0.68, 0.03, 0.02, C.cream, { x: x0 + dx, z: zf })
      b.rbox(0.48, 0.62, 0.05, 0.015, open ? '#2a2e33' : C.white, { x: x0 + dx, z: zf })
      if (!open) for (let i = 1; i < 5; i++) b.box(0.46, 0.012, 0.012, C.stone, { x: x0 + dx, y: i * 0.12, z: zf + 0.03 })
    }
    b.ledBall(0.03, '#ff4b3e', { x: x0, y: 0.8, z: zf + 0.03 })
    // roof: siren, vents, a hatch
    b.cyl(0.07, 0.08, 0.08, 12, C.slate, { x: x0 - 0.35, y: H + 0.1, z: z0 + 0.1 })
    b.ledBall(0.06, '#ff5a48', { x: x0 - 0.35, y: H + 0.22, z: z0 + 0.1 })
    b.rbox(0.3, 0.16, 0.24, 0.03, K.steel, { x: x0 + 0.35, y: H + 0.1, z: z0 - 0.15 })
    for (let i = 0; i < 3; i++) b.box(0.26, 0.012, 0.012, '#8a949c', { x: x0 + 0.35, y: H + 0.14 + i * 0.04, z: z0 - 0.02 })
    b.rbox(0.22, 0.05, 0.22, 0.02, C.stone, { x: x0 - 0.05, y: H + 0.1, z: z0 - 0.2 })
  })
  b.piece(0.68, -0.8, 0.1, () => {
    b.rbox(0.42, 1.72, 0.42, 0.04, K.brick, { x: 0.68, z: -0.8 })
    b.rbox(0.18, 0.26, 0.03, 0.06, '#2a2e33', { x: 0.68, y: 1.28, z: -0.58 })
    b.sphere(0.07, C.mustard, { x: 0.68, y: 1.36, z: -0.6, sy: 1.1 }, 1)
    b.cone(0.36, 0.32, 4, C.roofInk, { x: 0.68, y: 1.72, z: -0.8, ry: Math.PI / 4 })
  })
  b.piece(1.05, 0.5, 0.42, () => {
    b.cyl(0.055, 0.065, 0.2, 10, C.alert, { x: 1.05, z: 0.5 })
    b.sphere(0.058, C.alert, { x: 1.05, y: 0.2, z: 0.5, sy: 0.8 }, 1)
    b.cyl(0.025, 0.025, 0.16, 8, C.alert, { x: 1.05, y: 0.12, z: 0.5, rz: Math.PI / 2 })
  })
  // the compromised server cabinet
  const cx = -1.2, cz = 0.55
  b.piece(cx, cz, 0.34, () => {
    b.rbox(0.3, 0.06, 0.26, 0.02, C.stone, { x: cx, z: cz })
    b.rbox(0.26, 0.46, 0.22, 0.025, C.slate, { x: cx, y: 0.06, z: cz })
    for (let i = 0; i < 4; i++) b.box(0.18, 0.012, 0.01, '#6b7684', { x: cx, y: 0.14 + i * 0.07, z: cz + 0.112 })
  })
  const status = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4b3e' }))
  status.position.set(cx + 0.08, 0.46, cz + 0.115)
  s.part(status, 0.4)
  const smoke = s.puffs(cx, 0.55, cz, { n: 4, color: '#8c9096', size: 0.14, rise: 0.9, period: 2.2, delay: 0.4 })

  // fire truck, facing -x toward the cabinet
  const truck = s.part(new THREE.Group(), 0.3)
  truck.position.set(0.22, 0, 0.52)
  truck.add(
    vcMesh(bb => {
      bb.add(rboxGeo(0.62, 0.2, 0.26, 0.04), K.fireRed, { y: 0.07 })
      bb.add(rboxGeo(0.2, 0.17, 0.26, 0.04), K.fireRed, { x: -0.3, y: 0.2 })
      bb.box(0.02, 0.1, 0.22, '#9fd0ea', { x: -0.4, y: 0.29 })
      bb.box(0.625, 0.03, 0.265, C.white, { y: 0.19 })
      bb.box(0.46, 0.035, 0.2, K.steel, { x: 0.08, y: 0.28 })
      for (const [x, z] of [[0.2, 0.13], [-0.22, 0.13], [0.2, -0.13], [-0.22, -0.13]]) bb.cyl(0.06, 0.06, 0.05, 12, C.ink, { x, y: 0.06, z, rx: Math.PI / 2 })
      bb.box(0.04, 0.03, 0.2, C.mustard, { x: -0.42, y: 0.1 })
    }),
  )
  const ladder = vcMesh(bb => {
    bb.box(0.6, 0.02, 0.02, C.white, { x: -0.3, z: 0.07 })
    bb.box(0.6, 0.02, 0.02, C.white, { x: -0.3, z: -0.07 })
    for (let i = 0; i < 7; i++) bb.box(0.015, 0.015, 0.14, C.white, { x: -0.04 - i * 0.085 })
  })
  ladder.position.set(0.25, 0.32, 0)
  truck.add(ladder)
  const sirenR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.06), new THREE.MeshBasicMaterial({ color: '#ff4b3e' }))
  const sirenB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.06), new THREE.MeshBasicMaterial({ color: '#3d8bff' }))
  sirenR.position.set(-0.3, 0.39, 0.06)
  sirenB.position.set(-0.3, 0.39, -0.06)
  truck.add(sirenR, sirenB)
  // water arc
  const ND = 12
  const drops = s.part(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.028, 1), new THREE.MeshStandardMaterial({ color: '#8fd3f0', roughness: 0.2 }), ND), 0.5, [0, 0])
  drops.castShadow = false
  drops.frustumCulled = false
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
  const RED = new THREE.Color('#ff4b3e').multiplyScalar(3), GRN = new THREE.Color(C.signalBright).multiplyScalar(3)
  const RD = new THREE.Color('#ff4b3e').multiplyScalar(2.6), BL = new THREE.Color('#3d8bff').multiplyScalar(2.6), DIM = new THREE.Color('#3a2020')
  s.tick(t => {
    const P = 9, u = ((t % P) + P) % P
    const spraying = smooth(1.2, 1.6, u) * (1 - smooth(5.2, 5.6, u))
    const fixed = u > 5.4 && u < 8.6
    smoke.strength = fixed ? 0 : u < 1.5 ? 1 : Math.max(0, 1 - (u - 1.5) / 3.8)
    ladder.rotation.z = -0.45 * smooth(0.6, 1.4, u) * (1 - smooth(6, 7, u))
    const tip = new THREE.Vector3(-0.25, 0.32 + Math.sin(-ladder.rotation.z) * 0.6, 0).applyMatrix4(truck.matrix)
    for (let i = 0; i < ND; i++) {
      const f = (((t * 1.4 + i / ND) % 1) + 1) % 1
      const x = tip.x + (cx - tip.x) * f
      const z = tip.z + (cz - tip.z) * f
      const y = tip.y + (0.52 - tip.y) * f + Math.sin(f * Math.PI) * 0.32
      p.set(x, y, z)
      sc.setScalar(spraying * (0.7 + 0.3 * Math.sin(i * 1.7)) + 1e-4)
      drops.setMatrixAt(i, m4.compose(p, q, sc))
    }
    drops.instanceMatrix.needsUpdate = true
    ;(status.material as THREE.MeshBasicMaterial).color.copy(fixed ? GRN : Math.sin(t * 12) > 0 ? RED : DIM)
    const blink = Math.sin(t * 9) > 0
    ;(sirenR.material as THREE.MeshBasicMaterial).color.copy(blink ? RD : DIM)
    ;(sirenB.material as THREE.MeshBasicMaterial).color.copy(blink ? DIM : BL)
  })
  s.actor({ shirt: C.mustard, pose: idle(-0.55, 0.62, -Math.PI / 2) })
  s.actor({ shirt: C.mustard, pose: pingPong(x0 + 0.3, zf + 0.25, 0.95, 0.1, 0.25, 1.8, 0.4) })
}

// ------------------------------------------------------------------ 09 Website & Data Security: the castle keep

function security(b: PopBuilder, s: ShopKit, extras: THREE.Object3D[]) {
  const stone = C.stone, stoneD = '#d8cfbf'
  const kx = -0.05, kz = -0.6
  s.keep(kx, kz, 0.8)
  s.keep(-0.85, -0.08, 0.4)
  s.keep(0.75, -0.08, 0.4)
  s.keep(-0.05, 0.62, 0.95)
  const crenel = (x0: number, x1: number, z: number, y: number, ry = 0) => {
    const n = Math.max(2, Math.round((x1 - x0) / 0.2))
    for (let i = 0; i <= n; i += 2) {
      const x = x0 + ((x1 - x0) * i) / n
      b.at({ ry }, () => b.rbox(0.12, 0.12, 0.13, 0.02, stoneD, { x, y, z }))
    }
  }
  b.piece(kx, kz, 0, () => {
    b.rbox(0.95, 1.4, 0.85, 0.04, stone, { x: kx, z: kz })
    crenel(kx - 0.42, kx + 0.42, kz + 0.37, 1.39)
    crenel(kx - 0.42, kx + 0.42, kz - 0.37, 1.39)
    for (const dx of [-0.2, 0.2]) b.rbox(0.05, 0.2, 0.03, 0.02, '#2c3238', { x: kx + dx, y: 0.95, z: kz + 0.425 })
    b.rbox(0.03, 0.4, 0.03, 0.01, C.ink, { x: kx, y: 1.4, z: kz })
  })
  for (const [tx, d] of [[-0.85, 0.1], [0.75, 0.16]] as [number, number][]) {
    b.piece(tx, -0.08, d, () => {
      b.cyl(0.3, 0.32, 1.22, 24, stone, { x: tx, z: -0.08 })
      b.cyl(0.33, 0.33, 0.06, 24, stoneD, { x: tx, y: 1.2, z: -0.08 })
      b.cone(0.38, 0.56, 24, '#12a862', { x: tx, y: 1.24, z: -0.08 })
      b.sphere(0.035, C.mustard, { x: tx, y: 1.82, z: -0.08 }, 1)
      b.rbox(0.05, 0.18, 0.03, 0.02, '#2c3238', { x: tx, y: 0.7, z: 0.235 })
    })
  }
  b.piece(-0.05, -0.08, 0.05, () => {
    b.rbox(1.3, 0.74, 0.26, 0.03, stone, { x: -0.05, z: -0.08 })
    crenel(-0.62, 0.52, 0.03, 0.73)
    b.rbox(0.38, 0.52, 0.04, 0.12, '#2a2e33', { x: -0.05, z: 0.06 })
    b.rbox(0.44, 0.58, 0.02, 0.14, stoneD, { x: -0.05, z: 0.05 })
    // the Hark shield over the gate
    b.rbox(0.2, 0.14, 0.03, 0.03, K.hark, { x: -0.05, y: 0.56, z: 0.065 })
    b.box(0.13, 0.13, 0.03, K.hark, { x: -0.05, y: 0.56, z: 0.065, rz: Math.PI / 4 })
    b.box(0.03, 0.1, 0.035, C.white, { x: -0.05, y: 0.58, z: 0.07 })
  })
  // moat + drawbridge
  const pond = makePond({ radius: 0.38, aspect: 2.5, seed: 5, lilies: true, rim: C.stone })
  pond.position.set(-0.05, 0, 0.62)
  pond.updateMatrixWorld(true)
  b.piece(-0.05, 0.62, 0.2, () => {
    pond.children.forEach(c => {
      if ((c as THREE.Mesh).isMesh && c.name !== 'water') b.object(c, { x: -0.05, z: 0.62 })
    })
    b.rbox(0.36, 0.05, 0.62, 0.02, C.wood, { x: -0.05, y: 0.02, z: 0.42 })
    for (let i = 0; i < 6; i++) b.box(0.37, 0.01, 0.01, C.woodDark, { x: -0.05, y: 0.071, z: 0.17 + i * 0.1 })
  })
  const water = pond.children.find(c => c.name === 'water')
  if (water) {
    water.position.set(-0.05, 0.035, 0.62)
    extras.push(water)
  }

  // portcullis
  const gate = s.part(vcMesh(bb => {
    for (let i = 0; i < 5; i++) bb.box(0.022, 0.5, 0.022, '#3a4048', { x: -0.14 + i * 0.07, y: 0.25 })
    for (let i = 0; i < 4; i++) bb.box(0.34, 0.02, 0.022, '#3a4048', { y: 0.06 + i * 0.13 })
    for (let i = 0; i < 5; i++) bb.cone(0.014, 0.04, 4, '#3a4048', { x: -0.14 + i * 0.07, y: -0.04, rx: Math.PI })
  }), 0.25)
  // flags on the towers
  const flags = [[-0.85, 1.84], [0.75, 1.84]].map(([x, y], i) => {
    const f = s.part(vcMesh(bb => {
      bb.cyl(0.01, 0.01, 0.34, 5, C.ink, { y: 0.17 })
      bb.add(pennantGeo(0.3, 0.14), i ? C.white : K.hark, { y: 0.26 })
    }), 0.4 + i * 0.05)
    f.position.set(x, y, -0.08)
    return f
  })
  s.tick(t => {
    const P = 9, u = ((t % P) + P) % P
    const up = smooth(2.5, 4.2, u) * (1 - smooth(6.8, 8.4, u))
    gate.position.set(-0.05, 0.02 + up * 0.44, 0.09)
    gate.scale.y = 1 - up * 0.35
    flags.forEach((f, i) => {
      f.rotation.y = -0.4 + Math.sin(t * 3.2 + i) * 0.3
    })
  })
  s.actor({ shirt: C.navy, pose: pingPong(-0.55, -0.12, 0.45, -0.12, 0.2, 1.4, 0, 0.74) })
  s.actor({ shirt: C.roofRed, pose: idle(0.55, 0.95, -0.2) })
}

// ------------------------------------------------------------------ 10 ADA Accessibility: ramp + wide doors

function ada(b: PopBuilder, s: ShopKit) {
  const PH = 0.28
  const tx = -0.25, tz = -0.38, TW = 1.9, TD = 1.34
  const tf = tz + TD / 2
  const bx = -0.25, bz = -0.6, BW = 1.5, BD = 0.8, BH = 0.82
  const bf = bz + BD / 2
  s.keep(tx, tz, 1.15)
  s.keep(0.85, 0.52, 0.6)
  s.keep(1.55, 0.15, 0.2)
  b.piece(tx, tz, 0, () => {
    b.rbox(TW, PH, TD, 0.04, C.sand, { x: tx, z: tz })
    b.rbox(BW, BH, BD, 0.05, C.white, { x: bx, y: PH, z: bz })
    b.rbox(BW + 0.06, 0.07, BD + 0.06, 0.03, C.stone, { x: bx, y: PH + BH, z: bz })
    b.rbox(BW - 0.1, 0.07, BD - 0.1, 0.03, C.grass, { x: bx, y: PH + BH + 0.05, z: bz })
    for (let i = 0; i < 5; i++) b.sphere(0.09, C.leaf, { x: bx - 0.55 + i * 0.27, y: PH + BH + 0.15, z: bz + (i % 2 ? -0.18 : 0.12), sy: 0.8 }, 1)
    // glass front with a wide doorway
    b.rbox(0.42, 0.48, 0.03, 0.01, '#9ccbe0', { x: bx - 0.5, y: PH + 0.1, z: bf + 0.005 })
    b.rbox(0.3, 0.48, 0.03, 0.01, '#9ccbe0', { x: bx + 0.56, y: PH + 0.1, z: bf + 0.005 })
    b.rbox(0.6, 0.62, 0.02, 0.02, C.slate, { x: bx, y: PH, z: bf + 0.002 })
    b.box(0.8, 0.04, 0.34, K.harkDeep, { x: bx, y: PH + 0.66, z: bf + 0.16 })
    // round planters on the terrace
    for (const x of [tx - 0.78, tx + 0.72]) {
      b.cyl(0.11, 0.09, 0.14, 14, C.terracotta, { x, y: PH, z: tf - 0.14 })
      b.sphere(0.12, C.leafLight, { x, y: PH + 0.18, z: tf - 0.14, sy: 0.85 }, 1)
    }
  })
  // steps on the left
  b.piece(-0.85, tf + 0.12, 0.2, () => {
    b.rbox(0.46, PH * 0.66, 0.14, 0.015, C.stone, { x: -0.85, z: tf + 0.07 })
    b.rbox(0.46, PH * 0.33, 0.14, 0.015, C.stone, { x: -0.85, z: tf + 0.21 })
  })
  // the ramp: gentle, with handrails, up to the landing
  const r0x = 1.42, r1x = 0.32, rz = 0.52, RW = 0.34
  b.piece(0.85, rz, 0.15, () => {
    const len = r0x - r1x
    b.add(wedgeGeo(len, PH, RW, false), C.stone, { x: (r0x + r1x) / 2, z: rz })
    const ang = Math.atan2(PH, len)
    b.box(Math.hypot(len, PH), 0.03, RW, C.cream, { x: (r0x + r1x) / 2, y: PH / 2 + 0.01, z: rz, rz: -ang })
    b.box(0.08, 0.012, RW, C.mustard, { x: r0x - 0.04, y: 0.005, z: rz })
    b.rbox(0.62, PH, RW + 0.02, 0.02, C.stone, { x: r1x - 0.31 + 0.02, z: rz })
    for (const side of [-1, 1]) {
      const z = rz + side * (RW / 2 - 0.01)
      for (let i = 0; i <= 4; i++) {
        const f = i / 4
        const x = r0x - f * len
        b.cyl(0.01, 0.01, 0.22, 5, C.ink, { x, y: f * PH, z })
      }
      b.cyl(0.014, 0.014, Math.hypot(len, PH) + 0.06, 6, C.mustard, { x: (r0x + r1x) / 2, y: PH / 2 + 0.22, z, rz: Math.PI / 2 - ang })
    }
  })
  // access sign
  b.piece(1.58, 0.12, 0.4, () => {
    b.cyl(0.015, 0.018, 0.52, 6, C.white, { x: 1.58, z: 0.12 })
    b.rbox(0.2, 0.2, 0.03, 0.02, '#2f6fd0', { x: 1.58, y: 0.42, z: 0.12 })
    b.face(0.17, 0.17, CELL.access, { x: 1.58, y: 0.52, z: 0.137 })
  })

  // sliding doors
  const doors = [-1, 1].map(side => {
    const d = s.part(vcMesh(bb => {
      bb.add(rboxGeo(0.27, 0.56, 0.025, 0.01), '#bfe3f2')
      bb.box(0.27, 0.025, 0.03, C.ink, { y: 0.56 })
      bb.box(0.02, 0.2, 0.03, C.ink, { x: -side * 0.1, y: 0.2 })
    }, false), 0.3)
    d.position.set(bx + side * 0.14, PH, bf + 0.025)
    return d
  })
  // wheelchair user
  const chair = s.part(new THREE.Group(), 0.5, [0, 0])
  chair.add(
    vcMesh(bb => {
      bb.box(0.16, 0.025, 0.15, C.navy, { y: 0.13 })
      bb.box(0.025, 0.16, 0.15, C.navy, { x: -0.08, y: 0.21 })
      for (const z of [0.085, -0.085]) {
        bb.add(new THREE.TorusGeometry(0.075, 0.013, 6, 18), C.ink, { x: -0.02, y: 0.078, z })
        bb.cyl(0.04, 0.04, 0.01, 10, K.steel, { x: -0.02, y: 0.078, z, rx: Math.PI / 2 })
        bb.sphere(0.022, C.ink, { x: 0.08, y: 0.022, z: z * 0.8 }, 1)
      }
      bb.add(new THREE.CapsuleGeometry(0.065, 0.1, 4, 10), C.teal, { x: -0.03, y: 0.25 })
      bb.box(0.12, 0.05, 0.1, C.navy, { x: 0.04, y: 0.17 })
      bb.sphere(0.062, '#d9a07a', { x: -0.02, y: 0.39 }, 2)
    }),
  )
  const path: [number, number, number, number][] = [
    // t, x, y, z
    [0.0, 1.7, 0, rz],
    [1.2, 1.7, 0, rz],
    [5.2, r1x - 0.1, PH, rz],
    [6.2, bx, PH, tf - 0.05],
    [7.2, bx, PH, bf + 0.02],
  ]
  s.tick(t => {
    const P = 12, u = ((t % P) + P) % P
    let i = 0
    while (i < path.length - 2 && u > path[i + 1][0]) i++
    const [t0, x0, y0, z0] = path[i]
    const [t1, x1, y1, z1] = path[i + 1]
    const f = Math.min(1, Math.max(0, (u - t0) / Math.max(1e-3, t1 - t0)))
    chair.position.set(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f)
    const dx = x1 - x0, dz = z1 - z0
    if (Math.abs(dx) + Math.abs(dz) > 1e-3) chair.rotation.y = Math.atan2(-dz, dx)
    const inS = u < 1.2 ? smooth(0, 0.6, u) : u > 6.9 ? 1 - smooth(6.9, 7.3, u) : 1
    chair.scale.setScalar(Math.max(0.001, inS))
    chair.visible = inS > 0.01
    const open = smooth(5.4, 6.0, u) * (1 - smooth(8.4, 9.2, u))
    doors.forEach((d, j) => (d.position.x = bx + (j ? 1 : -1) * (0.14 + open * 0.26)))
  })
  s.actor({ shirt: C.coral, pose: pingPong(-1.15, tf + 0.55, -0.85, tf + 0.45, 0.2, 2, 0.6) })
  s.actor({ shirt: C.lavender, pose: idle(tx + 0.55, tf - 0.3, 0.5, PH) })
}

// ------------------------------------------------------------------ 11 WordPress: the blog cottage + mailbox

function wordpress(b: PopBuilder, s: ShopKit) {
  const x0 = -0.3, z0 = -0.5, W = 1.25, D = 0.9, H = 0.72
  const zf = z0 + D / 2
  s.keep(x0, z0, 1.0)
  s.keep(-0.6, 0.35, 0.65)
  s.keep(0.62, 1.35, 0.25)
  b.piece(x0, z0, 0, () => {
    b.rbox(W, H, D, 0.05, C.cream, { x: x0, z: z0 })
    b.gable(D, 0.62, W + 0.14, C.roofBlue, { x: x0, y: H - 0.01, z: z0, ry: Math.PI / 2 }, 0.1)
    b.rbox(0.17, 0.62, 0.17, 0.03, K.brick, { x: x0 + 0.36, y: H - 0.05, z: z0 - 0.18 })
    b.rbox(0.2, 0.05, 0.2, 0.02, C.ink, { x: x0 + 0.36, y: H + 0.55, z: z0 - 0.18 })
    door(b, 0.22, 0.42, x0 - 0.02, zf + 0.01, C.woodDark)
    b.rbox(0.34, 0.04, 0.14, 0.02, C.stone, { x: x0 - 0.02, z: zf + 0.07 })
    for (const wx of [x0 - 0.38, x0 + 0.34]) {
      windowPane(b, 0.2, 0.2, wx, 0.3, zf + 0.005)
      b.rbox(0.07, 0.24, 0.03, 0.01, K.harkDeep, { x: wx - 0.15, y: 0.28, z: zf + 0.01 })
      b.rbox(0.07, 0.24, 0.03, 0.01, K.harkDeep, { x: wx + 0.15, y: 0.28, z: zf + 0.01 })
      b.rbox(0.26, 0.05, 0.07, 0.015, C.wood, { x: wx, y: 0.24, z: zf + 0.04 })
      for (let i = 0; i < 4; i++) b.sphere(0.028, i % 2 ? C.blossom : C.mustard, { x: wx - 0.09 + i * 0.06, y: 0.3, z: zf + 0.04 }, 0)
    }
  })
  // picket fence round the front garden, gate gap by the path
  b.piece(-0.6, 0.45, 0.3, () => {
    const pick = (x: number, z: number) => {
      b.box(0.035, 0.2, 0.02, C.white, { x, y: 0.1, z })
      b.cone(0.025, 0.04, 4, C.white, { x, y: 0.2, z, ry: Math.PI / 4 })
    }
    for (let x = -1.28; x <= -0.12; x += 0.1) pick(x, 0.45)
    for (let x = 0.18; x <= 0.5; x += 0.1) pick(x, 0.45)
    b.box(1.18, 0.02, 0.015, C.white, { x: -0.7, y: 0.07, z: 0.445 })
    b.box(1.18, 0.02, 0.015, C.white, { x: -0.7, y: 0.15, z: 0.445 })
    b.box(0.34, 0.02, 0.015, C.white, { x: 0.34, y: 0.07, z: 0.445 })
    b.box(0.34, 0.02, 0.015, C.white, { x: 0.34, y: 0.15, z: 0.445 })
    // garden rows
    const cols = [C.blossom, C.mustard, C.white, C.coral, C.lavender]
    for (let i = 0; i < 14; i++) {
      const x = -1.2 + (i % 7) * 0.15, z = 0.18 + Math.floor(i / 7) * 0.13
      b.cyl(0.006, 0.008, 0.12, 3, '#6fae5a', { x, z })
      b.sphere(0.04, cols[i % cols.length], { x, y: 0.13, z, sy: 0.8 }, 1)
    }
    // stepping stones to the door
    for (let i = 0; i < 4; i++) b.cyl(0.08, 0.085, 0.02, 10, C.stone, { x: 0.02 - i * 0.02, z: 0.12 + i * 0.28 - 0.1 })
  })
  // mailbox by the lane
  const mx = 0.62, mz = 1.35
  b.piece(mx, mz, 0.42, () => {
    b.box(0.05, 0.42, 0.05, C.wood, { x: mx, y: 0.21, z: mz })
    b.rbox(0.16, 0.1, 0.26, 0.02, C.roofBlue, { x: mx, y: 0.42, z: mz })
    b.add(halfCylGeo(0.08, 0.26, 12), C.roofBlue, { x: mx, y: 0.52, z: mz })
    b.box(0.14, 0.12, 0.012, '#3f78bd', { x: mx, y: 0.47, z: mz + 0.13 })
  })
  s.puffs(x0 + 0.36, H + 0.66, z0 - 0.18, { n: 4, color: '#f1eee8', size: 0.13, rise: 1.0, period: 4.6, delay: 0.3 })
  // mailbox flag + a letter hopping to the door
  const flag = s.part(vcMesh(bb => {
    bb.box(0.012, 0.16, 0.02, C.roofRed, { y: 0.08 })
    bb.box(0.012, 0.06, 0.07, C.roofRed, { y: 0.13, z: 0.035 })
  }), 0.5)
  flag.position.set(mx + 0.085, 0.48, mz - 0.05)
  const letter = s.part(vcMesh(bb => {
    bb.box(0.14, 0.012, 0.1, C.white)
    bb.box(0.03, 0.014, 0.03, K.hark, { x: 0.04, z: 0.025 })
    bb.box(0.14, 0.013, 0.004, '#d9d2c3', { y: 0.001 })
  }), 0.55, [mx, mz])
  s.tick(t => {
    const P = 6.5, u = ((t % P) + P) % P
    flag.rotation.x = u < 3.2 ? -Math.PI / 2 * (1 - smooth(0, 0.3, u)) : -Math.PI / 2 * smooth(3.2, 3.6, u)
    const hop = smooth(0.6, 2.2, u)
    const vis = u > 0.3 && u < 2.35
    letter.visible = vis
    const ax = mx, ay = 0.62, az = mz, bx2 = x0 - 0.02, by = 0.3, bz = zf + 0.08
    letter.position.set(ax + (bx2 - ax) * hop, ay + (by - ay) * hop + Math.sin(hop * Math.PI) * 0.55, az + (bz - az) * hop)
    letter.rotation.set(Math.sin(hop * Math.PI) * 0.5, hop * Math.PI * 2, 0)
    const k = u < 0.6 ? smooth(0.3, 0.6, u) : 1 - smooth(2.15, 2.35, u)
    letter.scale.setScalar(Math.max(0.001, k))
  })
  s.actor({ shirt: C.roofBlue, pose: pingPong(0.1, 0.62, 0.45, 1.2, 0.22, 2.2) })
  s.actor({ shirt: C.blossom, pose: idle(-1.0, 0.05, 0.3) })
}

// ------------------------------------------------------------------ registry

export type ShopBuilder = (b: PopBuilder, s: ShopKit, extras: THREE.Object3D[]) => void

export const SHOPS: ShopBuilder[] = [software, webDesign, ecommerce, seo, pageSpeed, ai, aerial, hack, security, ada, wordpress]

/** playful place names for the wayfinding plates (decorative) */
export const PLACES = [
  'Gearworks Isle',
  'Easel Point',
  'Market Cay',
  'Beacon Rock',
  'Speedway Key',
  'Stargazer Isle',
  'Helipad Heights',
  'Firehouse Point',
  'Castle Keep',
  'Open Door Isle',
  'Postbox Green',
]
