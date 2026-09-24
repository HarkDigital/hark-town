import { el, rise, setRise } from '../../core/dom'
import { PROCESS } from '../../content'
import { FENCE_STATS } from './textures'

/*
 * Building Site HUD: the chapter headline, then a wayfinding sign plate —
 * "Step 0N / 04", the step's name and text, a four-step progress track —
 * which swaps for a stats plate when the site-fence panels revolve.
 * Visual layer only (the stage is aria-hidden; srContent carries the copy).
 */

const ICONS = [
  // listen: a voice, heard (sound bars)
  '<path d="M4 10v4"/><path d="M8 7v10"/><path d="M12 4v16"/><path d="M16 8v8"/><path d="M20 10.5v3"/>',
  // prototype: a cardboard box
  '<path d="M12 3.2l8 4.3v9L12 20.8 4 16.5v-9z"/><path d="M4 7.5l8 4.4 8-4.4"/><path d="M12 11.9v8.9"/><path d="M8 5.4l8 4.3"/>',
  // build: a crane hook over a block
  '<path d="M4 4.5h16"/><path d="M13 4.5v5"/><path d="M13 9.5a2 2 0 1 1-2 2"/><rect x="7.5" y="15" width="9" height="5" rx="1"/>',
  // support: a wrench
  '<path d="M14.6 4.2a4.6 4.6 0 0 0-5.3 6.1L4 15.6 8.4 20l5.3-5.3a4.6 4.6 0 0 0 6.1-5.3l-2.8 2.8-3.1-.9-.9-3.1z"/>',
]

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

export interface Band {
  l: number
  r: number
  t: number
  b: number
}

/** A screen box in px (stage space). */
export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Layout {
  portrait: boolean
  shortSteps: boolean
  shortStats: boolean
  intro: Band
  steps: Band
  stats: Band
}

export interface HudState {
  head: boolean
  plate: boolean
  step: number
  /** per-step fill 0..1 */
  fills: number[]
  statsOn: boolean
  stats: boolean[]
}

export class SiteHud {
  root: HTMLElement
  private head: HTMLElement
  private eyebrow: HTMLElement
  private title: HTMLElement
  private dock: HTMLElement
  private plate: HTMLElement
  private cards: { card: HTMLElement; name: HTMLElement }[] = []
  private segs: HTMLElement[] = []
  private bars: HTMLElement[] = []
  private barVals = [-1, -1, -1, -1]
  private statsBox: HTMLElement
  private statRows: { row: HTMLElement; v: HTMLElement }[] = []
  private probe: HTMLElement
  private last = ''
  /** copy boxes (px) from the last layout(), for the world's far-field keep-out */
  boxes: { head: Box; plate: Box; stats: Box } = {
    head: { left: 0, top: 0, right: 0, bottom: 0 },
    plate: { left: 0, top: 0, right: 0, bottom: 0 },
    stats: { left: 0, top: 0, right: 0, bottom: 0 },
  }

  constructor(stage: HTMLElement) {
    this.root = el('div', 'pc', undefined, stage)
    this.probe = el('div', 'pc-probe', undefined, this.root)

    const col = el('div', 'pc-col', undefined, this.root)
    const head = (this.head = el('div', 'pc-head', undefined, col))
    this.eyebrow = el('p', 'hud-eyebrow pc-eyebrow', 'How we work', head)
    this.title = rise(el('h2', 'hud-h2 pc-title', undefined, head), 'We listen first. <br><em>Then we build.</em>')

    this.dock = el('div', 'pc-dock', undefined, col)

    // ---- step plate
    const plate = (this.plate = el('div', 'pc-plate hud-panel', undefined, this.dock))
    el('span', 'pc-screw pc-screw--l', undefined, plate)
    el('span', 'pc-screw pc-screw--r', undefined, plate)
    const deck = el('div', 'pc-deck', undefined, plate)
    PROCESS.forEach((p, i) => {
      const card = el('div', 'pc-card', undefined, deck)
      const top = el('div', 'pc-card-top', undefined, card)
      const ico = el('span', 'pc-ico', undefined, top)
      ico.innerHTML = svg(ICONS[i])
      const count = el('span', 'hud-label pc-count', undefined, top)
      count.innerHTML = `Step <b>0${i + 1}</b> / 04`
      const name = rise(el('h3', 'pc-name', undefined, card), p.title)
      el('p', 'hud-body pc-text', p.text, card)
      this.cards.push({ card, name })
    })
    const track = el('ol', 'pc-track', undefined, plate)
    PROCESS.forEach(p => {
      const seg = el('li', 'pc-seg', undefined, track)
      const bar = el('span', 'pc-bar', undefined, seg)
      this.bars.push(el('i', '', undefined, bar))
      el('span', 'pc-seg-t', p.title, seg)
      this.segs.push(seg)
    })

    // ---- stats plate
    const stats = (this.statsBox = el('div', 'pc-stats hud-panel', undefined, this.dock))
    el('span', 'pc-screw pc-screw--l', undefined, stats)
    el('span', 'pc-screw pc-screw--r', undefined, stats)
    el('p', 'hud-eyebrow pc-stats-eyebrow', 'On the site fence', stats)
    const list = el('ol', 'pc-stat-list', undefined, stats)
    FENCE_STATS.forEach(s => {
      const row = el('li', 'pc-stat', undefined, list)
      const v = rise(el('p', 'pc-sv', undefined, row), s.value)
      el('p', 'pc-sl', s.label, row)
      this.statRows.push({ row, v })
    })
  }

