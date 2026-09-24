import * as THREE from 'three'
import { rng } from '../core/math'
import { logoShapes } from '../logo/logo'
import { C, MAT, clay, clayVC } from './palette'
import { Builder, col, vnoise2 } from './geo'
import { KIT } from './anim'

/*
 * Street furniture: roads, paths, tram rails, fences, benches, lamps, signs,
 * flags and soft contact-shadow blobs. Roads/paths/rails carry their curve
 * in userData.curve (CatmullRomCurve3) + userData.length, so vehicles can
 * follow them: curve.getPointAt(u), curve.getTangentAt(u).
 */

export type PathPoint = THREE.Vector3 | [number, number] | [number, number, number]

function toCurve(points: PathPoint[], closed = false, y = 0) {
  const pts = points.map(p => (p instanceof THREE.Vector3 ? p.clone() : p.length === 2 ? new THREE.Vector3(p[0], y, p[1]) : new THREE.Vector3(p[0], p[1], p[2])))
  return new THREE.CatmullRomCurve3(pts, closed, 'centripetal', 0.5)
}

interface Frames {
  p: THREE.Vector3[]
  s: THREE.Vector3[]
  u: number[]
}

/** Evenly spaced samples along a curve with flat side vectors (in xz). */
function frames(curve: THREE.Curve<THREE.Vector3>, step: number, closed: boolean): Frames {
  const len = curve.getLength()
  const n = Math.max(2, Math.ceil(len / step))
  const p: THREE.Vector3[] = [], s: THREE.Vector3[] = [], u: number[] = []
  for (let i = 0; i <= n; i++) {
    const t = closed ? (i % n) / n : i / n
    const pt = curve.getPointAt(t)
    const tan = curve.getTangentAt(t)
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize()
    p.push(pt)
    s.push(side)
    u.push(t * len)
  }
  return { p, s, u }
}

