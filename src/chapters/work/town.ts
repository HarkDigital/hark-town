import * as THREE from 'three'
import { rng } from '../../core/math'
import { C } from '../../kit/palette'
import { Kit, ball, cellPlane, prism, Spring } from './kit'
import { nextFrame } from '../../core/yield'
import {
  ARCH_CELL,
  DEST_CELL,
  faceCell,
  POSTERS_H,
  POSTERS_W,
  posterCell,
  shopCell,
  SIGNS_H,
  SIGNS_W,
  SOLD_CELL,
  stallCell,
  STALLS_H,
  STALLS_W,
  WELCOME_CELL,
  type Signage,
} from './signs'
import * as L from './layout'

/*
 * Builds Main Street: the long floating island, the street with its tram
 * line, six featured shops (each with a rooftop flip billboard), filler
 * houses, back gardens, the canal, the market row, the terminus, the sky
 * bridge and the Hark tram. Static scenery is baked into a few merged
 * meshes; anything that pops, flips or moves stays its own small group.
 */

const F = L.SHOP_D / 2
const GLASS = '#2b4153'
const FRAME = '#fbfaf6'
const INK = '#26302d'
const WOOD = '#c9955f'
const PAVE = '#ece0c8'
const CURB = '#d9cbb0'
const ROADC = '#aaa69d'
const BED = '#9c978e'
const RAIL = '#8b939a'

const BOARD_W = 4.0
const BOARD_H = 2.5
const BOARD_T = 0.14
/** half the outer height of a billboard frame */
export const BOARD_HALF = BOARD_H / 2 + BOARD_T

export interface Board {
  /** yawed/tilted frame (child of the shop) */
  root: THREE.Group
  /** flips 0 → π about x: green "Stop" face → the website */
  flip: THREE.Group
  screen: THREE.MeshBasicMaterial
  /** a paper-blank wash over the screen once the tram has moved on (opacity 0..1) */
  blank: THREE.MeshBasicMaterial
  blankMesh: THREE.Mesh
  spring: Spring
  /** world-ish (street space) centre, for camera framing */
  center: THREE.Vector3
}

export interface Popper {
  obj: THREE.Object3D
  spring: Spring
  /** local progress at which it pops up (−1 = driven elsewhere) */
  at: number
  x: number
}

export interface TreeSet {
  trunks: THREE.InstancedMesh
  crowns: THREE.InstancedMesh
  cones: THREE.InstancedMesh
  items: { x: number; z: number; s: number; kind: 0 | 1; h: number; r: number; phase: number; at: number; spring: Spring; ci: number }[]
}

export interface Town {
  root: THREE.Group
  shops: Popper[]
  boards: Board[]
  fillers: Popper[]
  stalls: Popper[]
  tram: THREE.Group
  trees: TreeSet
  /** idle animation of small moving parts (time-based only) */
  animate(time: number, calm: boolean): void
  /** meshes to raycast for pokes, mapped to their popper */
  pokeables: { mesh: THREE.Object3D; popper: Popper }[]
}

interface Mats {
  sign: THREE.MeshStandardMaterial
  face: THREE.MeshBasicMaterial
  stall: THREE.MeshStandardMaterial
  poster: THREE.MeshBasicMaterial
  dest: THREE.MeshBasicMaterial
}

/** Signs and screens sit a hair in front of their boards: pull them forward in depth too. */
function decal<M extends THREE.Material>(m: M): M {
  m.polygonOffset = true
  m.polygonOffsetFactor = -2
  m.polygonOffsetUnits = -4
  return m
}

/** A box centred on its position (for slanted slabs). */
const slabGeo = new Map<string, THREE.BoxGeometry>()
function slab(w: number, h: number, d: number) {
  const k = `${w}|${h}|${d}`
  let g = slabGeo.get(k)
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d)
    slabGeo.set(k, g)
  }
  return g
}

/** window pane with a white frame and sill, on a +z face at z */
function win(kit: Kit, x: number, y: number, z: number, w: number, h: number, frame = FRAME) {
  kit.box(w + 0.1, h + 0.1, 0.03, frame, { x, y: y - 0.05, z: z + 0.005 }, 0.015)
  kit.box(w, h, 0.03, GLASS, { x, y, z: z + 0.02 }, 0.01, 'gloss')
  kit.box(w + 0.16, 0.04, 0.09, frame, { x, y: y - 0.07, z: z + 0.04 }, 0.01)
}

/** window on the −x face (the side the camera sees) */
function sideWin(kit: Kit, x: number, y: number, z: number, w: number, h: number, frame = FRAME) {
  kit.box(0.03, h + 0.1, w + 0.1, frame, { x: x - 0.005, y: y - 0.05, z }, 0.015)
  kit.box(0.03, h, w, GLASS, { x: x - 0.02, y, z }, 0.01, 'gloss')
}

/** Gable roof over a w×d box of height h, ridge along x. */
function gableX(kit: Kit, w: number, d: number, h: number, rise: number, wall: string, roof: string, z = 0) {
  // gable end walls
  kit.add(prism(d, rise, w), wall, { y: h, z, ry: Math.PI / 2 })
  const th = Math.atan2(rise, d / 2)
  const len = Math.hypot(rise, d / 2) + 0.16
  for (const s of [-1, 1]) {
    kit.add(slab(w + 0.24, 0.09, len), roof, {
      x: 0,
      y: h + rise / 2 + 0.05,
      z: z + s * (d / 4 + 0.02),
      rx: s * th,
    })
  }
  kit.cyl(0.05, 0.05, w + 0.26, roof, { y: h + rise + 0.02, z, rz: Math.PI / 2, x: (w + 0.26) / 2 }, 6)
}

/** Gable roof with the gable facing the street (ridge along z). */
function gableZ(kit: Kit, w: number, d: number, h: number, rise: number, wall: string, roof: string, z = 0) {
  kit.add(prism(w, rise, d), wall, { y: h, z })
  const th = Math.atan2(rise, w / 2)
  const len = Math.hypot(rise, w / 2) + 0.16
  for (const s of [-1, 1]) {
    kit.add(slab(len, 0.09, d + 0.26), roof, {
      x: s * (w / 4 + 0.02),
      y: h + rise / 2 + 0.05,
      z,
      rz: -s * th,
    })
  }
}

function signPlane(kit: Kit, mats: Mats, k: number, y: number, z: number, x = 0, w = 2.9) {
  kit.mapped(cellPlane(w, w / 6.4, shopCell(k), SIGNS_W, SIGNS_H), mats.sign, { x, y, z })
}

// ------------------------------------------------------------------ billboards

function buildBoard(k: number, mats: Mats, placeholder: THREE.Texture): Board {
  const root = new THREE.Group()
  root.rotation.set(L.BOARD_TILT, L.BOARD_YAW, 0, 'YXZ')
  const kit = new Kit()
  const W = BOARD_W
  const H = BOARD_H
  const T = BOARD_T
  const D = 0.16
  kit.box(W + 2 * T, T, D, FRAME, { y: H / 2 }, 0.04)
  kit.box(W + 2 * T, T, D, FRAME, { y: -H / 2 - T }, 0.04)
  kit.box(T, H, D, FRAME, { x: -(W / 2 + T / 2), y: -H / 2 }, 0.03)
  kit.box(T, H, D, FRAME, { x: W / 2 + T / 2, y: -H / 2 }, 0.03)
  kit.box(W, H, 0.04, '#39433f', { y: -H / 2, z: -0.1 }, 0.01)
  // legs + brace, buried in the roof
  for (const s of [-1, 1]) kit.box(0.12, 1.3, 0.12, '#4a5451', { x: s * 1.35, y: -H / 2 - T - 1.3, z: -0.04 }, 0.02)
  kit.add(slab(2.9, 0.06, 0.06), '#4a5451', { y: -H / 2 - T - 0.55, z: -0.04, rz: 0.28 })
  // catwalk + rail
  kit.box(W + 0.3, 0.05, 0.38, '#5b6461', { y: -H / 2 - T - 0.07, z: 0.2 }, 0.01)
  kit.box(W + 0.3, 0.03, 0.03, '#5b6461', { y: -H / 2 - T + 0.2, z: 0.37 }, 0.005)
  for (let i = 0; i <= 4; i++) kit.box(0.025, 0.27, 0.025, '#5b6461', { x: -W / 2 - 0.1 + i * ((W + 0.2) / 4), y: -H / 2 - T - 0.07, z: 0.37 }, 0.005)
  // lamps on arms over the top, glowing warm
  for (const x of [-1.35, 0, 1.35]) {
    kit.box(0.04, 0.04, 0.46, '#4a5451', { x, y: H / 2 + T - 0.02, z: 0.23 }, 0.01)
    kit.box(0.26, 0.08, 0.14, '#4a5451', { x, y: H / 2 + T + 0.0, z: 0.46 }, 0.02)
    kit.add(slab(0.2, 0.02, 0.1), '#fff0c4', { x, y: H / 2 + T - 0.005, z: 0.46 }, 'glow', 2.2)
  }
  root.add(kit.build())

  const flip = new THREE.Group()
  // two back-to-back faces (no slab between them: nothing to z-fight with at
  // long range); each is back-face culled, so only the one facing us draws
  const fk = new Kit()
  fk.mapped(cellPlane(W, H, faceCell(k), SIGNS_W, SIGNS_H), mats.face, { z: 0.02 })
  flip.add(fk.build({ cast: false }))
  const screen = new THREE.MeshBasicMaterial({ map: placeholder })
  decal(screen)
  const plane = new THREE.PlaneGeometry(W, H)
  const sm = new THREE.Mesh(plane, screen)
  sm.rotation.x = Math.PI
  sm.position.z = -0.02
  flip.add(sm)
  // once the tram moves on, the site washes out to blank paper, so the next
  // stop's plate never sits over another client's live screen
  const blank = new THREE.MeshBasicMaterial({ map: placeholder, transparent: true, opacity: 0, depthWrite: false })
  decal(blank)
  const bm = new THREE.Mesh(plane, blank)
  bm.rotation.x = Math.PI
  bm.position.z = -0.035
  bm.renderOrder = 1
  bm.visible = false
  flip.add(bm)
  root.add(flip)
  return { root, flip, screen, blank, blankMesh: bm, spring: new Spring(95, 7.5), center: new THREE.Vector3() }
}

