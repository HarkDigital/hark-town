import { el, rise, setRise } from '../../core/dom'

/*
 * A comic speech bubble anchored to a little townsperson's head.
 *
 * The outline (rounded box + curved tail) is ONE svg path rebuilt from the
 * box size and the head's screen point, so the stroke flows round the tail
 * without a seam. Two layouts:
 *
 *  - float: the bubble hovers above/beside the speaker, clamped inside the
 *           safe area (never under the chrome); if there's no room above the
 *           head it slides beside it, then below.
 *  - dock:  (portrait / phones) a signage plate docked above the bottom
 *           chrome, with a short pointer on its top edge aimed at the speaker
 *           and a dotted leader the rest of the way.
 *
 * The box position eases toward its target so layout switches glide; the
 * tail is recomputed every frame from the eased box to the true head point,
 * so it always lands on the speaker.
 */

export interface Insets {
  top: number
  bottom: number
  left: number
  right: number
}

export type Side = 'left' | 'right'

const TAIL_HALF = 13
const RADIUS = 26
const SVGNS = 'http://www.w3.org/2000/svg'

export class Bubble {
  root: HTMLDivElement
  pop: HTMLDivElement
  body: HTMLDivElement
  private svg: SVGSVGElement
  private shape: SVGPathElement
  private shadow: SVGPathElement
  private leader: SVGPathElement
  private parts: HTMLElement[] = []
  on = false
  /** measured box size */
  w = 0
  h = 0
  private x = NaN
  private y = NaN
  private lastD = ''
  private lastLeader = ''
  private lastT = ''
  private lastO = ''

