import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp } from '../../core/math'
import { SECTIONS, WORK, workImage, type WorkItem } from '../../content'
import { Signage, placeholderTexture } from './signs'
import { buildTown, type Popper, type Town } from './town'
import { Life } from './life'
import { squash } from './kit'
import { nextFrame } from '../../core/yield'
import * as L from './layout'
import './work.css'

/*
 * MAIN STREET — Selected work.
 *
 * A long floating island with a tram line down the middle. The Hark tram
 * leaves the terminus and calls at six shops in turn; as it pulls in, the
 * shop's rooftop billboard flips from a green "Stop 0N" face to the client's
 * website (washing out to blank paper once the tram moves on), and a
 * wayfinding plate slides in with the project. Past the six
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
  return lerp(m1, L.BRIDGE_END + 8, ease.inQuad(clamp((l - MP1) / (1 - MP1))))
}

/** Local at which stop k's billboard turns to the website (the tram is braking in). */
const boardArrive = (k: number) => F0 + FW * (k + TRAVEL * 0.85)
/** …and starts to wash out (the tram has just pulled away, the plate is already down). */
const boardDepart = (k: number) => (k < NF - 1 ? F0 + FW * (k + 1 + TRAVEL * 0.15) : F1 + (MP0 - F1) * 0.2)

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

const _c = new THREE.Vector3()
const _o = new THREE.Vector3()
const _probe = new THREE.PerspectiveCamera(16, 1, 0.5, 2000)
/**
 * frameTo for a set of points: fit the view-plane box (for this yaw/pitch)
 * that holds all of them into `reg` (less `padPx`), at least `minW` wide.
 * The first guess ignores perspective (near points project larger, far ones
 * smaller), so it is corrected against the real projection a couple of times.
 */
function frameFit(out: Shot, pts: THREE.Vector3[], yaw: number, pitch: number, fov: number, reg: Region, W: number, H: number, minW: number, padPx: number) {
  _d.set(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
  _r.crossVectors(_d, UP).normalize()
  _u.crossVectors(_r, _d).normalize()
  const o = pts[0]
  let a0 = Infinity
  let a1 = -Infinity
  let b0 = Infinity
  let b1 = -Infinity
  for (const p of pts) {
    _o.subVectors(p, o)
    a0 = Math.min(a0, _o.dot(_r))
    a1 = Math.max(a1, _o.dot(_r))
    b0 = Math.min(b0, _o.dot(_u))
    b1 = Math.max(b1, _o.dot(_u))
  }
  const rx0 = reg.x0 + padPx
  const rx1 = reg.x1 - padPx
  const ry0 = reg.y0 + padPx
  const ry1 = reg.y1 - padPx
  const inner = { x0: rx0, x1: rx1, y0: ry0, y1: ry1 }
  const tanH = Math.tan((fov * DEG) / 2)
  _probe.fov = fov
  _probe.aspect = W / H
  _probe.updateProjectionMatrix()
  for (let it = 0; ; it++) {
    const w = a1 - a0
    if (w < minW) {
      a0 -= (minW - w) / 2
      a1 += (minW - w) / 2
    }
    // (frameTo recomputes the same basis)
    const C = _c.copy(o).addScaledVector(_r, (a0 + a1) / 2).addScaledVector(_u, (b0 + b1) / 2)
    frameTo(out, C, a1 - a0, b1 - b0, yaw, pitch, fov, inner, W, H)
    if (it === 2) break
    const dist = _o.subVectors(C, out.pos).dot(_d)
    const upp = (2 * dist * tanH) / H
    _probe.position.copy(out.pos)
    _probe.lookAt(out.tgt)
    _probe.updateMatrixWorld()
    let sx0 = Infinity
    let sx1 = -Infinity
    let sy0 = Infinity
    let sy1 = -Infinity
    for (const p of pts) {
      _o.copy(p).project(_probe)
      const sx = (_o.x * 0.5 + 0.5) * W
      const sy = (0.5 - _o.y * 0.5) * H
      sx0 = Math.min(sx0, sx)
      sx1 = Math.max(sx1, sx)
      sy0 = Math.min(sy0, sy)
      sy1 = Math.max(sy1, sy)
    }
    if (!Number.isFinite(sx0 + sx1 + sy0 + sy1) || !(upp > 0)) break
    // pull each box edge in (or push it out) by how far its points fall short of (or past) the region
    a0 += (sx0 - rx0) * upp
    a1 -= (rx1 - sx1) * upp
    b1 -= (sy0 - ry0) * upp
    b0 += (ry1 - sy1) * upp
    if (!(a1 > a0 && b1 > b0)) break
  }
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

/** A decoded screenshot: an ImageBitmap (decoded + resized off the main thread) or, as a fallback, an <img>. */
interface Pic {
  src: ImageBitmap | HTMLImageElement
  bitmap: boolean
}

/**
 * Fetch a screenshot and decode it off the main thread at the size it is
 * drawn at (the sources are 1280×800). Older engines that reject the resize
 * options get a full-size bitmap; engines without createImageBitmap (or that
 * fail to decode the blob) fall back to a plain <img>.
 */
async function loadPic(url: string, w: number, h: number): Promise<Pic> {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    let blob: Blob | null = null
    try {
      const res = await fetch(url)
      if (res.ok) blob = await res.blob()
    } catch {
      blob = null
    }
    if (blob) {
      try {
        return { src: await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }), bitmap: true }
      } catch {
        /* resize options unsupported: decode at full size */
      }
      try {
        return { src: await createImageBitmap(blob), bitmap: true }
      } catch {
        /* fall through to <img> */
      }
    }
  }
  return { src: await loadImage(url), bitmap: false }
}