// ------------------------------------------------------------------ shops

interface ShopBuild {
  kit: Kit
  board: THREE.Vector3
  extra?: THREE.Object3D[]
  anim?: (t: number, calm: boolean) => void
}

function shopBank(mats: Mats): ShopBuild {
  const kit = new Kit()
  const navy = '#2f4a6d'
  const stone = '#f3e9d6'
  kit.box(3.44, 0.16, 2.84, '#dccfb5', {}, 0.03)
  kit.box(3.2, 2.34, 2.6, stone, { y: 0.16 }, 0.07, 'matte', 2)
  kit.box(3.36, 0.12, 2.76, navy, { y: 2.5 }, 0.03)
  kit.box(3.1, 0.1, 2.5, '#e3d6bd', { y: 2.62 }, 0.02)
  // portico
  kit.box(3.34, 0.1, 0.76, '#e3d6bd', { y: 0.16, z: F + 0.34 }, 0.02)
  for (const x of [-1.25, -0.42, 0.42, 1.25]) {
    kit.cyl(0.085, 0.1, 1.56, '#fbfaf6', { x, y: 0.26, z: F + 0.46 }, 12)
    kit.box(0.26, 0.07, 0.26, '#fbfaf6', { x, y: 1.81, z: F + 0.46 }, 0.01)
  }
  kit.box(3.36, 0.5, 0.7, stone, { y: 1.88, z: F + 0.35 }, 0.03)
  signPlane(kit, mats, 0, 2.13, F + 0.706)
  kit.add(prism(3.44, 0.55, 0.7), stone, { y: 2.38, z: F + 0.35 })
  kit.add(prism(2.7, 0.36, 0.04), navy, { y: 2.46, z: F + 0.69 })
  // facade
  kit.box(0.58, 1.22, 0.05, navy, { y: 0.26, z: F + 0.01 }, 0.02)
  kit.ball(0.03, '#f0b43c', { x: 0.2, y: 0.85, z: F + 0.05 }, 0)
  win(kit, -0.95, 0.6, F, 0.46, 1.0)
  win(kit, 0.95, 0.6, F, 0.46, 1.0)
  for (const z of [0.6, -0.5]) sideWin(kit, -1.6, 0.7, z, 0.44, 1.1)
  // flag pole
  kit.cyl(0.025, 0.03, 1.35, '#d9d9d9', { x: 1.3, y: 2.72, z: -0.95 }, 6)
  kit.ball(0.05, '#f0b43c', { x: 1.3, y: 4.08, z: -0.95 }, 1)

  // waving flag (a few verts updated on the CPU)
  const flagGeo = new THREE.PlaneGeometry(0.72, 0.44, 8, 1)
  flagGeo.translate(0.36, 0, 0)
  const flagPos = flagGeo.attributes.position as THREE.BufferAttribute
  const base = Float32Array.from(flagPos.array as Float32Array)
  const flagMat = new THREE.MeshStandardMaterial({ color: navy, roughness: 0.8, side: THREE.DoubleSide })
  const flag = new THREE.Mesh(flagGeo, flagMat)
  flag.position.set(1.33, 3.78, -0.95)
  flag.rotation.y = -0.6
  flag.castShadow = true
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.09, 8, 1).translate(0.36, 0, 0.002),
    new THREE.MeshStandardMaterial({ color: '#f0b43c', roughness: 0.8, side: THREE.DoubleSide }),
  )
  const stripePos = stripe.geometry.attributes.position as THREE.BufferAttribute
  const sbase = Float32Array.from(stripePos.array as Float32Array)
  flag.add(stripe)
  const wave = (pos: THREE.BufferAttribute, b: Float32Array, t: number, amp: number) => {
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3]
      pos.setZ(i, b[i * 3 + 2] + Math.sin(x * 7 - t * 6) * 0.09 * x * amp)
      pos.setY(i, b[i * 3 + 1] + Math.sin(x * 5 - t * 4) * 0.025 * x * amp)
    }
    pos.needsUpdate = true
  }
  return {
    kit,
    board: new THREE.Vector3(0, 4.48, -0.35),
    extra: [flag],
    anim(t, calm) {
      const a = calm ? 0.25 : 1
      wave(flagPos, base, t, a)
      wave(stripePos, sbase, t, a)
      flagGeo.computeVertexNormals()
    },
  }
}

