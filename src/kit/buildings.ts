import * as THREE from 'three'
import { rng } from '../core/math'
import { C, ROOFS, WALLS, clayVC } from './palette'
import { Builder, col, vgrad } from './geo'
import { spin } from './anim'

/*
 * Buildings: houses & shops (gable / hip / flat / shed roofs, chimneys,
 * framed windows that glow at dusk, doors with steps, flower boxes,
 * shutters, striped awnings), towers and a windmill. Each is ONE vertex-
 * colour mesh (plus moving parts), so a street of them merges cheaply.
 */

export interface HouseOptions {
  w?: number
  d?: number
  h?: number
  wall?: string
  roof?: string
  /** roof style (default: seeded) */
  style?: 'gable' | 'flat' | 'shed' | 'hip'
  seed?: number
  /** chimney (default: seeded, pitched roofs only) */
  chimney?: boolean
  /** striped awning over the front: colour, or true for a seeded colour */
  awning?: string | boolean
  /** shopfront: big display window + fascia board on the ground floor */
  shop?: boolean
  /** door/accent colour (default: roof colour) */
  accent?: string
  /** flower boxes under ground-floor windows (default: seeded) */
  flowers?: boolean
  /** shutters beside windows (default: seeded) */
  shutters?: boolean
}

/** Window glass: a soft sky reflection, lighter at the top (local to the pane's centre y). */
const glassAt = (y: number, h = 0.26) => vgrad('#3a5361', '#86a5b5', y - h / 2, y + h / 2)

/** Unit front-facing quad (+z). */
const quad = () => new THREE.PlaneGeometry(1, 1)

function shade(hex: string, k: number) {
  return '#' + col(hex).clone().multiplyScalar(k).getHexString()
}

/** Pick a deterministic item. */
function pick<T>(rand: () => number, arr: readonly T[]) {
  return arr[Math.floor(rand() * arr.length) % arr.length]
}

/**
 * Add a framed window centred at (x, y) on a face. `face` = outward normal
 * axis: 'z' (front/back, sign by nz) or 'x' (sides).
 */
function addWindow(
  b: Builder,
  x: number,
  y: number,
  z: number,
  face: 'x' | 'z',
  sign: number,
  ww: number,
  wh: number,
  frame: string,
  opts: { shutters?: string; box?: boolean; glowK?: number } = {},
) {
  const ry = face === 'z' ? (sign > 0 ? 0 : Math.PI) : sign > 0 ? Math.PI / 2 : -Math.PI / 2
  const off = (o: number) => (face === 'z' ? { x, y, z: z + sign * o, ry } : { x: x + sign * o, y, z, ry })
  b.box(ww + 0.06, wh + 0.06, 0.03, frame, off(0.01))
  // glass (glows at dusk), with a cross mullion — front-facing quads (cheap)
  b.add(quad(), glassAt(y, wh), { ...off(0.0265), sx: ww, sy: wh }, opts.glowK ?? 1)
  b.add(quad(), frame, { ...off(0.03), sx: ww, sy: 0.022 })
  b.add(quad(), frame, { ...off(0.0305), sx: 0.022, sy: wh })
  if (opts.shutters) {
    const sx = ww / 2 + 0.07
    const put = (dx: number) => (face === 'z' ? { x: x + dx, y, z: z + sign * 0.02, ry } : { x, y, z: z + dx, ry })
    b.box(0.09, wh + 0.04, 0.02, opts.shutters, put(sx))
    b.box(0.09, wh + 0.04, 0.02, opts.shutters, put(-sx))
  }
  if (opts.box) {
    const by = y - wh / 2 - 0.06
    const p = face === 'z' ? { x, y: by, z: z + sign * 0.06, ry } : { x: x + sign * 0.06, y: by, z, ry }
    b.rbox(ww + 0.08, 0.07, 0.09, 0.02, C.woodDark, p, 1)
    for (let i = 0; i < 4; i++) {
      const fx = (i / 3 - 0.5) * ww
      const q = face === 'z' ? { x: x + fx, y: by + 0.06, z: z + sign * 0.07 } : { x: x + sign * 0.07, y: by + 0.06, z: z + fx }
      b.sphere(0.032, i % 2 ? C.blossom : C.coral, q, 0)
    }
    const leaves = face === 'z' ? { x, y: by + 0.045, z: z + sign * 0.06, ry } : { x: x + sign * 0.06, y: by + 0.045, z, ry }
    b.box(ww + 0.02, 0.03, 0.06, '#5aa55e', leaves)
  }
}

