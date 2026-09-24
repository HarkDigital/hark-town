import * as THREE from 'three'
import { STATS } from '../../content'
import { logoShapes } from '../../logo/logo'
import { rng } from '../../core/math'

/*
 * Painted surfaces for the site, drawn once into canvases:
 *  - the fence atlas: seven plywood panels (three of them revolve to show
 *    the stats on their green backs),
 *  - the blueprint on the trestle table,
 *  - the cardboard mock-up's marker-drawn facade,
 *  - the client's speech bubble and the "next idea" light bulb.
 * Text uses the site's fonts; everything is redrawn once they have loaded.
 */

const DISPLAY = "'Fraunces Variable', 'Fraunces', Georgia, serif"
const SANS = "'Figtree Variable', 'Figtree', system-ui, sans-serif"
const MONO = "'Space Mono', ui-monospace, monospace"

const INK = '#1d2321'
const SIGNAL = '#00e27a'
const PLY = '#f3ead6'
const MUSTARD = '#f0b43c'

/** The three stats the site fence carries, in fence order. */
export const FENCE_STATS = ['10 years', '$1M+', '15'].map(v => STATS.find(s => s.value === v)!).filter(Boolean)
/** a verbatim opening of each stat's label, short enough to paint on a panel */
const CAPTION_WORDS = [3, 4, 5]
export const statCaption = (i: number) => FENCE_STATS[i].label.split(/\s+/).slice(0, CAPTION_WORDS[i]).join(' ')

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function texture(c: HTMLCanvasElement, aniso: number) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = aniso
  return t
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** Fit text to a max width by shrinking the font size. */
function fitFont(g: CanvasRenderingContext2D, text: string, weight: string, family: string, size: number, maxW: number) {
  let s = size
  g.font = `${weight} ${s}px ${family}`
  while (g.measureText(text).width > maxW && s > 8) {
    s -= 2
    g.font = `${weight} ${s}px ${family}`
  }
  return s
}

let markPaths: Path2D | null = null
/** The Hark mark as a canvas path, 1 unit tall, centered, y down. */
function markPath() {
  if (markPaths) return markPaths
  const p = new Path2D()
  for (const s of logoShapes()) {
    const pts = s.getPoints(24)
    pts.forEach((v, i) => (i ? p.lineTo(v.x, -v.y) : p.moveTo(v.x, -v.y)))
    p.closePath()
    for (const h of s.holes) {
      const hp = h.getPoints(24)
      hp.forEach((v, i) => (i ? p.lineTo(v.x, -v.y) : p.moveTo(v.x, -v.y)))
      p.closePath()
    }
  }
  return (markPaths = p)
}

function drawMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  g.save()
  g.translate(cx, cy)
  g.scale(size, size)
  g.fillStyle = color
  g.fill(markPath(), 'evenodd')
  g.restore()
}

function chevrons(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.fillStyle = MUSTARD
  g.fillRect(x, y, w, h)
  g.fillStyle = INK
  const step = h * 1.1
  for (let i = -2; i < w / step + 2; i++) {
    const x0 = x + i * step
    g.beginPath()
    g.moveTo(x0, y + h)
    g.lineTo(x0 + step * 0.5, y + h)
    g.lineTo(x0 + step * 0.5 + h, y)
    g.lineTo(x0 + h, y)
    g.closePath()
    g.fill()
  }
  g.restore()
}

// ------------------------------------------------------------------ site fence

export const ATLAS = { cols: 2, rows: 5, cw: 512, ch: 256 }
/** cells: 0 end-L · 1 stat1 front · 2 hats · 3 stat2 front · 4 dust · 5 stat3 front · 6–8 stat backs · 9 end-R */
export const CELL = { endL: 0, front: [1, 3, 5], hats: 2, dust: 4, back: [6, 7, 8], endR: 9 }

export function cellUv(cell: number) {
  const col = cell % ATLAS.cols
  const row = Math.floor(cell / ATLAS.cols)
  const W = ATLAS.cols * ATLAS.cw
  const H = ATLAS.rows * ATLAS.ch
  // canvas y is down; uv v is up (flipY)
  const u0 = (col * ATLAS.cw + 2) / W
  const u1 = ((col + 1) * ATLAS.cw - 2) / W
  const v1 = 1 - (row * ATLAS.ch + 2) / H
  const v0 = 1 - ((row + 1) * ATLAS.ch - 2) / H
  return { u0, u1, v0, v1 }
}