/** Flat strip between lateral offsets a > b at height y above the curve. */
function strip(f: Frames, a: number, b: number, y: number, jitter = 0, seed = 0): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = []
  for (let i = 0; i < f.p.length; i++) {
    const j = jitter ? (vnoise2(f.u[i] * 1.7 + seed, seed) - 0.5) * jitter : 0
    const j2 = jitter ? (vnoise2(f.u[i] * 1.9 - seed, seed + 3) - 0.5) * jitter : 0
    const { x, y: py, z } = f.p[i]
    pos.push(x + f.s[i].x * (a + j), py + y, z + f.s[i].z * (a + j))
    pos.push(x + f.s[i].x * (b + j2), py + y, z + f.s[i].z * (b + j2))
  }
  for (let i = 0; i < f.p.length - 1; i++) {
    const A = i * 2, B = i * 2 + 1, A1 = A + 2, B1 = B + 2
    idx.push(A, A1, B, B, A1, B1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setIndex(idx)
  return g
}

/** Vertical skirt along lateral offset `a` from y0 up to y1 (facing outward by sign). */
function skirt(f: Frames, a: number, y0: number, y1: number, sign: number): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = []
  for (let i = 0; i < f.p.length; i++) {
    const { x, y, z } = f.p[i]
    const sx = f.s[i].x, sz = f.s[i].z
    pos.push(x + sx * a, y + y1, z + sz * a, x + sx * a, y + y0, z + sz * a)
    nor.push(sx * sign, 0, sz * sign, sx * sign, 0, sz * sign)
  }
  for (let i = 0; i < f.p.length - 1; i++) {
    const A = i * 2, B = i * 2 + 1, A1 = A + 2, B1 = B + 2
    if (sign > 0) idx.push(A, B, A1, B, B1, A1)
    else idx.push(A, A1, B, B, A1, B1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

export interface RoadOptions {
  width?: number
  color?: string
  /** dashed centre line (default true) */
  line?: boolean
  /** raised kerbs on both sides (default true) */
  kerb?: boolean
  closed?: boolean
  /** height of the road surface above y (default 0.02) */
  y?: number
}

/**
 * A road ribbon through `points` ([x, z] pairs or Vector3s, smoothed with a
 * Catmull-Rom curve): soft grey tarmac, raised pale kerbs, dashed centre line.
 */
export function makeRoad(points: PathPoint[], o: RoadOptions = {}): THREE.Mesh {
  const closed = !!o.closed
  const curve = toCurve(points, closed)
  const f = frames(curve, 0.14, closed)
  const w = o.width ?? 0.9
  const y = o.y ?? 0.02
  const b = new Builder()
  const kerb = o.kerb !== false
  const kw = 0.07
  const tar = col(o.color ?? C.road)
  b.add(strip(f, w / 2, -w / 2, y), (x, _y, z, out) => out.copy(tar).multiplyScalar(0.97 + vnoise2(x * 3, z * 3) * 0.06))
  if (kerb) {
    for (const s of [1, -1]) {
      const a = s > 0 ? w / 2 + kw : -w / 2
      const bb = s > 0 ? w / 2 : -w / 2 - kw
      b.add(strip(f, a, bb, y + 0.025), C.kerb)
      b.add(skirt(f, s * (w / 2 + kw), -0.02, y + 0.025, s), C.stone)
      b.add(skirt(f, s * (w / 2), y, y + 0.025, -s), C.stone)
    }
  } else {
    for (const s of [1, -1]) b.add(skirt(f, (s * w) / 2, -0.02, y, s), shadeHex(o.color ?? C.road, 0.9))
  }
  if (o.line !== false) {
    const len = curve.getLength()
    const dash = 0.22, gap = 0.2
    for (let d = gap; d < len - dash; d += dash + gap) {
      const t0 = d / len, t1 = (d + dash) / len
      const p0 = curve.getPointAt(t0), p1 = curve.getPointAt(t1)
      const mid = p0.clone().add(p1).multiplyScalar(0.5)
      const ang = Math.atan2(p1.x - p0.x, p1.z - p0.z)
      b.box(0.04, 0.004, dash, C.roadLine, { x: mid.x, y: mid.y + y + 0.002, z: mid.z, ry: ang })
    }
  }
  const m = new THREE.Mesh(b.build(), clayVC())
  m.receiveShadow = true
  m.castShadow = false
  m.userData.curve = curve
  m.userData.length = curve.getLength()
  m.name = 'road'
  return m
}

function shadeHex(hex: string, k: number) {
  return '#' + col(hex).clone().multiplyScalar(k).getHexString()
}

/** A soft footpath (sandy by default) with gently irregular edges. */
export function makePath(points: PathPoint[], o: { width?: number; color?: string; closed?: boolean; seed?: number; stones?: boolean } = {}): THREE.Mesh {
  const closed = !!o.closed
  const curve = toCurve(points, closed)
  const f = frames(curve, 0.12, closed)
  const w = o.width ?? 0.5
  const seed = o.seed ?? 3
  const b = new Builder()
  const base = col(o.color ?? C.path)
  b.add(strip(f, w / 2, -w / 2, 0.012, 0.12, seed), (x, _y, z, out) => out.copy(base).multiplyScalar(0.95 + vnoise2(x * 5, z * 5) * 0.1))
  if (o.stones) {
    const rand = rng(seed)
    const len = curve.getLength()
    for (let d = 0.2; d < len; d += 0.26) {
      const p = curve.getPointAt(d / len)
      b.add(new THREE.CylinderGeometry(0.08 + rand() * 0.03, 0.09 + rand() * 0.03, 0.02, 7), C.stone, {
        x: p.x + (rand() - 0.5) * w * 0.5,
        y: p.y + 0.02,
        z: p.z + (rand() - 0.5) * w * 0.5,
        ry: rand() * 3,
      })
    }
  }
  const m = new THREE.Mesh(b.build(), clayVC())
  m.receiveShadow = true
  m.userData.curve = curve
  m.userData.length = curve.getLength()
  m.name = 'path'
  return m
}

/** Tram/train rails: timber sleepers + two steel rails along the curve. */
export function makeRails(points: PathPoint[], o: { gauge?: number; closed?: boolean; bed?: boolean } = {}): THREE.Mesh {
  const closed = !!o.closed
  const curve = toCurve(points, closed)
  const f = frames(curve, 0.12, closed)
  const g = o.gauge ?? 0.34
  const b = new Builder()
  if (o.bed !== false) b.add(strip(f, g / 2 + 0.16, -g / 2 - 0.16, 0.01), (x, _y, z, out) => out.copy(col(C.stone)).multiplyScalar(0.93 + vnoise2(x * 7, z * 7) * 0.1))
  const len = curve.getLength()
  for (let d = 0.08; d < len; d += 0.2) {
    const p = curve.getPointAt(d / len)
    const t = curve.getTangentAt(d / len)
    b.box(g + 0.2, 0.03, 0.07, C.woodDark, { x: p.x, y: p.y + 0.03, z: p.z, ry: Math.atan2(t.x, t.z) })
  }
  for (const s of [1, -1]) {
    b.add(strip(f, s * g / 2 + 0.018, s * g / 2 - 0.018, 0.065), '#c2c8cf')
    b.add(skirt(f, s * g / 2 + 0.018, 0.03, 0.065, 1), '#8e969f')
    b.add(skirt(f, s * g / 2 - 0.018, 0.03, 0.065, -1), '#8e969f')
  }
  const m = new THREE.Mesh(b.build(), clayVC())
  m.receiveShadow = true
  m.userData.curve = curve
  m.userData.length = len
  m.name = 'rails'
  return m
}

/**
 * Picket fence along a polyline (straight segments). Pass `closed` to loop.
 * Doesn't cast shadows by default (thin).
 */
export function makeFence(points: PathPoint[], o: { color?: string; height?: number; spacing?: number; closed?: boolean } = {}): THREE.Mesh {
  const pts = points.map(p => (p instanceof THREE.Vector3 ? p.clone() : p.length === 2 ? new THREE.Vector3(p[0], 0, p[1]) : new THREE.Vector3(p[0], p[1], p[2])))
  if (o.closed && pts.length > 2) pts.push(pts[0].clone())
  const h = o.height ?? 0.26
  const sp = o.spacing ?? 0.14
  const colr = o.color ?? C.white
  const b = new Builder()
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1]
    const len = a.distanceTo(c)
    const ang = Math.atan2(c.x - a.x, c.z - a.z)
    const n = Math.max(1, Math.round(len / sp))
    for (let k = 0; k < n; k++) {
      const t = k / n
      const x = a.x + (c.x - a.x) * t, z = a.z + (c.z - a.z) * t, y = a.y + (c.y - a.y) * t
      const post = k === 0
      b.box(post ? 0.05 : 0.018, post ? h + 0.04 : h, post ? 0.05 : 0.04, colr, { x, y: y + (post ? h + 0.04 : h) / 2, z, ry: ang })
      if (!post) b.add(new THREE.ConeGeometry(0.025, 0.04, 4), colr, { x, y: y + h + 0.018, z, ry: ang + Math.PI / 4 })
    }
    const mx = (a.x + c.x) / 2, mz = (a.z + c.z) / 2, my = (a.y + c.y) / 2
    for (const ry of [0.32, 0.72]) b.box(0.02, 0.035, len, colr, { x: mx, y: my + h * ry, z: mz, ry: ang })
  }
  const last = pts[pts.length - 1]
  if (!o.closed) b.box(0.05, h + 0.04, 0.05, colr, { x: last.x, y: last.y + (h + 0.04) / 2, z: last.z })
  const m = new THREE.Mesh(b.build(), clayVC())
  m.receiveShadow = true
  m.castShadow = false
  m.name = 'fence'
  return m
}

/** Park bench (faces +z), ~0.5 wide. */
export function makeBench(color: string = C.wood): THREE.Group {
  const b = new Builder()
  for (let i = 0; i < 3; i++) b.rbox(0.5, 0.025, 0.05, 0.01, color, { y: 0.14, z: -0.05 + i * 0.055 }, 1)
  for (let i = 0; i < 2; i++) b.rbox(0.5, 0.045, 0.02, 0.01, color, { y: 0.2 + i * 0.065, z: -0.1, rx: -0.12 }, 1)
  for (const s of [-1, 1]) {
    b.box(0.025, 0.14, 0.14, C.ink, { x: s * 0.2, y: 0.07, z: 0 })
    b.box(0.025, 0.16, 0.02, C.ink, { x: s * 0.2, y: 0.22, z: -0.1, rx: -0.12 })
  }
  const m = new THREE.Mesh(b.build(), clayVC())
  m.receiveShadow = true
  const g = new THREE.Group()
  g.add(m)
  return g
}

/**
 * Classic little lamp post (~0.95 tall). The bulb glows at dusk
 * automatically (KIT.uGlow); child 'bulb' kept for compatibility.
 */
export function makeLamp(): THREE.Group {
  const b = new Builder()
  b.cyl(0.05, 0.06, 0.06, 8, C.ink, { y: 0.03 })
  b.cyl(0.02, 0.028, 0.86, 6, C.ink, { y: 0.46 })
  b.cyl(0.07, 0.05, 0.03, 8, C.ink, { y: 0.88 })
  b.cone(0.085, 0.07, 8, C.ink, { y: 1.02 })
  const g = new THREE.Group()
  const m = new THREE.Mesh(b.build(), clayVC())
  g.add(m)
  const bb = new Builder()
  bb.sphere(0.06, '#fff3d0', { y: 0.94 }, 1, 2.2)
  const bulb = new THREE.Mesh(bb.build(), clayVC())
  bulb.name = 'bulb'
  g.add(bulb)
  return g
}

/**
 * Modern street lamp with a curved arm (~1.3 tall). hark: true adds a Hark
 * green LED ring that is always on (blooms), otherwise a warm lantern that
 * glows at dusk.
 */
export function makeStreetLamp(o: { hark?: boolean; color?: string } = {}): THREE.Group {
  const pole = o.color ?? (o.hark ? '#2b3a35' : C.slate)
  const b = new Builder()
  b.cyl(0.06, 0.075, 0.08, 10, pole, { y: 0.04 })
  b.cyl(0.022, 0.03, 1.2, 8, pole, { y: 0.64 })
  // arm + brace
  b.rbox(0.3, 0.03, 0.03, 0.012, pole, { x: 0.12, y: 1.28 }, 1)
  b.box(0.018, 0.17, 0.018, pole, { x: 0.055, y: 1.21, rz: -0.75 })
  b.rbox(0.2, 0.05, 0.1, 0.02, pole, { x: 0.24, y: 1.26 }, 1)
  b.box(0.15, 0.015, 0.07, '#fff4d6', { x: 0.24, y: 1.23 }, o.hark ? 0 : 2.2)
  const g = new THREE.Group()
  g.add(new THREE.Mesh(b.build(), clayVC()))
  if (o.hark) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.07), MAT.led)
    led.position.set(0.24, 1.228, 0)
    g.add(led)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 16), MAT.led)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.5
    g.add(ring)
  }
  return g
}