function shopExchange(mats: Mats): ShopBuild {
  const kit = new Kit()
  kit.box(3.2, 2.3, 2.6, '#7fb3e3', {}, 0.1, 'matte', 2)
  kit.box(3.3, 0.14, 2.7, '#3d5a80', { y: 2.3 }, 0.05)
  kit.box(2.9, 0.72, 0.05, GLASS, { y: 0.06, z: F }, 0.01, 'gloss')
  for (const x of [-1.45, -0.45, 0.55, 1.45]) kit.box(0.05, 0.74, 0.07, FRAME, { x, y: 0.05, z: F + 0.01 }, 0.01)
  kit.box(3.28, 0.56, 0.12, FRAME, { y: 0.86, z: F - 0.02 }, 0.03)
  signPlane(kit, mats, 1, 1.14, F + 0.045)
  kit.box(3.0, 0.42, 0.05, GLASS, { y: 1.56, z: F }, 0.01, 'gloss')
  for (let i = 0; i < 6; i++) kit.box(0.04, 0.44, 0.07, FRAME, { x: -1.5 + i * 0.6, y: 1.55, z: F + 0.01 }, 0.005)
  kit.box(3.26, 0.08, 2.66, FRAME, { y: 2.08 }, 0.02)
  kit.box(0.05, 0.42, 2.3, GLASS, { x: -1.6, y: 1.56 }, 0.01, 'gloss')
  kit.box(0.05, 0.62, 2.3, GLASS, { x: -1.6, y: 0.16 }, 0.01, 'gloss')
  kit.box(0.56, 0.32, 0.44, '#d6dde3', { x: 1.0, y: 2.44, z: -0.8 }, 0.05)
  kit.box(0.46, 0.26, 0.4, '#d6dde3', { x: -0.9, y: 2.44, z: -0.9 }, 0.05)
  // radio mast in the alley (red/white bands, blinking tip)
  const mx = -2.3
  const mz = -0.9
  kit.box(0.5, 0.14, 0.5, '#9aa3a8', { x: mx, z: mz }, 0.03)
  kit.cyl(0.05, 0.14, 5.3, '#eef1f4', { x: mx, y: 0.14, z: mz }, 8)
  for (const y of [1.2, 2.6, 4.0]) kit.cyl(0.12 - y * 0.013, 0.13 - y * 0.013, 0.45, '#e04a36', { x: mx, y, z: mz }, 8)
  kit.box(0.08, 0.3, 0.08, '#d6dde3', { x: mx + 0.12, y: 3.3, z: mz }, 0.01)
  kit.cyl(0.13, 0.13, 0.05, '#fbfaf6', { x: mx + 0.2, y: 3.45, z: mz, rz: Math.PI / 2 }, 12)
  const tip = new THREE.Mesh(ball(0.075, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4b3e').multiplyScalar(2.4) }))
  tip.position.set(mx, 5.5, mz)
  const tipMat = tip.material as THREE.MeshBasicMaterial
  const tipBase = tipMat.color.clone()
  // rotating dish on the roof
  const dish = new THREE.Group()
  const dk = new Kit()
  dk.cyl(0.04, 0.05, 0.3, '#d6dde3', {}, 6)
  const cone = new THREE.ConeGeometry(0.34, 0.14, 16)
  dk.add(cone, '#fbfaf6', { y: 0.42, rx: -2.2 })
  dk.cyl(0.015, 0.015, 0.34, '#9aa3a8', { y: 0.36, z: 0.02, rx: 1.0 }, 4)
  dk.ball(0.035, '#9aa3a8', { y: 0.55, z: 0.27 }, 0)
  dish.add(dk.build())
  dish.position.set(1.0, 2.44, 0.55)
  return {
    kit,
    board: new THREE.Vector3(0.15, 4.2, -0.3),
    extra: [tip, dish],
    anim(t, calm) {
      const on = calm ? 0.8 : Math.max(0.15, Math.pow(Math.max(0, Math.sin(t * 3.2)), 6))
      tipMat.color.copy(tipBase).multiplyScalar(on)
      dish.rotation.y = calm ? 0.4 : Math.sin(t * 0.35) * 0.9
    },
  }
}

function shopHouse(mats: Mats): ShopBuild {
  const kit = new Kit()
  const wall = '#f4b99a'
  const roof = '#c8603a'
  const green = '#2f8f55'
  const bz = -0.12
  kit.box(3.0, 1.62, 2.36, wall, { z: bz }, 0.06, 'matte', 2)
  gableZ(kit, 3.0, 2.36, 1.62, 0.98, wall, roof, bz)
  kit.box(0.34, 0.8, 0.34, roof, { x: 0.9, y: 2.0, z: -0.65 }, 0.03)
  kit.box(0.4, 0.08, 0.4, '#8a4a30', { x: 0.9, y: 2.78, z: -0.65 }, 0.02)
  // porch
  const pz = F - 0.1
  kit.box(3.14, 0.12, 0.74, '#e3d6bd', { z: pz + 0.27 }, 0.02)
  for (const x of [-1.42, 1.42]) kit.cyl(0.05, 0.05, 1.22, FRAME, { x, y: 0.12, z: pz + 0.56 }, 8)
  kit.box(3.3, 0.08, 0.86, roof, { y: 1.36, z: pz + 0.3, rx: 0.14 }, 0.02)
  kit.box(3.02, 0.52, 0.06, '#f6ecd8', { y: 0.9, z: pz + 0.66 }, 0.02)
  signPlane(kit, mats, 2, 1.16, pz + 0.695)
  // door, windows with shutters, round gable window
  const fz = bz + 1.18
  kit.box(0.5, 1.0, 0.05, green, { y: 0.12, z: fz }, 0.02)
  kit.ball(0.03, '#f0b43c', { x: 0.17, y: 0.6, z: fz + 0.04 }, 0)
  for (const x of [-0.95, 0.95]) {
    win(kit, x, 0.45, fz, 0.46, 0.6)
    for (const s of [-1, 1]) kit.box(0.14, 0.64, 0.04, green, { x: x + s * 0.34, y: 0.43, z: fz + 0.02 }, 0.01)
  }
  kit.cyl(0.2, 0.2, 0.05, FRAME, { y: 2.08, z: fz, rx: Math.PI / 2 }, 16)
  kit.cyl(0.15, 0.15, 0.06, GLASS, { y: 2.08, z: fz + 0.005, rx: Math.PI / 2 }, 16, 'gloss')
  sideWin(kit, -1.5, 0.5, 0.2, 0.5, 0.62)
  // flower boxes
  for (const x of [-0.95, 0.95]) {
    kit.box(0.56, 0.12, 0.14, '#c8603a', { x, y: 0.26, z: fz + 0.09 }, 0.02)
    for (let i = 0; i < 4; i++) kit.ball(0.05, i % 2 ? '#f2b63d' : '#e2694a', { x: x - 0.2 + i * 0.13, y: 0.42, z: fz + 0.1 }, 0)
  }
  // SOLD sign on its post
  const sx = 1.98
  const sz = F + 0.55
  kit.cyl(0.035, 0.04, 1.3, FRAME, { x: sx, z: sz }, 6)
  kit.box(0.62, 0.035, 0.035, FRAME, { x: sx + 0.27, y: 1.22, z: sz }, 0.005)
  kit.box(0.5, 0.27, 0.03, FRAME, { x: sx + 0.33, y: 0.86, z: sz }, 0.01)
  kit.mapped(cellPlane(0.48, 0.24, SOLD_CELL, SIGNS_W, SIGNS_H), mats.sign, { x: sx + 0.33, y: 0.995, z: sz + 0.018 })
  return { kit, board: new THREE.Vector3(0, 4.3, -0.35) }
}

function shopFactory(mats: Mats, smoke: THREE.InstancedMesh): ShopBuild {
  const kit = new Kit()
  const brick = '#d4764f'
  kit.box(3.2, 1.95, 2.6, brick, {}, 0.05, 'matte', 2)
  for (let i = 1; i <= 5; i++) kit.box(3.22, 0.03, 2.62, '#bb5f3d', { y: i * 0.33 }, 0.01)
  // sawtooth roof
  const tw = 3.2 / 3
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Shape()
    s.moveTo(-tw / 2, 0)
    s.lineTo(tw / 2, 0)
    s.lineTo(tw / 2, 0.62)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 2.6, bevelEnabled: false })
    g.translate(0, 0, -1.3)
    const x = -tw + i * tw
    kit.add(g, '#9aa3a8', { x, y: 1.95 })
    kit.box(0.04, 0.5, 2.4, GLASS, { x: x + tw / 2 + 0.02, y: 1.99 }, 0.005, 'gloss')
  }
  // tall chimney on the west wall
  const cx = -1.9
  const cz = -0.8
  kit.cyl(0.24, 0.32, 5.6, '#bf6343', { x: cx, z: cz }, 12)
  kit.cyl(0.25, 0.26, 0.24, FRAME, { x: cx, y: 4.9, z: cz }, 12)
  kit.cyl(0.29, 0.29, 0.12, '#5a4a40', { x: cx, y: 5.6, z: cz }, 12)
  kit.box(0.3, 0.9, 0.4, '#bf6343', { x: -1.72, y: 0, z: cz }, 0.03)
  // roller door + fascia
  kit.box(1.5, 1.15, 0.05, '#aab3b8', { x: -0.45, y: 0.02, z: F }, 0.01)
  for (let i = 1; i < 6; i++) kit.box(1.5, 0.02, 0.07, '#8d969b', { x: -0.45, y: 0.02 + i * 0.19, z: F + 0.01 }, 0.005)
  kit.box(0.42, 0.9, 0.05, '#3d5a80', { x: 0.95, y: 0.05, z: F }, 0.01)
  kit.box(3.28, 0.56, 0.1, '#1d2321', { y: 1.28, z: F - 0.02 }, 0.03)
  signPlane(kit, mats, 3, 1.56, F + 0.036)
  for (const z of [0.7, 0, -0.7]) sideWin(kit, -1.6, 0.9, z, 0.36, 0.42)
  // a pallet of freshly blown bottles
  const px = 2.02
  const pz = F + 0.1
  kit.box(0.74, 0.1, 0.64, WOOD, { x: px, z: pz }, 0.01)
  const bc = ['#4d8fd6', '#46b36b', '#e2694a', '#f0b43c']
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const x = px - 0.22 + i * 0.22
      const z = pz - 0.2 + j * 0.2
      const c = bc[(i + j * 2) % bc.length]
      kit.cyl(0.07, 0.075, 0.2, c, { x, y: 0.1, z }, 8, 'gloss')
      kit.cyl(0.03, 0.06, 0.07, c, { x, y: 0.3, z }, 8, 'gloss')
      kit.cyl(0.032, 0.032, 0.04, '#fbfaf6', { x, y: 0.37, z }, 6)
    }
  // smoke puffs rise from the chimney (instanced, cheap)
  const sm = new THREE.Matrix4()
  const sq = new THREE.Quaternion()
  const sv = new THREE.Vector3()
  const ss = new THREE.Vector3()
  const N = smoke.count
  return {
    kit,
    board: new THREE.Vector3(0.1, 4.3, -0.25),
    extra: [smoke],
    anim(t, calm) {
      for (let i = 0; i < N; i++) {
        const u = (t * (calm ? 0.04 : 0.13) + i / N) % 1
        const r = 0.13 + u * 0.4
        sv.set(cx + u * 1.3 + Math.sin(u * 7 + i * 1.7) * 0.14, 5.72 + u * 2.2 + Math.sin(i * 2.3) * 0.08, cz - u * 0.6)
        const fade = Math.min(1, u * 5) * (1 - Math.max(0, (u - 0.65) / 0.35) ** 2)
        ss.setScalar(r * fade)
        sm.compose(sv, sq, ss)
        smoke.setMatrixAt(i, sm)
      }
      smoke.instanceMatrix.needsUpdate = true
    },
  }
}

function shopTheatre(mats: Mats): ShopBuild {
  const kit = new Kit()
  const red = '#e0654a'
  const cream = '#fbf3df'
  kit.box(3.2, 2.45, 2.6, red, {}, 0.06, 'matte', 2)
  kit.box(3.3, 0.12, 2.7, '#b8472f', { y: 2.45 }, 0.03)
  kit.box(1.5, 0.44, 0.32, cream, { y: 2.45, z: F - 0.16 }, 0.05)
  kit.box(0.84, 0.22, 0.32, cream, { y: 2.89, z: F - 0.16 }, 0.05)
  kit.ball(0.12, '#f0b43c', { y: 3.2, z: F - 0.16 }, 1, 'gloss')
  for (const x of [-1.52, 1.52]) kit.box(0.18, 2.45, 0.08, cream, { x, z: F }, 0.02)
  // marquee
  kit.box(3.44, 0.62, 0.96, cream, { y: 1.34, z: F + 0.48 }, 0.06)
  kit.box(3.48, 0.06, 1.0, '#f0b43c', { y: 1.3, z: F + 0.48 }, 0.02)
  signPlane(kit, mats, 4, 1.65, F + 0.966, 0, 2.7)
  // doors, ticket booth
  for (const x of [-0.95, 0.95]) kit.box(0.72, 1.12, 0.05, GLASS, { x, y: 0.04, z: F }, 0.01, 'gloss')
  kit.box(0.66, 1.02, 0.5, '#f0b43c', { y: 0.02, z: F + 0.3 }, 0.1, 'matte', 2)
  kit.box(0.46, 0.32, 0.05, GLASS, { y: 0.56, z: F + 0.55 }, 0.02, 'gloss')
  kit.box(0.74, 0.08, 0.58, red, { y: 1.04, z: F + 0.3 }, 0.03)
  // round windows above the marquee
  for (const x of [-0.85, 0, 0.85]) {
    kit.cyl(0.16, 0.16, 0.05, cream, { x, y: 2.18, z: F, rx: Math.PI / 2 }, 14)
    kit.cyl(0.12, 0.12, 0.06, GLASS, { x, y: 2.18, z: F + 0.005, rx: Math.PI / 2 }, 14, 'gloss')
  }
  for (const z of [0.5, -0.6]) sideWin(kit, -1.6, 1.0, z, 0.3, 0.9, cream)
  // chasing marquee bulbs
  const per = 15
  const bulbs = new THREE.InstancedMesh(ball(0.035, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), per * 2)
  const m = new THREE.Matrix4()
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < per; i++) {
      m.makeTranslation(-1.62 + (i * 3.24) / (per - 1), r ? 1.93 : 1.4, F + 0.975)
      bulbs.setMatrixAt(r * per + i, m)
    }
  const warm = new THREE.Color('#ffd98a')
  const col = new THREE.Color()
  for (let i = 0; i < per * 2; i++) bulbs.setColorAt(i, warm)
  return {
    kit,
    board: new THREE.Vector3(0, 4.6, -0.4),
    extra: [bulbs],
    anim(t, calm) {
      const step = Math.floor(t * 7)
      for (let i = 0; i < per * 2; i++) {
        const on = calm ? 1 : (i + step) % 3 === 0 ? 1 : 0.35
        bulbs.setColorAt(i, col.copy(warm).multiplyScalar(0.8 + on * 1.8))
      }
      if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true
    },
  }
}