  constructor(
    parent: HTMLElement,
    opts: { quote: string; name: string; company: string; index: number; total: number; look: { shirt: string; skin: string; hair: string | null } },
  ) {
    this.root = el('div', 'vo-bubble', undefined, parent)
    this.pop = el('div', 'vo-pop', undefined, this.root)
    this.svg = document.createElementNS(SVGNS, 'svg')
    this.svg.setAttribute('class', 'vo-svg')
    this.svg.setAttribute('aria-hidden', 'true')
    this.shadow = document.createElementNS(SVGNS, 'path')
    this.shadow.setAttribute('class', 'vo-shadow')
    this.shape = document.createElementNS(SVGNS, 'path')
    this.shape.setAttribute('class', 'vo-shape')
    this.leader = document.createElementNS(SVGNS, 'path')
    this.leader.setAttribute('class', 'vo-leader')
    this.svg.append(this.leader, this.shadow, this.shape)
    this.pop.appendChild(this.svg)

    this.body = el('div', 'vo-body', undefined, this.pop)
    const meta = el('p', 'vo-meta', undefined, this.body)
    const pad = (n: number) => String(n).padStart(2, '0')
    const m = rise(el('span', '', undefined, meta), `Client voices · ${pad(opts.index + 1)}/${pad(opts.total)}`)
    const bq = el('blockquote', 'vo-q', undefined, this.body)
    const q = rise(el('p', 'hud-quote', undefined, bq), `“${opts.quote}”`)
    const cap = el('p', 'vo-cap', undefined, this.body)
    // a tiny portrait of the peg person who's talking
    const av = el('span', 'vo-av', undefined, cap)
    av.setAttribute('aria-hidden', 'true')
    const { shirt, skin, hair } = opts.look
    av.innerHTML = `<svg viewBox="0 0 34 34"><ellipse cx="17" cy="36" rx="12.5" ry="11" fill="${shirt}"/><circle cx="17" cy="15.5" r="8.4" fill="${skin}"/>${
      hair ? `<path d="M8.6 15.2a8.4 8.4 0 0 1 16.8 0c-2.2-3-5.6-4.4-8.4-4.4s-6.2 1.4-8.4 4.4z" fill="${hair}"/>` : ''
    }<circle cx="14.2" cy="16.4" r="1.15" fill="#1d2321"/><circle cx="19.8" cy="16.4" r="1.15" fill="#1d2321"/><ellipse cx="12.4" cy="19" rx="1.5" ry="0.9" fill="#f08a80" opacity=".55"/><ellipse cx="21.6" cy="19" rx="1.5" ry="0.9" fill="#f08a80" opacity=".55"/></svg>`
    const who = el('span', 'vo-who', undefined, cap)
    const name = rise(el('span', 'vo-name', undefined, who), opts.name)
    const co = rise(el('span', 'vo-co', undefined, who), opts.company)
    this.parts.push(m, q, name, co)

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        this.w = this.body.offsetWidth
        this.h = this.body.offsetHeight
      }).observe(this.body)
    }
  }

  set(on: boolean) {
    if (this.on === on) return
    this.on = on
    this.root.classList.toggle('is-on', on)
    for (const p of this.parts) setRise(p, on)
  }

  /** snap the eased position next placement (after a cut / fresh entry) */
  snap() {
    this.x = NaN
    this.y = NaN
  }

  /**
   * Lay the bubble out for this frame.
   * @param hx,hy   head-top point in px (NaN/off-screen allowed)
   */
  place(hx: number, hy: number, headOk: boolean, mode: 'float' | 'dock', side: Side, W: number, H: number, ins: Insets, dt: number) {
    if (!this.w || !this.h) {
      this.w = this.body.offsetWidth
      this.h = this.body.offsetHeight
    }
    const bw = this.w
    const bh = this.h
    if (!bw || !bh || !Number.isFinite(W + H)) return
    const L = ins.left
    const R = W - ins.right
    const T = ins.top
    const B = H - ins.bottom
    const ok = headOk && Number.isFinite(hx + hy)
    // tip hovers just above the head so the tail never covers the face
    const tipX = ok ? hx : W / 2
    const tipY = ok ? hy - 9 : H / 2

    let tx: number
    let ty: number
    if (mode === 'dock') {
      tx = (W - bw) / 2
      ty = B - bh - 6
    } else {
      const gap = 52
      // 1) above the head, box leaning to `side`
      tx = side === 'right' ? tipX - bw * 0.14 : tipX - bw * 0.86
      ty = tipY - gap - bh
      tx = clampN(tx, L, R - bw)
      if (ty < T) {
        // 2) beside the head
        ty = clampN(tipY - bh * 0.62, T, B - bh)
        const right = tipX + 44
        const left = tipX - 44 - bw
        if (side === 'right' ? right + bw <= R : left < L) tx = right
        else tx = left
        if (tx + bw > R || tx < L) {
          // 3) below the head
          tx = clampN(tipX - bw * 0.5, L, R - bw)
          ty = clampN(hy + 70, T, B - bh)
        }
      }
      ty = clampN(ty, T, B - bh)
    }

    // ease the box (fast), snap when fresh
    if (!Number.isFinite(this.x) || !Number.isFinite(this.y)) {
      this.x = tx
      this.y = ty
    } else {
      const k = 1 - Math.exp(-14 * Math.min(dt, 0.1))
      this.x += (tx - this.x) * k
      this.y += (ty - this.y) * k
    }
    const x = Math.round(this.x * 2) / 2
    const y = Math.round(this.y * 2) / 2
    const t = `translate3d(${x}px, ${y}px, 0)`
    if (t !== this.lastT) {
      this.root.style.transform = t
      this.lastT = t
    }

    // tail + leader in box space
    const px = tipX - x
    const py = tipY - y
    const maxTail = mode === 'dock' ? 30 : 140
    const { d, tip } = bubblePath(bw, bh, RADIUS, px, py, ok, maxTail)
    if (d !== this.lastD) {
      this.shape.setAttribute('d', d)
      this.shadow.setAttribute('d', d)
      this.lastD = d
    }
    let ld = ''
    if (ok && tip && Math.hypot(px - tip[0], py - tip[1]) > 6) {
      ld = `M${tip[0].toFixed(1)},${tip[1].toFixed(1)} L${px.toFixed(1)},${py.toFixed(1)}`
    }
    if (ld !== this.lastLeader) {
      this.leader.setAttribute('d', ld)
      this.lastLeader = ld
    }
    const o = tip ? `${tip[0].toFixed(0)}px ${tip[1].toFixed(0)}px` : '50% 100%'
    if (o !== this.lastO) {
      this.pop.style.transformOrigin = o
      this.lastO = o
    }
  }
}