/** A small house or shop with framed windows, a door, a roof and details. */
export function makeHouse(o: HouseOptions = {}): THREE.Group {
  const rand = rng((o.seed ?? 5) * 97 + 11)
  const w = o.w ?? 1.4, d = o.d ?? 1.2, h = o.h ?? 1.1
  const style = o.style ?? pick(rand, ['gable', 'gable', 'hip', 'flat', 'gable', 'shed'] as const)
  const wall = o.wall ?? pick(rand, WALLS)
  const roof = o.roof ?? pick(rand, ROOFS)
  const accent = o.accent ?? (rand() < 0.5 ? roof : pick(rand, [C.teal, C.roofBlue, C.coral, C.mustard, C.roofGreen]))
  const frame = C.white === wall ? C.cream : C.white
  const shutters = (o.shutters ?? rand() < 0.35) ? shade(accent, 0.95) : undefined
  const flowers = o.flowers ?? rand() < 0.45
  const chimney = o.chimney ?? rand() < 0.55
  const b = new Builder()

  // plinth + body
  b.rbox(w + 0.08, 0.08, d + 0.08, 0.03, C.stone, { y: 0.04 }, 1)
  b.rbox(w, h, d, 0.05, wall, { y: h / 2 + 0.02 }, 2)
  const top = h + 0.02

  // ---------- roof
  const ridgeX = w >= d
  const span = ridgeX ? d : w
  const len = ridgeX ? w : d
  const rot = ridgeX ? Math.PI / 2 : 0
  const oh = 0.09
  const rc = roof, rcDark = shade(roof, 0.82)
  // shingle rows: alternate bands along the height, darker undersides
  const cRoof = col(rc), cRoofDark = col(rcDark)
  const roofPaint = (_x: number, y: number, _z: number, out: THREE.Color, _nx: number, ny: number) => {
    if (ny < 0.3) return out.copy(cRoofDark)
    return out.copy(cRoof).multiplyScalar(Math.floor((y - top) / 0.07) % 2 ? 1 : 0.9)
  }
  if (style === 'gable') {
    const pitch = 0.62
    const rise = (span / 2) * Math.tan(pitch)
    const slab = (span / 2 + oh) / Math.cos(pitch)
    const t = 0.08
    // gable wall (triangle prism in wall colour)
    const tri = new THREE.Shape()
    tri.moveTo(-span / 2, 0)
    tri.lineTo(span / 2, 0)
    tri.lineTo(0, rise)
    tri.closePath()
    const prism = new THREE.ExtrudeGeometry(tri, { depth: len - 0.02, bevelEnabled: false })
    prism.translate(0, 0, -(len - 0.02) / 2)
    prism.rotateY(rot)
    b.add(prism, wall, { y: top - 0.005 })
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(slab, t, len + 0.2)
      g.rotateZ(-s * pitch)
      const mx = (s * (span / 2 + oh)) / 2
      const my = top + (rise - oh * Math.tan(pitch)) / 2
      g.translate(mx - s * (t / 2) * Math.sin(pitch), my - (t / 2) * Math.cos(pitch) + 0.01, 0)
      g.rotateY(rot)
      b.add(g, roofPaint)
    }
    // ridge cap
    const ridge = new THREE.CylinderGeometry(0.045, 0.045, len + 0.22, 8)
    ridge.rotateX(Math.PI / 2)
    ridge.rotateY(rot)
    b.add(ridge, rcDark, { y: top + rise + 0.01 })
    // round attic windows on both gable ends
    if (span > 0.85) {
      const ay = top + rise * 0.36
      for (const s of [-1, 1]) {
        const e = s * (len / 2 + 0.002)
        const disc = new THREE.CylinderGeometry(0.085, 0.085, 0.03, 14).rotateX(Math.PI / 2)
        const glass = new THREE.CylinderGeometry(0.062, 0.062, 0.02, 14).rotateX(Math.PI / 2)
        if (ridgeX) {
          disc.rotateY(Math.PI / 2)
          glass.rotateY(Math.PI / 2)
          b.add(disc, frame, { x: e, y: ay })
          b.add(glass, glassAt(ay), { x: e + s * 0.012, y: ay }, 1)
        } else {
          b.add(disc, frame, { z: e, y: ay })
          b.add(glass, glassAt(ay), { z: e + s * 0.012, y: ay }, 1)
        }
      }
    }
    if (chimney) {
      const cx = (rand() - 0.5) * len * 0.5
      const cs = rand() < 0.5 ? -1 : 1
      const off = span * 0.22
      const pos = ridgeX ? { x: cx, z: cs * off } : { x: cs * off, z: cx }
      b.rbox(0.16, rise * 0.8 + 0.28, 0.16, 0.03, rand() < 0.5 ? C.terracotta : C.stone, { ...pos, y: top + rise * 0.55 + 0.1 }, 1)
      b.box(0.2, 0.05, 0.2, C.slate, { ...pos, y: top + rise * 0.95 + 0.26 })
    }
  } else if (style === 'hip') {
    const rise = Math.min(w, d) * 0.42
    const cone = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).toNonIndexed()
    cone.deleteAttribute('normal')
    cone.rotateY(Math.PI / 4)
    b.add(cone, roofPaint, {
      y: top + rise / 2 + 0.02,
      sx: w + oh * 2,
      sy: rise,
      sz: d + oh * 2,
    })
    b.rbox(w + oh * 2, 0.06, d + oh * 2, 0.02, rcDark, { y: top + 0.02 }, 1)
    if (chimney) b.rbox(0.16, rise * 0.9, 0.16, 0.03, C.terracotta, { x: w * 0.18, z: -d * 0.12, y: top + rise * 0.55 }, 1)
  } else if (style === 'shed') {
    const tilt = 0.22
    const slab = new THREE.BoxGeometry(w + oh * 2, 0.08, (d + oh * 2) / Math.cos(tilt))
    slab.rotateX(tilt)
    b.add(slab, roofPaint, { y: top + (d / 2) * Math.tan(tilt) + 0.04 })
    // wall top-up under the slope (high at the back)
    const wedge = new THREE.Shape()
    wedge.moveTo(-d / 2, 0)
    wedge.lineTo(d / 2, 0)
    wedge.lineTo(d / 2, Math.tan(tilt) * d)
    wedge.closePath()
    const wg = new THREE.ExtrudeGeometry(wedge, { depth: w - 0.02, bevelEnabled: false })
    wg.translate(0, 0, -(w - 0.02) / 2)
    wg.rotateY(Math.PI / 2)
    b.add(wg, wall, { y: top - 0.01 })
  } else {
    // flat: parapet + roof slab + a little rooftop kit
    b.box(w - 0.04, 0.04, d - 0.04, C.stone, { y: top + 0.01 })
    const p = 0.06
    b.rbox(w + 0.04, 0.12, p, 0.02, rc, { y: top + 0.05, z: d / 2 - p / 2 + 0.02 }, 1)
    b.rbox(w + 0.04, 0.12, p, 0.02, rc, { y: top + 0.05, z: -d / 2 + p / 2 - 0.02 }, 1)
    b.rbox(p, 0.12, d + 0.04, 0.02, rc, { y: top + 0.05, x: w / 2 - p / 2 + 0.02 }, 1)
    b.rbox(p, 0.12, d + 0.04, 0.02, rc, { y: top + 0.05, x: -w / 2 + p / 2 - 0.02 }, 1)
    if (rand() < 0.6) b.rbox(0.28, 0.16, 0.22, 0.03, C.kerb, { x: (rand() - 0.5) * w * 0.4, y: top + 0.1, z: (rand() - 0.5) * d * 0.3 }, 1)
    if (rand() < 0.4) {
      b.cyl(0.12, 0.12, 0.22, 10, C.woodDark, { x: -w * 0.25, y: top + 0.3, z: -d * 0.2 })
      b.cone(0.14, 0.1, 10, C.woodDark, { x: -w * 0.25, y: top + 0.46, z: -d * 0.2 })
      for (const [lx, lz] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) b.cyl(0.012, 0.012, 0.2, 3, C.ink, { x: -w * 0.25 + lx * 0.08, y: top + 0.1, z: -d * 0.2 + lz * 0.08 })
    }
  }

  // ---------- windows and door
  const floors = Math.max(1, Math.round((h - 0.1) / 0.55))
  const floorH = (h - 0.05) / floors
  const winW = 0.2, winH = 0.24
  const colsF = Math.max(1, Math.round(w / 0.42))
  const colsS = Math.max(1, Math.round(d / 0.46))
  const doorCol = Math.floor(colsF / 2)
  const shop = !!o.shop
  for (let f = 0; f < floors; f++) {
    const y = 0.02 + floorH * (f + 0.55)
    for (let c = 0; c < colsF; c++) {
      const x = -w / 2 + (c + 0.5) * (w / colsF)
      if (f === 0 && (c === doorCol || shop)) {
        /* door / shopfront */
      } else addWindow(b, x, y, d / 2, 'z', 1, winW, winH, frame, { shutters, box: f === 0 && flowers })
      addWindow(b, x, y, -d / 2, 'z', -1, winW, winH, frame, { shutters })
    }
    for (let c = 0; c < colsS; c++) {
      const z = -d / 2 + (c + 0.5) * (d / colsS)
      if (d > 0.7) {
        addWindow(b, w / 2, y, z, 'x', 1, winW * 0.9, winH, frame)
        addWindow(b, -w / 2, y, z, 'x', -1, winW * 0.9, winH, frame)
      }
    }
  }
  const doorX = shop ? w * 0.28 : -w / 2 + (doorCol + 0.5) * (w / colsF)
  const doorH = Math.min(0.44, floorH * 0.78)
  b.rbox(0.26, doorH + 0.04, 0.03, 0.01, frame, { x: doorX, y: 0.02 + (doorH + 0.04) / 2 + 0.04, z: d / 2 + 0.005 }, 1)
  b.rbox(0.21, doorH, 0.04, 0.015, accent, { x: doorX, y: 0.04 + doorH / 2 + 0.02, z: d / 2 + 0.01 }, 1)
  b.sphere(0.018, C.mustard, { x: doorX + 0.06, y: 0.04 + doorH * 0.5, z: d / 2 + 0.04 }, 0)
  b.rbox(0.36, 0.05, 0.16, 0.02, C.stone, { x: doorX, y: 0.025, z: d / 2 + 0.1 }, 1)
  if (!shop && rand() < 0.5) {
    // little door canopy
    b.rbox(0.34, 0.035, 0.14, 0.015, rc, { x: doorX, y: 0.08 + doorH + 0.05, z: d / 2 + 0.07, rx: 0.25 }, 1)
  }

  if (shop) {
    // shopfront window + fascia board
    const sw = w * 0.52
    const sx = -w / 2 + 0.08 + sw / 2
    const sh = Math.min(0.42, floorH * 0.7)
    b.box(sw + 0.06, sh + 0.06, 0.03, frame, { x: sx, y: 0.08 + sh / 2 + 0.03, z: d / 2 + 0.01 })
    b.add(new THREE.BoxGeometry(sw, sh, 0.02), glassAt(0.08 + sh / 2 + 0.03, sh), { x: sx, y: 0.08 + sh / 2 + 0.03, z: d / 2 + 0.025 }, 1.2)
    for (let i = 1; i < 3; i++) b.box(0.02, sh, 0.012, frame, { x: sx - sw / 2 + (i * sw) / 3, y: 0.08 + sh / 2 + 0.03, z: d / 2 + 0.035 })
    b.rbox(w * 0.92, 0.13, 0.04, 0.02, accent, { y: Math.min(h - 0.08, floorH * 0.94), z: d / 2 + 0.02 }, 1)
  }

  const aw = o.awning ?? (shop ? true : false)
  if (aw) {
    const awCol = typeof aw === 'string' ? aw : pick(rand, [C.roofRed, C.teal, C.mustard, C.roofBlue, C.roofGreen, C.coral])
    const aWidth = shop ? w * 0.9 : 0.5
    const ax = shop ? 0 : doorX
    const stripes = Math.max(4, Math.round(aWidth / 0.09))
    const ay = shop ? Math.min(h - 0.2, floorH * 0.8) : 0.1 + doorH + 0.04
    for (let i = 0; i < stripes; i++) {
      const sw = aWidth / stripes
      b.box(sw + 0.002, 0.03, 0.3, i % 2 ? C.white : awCol, { x: ax - aWidth / 2 + sw * (i + 0.5), y: ay, z: d / 2 + 0.14, rx: 0.42 })
      // scalloped valance
      b.box(sw * 0.9, 0.06, 0.012, i % 2 ? C.white : awCol, { x: ax - aWidth / 2 + sw * (i + 0.5), y: ay - 0.08, z: d / 2 + 0.28 })
    }
  }

  const mesh = new THREE.Mesh(b.build(), clayVC())
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'house'
  const g = new THREE.Group()
  g.add(mesh)
  g.userData.size = { w, d, h }
  return g
}