/** Run `fn` when the main thread is idle (or within `timeout` ms regardless). */
const whenIdle = (fn: () => void, timeout: number) => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout })
  else window.setTimeout(fn, 34)
}

interface NdcRect {
  x0: number
  y0: number
  x1: number
  y1: number
}
/**
 * Publish a copy box to the world's far-field keep-out (world.params.keepOut,
 * an NDC rect, y up). Guarded: the world may not expose it; its shape may be a
 * plain {x0, y0, x1, y1}, a Vector4 or a Box2.
 */
function publishKeepOut(wp: object, r: NdcRect) {
  if (!('keepOut' in wp)) return
  const holder = wp as { keepOut: unknown }
  const ko = holder.keepOut
  if (ko instanceof THREE.Vector4) ko.set(r.x0, r.y0, r.x1, r.y1)
  else if (ko instanceof THREE.Box2) {
    ko.min.set(r.x0, r.y0)
    ko.max.set(r.x1, r.y1)
  } else if (ko && typeof ko === 'object') Object.assign(ko, r)
  else holder.keepOut = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }
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
  /** each stop's own plate height (portrait frames each stop just above its plate) */
  private plateHs: number[] = FEATURED.map(() => 0)
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
  private introNote!: HTMLElement
  /** the intro headline's box in NDC (for world.params.keepOut), and the viewport it was measured at */
  private keep = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private keepKey = ''
  private plates: { root: HTMLElement; name: HTMLElement; on: boolean }[] = []
  private market!: HTMLElement
  private marketTitle!: HTMLElement
  private marketItems: HTMLElement[] = []
  private noteText = ''
  private nowStall = -1

  // images: decoded off-thread, then uploaded one per idle slot whichever chapter is on
  private jobs: (() => void)[] = []
  private queue: (() => Promise<unknown>)[] = []
  private loading = 0
  private streaming = false
  private postersDirty = false
  private postersPending = REST.length
  private idleQueued = false
  private active = false

  // pokes
  private ray = new THREE.Raycaster()
  private tmp = new THREE.Vector3()
  private tmpS = new THREE.Vector3()
  private mat = new THREE.Matrix4()
  private quat = new THREE.Quaternion()
  private eul = new THREE.Euler()
  private probe = new THREE.PerspectiveCamera(16, 1, 0.5, 2000)
  private pts = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
  private fit = Array.from({ length: 5 }, () => new THREE.Vector3())
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
    await nextFrame()

    this.town = await buildTown(this.signage, this.mobile, placeholderTexture())
    this.group.add(this.town.root)
    await nextFrame()

    this.life = new Life(this.mobile)
    this.town.root.add(this.life.group)
    this.placeTransitClouds()

    // repaint signage once the real faces are in, and upload it while idle
    // (not on the first Main Street frame)
    this.signage.whenFonts().then(() => {
      this.signage.flush()
      this.addJob(() => {
        this.upload(this.signage.signsTex)
        this.upload(this.signage.stallsTex)
      })
    })

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
    // billboards are ~400 css px wide at most on screen
    const [w, h] = this.mobile ? [800, 500] : [1024, 640]
    return loadPic(workImage(FEATURED[k].id), w, h)
      .then(pic => {
        const tex = new THREE.Texture(pic.src)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy())
        if (pic.bitmap) {
          // WebGL ignores UNPACK_FLIP_Y for ImageBitmaps: flip in the UVs instead
          tex.flipY = false
          tex.repeat.set(1, -1)
          tex.offset.set(0, 1)
        }
        tex.needsUpdate = true
        this.addJob(() => {
          this.upload(tex)
          this.town.boards[k].screen.map = tex
        })
      })
      .catch(err => console.warn(`[work] missing screenshot for ${FEATURED[k].id}`, err))
  }

  private fetchPoster(j: number) {
    // sidewalk A-board thumbnails are 320×200 cells in the posters atlas
    return loadPic(workImage(REST[j].id), 320, 200)
      .then(pic => {
        this.addJob(() => {
          this.signage.poster(j, pic.src)
          this.postersDirty = true
        })
      })
      .catch(err => console.warn(`[work] missing screenshot for ${REST[j].id}`, err))
      .finally(() => {
        this.postersPending--
        this.addJob(() => this.flushPosters())
      })
  }

  /** Upload a texture now (off the render path), or leave it for first use. */
  private upload(tex: THREE.Texture) {
    try {
      this.ctx.renderer.initTexture(tex)
    } catch {
      /* uploads on first use instead */
    }
  }

  /** One posters-atlas upload once every thumbnail has settled (or at once while Main Street is on screen). */
  private flushPosters() {
    if (!this.postersDirty || (this.postersPending > 0 && !this.active)) return
    this.postersDirty = false
    this.signage.postersTex.needsUpdate = true
    this.upload(this.signage.postersTex)
  }

  /**
   * Queue a texture upload / poster paint. Jobs run one per idle slot whichever
   * chapter is on screen, so everything is on the GPU before the tram arrives
   * (and a first visit to Main Street never pays for it mid-wipe).
   */
  private addJob(job: () => void) {
    this.jobs.push(job)
    this.pumpJobs()
  }

  private pumpJobs() {
    if (this.idleQueued || !this.jobs.length) return
    this.idleQueued = true
    whenIdle(() => {
      this.idleQueued = false
      const job = this.jobs.shift()
      if (job) {
        try {
          job()
        } catch (err) {
          console.warn('[work] job failed', err)
        }
      }
      this.pumpJobs()
    }, 600)
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
    this.introNote = note
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
    this.plates.forEach((p, k) => {
      w = Math.max(w, p.root.offsetWidth)
      h = Math.max(h, p.root.offsetHeight)
      this.plateHs[k] = p.root.offsetHeight
    })
    if (w) this.plateW = w
    if (h) this.plateH = h
    this.marketH = this.market.offsetHeight || this.marketH
    this.introH = this.intro.offsetHeight || this.introH
    this.layout = null
    this.keepKey = ''
  }

  // ------------------------------------------------------------------ camera

  private ensureLayout(f: Frame) {
    const key = `${f.width}x${f.height}`
    if (this.layout?.key === key) return this.layout
    const W = f.width
    const H = f.height
    const portrait = W / H <= 0.8 || W < 700 // matches work.css (max-aspect-ratio: 4/5)
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
  private region(kind: 'stop' | 'market' | 'intro', lay: Layout, k = -1): Region {
    const { W, H, gutter, safeTop, safeBottom } = lay
    if (lay.portrait) {
      const below = kind === 'stop' ? this.plateHs[k] || this.plateH : kind === 'market' ? this.marketH : this.introH
      // the market may tuck a little under the top of its plate; a stop's
      // subject box already holds the tram, which must stay clear of it
      const tuck = kind === 'intro' ? -10 : kind === 'market' ? 18 : -6
      const y1 = Math.max(safeTop + 170, H - safeBottom - 6 - below + tuck)
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
    const drift = clamp((s - TRAVEL) / (1 - TRAVEL))
    const yaw = L.VIEW_YAW - 0.06 + drift * 0.1
    const pitch = 0.5 - drift * 0.03
    const reg = this.region('stop', lay, k)
    if (port) {
      // island above the plate: fit the billboard's top edge and the whole tram
      // (at its halt) between the head and the plate, whatever the aspect
      const b = this.town.boards[k].center
      const f = this.fit
      const cx = Math.cos(L.BOARD_YAW) * 2.15
      const cz = -Math.sin(L.BOARD_YAW) * 2.15
      f[0].set(b.x - cx, b.y + 1.45, b.z - cz)
      f[1].set(b.x + cx, b.y + 1.45, b.z + cz)
      f[2].set(L.STOP_X[k] - 1.5, L.RAIL_Y, 0.46)
      f[3].set(L.STOP_X[k] + 1.5, L.RAIL_Y, 0.46)
      f[4].set(L.SHOP_X[k] + 0.1, 3.0, -3.0)
      frameFit(out, f, yaw, pitch, 16, reg, lay.W, lay.H, 5.2, 8)
    } else frameTo(out, this.tmp.set(L.SHOP_X[k] - 0.15, 2.75, -2.6), 7.4, 8.4, yaw, pitch, 16, reg, lay.W, lay.H)
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
      // (inQuad: already on the move as the shorter cut window opens)
      blendShot(A, B, ease.inQuad(clamp((l - MP1) / (1 - MP1))), out)
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
    // keep the distant islets out from behind "Built to be heard."
    if (l < F0 && this.introNdc(f)) publishKeepOut(wp, this.keep)

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

    // ---- billboards flip to the client's site as the tram pulls in; once it
    // pulls out again the site washes out to blank paper, so only the stop we
    // are at shows a website (a stop's plate never sits over another client's
    // screen, and nothing competes with its copy)
    for (let k = 0; k < NF; k++) {
      const b = town.boards[k]
      const arrive = boardArrive(k)
      const arrived = l > arrive
      // the shop gives a happy hop as its tram pulls in
      if (arrived && !this.arrived[k] && !calm && Math.abs(l - arrive) < FW * 0.5) town.shops[k].spring.v += 3.2
      this.arrived[k] = arrived
      const x = b.spring.step(arrived ? 1 : 0, dt, calm)
      b.flip.rotation.x = x * Math.PI
      const wash = ease.inOutQuad(clamp((l - boardDepart(k)) / (FW * 0.18))) * 0.94
      b.blank.opacity = wash
      b.blankMesh.visible = wash > 0.002
    }

    // ---- trees bounce in
    this.updateTrees(l, dt, t, calm, popAt)

    // ---- idle life + little machines
    town.animate(t, calm)
    this.life.update(t, calm, s.focus.x)

    // ---- screenshots still streaming in while we are here: show them as they land
    if (this.active && this.postersDirty && !this.jobs.length) this.flushPosters()

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

  /** Measure the intro headline + note (their text, not the column) in NDC, once per viewport. */
  private introNdc(f: Frame) {
    const key = `${f.width}x${f.height}`
    if (this.keepKey === key) return true
    // the column's box for the vertical extent (its children animate in),
    // the text itself for how far right it reaches
    const box = this.intro.getBoundingClientRect()
    const range = document.createRange()
    const x0 = box.left
    const y0 = box.top
    const y1 = box.bottom
    let x1 = -Infinity
    for (const n of [this.introTitle, this.introNote]) {
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.width) x1 = Math.max(x1, r.right)
    }
    // hidden stage (prewarm) or not laid out yet: try again next frame
    if (!(x1 > x0 && y1 > y0)) return false
    const k = this.keep
    const pad = 12
    k.x0 = ((x0 - pad) / f.width) * 2 - 1
    k.x1 = ((x1 + pad) / f.width) * 2 - 1
    k.y0 = 1 - ((y1 + pad) / f.height) * 2
    k.y1 = 1 - ((y0 - pad) / f.height) * 2
    this.keepKey = key
    return true
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

  onEnter() {
    this.active = true
  }

  onLeave() {
    this.tramPrevX = NaN
    this.active = false
  }
}

export default function create(): Chapter {
  return new Work()
}