function shopHall(mats: Mats): ShopBuild {
  const kit = new Kit()
  const lilac = '#a98bd6'
  const plum = '#3d2f63'
  kit.box(3.2, 2.15, 2.6, lilac, {}, 0.1, 'matte', 2)
  kit.box(3.34, 0.16, 2.74, plum, { y: 2.15 }, 0.06)
  kit.box(1.9, 1.02, 0.05, GLASS, { x: -0.45, y: 0.1, z: F }, 0.02, 'gloss')
  for (const x of [-1.1, -0.45, 0.2]) kit.box(0.05, 1.04, 0.07, FRAME, { x, y: 0.09, z: F + 0.01 }, 0.01)
  kit.box(0.56, 1.06, 0.06, '#f0b43c', { x: 1.02, y: 0.06, z: F }, 0.02)
  kit.box(3.28, 0.56, 0.1, plum, { y: 1.26, z: F - 0.02 }, 0.03)
  signPlane(kit, mats, 5, 1.54, F + 0.036)
  for (const x of [-0.9, 0, 0.9]) {
    kit.cyl(0.15, 0.15, 0.05, FRAME, { x, y: 1.93, z: F, rx: Math.PI / 2 }, 14)
    kit.cyl(0.11, 0.11, 0.06, GLASS, { x, y: 1.93, z: F + 0.005, rx: Math.PI / 2 }, 14, 'gloss')
  }
  sideWin(kit, -1.6, 0.5, 0.3, 0.6, 0.9)
  // bunting across the facade
  const bc = ['#f0b43c', '#fbfaf6', '#e2694a', '#63c1e3']
  for (let i = 0; i < 10; i++) {
    const x = -1.5 + i * 0.333
    const tri = prism(0.2, 0.22, 0.01)
    kit.add(tri, bc[i % bc.length], { x, y: 2.1, z: F + 0.07, rz: Math.PI })
  }
  // loudspeaker horn on the roof
  const hx = -1.1
  const hy = 2.31
  const hz = 0.72
  kit.box(0.42, 0.36, 0.42, '#1d2321', { x: hx, y: hy, z: hz - 0.3 }, 0.05)
  const yaw = L.VIEW_YAW * 0.6
  const pitch = 0.3
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const mouth = new THREE.Vector3(hx, hy + 0.28, hz - 0.1).addScaledVector(dir, 0.42)
  const horn = new THREE.ConeGeometry(0.44, 0.84, 18, 1, false)
  kit.add(horn, '#fbfaf6', { x: hx, y: hy + 0.28, z: hz - 0.1, rx: -Math.PI / 2 - pitch, ry: yaw })
  kit.add(new THREE.CylinderGeometry(0.39, 0.39, 0.03, 18), '#1d2321', {
    x: mouth.x,
    y: mouth.y,
    z: mouth.z,
    rx: Math.PI / 2 - pitch,
    ry: yaw,
  })
  // sound rings spilling out of the horn (Hark green: someone's listening)
  const rings: THREE.Mesh[] = []
  const ringMats: THREE.MeshBasicMaterial[] = []
  const ringGeo = new THREE.TorusGeometry(0.4, 0.014, 5, 40)
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#00ff85').multiplyScalar(1.15),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const r = new THREE.Mesh(ringGeo, mat)
    r.rotation.set(-pitch, yaw, 0, 'YXZ')
    rings.push(r)
    ringMats.push(mat)
  }
  return {
    kit,
    board: new THREE.Vector3(0.4, 4.12, -0.3),
    extra: rings,
    anim(t, calm) {
      for (let i = 0; i < rings.length; i++) {
        const u = calm ? 0.3 + i * 0.25 : (t * 0.55 + i / rings.length) % 1
        const r = rings[i]
        r.position.copy(mouth).addScaledVector(dir, 0.08 + u * 1.1)
        r.scale.setScalar(0.85 + u * 1.1)
        ringMats[i].opacity = calm ? 0.3 : Math.sin(u * Math.PI) * (1 - u) * 1.1
      }
    },
  }
}

// ------------------------------------------------------------------ fillers, stalls, tram

const PASTEL = ['#f6d6c4', '#d4e6d6', '#f3e2a9', '#d6e4f0', '#f1c9b8', '#e8dcc4', '#e3d4ef', '#cfe7e3']
const ROOFS = [C.roofRed, C.roofBlue, '#f2b63d', '#6f9e57', '#c8603a', '#4d6f9b']

function fillerHouse(seed: number, w: number, d: number, h: number) {
  const r = rng(seed)
  const kit = new Kit()
  const wall = PASTEL[Math.floor(r() * PASTEL.length)]
  const roof = ROOFS[Math.floor(r() * ROOFS.length)]
  kit.box(w, h, d, wall, {}, 0.06, 'matte', 2)
  const rise = 0.55 + r() * 0.3
  if (r() < 0.55) gableX(kit, w, d, h, rise, wall, roof)
  else gableZ(kit, w, d, h, rise, wall, roof)
  const floors = h > 1.45 ? 2 : 1
  const fz = d / 2
  const door = r() < 0.5 ? -1 : 1
  kit.box(0.4, 0.78, 0.05, roof, { x: door * w * 0.24, y: 0, z: fz }, 0.02)
  for (let f = 0; f < floors; f++) {
    for (const s of [-1, 1]) {
      if (f === 0 && s === door) continue
      win(kit, s * w * 0.24, 0.32 + f * 0.62, fz, 0.34, 0.36)
      if (f === 0) {
        kit.box(0.44, 0.1, 0.12, '#c8603a', { x: s * w * 0.24, y: 0.2, z: fz + 0.07 }, 0.02)
        kit.ball(0.05, '#e2694a', { x: s * w * 0.24 - 0.1, y: 0.33, z: fz + 0.08 }, 0)
        kit.ball(0.05, '#f2b63d', { x: s * w * 0.24 + 0.08, y: 0.33, z: fz + 0.08 }, 0)
      }
    }
    if (floors === 2 && f === 1) win(kit, door * w * 0.24, 0.94, fz, 0.34, 0.36)
  }
  sideWin(kit, -w / 2, 0.45, 0, 0.36, 0.4)
  if (r() < 0.5) kit.box(0.26, 0.5, 0.26, '#b8472f', { x: w * 0.25, y: h + rise * 0.3, z: -d * 0.2 }, 0.03)
  // little striped awning over the door on some
  if (r() < 0.5) kit.box(0.7, 0.05, 0.36, roof, { x: door * w * 0.24, y: 0.86, z: fz + 0.16, rx: 0.3 }, 0.02)
  return kit
}

const STALL_COL = ['#e2694a', '#4d8fd6', '#7fbf64', '#f0b43c', '#a98bd6', '#63c1e3', '#f2b63d', '#e04a36', '#46b36b']
const FRUIT = ['#e04a36', '#f0b43c', '#7fbf64', '#e2694a', '#a98bd6', '#f2b63d']