// ------------------------------------------------------------------ signs

export interface SignOptions {
  /** board width (default by text length) */
  w?: number
  /** board height (default 0.34) */
  h?: number
  /** board colour */
  color?: string
  /** text colour */
  ink?: string
  /** Hark signage: green board, white text, a map pin */
  hark?: boolean
  /** 'sans' (Figtree) | 'display' (Fraunces) | 'mono' (Space Mono) */
  font?: 'sans' | 'display' | 'mono'
  /** post height (0 = board only, e.g. wall-mounted) */
  post?: number
  /** wayfinding arrow on one end */
  arrow?: 'left' | 'right'
  /** second smaller line */
  sub?: string
}

const FONTS = {
  sans: '"Figtree Variable", Figtree, system-ui, sans-serif',
  display: '"Fraunces Variable", Fraunces, Georgia, serif',
  mono: '"Space Mono", ui-monospace, monospace',
}

/** Rounded-rect path (ctx.roundRect is Safari 16+). */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawSign(canvas: HTMLCanvasElement, text: string, o: SignOptions, bg: string, ink: string) {
  const ctx = canvas.getContext('2d')!
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  // inner keyline
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.35
  ctx.lineWidth = H * 0.025
  const inset = H * 0.07
  roundRectPath(ctx, inset, inset, W - inset * 2, H - inset * 2, H * 0.12)
  ctx.stroke()
  ctx.globalAlpha = 1
  let left = H * 0.2
  let right = W - H * 0.2
  if (o.hark) {
    // map pin
    const px = H * 0.42, py = H * 0.5, r = H * 0.17
    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.arc(px, py - r * 0.35, r, Math.PI * 0.85, Math.PI * 0.15, false)
    ctx.lineTo(px, py + r * 1.35)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.arc(px, py - r * 0.35, r * 0.42, 0, Math.PI * 2)
    ctx.fill()
    left = H * 0.72
  }
  if (o.arrow) {
    ctx.fillStyle = ink
    const ax = o.arrow === 'right' ? W - H * 0.42 : H * 0.42
    const d = o.arrow === 'right' ? 1 : -1
    ctx.beginPath()
    ctx.moveTo(ax + d * H * 0.18, H / 2)
    ctx.lineTo(ax - d * H * 0.1, H / 2 - H * 0.2)
    ctx.lineTo(ax - d * H * 0.1, H / 2 + H * 0.2)
    ctx.closePath()
    ctx.fill()
    if (o.arrow === 'right') right = W - H * 0.72
    else left = Math.max(left, H * 0.72)
  }
  const family = FONTS[o.font ?? 'sans']
  const weight = o.font === 'mono' ? 700 : o.font === 'display' ? 600 : 800
  let size = H * (o.sub ? 0.4 : 0.5)
  ctx.fillStyle = ink
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const maxW = right - left
  ctx.font = `${weight} ${size}px ${family}`
  while (ctx.measureText(text).width > maxW && size > 8) {
    size *= 0.92
    ctx.font = `${weight} ${size}px ${family}`
  }
  const cx = (left + right) / 2
  ctx.fillText(text, cx, o.sub ? H * 0.4 : H * 0.53)
  if (o.sub) {
    let s2 = H * 0.2
    ctx.font = `700 ${s2}px ${FONTS.mono}`
    while (ctx.measureText(o.sub).width > maxW && s2 > 6) {
      s2 *= 0.92
      ctx.font = `700 ${s2}px ${FONTS.mono}`
    }
    ctx.globalAlpha = 0.8
    ctx.fillText(o.sub, cx, H * 0.74)
    ctx.globalAlpha = 1
  }
}