/** Flat-roof shop with a big display window, fascia board and striped awning. */
export function makeShop(o: HouseOptions = {}): THREE.Group {
  return makeHouse({ w: 1.5, d: 1.2, h: 1.2, style: 'flat', ...o, shop: true })
}

/** A slim tower: base for a bell tower, radio mast or lighthouse. */
export function makeTower(o: { h?: number; r?: number; color?: string; band?: string; top?: 'cap' | 'dome' | 'none' } = {}): THREE.Group {
  const h = o.h ?? 3, r = o.r ?? 0.45
  const b = new Builder()
  const body = o.color ?? C.white
  b.cyl(r * 0.8, r, h, 24, body, { y: h / 2 })
  b.cyl(r * 1.08, r * 1.12, 0.14, 24, C.stone, { y: 0.07 })
  if (o.band) {
    for (let i = 1; i <= 2; i++) {
      const y = h * (i / 3)
      const rr = r - (r * 0.2 * y) / h
      b.cyl(rr + 0.012, rr + 0.016, h * 0.12, 24, o.band, { y })
    }
  }
  // windows spiralling up
  const n = Math.max(2, Math.floor(h / 0.8))
  for (let i = 0; i < n; i++) {
    const y = 0.5 + (i / n) * (h - 0.8)
    const a = i * 2.2
    const rr = r - (r * 0.2 * y) / h + 0.005
    b.add(new THREE.BoxGeometry(0.12, 0.2, 0.03), glassAt(y, 0.2), { x: Math.sin(a) * rr, y, z: Math.cos(a) * rr, ry: a }, 1)
  }
  const top = o.top ?? 'cap'
  if (top === 'cap') {
    b.cyl(r * 0.95, r * 0.85, 0.12, 24, C.ink, { y: h + 0.06 })
  } else if (top === 'dome') {
    b.add(new THREE.SphereGeometry(r * 0.82, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), o.band ?? C.roofRed, { y: h })
  }
  const mesh = new THREE.Mesh(b.build(), clayVC())
  mesh.castShadow = true
  mesh.receiveShadow = true
  const g = new THREE.Group()
  g.add(mesh)
  return g
}