function plyPanel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.fillStyle = PLY
  g.fillRect(x, y, w, h)
  // faint wood grain
  const r = rng(x * 7 + y * 3 + 1)
  g.strokeStyle = 'rgba(150, 110, 60, 0.08)'
  g.lineWidth = 1.2
  for (let i = 0; i < 14; i++) {
    const yy = y + r() * h
    g.beginPath()
    g.moveTo(x, yy)
    g.bezierCurveTo(x + w * 0.3, yy + (r() - 0.5) * 10, x + w * 0.7, yy + (r() - 0.5) * 10, x + w, yy + (r() - 0.5) * 6)
    g.stroke()
  }
  // the green site band along the foot
  g.fillStyle = SIGNAL
  g.fillRect(x, y + h * 0.84, w, h * 0.16)
  g.fillStyle = 'rgba(29, 35, 33, 0.14)'
  g.fillRect(x, y + h * 0.84, w, 3)
}

function drawCell(g: CanvasRenderingContext2D, cell: number) {
  const { cw, ch } = ATLAS
  const x = (cell % ATLAS.cols) * cw
  const y = Math.floor(cell / ATLAS.cols) * ch
  g.save()
  g.beginPath()
  g.rect(x, y, cw, ch)
  g.clip()
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'
  const band = ch * 0.84

  const backIdx = CELL.back.indexOf(cell)
  if (backIdx >= 0) {
    // stat backs: all Hark green, the value big, a verbatim caption
    g.fillStyle = SIGNAL
    g.fillRect(x, y, cw, ch)
    g.fillStyle = 'rgba(255,255,255,0.14)'
    g.fillRect(x, y, cw, ch * 0.06)
    const s = FENCE_STATS[backIdx]
    g.fillStyle = INK
    fitFont(g, s.value, '640', DISPLAY, 132, cw - 70)
    g.fillText(s.value, x + 30, y + ch * 0.6)
    // a verbatim opening of the label, wrapped onto two short lines
    const words = statCaption(backIdx).toUpperCase().split(' ')
    const half = Math.ceil(words.length / 2)
    const lines = words.length > 2 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [words.join(' ')]
    g.fillStyle = 'rgba(29,35,33,0.85)'
    let cs = 34
    for (const ln of lines) cs = Math.min(cs, fitFont(g, ln, '700', MONO, 34, cw - 70))
    g.font = `700 ${cs}px ${MONO}`
    lines.forEach((ln, i) => g.fillText(ln, x + 32, y + ch * 0.6 + 40 + i * (cs + 4)))
    drawMark(g, x + cw - 50, y + ch - 52, 40, INK)
    g.restore()
    return
  }

  plyPanel(g, x, y, cw, ch)
  if (cell === CELL.endL || cell === CELL.endR) {
    chevrons(g, x, y, cw, ch * 0.3)
    g.fillStyle = INK
    const t = cell === CELL.endL ? 'HARK TOWN' : 'LOT 06'
    fitFont(g, t, '700', MONO, 48, cw - 60)
    g.fillText(t, x + 30, y + ch * 0.66)
  } else if (cell === CELL.front[0]) {
    drawMark(g, x + 78, y + band * 0.5, 92, SIGNAL)
    g.fillStyle = INK
    fitFont(g, 'Hark Digital', '640', DISPLAY, 60, cw - 170)
    g.fillText('Hark Digital', x + 140, y + band * 0.5 + 4)
    g.fillStyle = 'rgba(29,35,33,0.7)'
    fitFont(g, 'BUILDING SITE', '700', MONO, 22, cw - 170)
    g.fillText('BUILDING SITE', x + 142, y + band * 0.5 + 38)
  } else if (cell === CELL.hats) {
    // a "hard hats on" mandatory sign
    const cx = x + 84
    const cy = y + band * 0.5
    g.fillStyle = '#2f6fcf'
    g.beginPath()
    g.arc(cx, cy, 58, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(cx, cy + 12, 34, Math.PI, 0)
    g.fill()
    roundRect(g, cx - 46, cy + 10, 92, 10, 5)
    g.fill()
    g.fillStyle = INK
    fitFont(g, 'Hard hats on', '800', SANS, 50, cw - 180)
    g.fillText('Hard hats on', x + 164, y + band * 0.5 + 16)
  } else if (cell === CELL.front[1]) {
    g.fillStyle = INK
    fitFont(g, 'Quiet please,', 'italic 560', DISPLAY, 56, cw - 60)
    g.fillText('Quiet please,', x + 30, y + band * 0.45)
    g.fillStyle = '#0a8f55'
    fitFont(g, 'we’re listening.', 'italic 560', DISPLAY, 56, cw - 60)
    g.fillText('we’re listening.', x + 30, y + band * 0.45 + 58)
  } else if (cell === CELL.dust) {
    g.fillStyle = INK
    fitFont(g, 'Pardon our dust', '640', DISPLAY, 56, cw - 60)
    g.fillText('Pardon our dust', x + 30, y + band * 0.62)
  } else if (cell === CELL.front[2]) {
    g.fillStyle = 'rgba(29,35,33,0.7)'
    fitFont(g, 'NOW BUILDING', '700', MONO, 24, cw - 60)
    g.fillText('NOW BUILDING', x + 32, y + band * 0.36)
    g.fillStyle = INK
    fitFont(g, 'the next big idea', 'italic 560', DISPLAY, 54, cw - 60)
    g.fillText('the next big idea', x + 30, y + band * 0.36 + 62)
  }
  g.restore()
}

export function drawFence(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  for (let i = 0; i < ATLAS.cols * ATLAS.rows; i++) drawCell(g, i)
}

// ------------------------------------------------------------------ blueprint

export function drawBlueprint(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  g.fillStyle = '#2a64a8'
  g.fillRect(0, 0, W, H)
  g.strokeStyle = 'rgba(255,255,255,0.13)'
  g.lineWidth = 1
  for (let x = 0; x < W; x += 12) {
    g.beginPath()
    g.moveTo(x + 0.5, 0)
    g.lineTo(x + 0.5, H)
    g.stroke()
  }
  for (let y = 0; y < H; y += 12) {
    g.beginPath()
    g.moveTo(0, y + 0.5)
    g.lineTo(W, y + 0.5)
    g.stroke()
  }
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.lineWidth = 2
  g.strokeRect(6, 6, W - 12, H - 12)
  // elevation: four floors, a door, windows, the sign on the roof
  const bx = 40
  const by = 34
  const bw = 112
  const fh = 22
  g.lineWidth = 2
  g.strokeRect(bx, by, bw, fh * 4)
  for (let f = 0; f < 4; f++) {
    const yy = by + f * fh
    if (f) {
      g.beginPath()
      g.moveTo(bx, yy)
      g.lineTo(bx + bw, yy)
      g.stroke()
    }
    for (let i = 0; i < 4; i++) {
      if (f === 3 && (i === 1 || i === 2)) continue
      g.strokeRect(bx + 8 + i * 26 + (i > 1 ? 6 : 0), yy + 6, 16, 10)
    }
  }
  g.strokeRect(bx + bw / 2 - 8, by + fh * 3 + 6, 16, 16)
  // roof sign
  g.save()
  g.strokeStyle = 'rgba(255,255,255,0.9)'
  g.translate(bx + bw / 2, by - 12)
  g.scale(16, 16)
  g.lineWidth = 0.12
  g.stroke(markPath())
  g.restore()
  // dimension line
  g.lineWidth = 1.2
  g.beginPath()
  g.moveTo(bx, by + fh * 4 + 12)
  g.lineTo(bx + bw, by + fh * 4 + 12)
  g.moveTo(bx, by + fh * 4 + 7)
  g.lineTo(bx, by + fh * 4 + 17)
  g.moveTo(bx + bw, by + fh * 4 + 7)
  g.lineTo(bx + bw, by + fh * 4 + 17)
  g.stroke()
  // title block
  g.strokeRect(W - 86, H - 44, 74, 32)
  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = `700 11px ${MONO}`
  g.fillText('HARK', W - 78, H - 25)
  g.font = `400 9px ${MONO}`
  g.fillText('LOT 06', W - 78, H - 15)
  // scribbled notes from the client meeting
  g.strokeStyle = 'rgba(255,255,255,0.7)'
  g.lineWidth = 1.4
  for (let i = 0; i < 4; i++) {
    g.beginPath()
    g.moveTo(W - 86, 24 + i * 12)
    g.lineTo(W - 86 + 40 + ((i * 17) % 30), 24 + i * 12)
    g.stroke()
  }
}

// ------------------------------------------------------------------ cardboard

export function drawCardboard(c: HTMLCanvasElement) {
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  g.fillStyle = '#c99a5f'
  g.fillRect(0, 0, W, H)
  const r = rng(42)
  // corrugation + speckle
  for (let x = 0; x < W; x += 7) {
    g.fillStyle = `rgba(120, 80, 40, ${0.05 + r() * 0.04})`
    g.fillRect(x, 0, 2, H)
  }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(90,60,30,0.12)' : 'rgba(255,240,210,0.12)'
    g.fillRect(r() * W, r() * H, 2, 2)
  }
  // marker windows (hand-wobbled)
  g.strokeStyle = '#3a2716'
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const wobble = (x: number, y: number, w: number, h: number) => {
    g.lineWidth = 5
    g.beginPath()
    const j = () => (r() - 0.5) * 4
    g.moveTo(x + j(), y + j())
    g.lineTo(x + w + j(), y + j())
    g.lineTo(x + w + j(), y + h + j())
    g.lineTo(x + j(), y + h + j())
    g.closePath()
    g.stroke()
    // a cross mullion
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(x + w / 2 + j(), y + 3)
    g.lineTo(x + w / 2 + j(), y + h - 3)
    g.stroke()
  }
  const cols = [0.1, 0.27, 0.62, 0.79]
  for (const u of cols) wobble(u * W, H * 0.26, W * 0.11, H * 0.46)
  // packing tape across the top edge
  g.fillStyle = 'rgba(236, 206, 150, 0.8)'
  g.fillRect(0, 0, W, H * 0.12)
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(0, H * 0.02, W, H * 0.025)
  // scribble
  g.fillStyle = '#3a2716'
  g.font = `italic 700 ${Math.round(H * 0.2)}px ${SANS}`
  g.fillText('proto v1', W * 0.43, H * 0.9)
}