  /** Elements whose size changes should re-run layout(). */
  measured(): HTMLElement[] {
    return [this.head, this.dock]
  }

  /**
   * The free screen band (px) for the 3D subject in each phase — intro
   * (headline only), steps (headline + step plate), stats (headline + stats
   * plate) — measured from the real layout (offset boxes, so transforms
   * mid-animation don't skew it). On a portrait screen too short for
   * headline + plate + a useful picture, that phase is `short`: the
   * headline gives way while the plate shows and the island takes its room.
   */
  layout(W: number, H: number): Layout {
    const portrait = W / Math.max(1, H) < 0.8 || W < 700
    const pcs = getComputedStyle(this.probe)
    const px = (v: string, fb: number) => {
      const n = parseFloat(v)
      return Number.isFinite(n) ? n : fb
    }
    const gutter = px(pcs.paddingLeft, 20)
    const safeTop = px(pcs.top, 84)
    const safeBottom = px(pcs.bottom, 84)
    const box = (n: HTMLElement) => {
      let x = 0
      let y = 0
      for (let e: HTMLElement | null = n; e && e !== this.root; e = e.offsetParent as HTMLElement | null) {
        x += e.offsetLeft
        y += e.offsetTop
      }
      return { left: x, top: y, right: x + n.offsetWidth, bottom: y + n.offsetHeight }
    }
    const head = box(this.head)
    // the headline's inked extent (its block can be wider than the words)
    let textRight = head.left
    this.title.querySelectorAll<HTMLElement>('.rise-w').forEach(w => {
      textRight = Math.max(textRight, box(w).right)
    })
    textRight = Math.max(textRight, box(this.eyebrow).right)
    const dock = box(this.dock)
    Object.assign(this.boxes.head, head, { right: Math.min(head.right, textRight) })
    Object.assign(this.boxes.plate, box(this.plate))
    Object.assign(this.boxes.stats, box(this.statsBox))
    if (portrait) {
      const top = head.bottom + 22
      const bare = safeTop - 16
      const plateTop = box(this.plate).top - 10
      const statsTop = box(this.statsBox).top - 10
      const shortSteps = plateTop - top < H * 0.3
      const shortStats = statsTop - top < H * 0.3
      const band = (t: number, b: number): Band => ({ l: 4, r: W - 4, t, b: Math.max(t + 80, b) })
      return {
        portrait,
        shortSteps,
        shortStats,
        intro: band(top, plateTop),
        steps: band(shortSteps ? bare : top, plateTop),
        stats: band(shortStats ? bare : top, statsTop),
      }
    }
    const colR = Math.max(textRight, dock.right)
    const b = { l: Math.min(W * 0.58, colR + 28), r: W - gutter * 0.5, t: safeTop - 34, b: H - safeBottom + 24 }
    return { portrait, shortSteps: false, shortStats: false, intro: b, steps: b, stats: b }
  }

  update(o: HudState) {
    // progress fills are continuous; everything else only on change
    for (let i = 0; i < 4; i++) {
      const v = Math.round(o.fills[i] * 500) / 500
      if (v !== this.barVals[i]) {
        this.barVals[i] = v
        this.bars[i].style.transform = `scaleX(${v})`
      }
    }
    const key = `${+o.head}${+o.plate}${o.step}${+o.statsOn}${o.stats.map(Number).join('')}${o.fills.map(f => +(f >= 1)).join('')}`
    if (key === this.last) return
    this.last = key
    this.head.classList.toggle('is-in', o.head)
    setRise(this.title, o.head)
    this.plate.classList.toggle('is-in', o.plate)
    this.cards.forEach((c, i) => {
      const on = o.plate && o.step === i
      c.card.classList.toggle('is-in', on)
      c.card.classList.toggle('is-past', o.step > i)
      setRise(c.name, on)
    })
    this.segs.forEach((s, i) => {
      s.classList.toggle('is-active', o.step === i)
      s.classList.toggle('is-done', o.fills[i] >= 1)
    })
    this.statsBox.classList.toggle('is-in', o.statsOn)
    this.statRows.forEach((r, i) => {
      r.row.classList.toggle('is-in', o.stats[i])
      setRise(r.v, o.stats[i])
    })
  }
}