function stall(j: number, mats: Mats) {
  const r = rng(90 + j)
  const kit = new Kit()
  const col = STALL_COL[j % STALL_COL.length]
  kit.box(1.62, 0.55, 0.55, WOOD, { z: 0.25 }, 0.04)
  kit.box(1.72, 0.05, 0.62, '#ead6b3', { y: 0.55, z: 0.25 }, 0.01)
  kit.box(1.62, 0.8, 0.34, '#b5834f', { z: -0.46 }, 0.03)
  for (const x of [-0.8, 0.8]) {
    kit.cyl(0.03, 0.03, 1.36, FRAME, { x, z: 0.52 }, 6)
    kit.cyl(0.03, 0.03, 1.62, FRAME, { x, z: -0.6 }, 6)
  }
  // striped awning, sloping to the street
  const n = 6
  const sw = 1.84 / n
  for (let i = 0; i < n; i++) {
    const x = -0.92 + sw * (i + 0.5)
    kit.add(slab(sw, 0.04, 1.36), i % 2 ? '#fbfaf6' : col, { x, y: 1.5, z: -0.02, rx: 0.2 })
    kit.ball(sw / 2, i % 2 ? '#fbfaf6' : col, { x, y: 1.36, z: 0.66, sy: 0.55, sz: 0.3 }, 1)
  }
  // goods
  for (let i = 0; i < 7; i++)
    kit.ball(0.07 + r() * 0.03, FRUIT[Math.floor(r() * FRUIT.length)], { x: -0.62 + i * 0.2, y: 0.66, z: 0.2 + (r() - 0.5) * 0.2 }, 1)
  kit.box(0.34, 0.24, 0.28, WOOD, { x: -0.5, z: 0.82 }, 0.02)
  kit.box(0.3, 0.2, 0.26, WOOD, { x: -0.12, z: 0.86 }, 0.02)
  for (let i = 0; i < 3; i++) kit.ball(0.06, FRUIT[(j + i) % FRUIT.length], { x: -0.58 + i * 0.08, y: 0.27, z: 0.82 }, 0)
  // name board over the awning
  const sy = 1.93
  for (const x of [-0.62, 0.62]) kit.box(0.03, 0.3, 0.03, FRAME, { x, y: 1.62, z: 0.38 }, 0.005)
  kit.box(1.62, 0.44, 0.04, col, { y: sy - 0.22, z: 0.36, rx: -0.12 }, 0.02)
  kit.mapped(cellPlane(1.52, 0.38, stallCell(j), STALLS_W, STALLS_H), mats.stall, { y: sy, z: 0.385, rx: -0.12 })
  // sidewalk A-board with the site's thumbnail
  const ax = 0.6
  const az = 1.22
  for (const s of [-1, 1]) kit.add(slab(0.66, 0.5, 0.03), INK, { x: ax, y: 0.24, z: az + s * 0.06, rx: -s * 0.26 })
  kit.mapped(cellPlane(0.58, 0.3625, posterCell(j), POSTERS_W, POSTERS_H), mats.poster, { x: ax, y: 0.26, z: az + 0.083, rx: -0.26 })
  return kit
}

function buildTram(mats: Mats) {
  const kit = new Kit()
  const Lh = 2.9
  const cream = '#f6f1e7'
  // bogies and skirt
  for (const x of [-0.9, 0.9]) {
    kit.box(0.8, 0.12, 0.62, '#2a3230', { x, y: 0 }, 0.03)
    for (const s of [-1, 1]) kit.cyl(0.08, 0.08, 0.06, '#1d2321', { x: x + s * 0.24, y: 0.07, z: 0.3, rx: Math.PI / 2 }, 10)
  }
  kit.box(Lh - 0.1, 0.14, 0.84, '#2a3230', { y: 0.07 }, 0.04)
  kit.box(Lh, 0.44, 0.9, cream, { y: 0.16 }, 0.12, 'matte', 2)
  kit.box(Lh + 0.02, 0.1, 0.92, C.signal, { y: 0.5 }, 0.05, 'matte', 2)
  kit.box(Lh - 0.08, 0.36, 0.84, '#223540', { y: 0.58 }, 0.1, 'gloss', 2)
  for (let i = 0; i < 7; i++) kit.box(0.07, 0.36, 0.88, cream, { x: -1.2 + i * 0.4, y: 0.58 }, 0.02)
  kit.box(Lh + 0.04, 0.14, 0.94, '#fbfaf6', { y: 0.93 }, 0.07, 'matte', 2)
  kit.box(0.95, 0.12, 0.52, '#b9c0c4', { y: 1.06 }, 0.04)
  // pantograph up to the wire
  const py = 1.17
  const top = L.WIRE_Y - L.RAIL_Y - 0.02
  kit.add(slab(0.04, 0.62, 0.04), '#3a4442', { x: -0.14, y: (py + top) / 2, rz: 0.55 })
  kit.add(slab(0.04, 0.62, 0.04), '#3a4442', { x: 0.14, y: (py + top) / 2, rz: -0.55 })
  kit.box(0.05, 0.03, 0.62, '#3a4442', { y: top - 0.02 }, 0.01)
  // the Hark roundel on the flank
  kit.cyl(0.13, 0.13, 0.03, C.signal, { x: 0.95, y: 0.32, z: 0.455, rx: Math.PI / 2 }, 16)
  kit.box(0.03, 0.14, 0.02, '#fbfaf6', { x: 0.91, y: 0.25, z: 0.475 }, 0.003)
  kit.box(0.03, 0.14, 0.02, '#fbfaf6', { x: 0.99, y: 0.25, z: 0.475 }, 0.003)
  kit.box(0.08, 0.025, 0.02, '#fbfaf6', { x: 0.95, y: 0.31, z: 0.475 }, 0.003)
  // destination blinds (both ends) and lamps
  for (const s of [-1, 1]) {
    kit.mapped(cellPlane(0.62, 0.2, DEST_CELL, SIGNS_W, SIGNS_H), mats.dest, {
      x: s * (Lh / 2 + 0.005),
      y: 0.83,
      ry: (s * Math.PI) / 2,
    })
    for (const z of [-0.28, 0.28]) {
      kit.ball(0.055, s > 0 ? '#fff4d6' : '#ff5a47', { x: s * (Lh / 2 + 0.01), y: 0.3, z }, 1, 'glow', s > 0 ? 2.6 : 1.8)
    }
  }
  const g = kit.build()
  g.traverse(o => {
    const m = o as THREE.Mesh
    if (m.isMesh) m.receiveShadow = false
  })
  const tram = new THREE.Group()
  tram.add(g)
  return tram
}

// ------------------------------------------------------------------ island & street

function islandGeometry(kit: Kit) {
  const r = rng(11)
  const cx = (L.ISLAND.x0 + L.ISLAND.x1) / 2
  const cz = (L.ISLAND.z0 + L.ISLAND.z1) / 2
  const a = (L.ISLAND.x1 - L.ISLAND.x0) / 2
  const b = (L.ISLAND.z1 - L.ISLAND.z0) / 2
  const N = 180
  const n = 7
  const pts: THREE.Vector2[] = []
  const f1 = r() * 6
  const f2 = r() * 6
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2
    const c = Math.cos(t)
    const s = Math.sin(t)
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n)
    const z = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)
    // outward normal of the superellipse
    const nx = (Math.pow(Math.abs(x / a) + 1e-6, n - 1) * Math.sign(x)) / a
    const nz = (Math.pow(Math.abs(z / b) + 1e-6, n - 1) * Math.sign(z)) / b
    const nl = Math.hypot(nx, nz) || 1
    const u = (x + z) * 0.35
    const w = 0.34 * Math.sin(u * 0.9 + f1) + 0.2 * Math.sin(u * 2.3 + f2) + 0.1 * Math.sin(u * 5.1)
    pts.push(new THREE.Vector2(cx + x + (nx / nl) * w, cz + z + (nz / nl) * w))
  }
  // shapes are drawn in (x, -z) so rotateX(-90°) lands them in (x, z)
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.y)))
  const cap = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.2,
    bevelSegments: 2,
    curveSegments: 1,
  })
  cap.rotateX(-Math.PI / 2)
  cap.translate(0, -0.44, 0)
  kit.add(cap, C.grass)
  const soil = new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false, curveSegments: 1 })
  soil.rotateX(-Math.PI / 2)
  soil.translate(0, -1.55, 0)
  kit.add(soil, C.soil)
  // a darker stripe of earth
  const band = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false, curveSegments: 1 })
  band.rotateX(-Math.PI / 2)
  band.scale(1.003, 1, 1.01)
  band.translate(-cx * 0.003, -1.25, -cz * 0.01)
  kit.add(band, '#86624a')

  // rocky underside: rings shrink toward a long keel
  const rings = 7
  const D = 8.5
  const top = -1.55
  const pos: number[] = []
  const ring: THREE.Vector3[][] = []
  for (let k = 0; k <= rings; k++) {
    const t = k / rings
    const sx = 1 - 0.5 * Math.pow(t, 1.1)
    const sz = Math.pow(1 - t, 1.2) * 0.96 + 0.04
    const row: THREE.Vector3[] = []
    for (let i = 0; i < N; i++) {
      const p = pts[i]
      const jag = k === 0 ? 1 : 0.86 + r() * 0.24
      const y = top - t * D * (0.75 + 0.25 * Math.cos(((p.x - cx) / a) * 1.4)) + (k > 0 && k < rings ? (r() - 0.5) * 0.7 : 0)
      row.push(new THREE.Vector3(cx + (p.x - cx) * sx * (k === 0 ? 1 : jag * 0.5 + 0.5), y, cz + (p.y - cz) * sz * jag))
    }
    ring.push(row)
  }
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < N; i++) {
      const a0 = ring[k][i]
      const b0 = ring[k][(i + 1) % N]
      const c0 = ring[k + 1][i]
      const d0 = ring[k + 1][(i + 1) % N]
      pos.push(a0.x, a0.y, a0.z, b0.x, b0.y, b0.z, c0.x, c0.y, c0.z)
      pos.push(b0.x, b0.y, b0.z, d0.x, d0.y, d0.z, c0.x, c0.y, c0.z)
    }
  }
  const rock = new THREE.BufferGeometry()
  rock.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  rock.computeVertexNormals()
  kit.add(rock, C.rock)
  return pts
}