// ------------------------------------------------------------------ bubbles

export function drawBubble(c: HTMLCanvasElement, kind: 'talk' | 'idea') {
  const g = c.getContext('2d')!
  const W = c.width
  const H = c.height
  g.clearRect(0, 0, W, H)
  g.fillStyle = 'rgba(29,35,33,0.16)'
  roundRect(g, 10, 12, W - 16, H * 0.68, 26)
  g.fill()
  g.fillStyle = '#fbfaf6'
  roundRect(g, 6, 6, W - 16, H * 0.68, 26)
  g.fill()
  g.beginPath()
  g.moveTo(W * 0.3, H * 0.66)
  g.lineTo(W * 0.24, H * 0.96)
  g.lineTo(W * 0.5, H * 0.66)
  g.closePath()
  g.fill()
  const cx = W / 2 - 4
  const cy = 6 + H * 0.34
  if (kind === 'talk') {
    g.fillStyle = '#07a85d'
    const hs = [0.34, 0.62, 0.9, 0.56, 0.3]
    hs.forEach((h, i) => {
      const bh = H * 0.42 * h
      roundRect(g, cx - 44 + i * 20, cy - bh / 2, 11, bh, 5.5)
      g.fill()
    })
  } else {
    // light bulb
    g.fillStyle = MUSTARD
    g.beginPath()
    g.arc(cx, cy - 6, 22, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#6b7280'
    roundRect(g, cx - 11, cy + 12, 22, 14, 4)
    g.fill()
    g.strokeStyle = MUSTARD
    g.lineWidth = 5
    g.lineCap = 'round'
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (1.1 + i * 0.2)
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * 30, cy - 6 + Math.sin(a) * 30)
      g.lineTo(cx + Math.cos(a) * 40, cy - 6 + Math.sin(a) * 40)
      g.stroke()
    }
  }
}