/**
 * A wayfinding signpost with real text (canvas texture, redrawn once the
 * web fonts load). Board faces +z (text on both faces). ~1 unit tall.
 */
export function makeSign(text: string, o: SignOptions = {}): THREE.Group {
  const h = o.h ?? 0.34
  const w = o.w ?? Math.max(0.7, Math.min(2.4, 0.3 + text.length * 0.11 * (h / 0.34)))
  const post = o.post ?? 0.62
  const bg = o.color ?? (o.hark ? C.signal : C.cream)
  const ink = o.ink ?? (o.hark ? '#06331d' : C.ink)
  const g = new THREE.Group()
  const b = new Builder()
  const frameCol = o.hark ? '#0b6b3c' : C.woodDark
  b.rbox(w + 0.06, h + 0.06, 0.05, 0.02, frameCol, { y: post + h / 2 }, 1)
  if (post > 0) {
    const twin = w > 1.1
    const xs = twin ? [-w * 0.36, w * 0.36] : [0]
    for (const x of xs) {
      b.rbox(0.06, post + 0.02, 0.06, 0.015, frameCol, { x, y: (post + 0.02) / 2 }, 1)
      b.cyl(0.05, 0.06, 0.04, 8, C.stone, { x, y: 0.02 })
    }
  }
  const frame = new THREE.Mesh(b.build(), clayVC())
  frame.receiveShadow = true
  g.add(frame)
  const canvas = document.createElement('canvas')
  const res = 160
  canvas.width = Math.round((w / h) * res)
  canvas.height = res
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const draw = () => {
    drawSign(canvas, text, o, bg, ink)
    tex.needsUpdate = true
  }
  draw()
  if (typeof document !== 'undefined' && document.fonts) {
    const fam = FONTS[o.font ?? 'sans'].split(',')[0]
    document.fonts
      .load(`800 32px ${fam}`)
      .then(draw)
      .catch(() => {})
  }
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
  mat.onBeforeCompile = clay(C.white).onBeforeCompile
  const face = new THREE.PlaneGeometry(w, h)
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(face, mat)
    m.position.set(0, post + h / 2, s * 0.027)
    if (s < 0) m.rotation.y = Math.PI
    m.receiveShadow = true
    g.add(m)
  }
  g.userData.canvas = canvas
  g.userData.redraw = draw
  return g
}