function streetFlat(kit: Kit) {
  const x0 = L.STREET_X0
  const x1 = L.STREET_X1
  const len = x1 - x0
  const mx = (x0 + x1) / 2
  // road + track bed
  kit.box(len, 0.05, L.ROAD.z1 - L.ROAD.z0, ROADC, { x: mx, y: 0 }, 0)
  kit.box(len, 0.012, 0.92, BED, { x: mx, y: 0.05 }, 0)
  // lane dashes
  for (let x = x0 + 0.8; x < x1 - 0.5; x += 1.3) for (const z of [-0.72, 0.72]) kit.box(0.6, 0.012, 0.05, '#f4efe4', { x, y: 0.05, z }, 0)
  // zebra crossings by every stop
  for (const sx of L.SHOP_X) {
    const cx = sx + L.POLE_DX + 0.9
    for (let i = 0; i < 6; i++) kit.box(0.16, 0.014, 2.3, '#f4efe4', { x: cx - 0.45 + i * 0.18, y: 0.05 }, 0)
  }
  // sidewalks + curbs
  for (const w of [L.WALK_FAR, L.WALK_NEAR]) {
    const z = (w.z0 + w.z1) / 2
    kit.box(len, 0.1, w.z1 - w.z0, PAVE, { x: mx, z }, 0.03)
    const cz = w === L.WALK_FAR ? w.z1 - 0.06 : w.z0 + 0.06
    kit.box(len, 0.104, 0.12, CURB, { x: mx, z: cz }, 0.02)
  }
  // paving joints on the far sidewalk (tiny detail at close range)
  for (let x = x0 + 1; x < x1; x += 1.1) kit.box(0.025, 0.004, 0.9, '#dccfb4', { x, y: 0.1, z: (L.WALK_FAR.z0 + L.WALK_FAR.z1) / 2 }, 0)
  // canal + stone edging
  const cz = (L.CANAL.z0 + L.CANAL.z1) / 2
  const cw = L.CANAL.z1 - L.CANAL.z0
  // the canal runs off the west end of the island as a waterfall (see life.ts)
  const cx0 = L.FALL_X
  const cx1 = 63
  kit.box(cx1 - cx0, 0.03, cw, C.water, { x: (cx0 + cx1) / 2, y: 0.0 }, 0, 'gloss')
  for (const z of [L.CANAL.z0 - 0.07, L.CANAL.z1 + 0.07]) kit.box(cx1 - cx0 + 0.15, 0.09, 0.14, '#e3d6bd', { x: (cx0 + cx1) / 2 + 0.07, z }, 0.03)
  kit.box(0.14, 0.09, cw + 0.28, '#e3d6bd', { x: cx1 + 0.07, z: cz }, 0.03)
  // back lane
  kit.box(len - 2, 0.03, 0.8, '#e6d9bf', { x: mx, z: -5.55 }, 0)
  // flower patches on the near grass
  const r = rng(71)
  for (let i = 0; i < 70; i++) {
    const x = x0 + 1 + r() * (len - 4)
    const z = r() < 0.5 ? 2.5 + r() * 0.35 : 4.2 + r() * 0.7
    kit.ball(0.045 + r() * 0.02, ['#f2b63d', '#e2694a', '#fbfaf6', '#a98bd6'][i % 4], { x, y: 0.04, z }, 0)
  }
}

function streetFurniture(kit: Kit, wires: Kit) {
  // catenary: poles on the far curb with arms over the tracks, one contact wire
  const poles: number[] = []
  for (let x = L.STREET_X0 + 1.4; x < L.STREET_X1 - 0.5; x += 3.75) poles.push(x)
  for (const x of poles) {
    kit.cyl(0.04, 0.05, L.WIRE_Y + 0.28, '#4a5451', { x, y: 0.1, z: -1.46 }, 8)
    kit.box(0.04, 0.04, 1.5, '#4a5451', { x, y: L.WIRE_Y + 0.12, z: -0.74 }, 0.005)
    kit.ball(0.05, '#4a5451', { x, y: L.WIRE_Y + 0.4, z: -1.46 }, 0)
  }
  wires.box(L.STREET_X1 - L.STREET_X0 - 1.5, 0.016, 0.016, '#3a4442', { x: (L.STREET_X0 + L.STREET_X1) / 2 + 0.4, y: L.WIRE_Y, z: 0 }, 0)
  // rails run on across the sky bridge
  const rl = L.BRIDGE_END - L.BUFFER_X
  for (const z of [-0.29, 0.29]) wires.box(rl, 0.03, 0.05, RAIL, { x: (L.BUFFER_X + L.BRIDGE_END) / 2, y: 0.05, z }, 0, 'gloss')

  // near-side street lamps with Hark-green LED rings
  for (let x = L.STREET_X0 + 3; x < L.STREET_X1 - 1; x += 3.75) {
    kit.cyl(0.03, 0.04, 1.35, INK, { x, y: 0.1, z: 2.08 }, 8)
    kit.box(0.24, 0.07, 0.14, INK, { x, y: 1.43, z: 1.99 }, 0.03)
    kit.box(0.18, 0.025, 0.1, '#00ff85', { x, y: 1.415, z: 1.99 }, 0.01, 'glow')
  }
  // tram stops: green roundel pole, timetable, bench
  for (let k = 0; k < L.STOP_X.length; k++) {
    const x = L.STOP_X[k] + L.POLE_DX
    const z = -1.56
    kit.cyl(0.035, 0.04, 1.42, INK, { x, y: 0.1, z }, 8)
    kit.cyl(0.21, 0.21, 0.05, C.signal, { x, y: 1.5, z, rx: Math.PI / 2, ry: L.BOARD_YAW }, 18)
    kit.cyl(0.155, 0.155, 0.055, '#fbfaf6', { x, y: 1.5, z, rx: Math.PI / 2, ry: L.BOARD_YAW }, 18)
    const hz = z + 0.03
    kit.box(0.035, 0.17, 0.02, INK, { x: x - 0.045, y: 1.415, z: hz, ry: L.BOARD_YAW }, 0.004)
    kit.box(0.035, 0.17, 0.02, INK, { x: x + 0.045, y: 1.415, z: hz, ry: L.BOARD_YAW }, 0.004)
    kit.box(0.09, 0.03, 0.02, INK, { x, y: 1.485, z: hz, ry: L.BOARD_YAW }, 0.004)
    kit.box(0.24, 0.32, 0.05, '#fbfaf6', { x, y: 0.72, z: z + 0.04 }, 0.02)
    kit.box(0.2, 0.05, 0.055, C.signal, { x, y: 0.95, z: z + 0.04 }, 0.01)
    // bench
    const bx = x + 0.75
    kit.box(0.9, 0.05, 0.28, WOOD, { x: bx, y: 0.3, z: -2.05 }, 0.02)
    kit.box(0.9, 0.22, 0.04, WOOD, { x: bx, y: 0.4, z: -2.2, rx: -0.12 }, 0.015)
    for (const s of [-1, 1]) kit.box(0.04, 0.2, 0.24, INK, { x: bx + s * 0.38, y: 0.1, z: -2.05 }, 0.01)
  }
  // near sidewalk: planters and benches between stops
  const r = rng(37)
  for (let x = L.STREET_X0 + 1.2; x < L.STREET_X1 - 1; x += 3.75) {
    const px = x + 1.3
    kit.box(0.7, 0.24, 0.36, '#d9774b', { x: px, y: 0.1, z: 1.95 }, 0.05)
    for (let i = 0; i < 4; i++) kit.ball(0.09, r() < 0.5 ? C.leaf : C.meadow, { x: px - 0.24 + i * 0.16, y: 0.38, z: 1.95 }, 1)
    for (let i = 0; i < 3; i++) kit.ball(0.045, ['#f2b63d', '#e2694a', '#fbfaf6'][i], { x: px - 0.18 + i * 0.18, y: 0.48, z: 1.98 }, 0)
  }
  // footbridges over the canal
  for (const x of [-4.5, 11.2, 26.2, 49.5]) {
    kit.box(1.0, 0.1, 1.5, '#e3d6bd', { x, y: 0.06, z: (L.CANAL.z0 + L.CANAL.z1) / 2 }, 0.04)
    for (const s of [-1, 1]) kit.box(0.05, 0.22, 1.5, '#fbfaf6', { x: x + s * 0.47, y: 0.16, z: (L.CANAL.z0 + L.CANAL.z1) / 2 }, 0.02)
  }
}

