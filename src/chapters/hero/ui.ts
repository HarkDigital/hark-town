import { BRAND, MICROCOPY } from '../../content'
import { el, rise, setRise } from '../../core/dom'
import type { NdcRect } from '../../world/World'

/** 'Philadelphia · Everywhere · est. 2016' → 'est. 2016' */
const EST = (BRAND.locale.split('·').pop() ?? '').trim()
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** keep 'est. 2016' together and each '·' with the word before it */
const glue = (s: string) => s.replace(/est\.\s+(\d{4})/i, 'est.\u00a0$1').replace(/\s+·/g, '\u00a0·')

/** layout box of `node` relative to `root` (ignores transforms, so springy pops don't skew it) */
function boxIn(node: HTMLElement, root: HTMLElement) {
  let x = 0, y = 0
  let n: HTMLElement | null = node
  while (n && n !== root) {
    x += n.offsetLeft
    y += n.offsetTop
    n = n.offsetParent as HTMLElement | null
  }
  return { l: x, t: y, r: x + node.offsetWidth, b: y + node.offsetHeight }
}

/**
 * The hero's signage:
 *  - welcome plate (opening): 'Welcome to Hark' pin, the studio name, the
 *    manifesto and where we are; the scroll hint tucked under it
 *  - town sign (while the town builds): a playful population counter
 *  - payoff: the headline + CTAs on clean sky
 */
export class HeroUI {
  root: HTMLDivElement
  private dock: HTMLElement
  private welcome: HTMLElement
  private welcomeTitle: HTMLElement
  private hint: HTMLElement
  private sign: HTMLElement
  private signNum: HTMLElement
  private pay: HTMLElement
  private title: HTMLElement
  private probe: HTMLElement
  private shown = -1
  /** which copy block is up: 0 none · 1 welcome · 2 town sign · 3 payoff */
  private block = 0
  /** cached copy boxes in NDC (re-measured on resize / content size change, never per frame) */
  private boxes: NdcRect[] = [0, 1, 2, 3].map(() => ({ x0: 0, y0: 0, x1: 0, y1: 0 }))
  /** chrome safe bands in px (measured on resize, never per frame) */
  safe = { top: 96, bottom: 90, side: 24 }
  /** NDC x of the welcome column's right edge (landscape keep-out for the camera) */
  keepLeft = -1

