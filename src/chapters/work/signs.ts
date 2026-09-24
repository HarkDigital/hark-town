import * as THREE from 'three'
import type { WorkItem } from '../../content'

/*
 * Painted signage for Main Street, drawn into canvas atlases:
 *
 *   SIGNS  (1024×2048) shop fascia boards · the green "Stop 0N" flip faces on
 *          the rooftop billboards · the tram's destination blind · a SOLD
 *          sign · the market arch · the welcome sign
 *   STALLS (1024×1024) the nine market stall boards
 *   POSTERS(1024×640)  the nine sidewalk A-board thumbnails (filled as the
 *          screenshots stream in)
 *
 * Everything is drawn once with fallback fonts, then again when the real
 * faces (Fraunces / Figtree / Space Mono) are ready.
 */

export interface Cell {
  x: number
  y: number
  w: number
  h: number
}

export const SIGNS_W = 1024
export const SIGNS_H = 2048
export const STALLS_W = 1024
export const STALLS_H = 1024
export const POSTERS_W = 1024
export const POSTERS_H = 640

const SHOP_H = 160
export const shopCell = (k: number): Cell => ({ x: 0, y: k * SHOP_H, w: 1024, h: SHOP_H })
export const faceCell = (k: number): Cell => ({ x: (k % 2) * 512, y: 960 + Math.floor(k / 2) * 320, w: 512, h: 320 })
export const DEST_CELL: Cell = { x: 0, y: 1920, w: 384, h: 128 }
export const SOLD_CELL: Cell = { x: 384, y: 1920, w: 256, h: 128 }
export const ARCH_CELL: Cell = { x: 640, y: 1920, w: 384, h: 128 }
export const stallCell = (j: number): Cell => ({ x: (j % 2) * 512, y: Math.floor(j / 2) * 128, w: 512, h: 128 })
export const WELCOME_CELL: Cell = { x: 0, y: 640, w: 512, h: 256 }
export const posterCell = (j: number): Cell => ({ x: 16 + (j % 3) * 336, y: 12 + Math.floor(j / 3) * 206, w: 320, h: 200 })

/** Fascia style per featured shop (bg, ink, face). */
export const SHOP_STYLE: { bg: string; ink: string; face: 'serif' | 'sans' | 'mono'; upper?: boolean; italic?: boolean }[] = [
  { bg: '#2f4a6d', ink: '#f6ecd8', face: 'serif' },
  { bg: '#fbfaf6', ink: '#2c64a8', face: 'sans' },
  { bg: '#f6ecd8', ink: '#b4502e', face: 'serif', italic: true },
  { bg: '#f0b43c', ink: '#1d2321', face: 'mono', upper: true },
  { bg: '#fbf3df', ink: '#c23b2a', face: 'sans', upper: true },
  { bg: '#3d2f63', ink: '#f7c95a', face: 'serif', italic: true },
]

export const STALL_INK = ['#c8603a', '#2c64a8', '#2f8f55', '#b5452f', '#6b4fa0', '#1f7a8c', '#b07a12', '#c23b2a', '#3a6b35']

const FONT = {
  serif: (px: number, italic = false) => `${italic ? 'italic ' : ''}600 ${px}px "Fraunces Variable", "Fraunces", Georgia, serif`,
  sans: (px: number) => `800 ${px}px "Figtree Variable", "Figtree", system-ui, sans-serif`,
  mono: (px: number) => `700 ${px}px "Space Mono", ui-monospace, monospace`,
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
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

/** Largest font size (≤ max) at which `text` fits in maxW. */
function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, max: number, min = 12) {
  let px = max
  g.font = font(px)
  while (px > min && g.measureText(text).width > maxW) {
    px -= 2
    g.font = font(px)
  }
  return px
}

/** Split a name into two balanced lines. */
function twoLines(text: string): [string, string] {
  const words = text.split(' ')
  let best: [string, string] = [text, '']
  let bestD = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const d = Math.abs(a.length - b.length)
    if (d < bestD) {
      bestD = d
      best = [a, b]
    }
  }
  return best
}

export class Signage {
  signs = canvas(SIGNS_W, SIGNS_H)
  stalls = canvas(STALLS_W, STALLS_H)
  posters = canvas(POSTERS_W, POSTERS_H)
  signsTex: THREE.CanvasTexture
  stallsTex: THREE.CanvasTexture
  postersTex: THREE.CanvasTexture
  private posterImgs: (HTMLImageElement | null)[]

