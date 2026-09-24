import { el, rise, setRise } from '../../core/dom'
import { MICROCOPY, SECTIONS, SERVICES } from '../../content'
import { PLACES } from './workshops'

/*
 * Wayfinding signage for The Works. Scroll decides WHAT is up (intro, which
 * workshop the plate names, which pins show); CSS decides how it arrives, so
 * wherever the scroll rests the copy is settled and exact.
 *
 *   intro   "What we do" pin + "Eleven ways to be heard." over the map
 *   plate   a signage plate: place name, Workshop 07 / 11, title, blurb,
 *           tags, and a transit-line index 01–11 (jumps to each workshop)
 *   pins    numbered map pins over every island in the overview (with
 *           short names on the way out)
 */

const pad = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const titleHtml = (t: string) => {
  const i = t.lastIndexOf(' ')
  return i < 0 ? `<em>${esc(t)}</em>` : `${esc(t.slice(0, i))} <em>${esc(t.slice(i + 1))}</em>`
}
const setOn = (node: Element, on: boolean, cls = 'is-on') => {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on)
}
/** short names for the map pins */
const SHORT = ['Software', 'Web Design', 'Ecommerce', 'SEO / GEO', 'Page Speed', 'AI', 'Aerial', 'Remediation', 'Security', 'ADA', 'WordPress']

export interface HudMetrics {
  w: number
  h: number
  tall: boolean
  /** right edge of the plate column (desktop) */
  colRight: number
  /** top of the plate (phones) */
  colTop: number
  introRight: number
  introTop: number
  safeTop: number
  safeBottom: number
}

export interface HudState {
  intro: boolean
  /** -1 none, else the workshop the plate names */
  shown: number
  /** 0 hidden, 1 numbers, 2 numbers + names */
  pins: number
}

export class Hud {
  private intro: HTMLElement
  private introTitle: HTMLElement
  private col: HTMLElement
  private plate: HTMLElement
  private slides: { root: HTMLElement; title: HTMLElement }[] = []
  private stops: HTMLButtonElement[] = []
  private line: HTMLElement
  private pinsRoot: HTMLElement
  private pins: HTMLElement[] = []
  private probe: HTMLElement
  private last = -2
  private lastPins = -1
  private dirty = true
  private m: HudMetrics = { w: 0, h: 0, tall: false, colRight: 0, colTop: 0, introRight: 0, introTop: 0, safeTop: 0, safeBottom: 0 }

  constructor(
    private stage: HTMLElement,
    jump: (k: number) => void,
    private calm: boolean,
  ) {
    /* pins first: they sit under the copy */
    this.pinsRoot = el('div', 'svc-pins', undefined, stage)
    this.pinsRoot.setAttribute('aria-hidden', 'true')
    SERVICES.forEach((_, k) => {
      const p = el('div', 'svc-pin', undefined, this.pinsRoot)
      p.style.setProperty('--i', String(k))
      el('b', '', pad(k + 1), p)
      el('span', '', SHORT[k], p)
      this.pins.push(p)
    })

    /* intro */
    this.intro = el('div', 'svc-intro', undefined, stage)
    el('p', 'hud-eyebrow', SECTIONS.services.eyebrow, this.intro)
    this.introTitle = rise(el('h2', 'hud-title svc-intro-title', undefined, this.intro), 'Eleven ways to be <em>heard.</em>')
    const hint = el('p', 'hud-label svc-hint', undefined, this.intro)
    el('span', '', MICROCOPY.scrollHint, hint)
    el('i', 'svc-hint-arrow', undefined, hint).setAttribute('aria-hidden', 'true')

    /* the signage plate */
    this.col = el('div', 'svc-col', undefined, stage)
    this.plate = el('div', 'svc-plate hud-panel', undefined, this.col)
    for (const c of ['tl', 'tr', 'bl', 'br']) el('i', `svc-screw svc-screw--${c}`, undefined, this.plate).setAttribute('aria-hidden', 'true')
    const slidesBox = el('div', 'svc-slides', undefined, this.plate)
    SERVICES.forEach((s, k) => {
      const root = el('article', 'svc-slide', undefined, slidesBox)
      const head = el('header', 'svc-head', undefined, root)
      el('p', 'hud-eyebrow svc-place', PLACES[k], head)
      const count = el('p', 'hud-label svc-count', undefined, head)
      count.append('Workshop ')
      el('b', '', s.num, count)
      count.append(` / ${pad(SERVICES.length)}`)
      const title = rise(el('h3', 'hud-h2 svc-title', undefined, root), titleHtml(s.title))
      el('p', 'hud-body svc-blurb', s.blurb, root)
      const tags = el('ul', 'hud-tags svc-tags', undefined, root)
      for (const t of s.tags) el('li', 'hud-tag', t, tags)
      this.slides.push({ root, title })
    })
    this.line = el('div', 'svc-line', undefined, this.plate)
    SERVICES.forEach((s, k) => {
      const b = el('button', 'svc-stop', undefined, this.line)
      b.type = 'button'
      b.title = s.title
      b.setAttribute('aria-label', `Workshop ${s.num}: ${s.title}`)
      el('span', '', s.num, b)
      b.addEventListener('click', () => jump(k))
      this.stops.push(b)
    })

    this.probe = el('div', 'svc-probe', undefined, stage)
    this.probe.setAttribute('aria-hidden', 'true')
    const ro = new ResizeObserver(() => (this.dirty = true))
    for (const n of [stage, this.col, this.plate, this.intro, this.probe]) ro.observe(n)
  }

