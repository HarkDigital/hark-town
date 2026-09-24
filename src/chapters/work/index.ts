import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp } from '../../core/math'
import { SECTIONS, WORK, workImage, type WorkItem } from '../../content'
import { Signage, placeholderTexture } from './signs'
import { buildTown, type Popper, type Town } from './town'
import { Life } from './life'
import { breathe, squash } from './kit'
import * as L from './layout'
import './work.css'

/*
 * MAIN STREET — Selected work.
 *
 * A long floating island with a tram line down the middle. The Hark tram
 * leaves the terminus and calls at six shops in turn; as it pulls in, the
 * shop's rooftop billboard flips from a green "Stop 0N" face to the client's
 * website, and a wayfinding plate slides in with the project. Past the six
 * stops the street opens into a market row of nine stalls (the other nine
 * sites), then the tram rolls out across a sky bridge and the camera lifts
 * into the clouds.
 *
 *   0.00–0.14  descend out of cloud; the town pops up; "Built to be heard."
 *   0.14–0.84  six stops (~0.117 each: ride in, then dwell with the plate)
 *   0.84–0.95  market row: "Nine more, all live." + Say hello
 *   0.95–1.00  the tram leaves; the camera rises into the clouds
 *
 * Everything visible is derived from `local`; springs only add the toy pop
 * on top of scroll-derived targets, and idle life runs on frame.time.
 */

const FEATURED = WORK.filter(w => w.featured)
const REST = WORK.filter(w => !w.featured)
const NF = FEATURED.length
const NR = REST.length

const F0 = 0.14
const F1 = 0.83
const FW = (F1 - F0) / NF
const TRAVEL = 0.3
const MP0 = 0.862
const MP1 = 0.935

const DEG = Math.PI / 180
const UP = new THREE.Vector3(0, 1, 0)

const isPreview = (url: string) => {
  try {
    return /(^|\.)harktest\.com$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** "City Line Capital" → "City Line <em>Capital</em>" */
const emLast = (name: string) => {
  const parts = name.split(' ')
  if (parts.length < 2) return `<em>${esc(name)}</em>`
  const last = parts.pop()!
  return `${esc(parts.join(' '))} <em>${esc(last)}</em>`
}
const pad = (n: number) => String(n).padStart(2, '0')

/** market pan progress 0..1 (eased at both ends) */
const marketU = (l: number) => ease.inOutQuad(clamp((l - MP0) / (MP1 - MP0)))
/** local at which the market pan centres stall j */
const marketAt = (j: number) => {
  const u = j / (NR - 1)
  const t = u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2)
  return MP0 + t * (MP1 - MP0)
}

function stopOf(l: number) {
  const k = clamp(Math.floor((l - F0) / FW), 0, NF - 1)
  return { k, s: (l - F0 - k * FW) / FW }
}

function tramX(l: number) {
  if (l <= F0) return L.TERMINUS_X
  if (l < F1) {
    const { k, s } = stopOf(l)
    const from = k === 0 ? L.TERMINUS_X : L.STOP_X[k - 1]
    return lerp(from, L.STOP_X[k], ease.inOutCubic(clamp(s / TRAVEL)))
  }
  const m0 = L.STALL_X[0] + L.MARKET_LEAD
  const m1 = L.STALL_X[NR - 1] + L.MARKET_LEAD
  if (l < MP0) return lerp(L.STOP_X[NF - 1], m0, ease.inOutCubic(clamp((l - F1) / (MP0 - F1))))
  if (l < MP1) return lerp(m0, m1, marketU(l))
  return lerp(m1, L.BRIDGE_END + 8, ease.inCubic(clamp((l - MP1) / (1 - MP1))))
}

/** Where on the route strip (0..1) a tram x sits. */
const ROUTE_X0 = L.TERMINUS_X
const ROUTE_X1 = L.STALL_X[NR - 1] + L.MARKET_LEAD
const routeP = (x: number) => clamp((x - ROUTE_X0) / (ROUTE_X1 - ROUTE_X0))

interface Region {
  x0: number
  x1: number
  y0: number
  y1: number
}

interface Shot {
  pos: THREE.Vector3
  tgt: THREE.Vector3
  fov: number
  /** street-space point the shadows centre on */
  focus: THREE.Vector3
  shadow: number
  /** tilt-shift sharp band */
  focusY: number
  band: number
}
const shot = (): Shot => ({
  pos: new THREE.Vector3(),
  tgt: new THREE.Vector3(),
  fov: 16,
  focus: new THREE.Vector3(),
  shadow: 9,
  focusY: 0.5,
  band: 0.2,
})
function blendShot(a: Shot, b: Shot, t: number, out: Shot) {
  out.pos.lerpVectors(a.pos, b.pos, t)
  out.tgt.lerpVectors(a.tgt, b.tgt, t)
  out.fov = lerp(a.fov, b.fov, t)
  out.focus.lerpVectors(a.focus, b.focus, t)
  out.shadow = lerp(a.shadow, b.shadow, t)
  out.focusY = lerp(a.focusY, b.focusY, t)
  out.band = lerp(a.band, b.band, t)
  return out
}

const _d = new THREE.Vector3()
const _r = new THREE.Vector3()
const _u = new THREE.Vector3()
/**
 * Aim a camera (heading yaw, elevation pitch) so a subject of view-plane
 * size w×h centred at C fills the screen region `reg`.
 */
function frameTo(out: Shot, C: THREE.Vector3, w: number, h: number, yaw: number, pitch: number, fov: number, reg: Region, W: number, H: number) {
  _d.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  const aspect = W / H
  const tanH = Math.tan((fov * DEG) / 2)
  const fw = Math.max(0.08, (reg.x1 - reg.x0) / W)
  const fh = Math.max(0.08, (reg.y1 - reg.y0) / H)
  const cx = ((reg.x0 + reg.x1) / 2 / W) * 2 - 1
  const cy = 1 - ((reg.y0 + reg.y1) / 2 / H) * 2
  const dist = Math.max(w / 2 / (fw * tanH * aspect), h / 2 / (fh * tanH))
  const hh = dist * tanH
  const hw = hh * aspect
  _r.crossVectors(_d, UP).normalize()
  _u.crossVectors(_r, _d).normalize()
  out.pos.copy(C).addScaledVector(_d, -dist).addScaledVector(_r, -cx * hw).addScaledVector(_u, -cy * hh)
  out.tgt.copy(out.pos).addScaledVector(_d, dist)
  out.fov = fov
  out.focus.copy(C)
  out.focusY = 1 - (reg.y0 + reg.y1) / 2 / H
  return out
}

interface Layout {
  key: string
  W: number
  H: number
  portrait: boolean
  gutter: number
  safeTop: number
  safeBottom: number
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      if (typeof img.decode === 'function') img.decode().then(() => resolve(img), () => resolve(img))
      else resolve(img)
    }
    img.onerror = () => reject(new Error(`failed to load ${url}`))
    img.src = url
  })
}

