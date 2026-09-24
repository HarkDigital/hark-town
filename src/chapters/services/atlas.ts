import * as THREE from 'three'

/*
 * A 512² canvas atlas for the little signs on the islands (4 x 4 cells):
 *   0        plain white (every untextured vertex samples it)
 *   1..11    workshop number plates "01".."11": Hark green, ink numerals
 *   12       the International Symbol of Access (blue plate)
 *   13       checkered flag / start line
 */
export const CELL = { white: 0, number: (k: number) => k + 1, access: 12, checker: 13 }

const S = 128

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** The faces the plates use (never rejects). */
function loadFonts(): Promise<void> {
  if (!document.fonts?.load) return Promise.resolve()
  return Promise.all([document.fonts.load('700 64px "Space Mono"'), document.fonts.load('italic 600 64px "Fraunces Variable"')]).then(
    () => undefined,
    () => undefined,
  )
}

export async function makeAtlas(renderer: THREE.WebGLRenderer): Promise<THREE.Texture> {
  const fonts = loadFonts()
  let fontsIn = false
  void fonts.then(() => (fontsIn = true))
  // give the numerals' face a moment, but never in a hidden tab (timers crawl
  // there): paint with the fallback now and repaint when the face lands
  if (!document.hidden) await Promise.race([fonts, new Promise<void>(r => setTimeout(r, 700))])
  const cv = document.createElement('canvas')
  cv.width = cv.height = S * 4
  const g = cv.getContext('2d')!
  paintAtlas(g)

  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.needsUpdate = true
  if (!fontsIn)
    void fonts.then(() => {
      paintAtlas(g)
      tex.needsUpdate = true
    })
  return tex
}

function paintAtlas(g: CanvasRenderingContext2D) {
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, S * 4, S * 4)

  const cell = (i: number) => [(i % 4) * S, Math.floor(i / 4) * S] as const

  // number plates
  for (let k = 0; k < 11; k++) {
    const [x, y] = cell(k + 1)
    g.fillStyle = '#00d873'
    g.fillRect(x, y, S, S)
    g.strokeStyle = 'rgba(255,255,255,0.9)'
    g.lineWidth = 6
    roundRect(g, x + 8, y + 8, S - 16, S - 16, 14)
    g.stroke()
    g.fillStyle = '#12201a'
    g.font = 'italic 600 78px "Fraunces Variable", "Fraunces", Georgia, serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(String(k + 1).padStart(2, '0'), x + S / 2, y + S / 2 + 4)
  }

  // access symbol
  {
    const [x, y] = cell(CELL.access)
    g.fillStyle = '#2f6fd0'
    g.fillRect(x, y, S, S)
    g.strokeStyle = '#ffffff'
    g.fillStyle = '#ffffff'
    g.lineCap = 'round'
    g.lineJoin = 'round'
    const cx = x + 58, cy = y + 30
    g.beginPath()
    g.arc(cx, cy, 10, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 11
    g.beginPath()
    g.moveTo(cx - 2, cy + 18)
    g.lineTo(cx - 6, cy + 50)
    g.lineTo(cx + 22, cy + 50)
    g.lineTo(cx + 34, cy + 74)
    g.stroke()
    g.lineWidth = 9
    g.beginPath()
    g.moveTo(cx - 4, cy + 32)
    g.lineTo(cx + 18, cy + 32)
    g.stroke()
    g.beginPath()
    g.arc(cx - 6, cy + 56, 26, Math.PI * 0.62, Math.PI * 2.02)
    g.stroke()
  }

  // checkers
  {
    const [x, y] = cell(CELL.checker)
    const n = 8, q = S / n
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = (i + j) % 2 ? '#1d2321' : '#fbfaf6'
        g.fillRect(x + i * q, y + j * q, q, q)
      }
  }
}