/**
 * A little windmill whose sails turn by themselves (KIT spinner). The sails
 * are child 'sails' (faces +z); stop them with group.userData.stopSpin().
 */
export function makeWindmill(o: { color?: string; roof?: string; sail?: string; speed?: number; h?: number } = {}): THREE.Group {
  const h = o.h ?? 1.9
  const b = new Builder()
  const body = o.color ?? C.cream
  const roof = o.roof ?? C.roofRed
  b.cyl(0.36, 0.5, h, 8, body, { y: h / 2 })
  b.cyl(0.54, 0.56, 0.1, 8, C.stone, { y: 0.05 })
  b.cone(0.46, 0.55, 8, roof, { y: h + 0.26 })
  b.rbox(0.2, 0.34, 0.05, 0.02, C.woodDark, { y: 0.2, z: 0.47, rx: -0.07 }, 1)
  addWindow(b, 0, h * 0.62, 0.41, 'z', 1, 0.14, 0.18, C.white)
  b.rbox(0.72, 0.05, 0.3, 0.02, C.woodDark, { y: h * 0.45, z: 0.3 }, 1)
  const mesh = new THREE.Mesh(b.build(), clayVC())
  mesh.castShadow = true
  mesh.receiveShadow = true
  const g = new THREE.Group()
  g.add(mesh)

  const s = new Builder()
  const sail = o.sail ?? C.white
  s.cyl(0.07, 0.07, 0.12, 10, C.woodDark, { rx: Math.PI / 2 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2
    const L = 0.95
    const cx = Math.cos(a) * (L / 2 + 0.06), cy = Math.sin(a) * (L / 2 + 0.06)
    s.box(L, 0.035, 0.03, C.woodDark, { x: cx, y: cy, rz: a })
    // sail cloth offset to one side of the spar
    const px = Math.cos(a + Math.PI / 2) * 0.1, py = Math.sin(a + Math.PI / 2) * 0.1
    s.box(L * 0.72, 0.17, 0.015, sail, { x: Math.cos(a) * (L * 0.58) + px, y: Math.sin(a) * (L * 0.58) + py, z: 0.02, rz: a })
  }
  const sails = new THREE.Mesh(s.build(), clayVC())
  sails.name = 'sails'
  sails.castShadow = true
  sails.position.set(0, h * 0.86, 0.52)
  g.add(sails)
  g.userData.stopSpin = spin(sails, o.speed ?? 0.9, 'z')
  return g
}