  constructor(
    private featured: WorkItem[],
    private rest: WorkItem[],
  ) {
    this.posterImgs = rest.map(() => null)
    const tex = (c: HTMLCanvasElement) => {
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
      return t
    }
    this.signsTex = tex(this.signs)
    this.stallsTex = tex(this.stalls)
    this.postersTex = tex(this.posters)
    this.drawAll()
  }

  drawAll() {
    this.drawSigns()
    this.drawStalls()
    this.drawPosters()
  }

  /** Redraw once the webfonts are in. */
  async whenFonts() {
    const fonts = document.fonts
    if (!fonts?.load) return
    try {
      await Promise.all([
        fonts.load('600 64px "Fraunces Variable"'),
        fonts.load('italic 600 64px "Fraunces Variable"'),
        fonts.load('800 64px "Figtree Variable"'),
        fonts.load('700 64px "Space Mono"'),
      ])
    } catch {
      /* fallback faces are fine */
    }
    this.drawSigns()
    this.drawStalls()
    this.drawPosters()
  }

  private drawSigns() {
    const g = this.signs.getContext('2d')!
    g.clearRect(0, 0, SIGNS_W, SIGNS_H)
    g.textAlign = 'center'
    g.textBaseline = 'middle'

    // shop fascia boards
    this.featured.forEach((w, k) => {
      const c = shopCell(k)
      const st = SHOP_STYLE[k]
      g.fillStyle = st.bg
      g.fillRect(c.x, c.y, c.w, c.h)
      // a painted inner line, like a hand-lettered sign
      g.strokeStyle = st.ink
      g.globalAlpha = 0.35
      g.lineWidth = 4
      roundRect(g, c.x + 14, c.y + 14, c.w - 28, c.h - 28, 16)
      g.stroke()
      g.globalAlpha = 1
      const text = st.upper ? w.name.toUpperCase() : w.name
      const font =
        st.face === 'serif' ? (px: number) => FONT.serif(px, st.italic) : st.face === 'sans' ? FONT.sans : FONT.mono
      fit(g, text, font, c.w - 110, st.face === 'mono' ? 76 : 96)
      g.fillStyle = st.ink
      g.fillText(text, c.x + c.w / 2, c.y + c.h / 2 + (st.face === 'serif' ? 4 : 2))
    })

    // the green "Stop 0N" faces the billboards show until the tram arrives
    this.featured.forEach((_w, k) => {
      const c = faceCell(k)
      g.fillStyle = '#00e27a'
      g.fillRect(c.x, c.y, c.w, c.h)
      g.strokeStyle = '#fbfaf6'
      g.lineWidth = 10
      roundRect(g, c.x + 18, c.y + 18, c.w - 36, c.h - 36, 22)
      g.stroke()
      g.fillStyle = '#0d3b27'
      g.font = FONT.mono(34)
      g.textAlign = 'left'
      g.fillText('STOP', c.x + 50, c.y + 70)
      g.textAlign = 'right'
      g.fillText('MAIN ST', c.x + c.w - 50, c.y + 70)
      g.textAlign = 'center'
      g.font = FONT.serif(172)
      g.fillStyle = '#1d2321'
      g.fillText(String(k + 1).padStart(2, '0'), c.x + c.w / 2, c.y + 182)
      // little tram pictogram
      const tx = c.x + c.w / 2 - 50
      const ty = c.y + 250
      g.fillStyle = '#1d2321'
      roundRect(g, tx, ty, 100, 38, 10)
      g.fill()
      g.fillStyle = '#00e27a'
      for (let i = 0; i < 3; i++) g.fillRect(tx + 12 + i * 28, ty + 8, 20, 13)
      g.fillStyle = '#1d2321'
      g.fillRect(tx + 48, ty - 14, 4, 14)
      g.fillRect(tx + 30, ty - 16, 40, 4)
    })

    // tram destination blind: LED green on black
    {
      const c = DEST_CELL
      g.fillStyle = '#121615'
      g.fillRect(c.x, c.y, c.w, c.h)
      g.fillStyle = '#00ff85'
      g.font = FONT.mono(64)
      g.textAlign = 'left'
      g.fillText('H', c.x + 34, c.y + c.h / 2 + 2)
      fit(g, 'MAIN ST', FONT.mono, c.w - 150, 58)
      g.fillText('MAIN ST', c.x + 120, c.y + c.h / 2 + 2)
      g.textAlign = 'center'
    }

    // SOLD
    {
      const c = SOLD_CELL
      g.fillStyle = '#fbfaf6'
      g.fillRect(c.x, c.y, c.w, c.h)
      g.fillStyle = '#e04a36'
      roundRect(g, c.x + 10, c.y + 10, c.w - 20, c.h - 20, 12)
      g.fill()
      g.fillStyle = '#fbfaf6'
      g.font = FONT.sans(78)
      g.fillText('SOLD', c.x + c.w / 2, c.y + c.h / 2 + 4)
    }

    // market arch
    {
      const c = ARCH_CELL
      g.fillStyle = '#fbf3df'
      g.fillRect(c.x, c.y, c.w, c.h)
      g.fillStyle = '#c8603a'
      fit(g, 'Market Row', (px: number) => FONT.serif(px, true), c.w - 50, 78)
      g.fillText('Market Row', c.x + c.w / 2, c.y + c.h / 2 + 4)
    }
  }