  constructor(stage: HTMLElement) {
    this.root = el('div', 'hero-root', undefined, stage)
    this.probe = el('div', 'hero-probe', undefined, this.root)

    // --- opening: welcome plate + scroll hint
    this.dock = el('div', 'hero-dock', undefined, this.root)
    this.welcome = el('div', 'hero-welcome hud-panel', undefined, this.dock)
    el('p', 'hud-eyebrow', MICROCOPY.signalEyebrow, this.welcome)
    this.welcomeTitle = rise(el('p', 'hero-welcome__title', undefined, this.welcome), BRAND.name)
    el('p', 'hud-body hero-welcome__body', BRAND.manifesto, this.welcome)
    el('p', 'hud-label hero-welcome__where', glue(BRAND.locale), this.welcome)
    this.hint = el('div', 'hero-hint', undefined, this.dock)
    const arrow = el('span', 'hero-hint__arrow', undefined, this.hint)
    arrow.innerHTML =
      '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 2v14M3 11l5 6 5-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    el('span', 'hero-hint__label', MICROCOPY.scrollHint, this.hint)

    // --- while the town builds: the town sign
    this.sign = el('div', 'hero-sign hud-panel', undefined, this.root)
    el('p', 'hud-eyebrow', 'Hark Town', this.sign)
    const n = el('p', 'hero-sign__pop', undefined, this.sign)
    el('span', 'hero-sign__k', 'Pop.', n)
    this.signNum = el('b', 'hero-sign__n', '0', n)
    el('p', 'hud-label hero-sign__est', glue(EST), this.sign)

    // --- payoff
    this.pay = el('div', 'hero-pay', undefined, this.root)
    this.title = rise(el('p', 'hud-title hero-title', undefined, this.pay), 'Make the internet <em>listen.</em>')
    const ctas = el('div', 'hero-ctas', undefined, this.pay)
    const work = el('button', 'hud-btn', 'See the work', ctas)
    work.type = 'button'
    work.addEventListener('click', () => window.__hark?.land('work'))
    const contact = el('a', 'hud-btn hud-btn--ghost', 'Start a project', ctas)
    contact.href = '#contact'
    contact.addEventListener('click', e => {
      e.preventDefault()
      window.__hark?.land('contact')
    })

    this.measure()
    window.addEventListener('resize', () => this.measure())
    // fonts landing or copy reflowing change the boxes without a resize
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.measureCopy())
      for (const n of [this.welcome, this.hint, this.sign, this.pay]) ro.observe(n)
    }
  }

  /** Cache the copy blocks' boxes in NDC (padded) for the world's far-field keep-out. */
  private measureCopy() {
    const w = this.root.clientWidth, h = this.root.clientHeight
    if (w < 10 || h < 10) return
    const pad = 18
    const set = (out: NdcRect, l: number, t: number, r: number, b: number) => {
      out.x0 = ((l - pad) / w) * 2 - 1
      out.x1 = ((r + pad) / w) * 2 - 1
      out.y0 = 1 - ((b + pad) / h) * 2
      out.y1 = 1 - ((t - pad) / h) * 2
    }
    const a = boxIn(this.welcome, this.root), hb = boxIn(this.hint, this.root)
    set(this.boxes[1], Math.min(a.l, hb.l), Math.min(a.t, hb.t), Math.max(a.r, hb.r), Math.max(a.b, hb.b))
    const s = boxIn(this.sign, this.root)
    set(this.boxes[2], s.l, s.t, s.r, s.b)
    const p = boxIn(this.pay, this.root)
    set(this.boxes[3], p.l, p.t, p.r, p.b)
  }

  /** The copy block on screen now, in NDC, or null when no copy shows. */
  copyRect(): NdcRect | null {
    return this.block ? this.boxes[this.block] : null
  }

  /** The chrome's safe bands, measured once and on resize. */
  measure() {
    const r = this.probe.getBoundingClientRect()
    const host = this.root.getBoundingClientRect()
    if (host.height < 10) {
      requestAnimationFrame(() => this.measure())
      return
    }
    this.safe.top = r.top - host.top
    this.safe.bottom = host.bottom - r.bottom
    this.safe.side = r.left - host.left
    const d = this.dock.getBoundingClientRect()
    this.keepLeft = this.root.classList.contains('is-port') ? -1 : ((d.right - host.left) / host.width) * 2 - 1
    this.measureCopy()
  }

  update(p: { local: number; intro: number; portrait: boolean; pop: number }) {
    const { local, intro } = p
    if (this.root.classList.contains('is-port') !== p.portrait) {
      this.root.classList.toggle('is-port', p.portrait)
      this.measure()
    }
    const welcomeOn = intro > 0.25 && local < 0.12
    this.welcome.classList.toggle('is-in', welcomeOn)
    setRise(this.welcomeTitle, welcomeOn)
    this.hint.classList.toggle('is-in', intro > 0.7 && local < 0.06)
    const signOn = local > 0.17 && local < 0.6
    this.sign.classList.toggle('is-in', signOn)
    if (signOn && p.pop !== this.shown) {
      this.shown = p.pop
      this.signNum.textContent = String(p.pop)
      if (!REDUCED && this.signNum.animate)
        this.signNum.animate([{ transform: 'translate3d(0,-0.18em,0) scale(1.18)' }, { transform: 'none' }], {
          duration: 360,
          easing: 'cubic-bezier(0.34, 1.7, 0.5, 1)',
        })
    }
    const payOn = local > 0.64 && local < 0.93
    this.pay.classList.toggle('is-in', payOn)
    setRise(this.title, payOn)
    this.block = payOn ? 3 : signOn ? 2 : welcomeOn ? 1 : 0
  }
}
