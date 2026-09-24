import { BRAND, MICROCOPY } from '../../content'
import { el, rise, setRise } from '../../core/dom'

/** 'Philadelphia · Everywhere · est. 2016' → 'est. 2016' */
const EST = (BRAND.locale.split('·').pop() ?? '').trim()
const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** keep 'est. 2016' together and each '·' with the word before it */
const glue = (s: string) => s.replace(/est\.\s+(\d{4})/i, 'est.\u00a0$1').replace(/\s+·/g, '\u00a0·')

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
  }
}