const clampN = (v: number, a: number, b: number) => (b < a ? a : Math.min(b, Math.max(a, v)))

/**
 * Rounded box (0,0)-(w,h) with a curved tail spliced into the edge facing the
 * tip. Returns the path and where the tail actually ends (it's capped at
 * `maxTail`; the rest is a dotted leader).
 */
function bubblePath(w: number, h: number, r: number, px: number, py: number, ok: boolean, maxTail: number) {
  const f = (n: number) => n.toFixed(1)
  let edge: 'top' | 'bottom' | 'left' | 'right' | null = null
  if (ok) {
    if (py > h + 4) edge = 'bottom'
    else if (py < -4) edge = 'top'
    else if (px < -4) edge = 'left'
    else if (px > w + 4) edge = 'right'
  }
  const half = TAIL_HALF
  // base centre on the chosen edge, kept clear of the corners
  let bx = 0
  let by = 0
  if (edge === 'bottom' || edge === 'top') {
    bx = clampN(px + (px < w / 2 ? 18 : -18), r + half + 2, w - r - half - 2)
    by = edge === 'bottom' ? h : 0
  } else if (edge === 'left' || edge === 'right') {
    by = clampN(py, r + half + 2, h - r - half - 2)
    bx = edge === 'left' ? 0 : w
  }
  let tip: [number, number] | null = null
  let tail = ''
  if (edge) {
    let dx = px - bx
    let dy = py - by
    const len = Math.hypot(dx, dy)
    const cap = Math.min(len, maxTail)
    const k = len > 0 ? cap / len : 0
    dx *= k
    dy *= k
    tip = [bx + dx, by + dy]
    // swoosh: the two flanks bow the same way
    const nx = -dy / Math.max(1, cap)
    const ny = dx / Math.max(1, cap)
    const bend = Math.min(16, cap * 0.22)
    const mid = (ax: number, ay: number, cx: number, cy: number, s: number) =>
      `${f((ax + cx) / 2 + nx * bend * s)},${f((ay + cy) / 2 + ny * bend * s)}`
    // the flank points on the edge
    let a1x: number, a1y: number, a2x: number, a2y: number
    if (edge === 'bottom') {
      a1x = bx + half
      a1y = h
      a2x = bx - half
      a2y = h
    } else if (edge === 'top') {
      a1x = bx - half
      a1y = 0
      a2x = bx + half
      a2y = 0
    } else if (edge === 'left') {
      a1x = 0
      a1y = by + half
      a2x = 0
      a2y = by - half
    } else {
      a1x = w
      a1y = by - half
      a2x = w
      a2y = by + half
    }
    const [tx, ty] = tip
    tail = `L${f(a1x)},${f(a1y)} Q${mid(a1x, a1y, tx, ty, 1)} ${f(tx)},${f(ty)} Q${mid(tx, ty, a2x, a2y, 0.55)} ${f(a2x)},${f(a2y)}`
  }
  // clockwise from the top-left corner
  let d = `M${f(r)},0`
  if (edge === 'top') d += ` ${tail}`
  d += ` L${f(w - r)},0 Q${f(w)},0 ${f(w)},${f(r)}`
  if (edge === 'right') d += ` ${tail}`
  d += ` L${f(w)},${f(h - r)} Q${f(w)},${f(h)} ${f(w - r)},${f(h)}`
  if (edge === 'bottom') d += ` ${tail}`
  d += ` L${f(r)},${f(h)} Q0,${f(h)} 0,${f(h - r)}`
  if (edge === 'left') d += ` ${tail}`
  d += ` L0,${f(r)} Q0,0 ${f(r)},0 Z`
  return { d, tip }
}