  metrics(): HudMetrics {
    if (this.dirty) {
      this.dirty = false
      const m = this.m
      m.w = this.stage.offsetWidth
      m.h = this.stage.offsetHeight
      m.tall = m.w < 768 || m.w / Math.max(1, m.h) < 0.8
      m.colRight = this.col.offsetLeft + this.col.offsetWidth
      m.colTop = this.col.offsetTop + this.plate.offsetTop
      m.introRight = this.intro.offsetLeft + this.intro.offsetWidth
      m.introTop = this.intro.offsetTop
      m.safeTop = this.probe.offsetTop
      m.safeBottom = m.h - (this.probe.offsetTop + this.probe.offsetHeight)
      if (!m.h) this.dirty = true
    }
    return this.m
  }

  update(s: HudState) {
    setOn(this.intro, s.intro)
    setRise(this.introTitle, s.intro)
    setOn(this.col, s.shown >= 0)
    if (s.shown !== this.last) {
      const prev = this.last
      this.last = s.shown
      this.slides.forEach((it, k) => {
        setOn(it.root, k === s.shown)
        setRise(it.title, k === s.shown)
      })
      this.stops.forEach((b, k) => {
        setOn(b, k === s.shown)
        setOn(b, k < s.shown, 'is-past')
      })
      this.line.style.setProperty('--p', String(Math.max(0, s.shown) / (SERVICES.length - 1)))
      // the sign swings on its hooks when it changes
      if (prev >= 0 && s.shown >= 0 && !this.calm && typeof this.plate.animate === 'function') {
        const dir = s.shown > prev ? 1 : -1
        this.plate.animate(
          [
            { transform: `rotate(${-1.6 * dir}deg)` },
            { transform: `rotate(${0.9 * dir}deg)` },
            { transform: `rotate(${-0.35 * dir}deg)` },
            { transform: 'none' },
          ],
          { duration: 900, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
        )
      }
    }
    if (s.pins !== this.lastPins) {
      this.lastPins = s.pins
      setOn(this.pinsRoot, s.pins > 0)
      setOn(this.pinsRoot, s.pins > 1, 'is-named')
    }
  }

  /** screen positions (px) of each island's pin point; null = off */
  placePins(xy: Float32Array, visible: boolean[]) {
    if (!this.pinsRoot.classList.contains('is-on')) return
    for (let k = 0; k < this.pins.length; k++) {
      const p = this.pins[k]
      const x = xy[k * 2], y = xy[k * 2 + 1]
      const ok = visible[k] && Number.isFinite(x) && Number.isFinite(y)
      setOn(p, ok, 'is-vis')
      if (ok) p.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    }
  }
}