// ------------------------------------------------------------------ flags

const flagMats = new Map<string, THREE.MeshStandardMaterial>()
let markTex: THREE.CanvasTexture | null = null

function harkMarkTexture(bg: string) {
  if (markTex) return markTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 160
  const ctx = c.getContext('2d')!
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = '#ffffff'
  const S = 112
  ctx.save()
  ctx.translate(c.width * 0.5, c.height / 2)
  ctx.scale(S, -S)
  for (const shape of logoShapes()) {
    const path = new Path2D()
    const pts = shape.getPoints(24)
    pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)))
    path.closePath()
    for (const hole of shape.holes) {
      const hp = hole.getPoints(24)
      hp.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)))
      path.closePath()
    }
    ctx.fill(path, 'evenodd')
  }
  ctx.restore()
  markTex = new THREE.CanvasTexture(c)
  markTex.colorSpace = THREE.SRGBColorSpace
  return markTex
}

function flagMaterial(color: string, mark: boolean, w: number) {
  const key = `${color}|${mark}|${w}`
  let m = flagMats.get(key)
  if (m) return m
  m = new THREE.MeshStandardMaterial({ color: mark ? '#ffffff' : color, roughness: 0.75, side: THREE.DoubleSide, map: mark ? harkMarkTexture(color) : null })
  const W = w.toFixed(3)
  m.onBeforeCompile = shader => {
    clay(C.white).onBeforeCompile(shader, null as unknown as THREE.WebGLRenderer)
    shader.uniforms.uKitTime = KIT.uTime
    shader.uniforms.uWind = KIT.uWind
    const wave = `
      float kx = clamp(position.x / ${W}, 0.0, 1.0);
      float ph = position.x * 7.0 - uKitTime * 6.5 + position.y * 2.5;
      float amp = 0.07 * ${W} * (0.6 + 0.4 * uWind);
    `
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uKitTime;\nuniform float uWind;')
      .replace(
        '#include <beginnormal_vertex>',
        `${wave}
        float dz = cos(ph) * 7.0 * amp * kx + sin(ph) * amp / ${W};
        vec3 objectNormal = normalize(vec3(-dz, 0.0, 1.0));`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        transformed.z += sin(ph) * amp * kx;
        transformed.y -= kx * kx * 0.06 * ${W};`,
      )
  }
  m.customProgramCacheKey = () => `kit-flag-${W}`
  flagMats.set(key, m)
  return m
}

/**
 * A flag on a pole that flutters by itself (vertex shader, KIT.uTime). The
 * cloth flies toward +x. mark: true prints the Hark mark in white.
 */
export function makeFlag(o: { color?: string; w?: number; h?: number; pole?: number; mark?: boolean } = {}): THREE.Group {
  const w = o.w ?? 0.5, h = o.h ?? 0.32, pole = o.pole ?? 1.3
  const g = new THREE.Group()
  const b = new Builder()
  b.cyl(0.02, 0.026, pole, 6, C.white, { y: pole / 2 })
  b.sphere(0.035, C.mustard, { y: pole + 0.02 }, 1)
  b.cyl(0.06, 0.07, 0.05, 8, C.stone, { y: 0.025 })
  const p = new THREE.Mesh(b.build(), clayVC())
  p.castShadow = false
  g.add(p)
  const cloth = new THREE.PlaneGeometry(w, h, 12, 3)
  cloth.translate(w / 2, 0, 0)
  const flag = new THREE.Mesh(cloth, flagMaterial(o.color ?? C.signal, !!o.mark, w))
  flag.position.set(0.02, pole - h / 2 - 0.02, 0)
  flag.name = 'cloth'
  g.add(flag)
  return g
}

// ------------------------------------------------------------------ contact shadow blob

let blobTex: THREE.CanvasTexture | null = null
const blobMats = new Map<number, THREE.MeshBasicMaterial>()
let blobGeo: THREE.PlaneGeometry | null = null

/** Shared blob material (radial soft shadow). */
export function blobMaterial(opacity = 0.32) {
  let m = blobMats.get(opacity)
  if (m) return m
  if (!blobTex) {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')!
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    grd.addColorStop(0, 'rgba(0,0,0,1)')
    grd.addColorStop(0.45, 'rgba(0,0,0,0.6)')
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grd
    ctx.fillRect(0, 0, 64, 64)
    blobTex = new THREE.CanvasTexture(c)
  }
  m = new THREE.MeshBasicMaterial({
    color: '#2b3440',
    alphaMap: blobTex,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
  })
  blobMats.set(opacity, m)
  return m
}

/** Soft contact-shadow blob (w × d footprint) lying on y = 0.01. */
export function makeBlob(w = 0.5, d = w, opacity = 0.32): THREE.Mesh {
  if (!blobGeo) {
    blobGeo = new THREE.PlaneGeometry(1, 1)
    blobGeo.rotateX(-Math.PI / 2)
  }
  const m = new THREE.Mesh(blobGeo, blobMaterial(opacity))
  m.scale.set(w, 1, d)
  m.position.y = 0.012
  m.renderOrder = 1
  m.name = 'blob'
  return m
}