class Work implements Chapter {
  id = 'work'
  group = new THREE.Group()
  /** WORK order: the six stops (dwelling, plate up), then the nine stalls as the pan passes them. */
  anchors = WORK.map(w => {
    const k = FEATURED.indexOf(w)
    if (k >= 0) return F0 + FW * (k + 0.62)
    return marketAt(Math.max(0, REST.indexOf(w)))
  })

  private ctx!: ChapterContext
  private town!: Town
  private life!: Life
  private signage!: Signage
  private mobile = false

  // camera
  private layout: Layout | null = null
  private cur = shot()
  private sA = shot()
  private sB = shot()
  private poseLocal = -1
  private plateW = 380
  private plateH = 360
  private marketH = 360
  private introH = 200

  // DOM
  private head!: HTMLElement
  private headNote!: HTMLElement
  private route!: HTMLElement
  private routeStops: HTMLElement[] = []
  private routeStalls: HTMLElement[] = []
  private intro!: HTMLElement
  private introTitle!: HTMLElement
  private plates: { root: HTMLElement; name: HTMLElement; on: boolean }[] = []
  private market!: HTMLElement
  private marketTitle!: HTMLElement
  private marketItems: HTMLElement[] = []
  private noteText = ''
  private nowStall = -1

  // images
  private jobs: (() => void)[] = []
  private queue: (() => Promise<unknown>)[] = []
  private loading = 0
  private streaming = false
  private postersDirty = false

  // pokes
  private ray = new THREE.Raycaster()
  private tmp = new THREE.Vector3()
  private tmpS = new THREE.Vector3()
  private mat = new THREE.Matrix4()
  private quat = new THREE.Quaternion()
  private eul = new THREE.Euler()
  private probe = new THREE.PerspectiveCamera(16, 1, 0.5, 2000)
  private pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  private tmpP = new THREE.Vector3()
  private tramV = 0
  private arrived: boolean[] = FEATURED.map(() => false)
  private tramPrevX = NaN
  private tramLean = 0
  private tramLeanV = 0