// ------------------------------------------------------------------ bundle

export interface SiteTextures {
  fence: THREE.CanvasTexture
  blueprint: THREE.CanvasTexture
  cardboard: THREE.CanvasTexture
  talk: THREE.CanvasTexture
  idea: THREE.CanvasTexture
  /** redraw everything that has type once the web fonts are ready */
  redraw(): void
}

export function makeTextures(aniso: number, mobile: boolean): SiteTextures {
  const hc = canvas(ATLAS.cols * ATLAS.cw, ATLAS.rows * ATLAS.ch)
  const bc = canvas(256, 160)
  const cc = canvas(mobile ? 256 : 512, mobile ? 80 : 160)
  const tc = canvas(128, 112)
  const ic = canvas(128, 112)
  drawFence(hc)
  drawBlueprint(bc)
  drawCardboard(cc)
  drawBubble(tc, 'talk')
  drawBubble(ic, 'idea')
  const out: SiteTextures = {
    fence: texture(hc, aniso),
    blueprint: texture(bc, aniso),
    cardboard: texture(cc, aniso),
    talk: texture(tc, 1),
    idea: texture(ic, 1),
    redraw() {
      drawFence(hc)
      drawBlueprint(bc)
      drawCardboard(cc)
      out.fence.needsUpdate = true
      out.blueprint.needsUpdate = true
      out.cardboard.needsUpdate = true
    },
  }
  return out
}

/** Resolve when the fonts the painted signs use are ready (never rejects). */
export function whenSignFontsReady(): Promise<void> {
  const f = document.fonts
  if (!f?.load) return Promise.resolve()
  return Promise.all([
    f.load(`640 64px ${DISPLAY}`),
    f.load(`italic 560 64px ${DISPLAY}`),
    f.load(`800 40px ${SANS}`),
    f.load(`700 20px ${MONO}`),
    f.load(`400 20px ${MONO}`),
  ]).then(
    () => undefined,
    () => undefined,
  )
}