function terminus(kit: Kit, mats: Mats) {
  // buffer stop
  const bx = L.BUFFER_X
  kit.box(0.34, 0.36, 1.1, '#e04a36', { x: bx - 0.1, y: 0.05 }, 0.05)
  for (const z of [-0.36, 0, 0.36]) kit.box(0.36, 0.1, 0.18, '#fbfaf6', { x: bx - 0.1, y: 0.2, z }, 0.01)
  // shelter on the far sidewalk
  const sx = -8.2
  const sz = -1.92
  for (const x of [-0.8, 0.8]) kit.cyl(0.04, 0.04, 1.3, INK, { x: sx + x, y: 0.1, z: sz + 0.25 }, 8)
  kit.box(1.9, 1.2, 0.05, '#cfe3ea', { x: sx, y: 0.2, z: sz - 0.26 }, 0.02, 'gloss')
  kit.box(2.1, 0.09, 0.8, C.signal, { x: sx, y: 1.4, z: sz }, 0.04, 'matte', 2)
  kit.box(1.4, 0.05, 0.28, WOOD, { x: sx, y: 0.36, z: sz - 0.08 }, 0.02)
  // welcome sign on the near grass
  const wx = -8.4
  const wz = 2.75
  for (const s of [-1, 1]) kit.cyl(0.05, 0.05, 1.1, '#fbfaf6', { x: wx + s * 0.62, z: wz }, 8)
  kit.box(1.7, 0.86, 0.06, '#1f6a40', { x: wx, y: 0.5, z: wz - 0.02, ry: L.BOARD_YAW, rx: -0.08 }, 0.05)
  kit.mapped(cellPlane(1.6, 0.8, WELCOME_CELL, STALLS_W, STALLS_H), mats.stall, { x: wx, y: 0.93, z: wz + 0.02, ry: L.BOARD_YAW, rx: -0.08 })
  // a bed of flowers under it
  for (let i = 0; i < 12; i++) kit.ball(0.07, ['#f2b63d', '#e2694a', '#fbfaf6'][i % 3], { x: wx - 0.7 + i * 0.13, y: 0.05, z: wz + 0.25 + (i % 2) * 0.1 }, 0)
}

function market(kit: Kit, mats: Mats) {
  // "Market Row" banner on two poles over the far sidewalk
  const ax = L.ARCH_X
  for (const s of [-1, 1]) kit.cyl(0.05, 0.05, 2.3, '#fbfaf6', { x: ax + s * 0.95, y: 0.1, z: -1.9 }, 8)
  kit.box(2.1, 0.62, 0.06, '#c8603a', { x: ax, y: 1.8, z: -1.9 }, 0.05)
  kit.mapped(cellPlane(1.86, 0.62, ARCH_CELL, SIGNS_W, SIGNS_H), mats.sign, { x: ax, y: 2.11, z: -1.865 })
  for (const s of [-1, 1]) kit.ball(0.08, C.signal, { x: ax + s * 0.95, y: 2.45, z: -1.9 }, 1)
  // bunting poles along both sidewalks
  for (let x = L.STALL_X[0] - 1; x <= L.STALL_X[8] + 1.2; x += 2.05 * 2) {
    kit.cyl(0.03, 0.035, 2.2, '#fbfaf6', { x, y: 0.1, z: -1.4 }, 6)
    kit.cyl(0.03, 0.035, 2.2, '#fbfaf6', { x, y: 0.1, z: 1.4 }, 6)
  }
  // picnic tables + a little fountain on the near side
  for (const x of [48.5, 55.5]) {
    kit.box(1.1, 0.06, 0.5, WOOD, { x, y: 0.42, z: 2.7 }, 0.02)
    for (const s of [-1, 1]) kit.box(1.1, 0.05, 0.2, WOOD, { x, y: 0.25, z: 2.7 + s * 0.42 }, 0.02)
    for (const s of [-1, 1]) kit.box(0.06, 0.42, 0.4, INK, { x: x + s * 0.45, y: 0, z: 2.7 }, 0.01)
  }
  kit.cyl(0.8, 0.9, 0.3, '#e3d6bd', { x: 52, z: 2.72 }, 20)
  kit.cyl(0.66, 0.66, 0.04, C.water, { x: 52, y: 0.27, z: 2.72 }, 20, 'gloss')
  kit.cyl(0.08, 0.12, 0.62, '#e3d6bd', { x: 52, y: 0.3, z: 2.72 }, 10)
  kit.cyl(0.28, 0.1, 0.1, '#e3d6bd', { x: 52, y: 0.9, z: 2.72 }, 12)
}

function windmill(kit: Kit) {
  const x = 64.2
  const z = 3.0
  kit.cyl(0.52, 0.78, 2.4, '#fbf3df', { x, z }, 14)
  kit.add(new THREE.ConeGeometry(0.66, 0.8, 14), '#c8603a', { x, y: 2.8, z })
  kit.box(0.34, 0.6, 0.05, '#8a4a30', { x: x - 0.1, y: 0, z: z + 0.72, ry: -0.3 }, 0.02)
  kit.cyl(0.14, 0.14, 0.05, GLASS, { x: x - 0.1, y: 1.4, z: z + 0.62, rx: Math.PI / 2, ry: -0.3 }, 10, 'gloss')
  const sails = new THREE.Group()
  const sk = new Kit()
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2
    sk.add(slab(0.05, 1.7, 0.03), '#8a735d', { x: Math.sin(a) * 0.85, y: Math.cos(a) * 0.85, rz: -a })
    sk.add(slab(0.32, 1.25, 0.02), '#fbfaf6', { x: Math.sin(a) * 1.0 + Math.cos(a) * 0.18, y: Math.cos(a) * 1.0 - Math.sin(a) * 0.18, rz: -a })
  }
  sk.cyl(0.12, 0.12, 0.2, '#8a735d', { rx: Math.PI / 2, y: 0, z: -0.1 }, 10)
  sails.add(sk.build())
  sails.position.set(x - 0.2, 2.45, z + 0.62)
  sails.rotation.set(0, L.VIEW_YAW * 0.8, 0, 'YXZ')
  return sails
}

function bridge(kit: Kit) {
  const x0 = L.STREET_X1 - 0.4
  const x1 = L.BRIDGE_END
  const mx = (x0 + x1) / 2
  kit.box(x1 - x0, 0.16, 1.2, '#e8dcc4', { x: mx, y: -0.11 }, 0.04)
  kit.box(x1 - x0, 0.03, 0.9, BED, { x: mx, y: 0.03 }, 0)
  for (const s of [-1, 1]) kit.box(x1 - x0, 0.04, 0.05, '#fbfaf6', { x: mx, y: 0.46, z: s * 0.58 }, 0.01)
  for (let x = x0 + 0.5; x < x1; x += 1.4) for (const s of [-1, 1]) kit.box(0.04, 0.42, 0.04, '#fbfaf6', { x, y: 0.05, z: s * 0.58 }, 0.005)
  // little lanterns
  for (let x = x0 + 2; x < x1; x += 5.6) kit.ball(0.06, '#00ff85', { x, y: 0.52, z: 0.58 }, 1, 'glow', 1.8)
}

function backdrop(kit: Kit) {
  const r = rng(23)
  // back-row houses (smaller, behind the shops)
  for (let x = L.STREET_X0 + 1.5; x < L.STREET_X1 - 2; x += 2.9 + r() * 0.9) {
    const z = -6.6 - r() * 1.4
    const w = 1.5 + r() * 0.7
    const d = 1.3 + r() * 0.4
    const h = 0.9 + r() * 0.55
    const wall = PASTEL[Math.floor(r() * PASTEL.length)]
    const roof = ROOFS[Math.floor(r() * ROOFS.length)]
    kit.box(w, h, d, wall, { x, z }, 0.05)
    const rise = 0.45 + r() * 0.2
    kit.add(prism(d, rise, w), wall, { x, y: h, z, ry: Math.PI / 2 })
    const th = Math.atan2(rise, d / 2)
    const len = Math.hypot(rise, d / 2) + 0.14
    for (const s of [-1, 1]) kit.add(slab(w + 0.2, 0.08, len), roof, { x, y: h + rise / 2 + 0.04, z: z + s * (d / 4 + 0.02), rx: s * th })
    for (const s of [-1, 1]) kit.box(0.28, 0.3, 0.03, GLASS, { x: x + s * w * 0.25, y: 0.35, z: z + d / 2 + 0.01 }, 0.01, 'gloss')
  }
  // hedges + fences along the back lane
  for (let x = L.STREET_X0 + 0.5; x < L.STREET_X1 - 1; x += 2.6) {
    kit.box(1.8, 0.3, 0.32, r() < 0.5 ? '#5aa860' : C.leaf, { x, z: -5.05 }, 0.12, 'matte', 2)
  }
  for (let x = L.STREET_X0 + 1; x < L.STREET_X1 - 1; x += 0.5) kit.box(0.06, 0.3, 0.04, '#fbfaf6', { x, z: -5.95 }, 0.01)
  kit.box(L.STREET_X1 - L.STREET_X0 - 2, 0.04, 0.03, '#fbfaf6', { x: (L.STREET_X0 + L.STREET_X1) / 2, y: 0.22, z: -5.95 }, 0)
  // sheds
  for (const x of [6, 19, 33, 47, 58]) {
    kit.box(0.8, 0.6, 0.6, '#b5834f', { x, z: -8.3 }, 0.03)
    kit.box(0.92, 0.07, 0.72, '#6f5c49', { x, y: 0.6, z: -8.3, rx: 0.15 }, 0.02)
  }
}

// ------------------------------------------------------------------ trees