  async init(ctx: ChapterContext) {
    this.ctx = ctx
    this.mobile = ctx.mobile
    this.group.rotation.y = L.STREET_YAW

    this.signage = new Signage(FEATURED, REST)
    const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
    for (const t of [this.signage.signsTex, this.signage.stallsTex, this.signage.postersTex]) t.anisotropy = aniso
    this.buildDom(ctx.stage)
    await breathe()

    this.town = await buildTown(this.signage, this.mobile, placeholderTexture())
    this.group.add(this.town.root)
    await breathe()

    this.life = new Life(this.mobile)
    this.town.root.add(this.life.group)
    this.placeTransitClouds()

    // repaint signage once the real faces are in
    this.signage.whenFonts().then(() => this.signage.flush())

    // screenshots: the first billboard now, the rest once the site is revealed
    this.queue = [
      ...FEATURED.map((_, k) => () => this.fetchFeatured(k)),
      ...REST.map((_, j) => () => this.fetchPoster(j)),
    ]
    this.pumpLoads(1)
    const go = () => {
      if (this.streaming) return
      this.streaming = true
      this.pumpLoads(2)
    }
    if (document.documentElement.dataset.ready === '1') go()
    else {
      window.addEventListener('hark:reveal', go, { once: true })
      window.setTimeout(go, 12000)
    }
  }

  // ------------------------------------------------------------------ images

  private pumpLoads(max: number) {
    while (this.loading < max && this.queue.length) {
      const job = this.queue.shift()!
      this.loading++
      job().finally(() => {
        this.loading--
        if (this.streaming) this.pumpLoads(2)
      })
    }
  }