  private drawStalls() {
    const g = this.stalls.getContext('2d')!
    g.clearRect(0, 0, STALLS_W, STALLS_H)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    this.rest.forEach((w, j) => {
      const c = stallCell(j)
      g.fillStyle = '#fbf6ea'
      g.fillRect(c.x, c.y, c.w, c.h)
      g.fillStyle = STALL_INK[j % STALL_INK.length]
      g.fillRect(c.x, c.y + c.h - 12, c.w, 12)
      const px = fit(g, w.name, FONT.sans, c.w - 40, 60, 40)
      if (g.measureText(w.name).width <= c.w - 40 || !w.name.includes(' ')) {
        g.font = FONT.sans(px)
        g.fillText(w.name, c.x + c.w / 2, c.y + c.h / 2 - 3)
      } else {
        const [a, b] = twoLines(w.name)
        const p2 = Math.min(fit(g, a, FONT.sans, c.w - 40, 46), fit(g, b, FONT.sans, c.w - 40, 46))
        g.font = FONT.sans(p2)
        g.fillText(a, c.x + c.w / 2, c.y + c.h / 2 - p2 * 0.52 - 3)
        g.fillText(b, c.x + c.w / 2, c.y + c.h / 2 + p2 * 0.52 - 3)
      }
    })

    // welcome sign at the terminus (playful town signage)
    {
      const c = WELCOME_CELL
      g.fillStyle = '#2f8f55'
      roundRect(g, c.x, c.y, c.w, c.h, 26)
      g.fill()
      g.strokeStyle = '#fbfaf6'
      g.lineWidth = 7
      roundRect(g, c.x + 14, c.y + 14, c.w - 28, c.h - 28, 18)
      g.stroke()
      g.fillStyle = '#fbfaf6'
      g.font = FONT.mono(26)
      g.fillText('WELCOME TO', c.x + c.w / 2, c.y + 58)
      g.font = FONT.serif(78, true)
      g.fillText('Main Street', c.x + c.w / 2, c.y + 124)
      g.font = FONT.mono(26)
      g.fillText('POP. 15 WEBSITES', c.x + c.w / 2, c.y + 194)
    }
  }

  private drawPosters() {
    const g = this.posters.getContext('2d')!
    g.fillStyle = '#2a2f2d'
    g.fillRect(0, 0, POSTERS_W, POSTERS_H)
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    this.rest.forEach((w, j) => {
      const c = posterCell(j)
      const img = this.posterImgs[j]
      if (img) {
        g.drawImage(img, c.x, c.y, c.w, c.h)
      } else {
        g.fillStyle = '#f6f1e7'
        g.fillRect(c.x, c.y, c.w, c.h)
        g.fillStyle = STALL_INK[j % STALL_INK.length]
        fit(g, w.name, FONT.sans, c.w - 30, 30)
        g.fillText(w.name, c.x + c.w / 2, c.y + c.h / 2)
      }
    })
    this.postersTex.needsUpdate = true
  }

  /** A sidewalk-board thumbnail arrived. */
  poster(j: number, img: HTMLImageElement) {
    this.posterImgs[j] = img
    const g = this.posters.getContext('2d')!
    const c = posterCell(j)
    g.drawImage(img, c.x, c.y, c.w, c.h)
  }

  flush() {
    this.signsTex.needsUpdate = true
    this.stallsTex.needsUpdate = true
    this.postersTex.needsUpdate = true
  }
}

/** A calm "coming soon" card for a billboard whose screenshot hasn't arrived. */
export function placeholderTexture() {
  const c = canvas(64, 40)
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 40)
  grad.addColorStop(0, '#f6f1e7')
  grad.addColorStop(1, '#e6dccb')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 40)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