function treeSet(mobile: boolean): TreeSet {
  const r = rng(51)
  const items: TreeSet['items'] = []
  const add = (x: number, z: number, s: number) => {
    const kind: 0 | 1 = r() < 0.72 ? 0 : 1
    items.push({
      x,
      z,
      s,
      kind,
      h: 0.45 + r() * 0.3,
      r: 0.42 + r() * 0.16,
      phase: r() * 6.28,
      at: 0,
      spring: new Spring(150 + r() * 60, 10),
      ci: Math.floor(r() * 5),
    })
  }
  // near grass strip between stops (kept clear of where the tram halts)
  for (const sx of L.SHOP_X) for (const dx of [3.2, 4.4]) add(sx + dx + (r() - 0.5) * 0.3, 2.62 + r() * 0.25, 0.85 + r() * 0.3)
  add(-5.6, 2.7, 1.0)
  for (let x = 43; x < 64; x += 3.1) add(x + r() * 0.6, 2.6 + r() * 0.3, 0.8 + r() * 0.3)
  // beyond the canal (foreground)
  const step = mobile ? 3.6 : 2.4
  for (let x = L.STREET_X0 + 0.5; x < L.STREET_X1 - 2; x += step + r() * 1.2) add(x, 4.35 + r() * 0.55, 0.8 + r() * 0.5)
  // back gardens
  const bstep = mobile ? 2.6 : 1.7
  for (let x = L.STREET_X0 + 0.8; x < L.STREET_X1 - 1; x += bstep + r() * 1.1) add(x, -5.4 - r() * 0.2 - (r() < 0.5 ? 0 : 3.1), 0.8 + r() * 0.5)
  // around the terminus + windmill
  add(-11.4, 0.8, 1.1)
  add(-11.6, -2.8, 1.2)
  add(-11.1, -6.3, 0.9)
  add(65.8, 1.2, 1.0)
  add(65.4, -3.4, 1.2)

  const trunkGeo = new THREE.CylinderGeometry(0.06, 0.085, 1, 6)
  trunkGeo.translate(0, 0.5, 0)
  const crownGeo = new THREE.IcosahedronGeometry(1, 1)
  const coneGeo = new THREE.ConeGeometry(1, 1, 8)
  coneGeo.translate(0, 0.5, 0)
  const matT = new THREE.MeshStandardMaterial({ color: C.soil, roughness: 0.9 })
  const matC = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })
  const n = items.length
  const trunks = new THREE.InstancedMesh(trunkGeo, matT, n)
  const crowns = new THREE.InstancedMesh(crownGeo, matC, n)
  const cones = new THREE.InstancedMesh(coneGeo, matC, n)
  const greens = [C.leaf, C.meadow, C.leafDark, '#5aa860', '#8cc56b'].map(c => new THREE.Color(c))
  for (let i = 0; i < n; i++) {
    crowns.setColorAt(i, greens[items[i].ci])
    cones.setColorAt(i, greens[(items[i].ci + 2) % greens.length])
  }
  for (const m of [trunks, crowns, cones]) {
    m.castShadow = true
    m.receiveShadow = true
    m.frustumCulled = false
  }
  return { trunks, crowns, cones, items }
}

// ------------------------------------------------------------------ assemble

export async function buildTown(signage: Signage, mobile: boolean, placeholder: THREE.Texture): Promise<Town> {
  const root = new THREE.Group()
  const mats: Mats = {
    sign: decal(new THREE.MeshStandardMaterial({ map: signage.signsTex, roughness: 0.7 })),
    face: decal(new THREE.MeshBasicMaterial({ map: signage.signsTex, color: new THREE.Color(0.9, 0.9, 0.9) })),
    stall: decal(new THREE.MeshStandardMaterial({ map: signage.stallsTex, roughness: 0.75 })),
    poster: decal(new THREE.MeshBasicMaterial({ map: signage.postersTex })),
    dest: decal(new THREE.MeshBasicMaterial({ map: signage.signsTex, color: new THREE.Color(1.5, 1.5, 1.5) })),
  }

  // island (receives shadows; casting would only shade the void below)
  const ik = new Kit()
  islandGeometry(ik)
  root.add(ik.build({ cast: false }))

  const flat = new Kit()
  streetFlat(flat)
  root.add(flat.build({ cast: false }))
  await nextFrame()
  const furn = new Kit()
  const wires = new Kit()
  streetFurniture(furn, wires)
  await nextFrame()
  terminus(furn, mats)
  market(furn, mats)
  const sails = windmill(furn)
  bridge(wires)
  root.add(wires.build({ cast: false }))
  root.add(furn.build())
  root.add(sails)
  await nextFrame()

  const back = new Kit()
  backdrop(back)
  root.add(back.build())
  await nextFrame()

  // shops
  const smoke = new THREE.InstancedMesh(ball(1, 1), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 1 }), mobile ? 5 : 8)
  smoke.frustumCulled = false
  const makers = [
    () => shopBank(mats),
    () => shopExchange(mats),
    () => shopHouse(mats),
    () => shopFactory(mats, smoke),
    () => shopTheatre(mats),
    () => shopHall(mats),
  ]
  const shops: Popper[] = []
  const boards: Board[] = []
  const anims: ((t: number, calm: boolean) => void)[] = []
  const pokeables: Town['pokeables'] = []
  for (let k = 0; k < makers.length; k++) {
    if (k % 2 === 0 && k > 0) await nextFrame()
    const b = makers[k]()
    const g = new THREE.Group()
    const body = b.kit.build()
    g.add(body)
    for (const e of b.extra ?? []) g.add(e)
    const board = buildBoard(k, mats, placeholder)
    board.root.position.copy(b.board)
    g.add(board.root)
    g.position.set(L.SHOP_X[k], 0, L.SHOP_Z)
    board.center.copy(b.board).add(g.position)
    root.add(g)
    const p: Popper = { obj: g, spring: new Spring(170, 11), at: 0, x: L.SHOP_X[k] }
    shops.push(p)
    boards.push(board)
    pokeables.push({ mesh: body, popper: p })
    if (b.anim) anims.push(b.anim)
  }
  await nextFrame()

  // filler houses in the gaps (set back a little so the shops lead)
  const fillers: Popper[] = []
  const gaps = [-3.75, ...L.SHOP_X.map(x => x + 3.75)]
  gaps.forEach((x, i) => {
    const r = rng(300 + i)
    const w = 2.1 + r() * 0.35
    const d = 2.0 + r() * 0.3
    const h = 1.25 + r() * 0.6
    const kit = fillerHouse(300 + i, w, d, h)
    const g = new THREE.Group()
    const body = kit.build()
    g.add(body)
    g.position.set(x, 0, L.FRONT_Z - 0.3 - d / 2)
    root.add(g)
    const p: Popper = { obj: g, spring: new Spring(170, 11), at: 0, x }
    fillers.push(p)
    pokeables.push({ mesh: body, popper: p })
  })
  await nextFrame()

  // market stalls
  const stalls: Popper[] = []
  L.STALL_X.forEach((x, j) => {
    const g = stall(j, mats).build()
    g.position.set(x, 0, L.STALL_Z)
    root.add(g)
    const p: Popper = { obj: g, spring: new Spring(200, 12), at: -1, x }
    stalls.push(p)
    pokeables.push({ mesh: g, popper: p })
  })
  await nextFrame()

  const tram = buildTram(mats)
  tram.position.set(L.TERMINUS_X, L.RAIL_Y, 0)
  root.add(tram)

  const trees = treeSet(mobile)
  root.add(trees.trunks, trees.crowns, trees.cones)

  // bunting strung along both market sidewalks (instanced pennants that sway)
  const pennants: { x: number; z: number; y: number; ph: number }[] = []
  const strings = new Kit()
  const PER = 9
  for (let x = L.STALL_X[0] - 1; x + 4.1 <= L.STALL_X[8] + 1.3; x += 4.1) {
    for (const z of [-1.4, 1.4]) {
      let prev: THREE.Vector3 | null = null
      for (let i = 0; i <= PER; i++) {
        const u = i / PER
        const p = new THREE.Vector3(x + u * 4.1, 2.28 - Math.sin(u * Math.PI) * 0.4, z)
        if (i > 0 && i < PER) pennants.push({ x: p.x, y: p.y, z: p.z, ph: p.x * 0.9 + z })
        if (prev) {
          const len = prev.distanceTo(p)
          strings.add(slab(len, 0.012, 0.012), '#fbfaf6', {
            x: (prev.x + p.x) / 2,
            y: (prev.y + p.y) / 2 + 0.01,
            z,
            rz: Math.atan2(p.y - prev.y, p.x - prev.x),
          })
        }
        prev = p
      }
    }
  }
  const penGeo = prism(0.2, 0.26, 0.01).clone()
  penGeo.rotateZ(Math.PI)
  const pen = new THREE.InstancedMesh(
    penGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }),
    pennants.length,
  )
  const penCol = ['#e2694a', '#f0b43c', '#fbfaf6', '#4d8fd6', '#7fbf64'].map(c => new THREE.Color(c))
  pennants.forEach((_, i) => pen.setColorAt(i, penCol[i % penCol.length]))
  pen.frustumCulled = false
  root.add(pen)
  root.add(strings.build({ cast: false }))

  const pm = new THREE.Matrix4()
  const pq = new THREE.Quaternion()
  const pe = new THREE.Euler()
  const pv = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)

  return {
    root,
    shops,
    boards,
    fillers,
    stalls,
    tram,
    trees,
    pokeables,
    animate(t, calm) {
      for (const a of anims) a(t, calm)
      sails.children[0].rotation.z = calm ? 0.3 : -t * 0.9
      const amp = calm ? 0.1 : 1
      for (let i = 0; i < pennants.length; i++) {
        const p = pennants[i]
        pe.set(Math.sin(t * 2.4 + p.ph) * 0.35 * amp, 0, 0)
        pq.setFromEuler(pe)
        pm.compose(pv.set(p.x, p.y, p.z), pq, one)
        pen.setMatrixAt(i, pm)
      }
      pen.instanceMatrix.needsUpdate = true
    },
  }
}

// re-export helpers the chapter uses for framing
export { BOARD_W, BOARD_H }