  private fetchFeatured(k: number) {
    return loadImage(workImage(FEATURED[k].id))
      .then(img => {
        const tex = new THREE.Texture(img)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy())
        tex.needsUpdate = true
        this.jobs.push(() => {
          try {
            this.ctx.renderer.initTexture(tex)
          } catch {
            /* uploads on first use instead */
          }
          this.town.boards[k].screen.map = tex
        })
      })
      .catch(err => console.warn(`[work] missing screenshot for ${FEATURED[k].id}`, err))
  }

  private fetchPoster(j: number) {
    return loadImage(workImage(REST[j].id))
      .then(img => {
        this.jobs.push(() => {
          this.signage.poster(j, img)
          this.postersDirty = true
        })
      })
      .catch(err => console.warn(`[work] missing screenshot for ${REST[j].id}`, err))
  }

  // ------------------------------------------------------------------ DOM

  private buildDom(stage: HTMLElement) {
    // head: place pin + a tram-line route strip
    this.head = el('div', 'wk-head', undefined, stage)
    const top = el('div', 'wk-head-row', undefined, this.head)
    el('p', 'hud-eyebrow', 'Main Street', top)
    el('span', 'hud-label wk-head-sub', SECTIONS.work.eyebrow, top)
    this.route = el('div', 'wk-route', undefined, this.head)
    el('span', 'wk-route-line', undefined, this.route)
    FEATURED.forEach((_, k) => {
      const i = el('i', 'wk-route-stop', undefined, this.route)
      i.style.left = `${(routeP(L.STOP_X[k]) * 100).toFixed(2)}%`
      this.routeStops.push(i)
    })
    REST.forEach((_, j) => {
      const i = el('i', 'wk-route-stall', undefined, this.route)
      i.style.left = `${(routeP(L.STALL_X[j] + L.MARKET_LEAD) * 100).toFixed(2)}%`
      this.routeStalls.push(i)
    })
    el('b', 'wk-route-tram', undefined, this.route)
    this.headNote = el('p', 'hud-label wk-head-note', '', this.head)

    // intro
    this.intro = el('div', 'wk-intro', undefined, stage)
    const [a, b] = SECTIONS.work.title.split(/ (?=\S+$)/)
    this.introTitle = rise(el('h2', 'hud-title', undefined, this.intro), `${esc(a)} <em>${esc(b)}</em>`)
    const note = el('p', 'wk-intro-note', undefined, this.intro)
    note.innerHTML = `<span class="wk-roundel" aria-hidden="true">H</span><span class="hud-label">Line H · ${NF} stops · ${NR} market stalls</span>`

    // one wayfinding plate per stop, docked left (or along the bottom on phones)
    const dock = el('div', 'wk-dock', undefined, stage)
    FEATURED.forEach((w, k) => this.plates.push(this.buildPlate(dock, w, k)))

    // market row
    this.market = el('section', 'wk-market hud-panel', undefined, dock)
    const mtop = el('div', 'wk-plate-top', undefined, this.market)
    el('span', 'hud-label', `Market row · ${NR} stalls`, mtop)
    this.marketTitle = rise(el('h3', 'hud-h2 wk-market-title', undefined, this.market), 'Nine more, <em>all live.</em>')
    const list = el('ul', 'wk-list', undefined, this.market)
    REST.forEach(w => {
      const li = el('li', '', undefined, list)
      const link = el('a', '', undefined, li)
      link.href = w.url
      link.target = '_blank'
      link.rel = 'noopener'
      link.innerHTML = `<span class="wk-li-name">${esc(w.name)}</span><span class="wk-li-kind">${esc(w.industry)}</span><span class="wk-li-arrow" aria-hidden="true">↗</span>`
      this.marketItems.push(li)
    })
    const cta = el('div', 'wk-cta', undefined, this.market)
    const hello = el('button', 'hud-btn', 'Say hello', cta)
    hello.type = 'button'
    hello.addEventListener('click', () => window.__hark?.land('contact'))

    // keep the camera framing in step with the real plate sizes
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.measure())
      for (const p of this.plates) ro.observe(p.root)
      ro.observe(this.market)
      ro.observe(this.intro)
    }
  }

  private buildPlate(stage: HTMLElement, w: WorkItem, k: number) {
    const root = el('article', 'wk-plate hud-panel', undefined, stage)
    const top = el('div', 'wk-plate-top', undefined, root)
    const stop = el('span', 'wk-stop', undefined, top)
    stop.innerHTML = `<span class="wk-roundel" aria-hidden="true">H</span><span class="hud-label">Stop <b>${pad(k + 1)}</b> / ${pad(NF)}</span>`
    el('span', 'hud-label wk-kind', w.industry, top)
    const name = rise(el('h3', 'hud-h2 wk-name', undefined, root), emLast(w.name))
    el('p', 'hud-body wk-blurb', w.blurb, root)
    const tags = el('ul', 'hud-tags wk-tags', undefined, root)
    for (const t of w.tags) el('li', 'hud-tag', t, tags)
    const cta = el('div', 'wk-cta', undefined, root)
    const pre = isPreview(w.url)
    const a = el('a', 'hud-btn', pre ? 'Preview site ↗' : 'Visit site ↗', cta)
    a.href = w.url
    a.target = '_blank'
    a.rel = 'noopener'
    if (pre) el('span', 'wk-pill wk-pill--preview', 'Preview', cta)
    else el('span', 'wk-pill', hostOf(w.url), cta)
    return { root, name, on: false }
  }

  private measure() {
    let w = 0
    let h = 0
    for (const p of this.plates) {
      w = Math.max(w, p.root.offsetWidth)
      h = Math.max(h, p.root.offsetHeight)
    }
    if (w) this.plateW = w
    if (h) this.plateH = h
    this.marketH = this.market.offsetHeight || this.marketH
    this.introH = this.intro.offsetHeight || this.introH
    this.layout = null
  }

  // ------------------------------------------------------------------ camera

  private ensureLayout(f: Frame) {
    const key = `${f.width}x${f.height}`
    if (this.layout?.key === key) return this.layout
    const W = f.width
    const H = f.height
    const portrait = W / H < 0.8 || W < 700
    this.layout = {
      key,
      W,
      H,
      portrait,
      gutter: clamp(W * 0.034, 16, 48),
      safeTop: clamp(H * 0.105, 80, 112),
      safeBottom: clamp(H * 0.105, 82, 110),
    }
    return this.layout
  }

  /** Where the subject goes on screen: right of the plate (landscape) or above it (portrait). */
  private region(kind: 'stop' | 'market' | 'intro', lay: Layout): Region {
    const { W, H, gutter, safeTop, safeBottom } = lay
    if (lay.portrait) {
      const below = kind === 'stop' ? this.plateH : kind === 'market' ? this.marketH : this.introH
      // the subject may tuck a little under the top of the plate
      const y1 = Math.max(safeTop + 170, H - safeBottom - 6 - below + (kind === 'intro' ? -10 : 18))
      return { x0: gutter * 0.4, x1: W - gutter * 0.4, y0: safeTop + (kind === 'intro' ? 30 : 62), y1 }
    }
    if (kind === 'intro') return { x0: W * 0.2, x1: W - gutter * 0.3, y0: H * 0.3, y1: H - safeBottom * 0.55 }
    const left = gutter + (kind === 'market' ? Math.max(this.plateW, 360) : this.plateW) + W * 0.035
    return { x0: left, x1: W - gutter * 0.5, y0: safeTop - H * 0.02, y1: H - safeBottom - H * 0.005 }
  }

  private introShot(l: number, lay: Layout, out: Shot) {
    const u = clamp((l - 0.04) / (F0 - 0.04))
    const C = this.tmp.set(lerp(5.5, 9.5, u), 0.2, -1.2)
    const port = lay.portrait
    frameTo(
      out,
      C,
      port ? 30 : 44,
      port ? 18 : 15.5,
      lerp(-0.66, -0.56, u),
      lerp(0.62, 0.58, u),
      17,
      this.region('intro', lay),
      lay.W,
      lay.H,
    )
    out.shadow = 26
    out.band = 0.3
    return out
  }

  private inShot(lay: Layout, out: Shot) {
    this.introShot(0.04, lay, out)
    const C = out.tgt
    const dir = this.tmpS.copy(out.pos).sub(C)
    const len = dir.length()
    dir.normalize()
    // swing up to a steep, high view (above the cloud layer)
    dir.y = 0
    dir.normalize().multiplyScalar(Math.cos(1.2)).setY(Math.sin(1.2)).normalize()
    out.pos.copy(C).addScaledVector(dir, len * 1.9)
    out.fov = 20
    out.band = 0.1
    return out
  }

  private stopShot(k: number, s: number, lay: Layout, out: Shot) {
    const port = lay.portrait
    const C = this.tmp.set(L.SHOP_X[k] + (port ? 0.1 : -0.15), port ? 3.0 : 2.75, port ? -3.0 : -2.6)
    const drift = clamp((s - TRAVEL) / (1 - TRAVEL))
    frameTo(
      out,
      C,
      port ? 5.6 : 7.4,
      port ? 6.4 : 8.4,
      L.VIEW_YAW - 0.06 + drift * 0.1,
      0.5 - drift * 0.03,
      16,
      this.region('stop', lay),
      lay.W,
      lay.H,
    )
    // a slow push in while we dwell
    out.pos.lerp(out.tgt, drift * 0.04)
    out.shadow = 9
    out.focus.set(L.SHOP_X[k], 0, -2.4)
    // keep the billboard, the shop sign and the tram in the sharp band
    const b = this.town.boards[k].center
    this.pts[0].set(b.x, b.y + 1.5, b.z)
    this.pts[1].set(L.SHOP_X[k], 1.0, L.FRONT_Z + 0.4)
    this.pts[2].set(L.STOP_X[k], 0.45, 0.45)
    this.bandFor(out, lay, this.pts, 3, 0.04)
    return out
  }

  private marketShot(l: number, lay: Layout, out: Shot) {
    const x = lerp(L.STALL_X[0], L.STALL_X[NR - 1], marketU(l))
    const port = lay.portrait
    frameTo(out, this.tmp.set(x + 0.3, 1.15, -2.3), port ? 6.2 : 9.2, port ? 4.4 : 4.6, -0.3, 0.5, 16, this.region('market', lay), lay.W, lay.H)
    out.shadow = 9.5
    this.pts[0].set(x, 2.0, L.STALL_Z - 0.3)
    this.pts[1].set(x, 0.2, -1.6)
    this.bandFor(out, lay, this.pts, 2, 0.06)
    return out
  }

  private outShot(lay: Layout, out: Shot) {
    const C = this.tmp.set(L.STALL_X[NR - 1] + 14, 0, -1)
    frameTo(out, C, 60, 30, -0.2, 1.12, 20, { x0: 0, x1: lay.W, y0: 0, y1: lay.H }, lay.W, lay.H)
    out.pos.y += 14
    out.shadow = 22
    out.band = 0.1
    return out
  }

  private solve(l: number, f: Frame) {
    const lay = this.ensureLayout(f)
    const out = this.cur
    const A = this.sA
    const B = this.sB
    if (l < F0) {
      this.introShot(l, lay, A)
      if (l < 0.085) {
        this.inShot(lay, B)
        const t = ease.outCubic(clamp(l / 0.085))
        blendShot(B, A, t, out)
      } else blendShot(A, A, 0, out)
    } else if (l < F1) {
      const { k, s } = stopOf(l)
      this.stopShot(k, s, lay, B)
      // ride in from the previous stop (the camera lags the tram a touch)
      const e = ease.inOutCubic(clamp((s - 0.02) / (TRAVEL + 0.02)))
      if (e < 1) {
        if (k === 0) this.introShot(F0, lay, A)
        else this.stopShot(k - 1, 1, lay, A)
        blendShot(A, B, e, out)
        this.pullBack(out, Math.sin(e * Math.PI) * (k === 0 ? 0.08 : 0.22))
      } else blendShot(B, B, 0, out)
    } else if (l < MP1) {
      this.marketShot(l, lay, B)
      const e = ease.inOutCubic(clamp((l - F1) / (MP0 - F1 + 0.01)))
      if (e < 1) {
        this.stopShot(NF - 1, 1, lay, A)
        blendShot(A, B, e, out)
        this.pullBack(out, Math.sin(e * Math.PI) * 0.26)
      } else blendShot(B, B, 0, out)
    } else {
      this.marketShot(MP1, lay, A)
      this.outShot(lay, B)
      blendShot(A, B, ease.inCubic(clamp((l - MP1) / (1 - MP1))), out)
    }
    this.poseLocal = l
    return out
  }

  /** Drone rises: back the camera off along its view line. */
  private pullBack(out: Shot, amount: number) {
    out.pos.sub(out.tgt).multiplyScalar(1 + amount).add(out.tgt)
  }

  /** Set the tilt-shift band so these street-space points stay sharp. */
  private bandFor(out: Shot, lay: Layout, pts: THREE.Vector3[], n: number, pad: number) {
    const cam = this.probe
    cam.fov = out.fov
    cam.aspect = lay.W / lay.H
    cam.updateProjectionMatrix()
    cam.position.copy(out.pos)
    cam.lookAt(out.tgt)
    cam.updateMatrixWorld()
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < n; i++) {
      const y = this.tmpP.copy(pts[i]).project(cam).y * 0.5 + 0.5
      if (!Number.isFinite(y)) continue
      lo = Math.min(lo, y)
      hi = Math.max(hi, y)
    }
    if (lo > hi) return
    out.focusY = clamp((lo + hi) / 2, 0.1, 0.9)
    out.band = clamp((hi - lo) / 2 + pad, 0.1, 0.42)
  }

  // ------------------------------------------------------------------ transit clouds

  private placeTransitClouds() {
    const f = { width: 1440, height: 900 } as Frame
    const lay = this.ensureLayout(f)
    const pts: { x: number; y: number; z: number; s: number }[] = []
    // descent: a layer the camera drops through
    const a = this.introShot(0.04, lay, shot())
    const b = this.inShot(lay, shot())
    for (let i = 0; i < 7; i++) {
      const t = 0.42 + (i % 3) * 0.1
      const p = new THREE.Vector3().lerpVectors(a.pos, b.pos, t)
      pts.push({ x: p.x + (i - 3) * 6, y: p.y - 6 + (i % 2) * 3, z: p.z - 10 + ((i * 7) % 5) * 4, s: 3 + (i % 3) })
    }
    // exit: clouds over the sky bridge the camera rises into
    const c = this.marketShot(MP1, lay, shot())
    const d = this.outShot(lay, shot())
    for (let i = 0; i < 7; i++) {
      const t = 0.5 + (i % 3) * 0.12
      const p = new THREE.Vector3().lerpVectors(c.pos, d.pos, t)
      pts.push({ x: p.x + (i - 3) * 6, y: p.y - 7 + (i % 2) * 3, z: p.z - 12 + ((i * 5) % 4) * 5, s: 3 + (i % 3) })
    }
    // and along the far end of the bridge, so it trails off into cloud
    for (let i = 0; i < 6; i++) pts.push({ x: L.BRIDGE_END - 8 + i * 4, y: -0.8 + (i % 2) * 1.2, z: (i % 3) - 1, s: 2.2 + (i % 2) })
    this.life.addTransitClouds(pts)
    this.layout = null
  }

  // ------------------------------------------------------------------ frame

  update(l: number, f: Frame, ctx: ChapterContext) {
    const calm = ctx.reducedMotion
    const dt = f.dt
    const t = f.time
    const town = this.town
    const s = this.solve(l, f)

    // sky + light: late morning, sun raking across the shop fronts
    const wp = ctx.world.params
    wp.time = 0.34 + 0.12 * l
    wp.focus.copy(s.focus).applyAxisAngle(UP, L.STREET_YAW)
    wp.shadowSize = s.shadow
    wp.sunAzimuth = L.SUN_AZIMUTH

    // tilt-shift + finish
    const pp = ctx.post.params
    pp.focusY = s.focusY
    pp.band = s.band
    pp.blur = this.mobile ? 6 : 8
    pp.sat = 1.14
    pp.vignette = 0.24
    pp.bloomStrength = 0.4
    pp.bloomRadius = 0.35

    // ---- tram (scroll-driven), with a springy lean when it brakes
    const tx = tramX(l)
    const v = Number.isFinite(this.tramPrevX) ? (tx - this.tramPrevX) / Math.max(dt, 1e-3) : 0
    this.tramPrevX = tx
    const vv = clamp(v, -30, 30)
    const accel = clamp((vv - this.tramV) / Math.max(dt, 1e-3), -60, 60)
    this.tramV = vv
    const target = calm ? 0 : -accel * 0.0022
    this.tramLeanV += (180 * (target - this.tramLean) - 9 * this.tramLeanV) * Math.min(dt, 0.05)
    this.tramLean += this.tramLeanV * Math.min(dt, 0.05)
    this.tramLean = clamp(this.tramLean, -0.08, 0.08)
    town.tram.position.x = tx
    town.tram.rotation.z = this.tramLean
    const moving = Math.abs(vv) > 0.05
    town.tram.position.y = L.RAIL_Y + (moving && !calm ? Math.abs(Math.sin(t * 22)) * 0.008 : 0)
    // off the end of the sky bridge, it shrinks into the cloud
    const gone = clamp((tx - (L.BRIDGE_END - 10)) / 10)
    town.tram.scale.setScalar(Math.max(0.001, 1 - gone))

    // ---- the town pops up in a wave as the clouds part
    const popAt = (x: number) => 0.02 + 0.07 * clamp((x + 11) / 55)
    const pop = (p: Popper, on: boolean) => {
      p.spring.step(on ? 1 : 0, dt, calm)
      squash(p.spring, p.obj.scale, 1)
      p.obj.visible = p.spring.x > 0.002
    }
    for (const p of town.shops) pop(p, l > popAt(p.x))
    for (const p of town.fillers) pop(p, l > popAt(p.x))
    for (let j = 0; j < town.stalls.length; j++) pop(town.stalls[j], tx > L.STALL_X[j] - 1.4)

    // ---- billboards flip as the tram pulls in
    for (let k = 0; k < NF; k++) {
      const b = town.boards[k]
      const arrive = F0 + FW * (k + TRAVEL * 0.85)
      const here = l > arrive
      // the shop gives a happy hop as its tram pulls in
      if (here && !this.arrived[k] && !calm && Math.abs(l - arrive) < FW * 0.5) town.shops[k].spring.v += 3.2
      this.arrived[k] = here
      const x = b.spring.step(here ? 1 : 0, dt, calm)
      b.flip.rotation.x = x * Math.PI
    }

    // ---- trees bounce in
    this.updateTrees(l, dt, t, calm, popAt)

    // ---- idle life + little machines
    town.animate(t, calm)
    this.life.update(t, calm, s.focus.x)

    // ---- one heavy job per frame (texture uploads, poster paints)
    const job = this.jobs.shift()
    if (job) {
      try {
        job()
      } catch (err) {
        console.warn('[work] job failed', err)
      }
    } else if (this.postersDirty) {
      this.postersDirty = false
      this.signage.postersTex.needsUpdate = true
    }

    this.updateDom(l, tx)
  }

  private updateTrees(l: number, dt: number, t: number, calm: boolean, popAt: (x: number) => number) {
    const tr = this.town.trees
    const m = this.mat
    const q = this.quat
    const e = this.eul
    const v = this.tmp
    const sc = this.tmpS
    const sq = new THREE.Vector3()
    for (let i = 0; i < tr.items.length; i++) {
      const it = tr.items[i]
      it.spring.step(l > popAt(it.x) + (i % 5) * 0.003 ? 1 : 0, dt, calm)
      squash(it.spring, sq, 1.2)
      const sway = calm ? 0 : Math.sin(t * 1.4 + it.phase) * 0.035
      e.set(sway * 0.6, 0, sway)
      q.setFromEuler(e)
      const S = it.s
      // trunk
      sc.set(sq.x * S, sq.y * S * it.h, sq.z * S)
      m.compose(v.set(it.x, 0, it.z), q, sc)
      tr.trunks.setMatrixAt(i, m)
      // crown sits on the trunk
      const hidden = sq.y < 0.002
      if (it.kind === 0) {
        const r = it.r * S
        sc.set(hidden ? 0 : sq.x * r, hidden ? 0 : sq.y * r * 1.05, hidden ? 0 : sq.z * r)
        const cy = (it.h * S + r * 0.8) * sq.y
        v.set(it.x + Math.sin(sway) * cy * 0.6, cy, it.z)
        m.compose(v, q, sc)
        tr.crowns.setMatrixAt(i, m)
        sc.set(0, 0, 0)
        tr.cones.setMatrixAt(i, m.compose(v, q, sc))
      } else {
        const r = it.r * S * 0.85
        const h = S * 1.25
        sc.set(hidden ? 0 : sq.x * r, hidden ? 0 : sq.y * h, hidden ? 0 : sq.z * r)
        const cy = it.h * S * 0.55 * sq.y
        v.set(it.x, cy, it.z)
        m.compose(v, q, sc)
        tr.cones.setMatrixAt(i, m)
        sc.set(0, 0, 0)
        tr.crowns.setMatrixAt(i, m.compose(v, q, sc))
      }
    }
    tr.trunks.instanceMatrix.needsUpdate = true
    tr.crowns.instanceMatrix.needsUpdate = true
    tr.cones.instanceMatrix.needsUpdate = true
  }

  private updateDom(l: number, tx: number) {
    // head + route strip
    this.head.classList.toggle('is-in', l > 0.03 && l < 0.965)
    this.route.style.setProperty('--p', routeP(tx).toFixed(4))
    const { k, s } = stopOf(l)
    let note = 'All aboard'
    if (l >= F0 && l < F1) {
      const next = s < TRAVEL * 0.85 ? k : k + 1
      note = next < NF ? `Next stop · ${FEATURED[next].name}` : 'Next stop · Market Row'
    } else if (l >= F1 && l < MP1) note = 'Next stop · Sky Bridge'
    else if (l >= MP1) note = 'All change'
    if (note !== this.noteText) {
      this.noteText = note
      this.headNote.textContent = note
    }
    for (let i = 0; i < NF; i++) {
      const arrived = l >= F0 + FW * (i + TRAVEL * 0.85)
      const here = arrived && l < F0 + FW * (i + 1) && l < F1
      this.routeStops[i].classList.toggle('is-done', arrived)
      this.routeStops[i].classList.toggle('is-on', here)
    }
    for (let j = 0; j < NR; j++) this.routeStalls[j].classList.toggle('is-done', tx >= L.STALL_X[j] + L.MARKET_LEAD - 0.5)

    // intro
    const introOn = l > 0.028 && l < F0 - 0.004
    this.intro.classList.toggle('is-in', introOn)
    setRise(this.introTitle, introOn)

    // plates
    for (let i = 0; i < NF; i++) {
      const p = this.plates[i]
      const a = F0 + FW * (i + TRAVEL * 0.8)
      const b = F0 + FW * (i + 1) - FW * 0.05
      const on = l > a && l < b
      if (on !== p.on) {
        p.on = on
        p.root.classList.toggle('is-in', on)
        setRise(p.name, on)
      }
    }

    // market
    const mOn = l > F1 + 0.018 && l < MP1 + 0.006
    this.market.classList.toggle('is-in', mOn)
    setRise(this.marketTitle, mOn)
    let now = -1
    if (mOn) {
      const x = lerp(L.STALL_X[0], L.STALL_X[NR - 1], marketU(l))
      let best = Infinity
      for (let j = 0; j < NR; j++) {
        const d = Math.abs(L.STALL_X[j] - x)
        if (d < best) {
          best = d
          now = j
        }
      }
    }
    if (now !== this.nowStall) {
      if (this.nowStall >= 0) this.marketItems[this.nowStall].classList.remove('is-now')
      if (now >= 0) this.marketItems[now].classList.add('is-now')
      this.nowStall = now
    }
  }

  camera(l: number, f: Frame, out: CameraPose) {
    const s = this.poseLocal === l && this.layout ? this.cur : this.solve(l, f)
    out.position.copy(s.pos).applyAxisAngle(UP, L.STREET_YAW)
    out.target.copy(s.tgt).applyAxisAngle(UP, L.STREET_YAW)
    out.fov = s.fov
    out.roll = 0
    out.parallax = 0.5
  }

  onPointerDown(f: Frame, ctx: ChapterContext) {
    // poke a building: it wobbles like a toy
    this.ray.setFromCamera(f.pointerRaw, ctx.camera)
    let best: { d: number; p: Popper } | null = null
    for (const { mesh, popper } of this.town.pokeables) {
      if (!popper.obj.visible) continue
      const hits = this.ray.intersectObject(mesh, true)
      if (hits.length && (!best || hits[0].distance < best.d)) best = { d: hits[0].distance, p: popper }
    }
    if (best && !ctx.reducedMotion) best.p.spring.v += 5.5
  }

  onLeave() {
    this.tramPrevX = NaN
  }
}

export default function create(): Chapter {
  return new Work()
}
