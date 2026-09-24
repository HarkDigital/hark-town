import { el, rise } from '../../core/dom'
import { BRAND, CONTACT } from '../../content'

/*
 * The Lighthouse's signage: a dark enamel plate (dusk) with the address as
 * the big green primary link, a copy button, the sister sites, back to top
 * and the colophon; plus the "Goodnight" sign-off that floats up into the
 * sky at the very end. Layout is measured (not per frame) so the 3D fit can
 * keep the lighthouse clear of the plate at every viewport.
 */

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Hud {
  stage: HTMLElement
  probe: HTMLElement
  col: HTMLElement
  slot: HTMLElement
  plate: HTMLElement
  eyebrow: HTMLElement
  title: HTMLElement
  body: HTMLElement
  cta: HTMLElement
  mail: HTMLAnchorElement
  copyBtn: HTMLButtonElement
  links: HTMLElement
  foot: HTMLElement
  night: HTMLElement
  nightText: HTMLElement
  /** pointer/focus on the email or copy button (raises the post box flag) */
  hover: boolean
  /** performance.now() of the last successful copy */
  copiedAt: number
  dirty: boolean
}

const ICON_MAIL =
  '<svg class="ct-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_MOON =
  '<svg class="ct-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" fill="currentColor"/></svg>'

/** Copy text to the clipboard: async Clipboard API, then a textarea fallback. */
export async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* denied / unsupported: fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;'
  const active = document.activeElement as HTMLElement | null
  document.body.appendChild(ta)
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  active?.focus?.({ preventScroll: true })
  return ok
}

export function buildHud(stage: HTMLElement): Hud {
  stage.classList.add('is-dark')
  const probe = el('div', 'ct-probe', undefined, stage)
  probe.setAttribute('aria-hidden', 'true')
  const col = el('div', 'ct-col', undefined, stage)
  const slot = el('div', 'ct-slot', undefined, col)
  const plate = el('div', 'hud-panel ct-plate', undefined, slot)
  for (const k of ['tl', 'tr', 'bl', 'br']) el('span', `ct-screw ct-screw--${k}`, undefined, plate).setAttribute('aria-hidden', 'true')

  const eyebrow = el('p', 'hud-eyebrow ct-eyebrow ct-in', CONTACT.eyebrow, plate)
  const words = CONTACT.title.split(' ')
  const last = words.pop() ?? ''
  const title = rise(el('h2', 'hud-title ct-title', undefined, plate), `${words.join(' ')} <em>${last}</em>`)
  const body = el('p', 'hud-body ct-body ct-in', CONTACT.body, plate)

  const cta = el('div', 'ct-cta ct-in', undefined, plate)
  const mail = el('a', 'hud-btn ct-mail', undefined, cta)
  mail.href = CONTACT.href
  mail.innerHTML = `${ICON_MAIL}<span class="ct-mail-addr"></span><span class="ct-mail-go" aria-hidden="true">→</span>`
  mail.querySelector('.ct-mail-addr')!.textContent = BRAND.email
  mail.setAttribute('aria-label', `Email ${BRAND.email}`)

  const copyBtn = el('button', 'ct-copy', undefined, cta)
  copyBtn.type = 'button'
  copyBtn.setAttribute('aria-label', `Copy ${BRAND.email}`)
  copyBtn.innerHTML =
    '<span class="ct-copy-idle">Copy<span class="ct-copy-more"> email</span></span><span class="ct-copy-done" aria-hidden="true">Copied</span><span class="ct-copy-fail" aria-hidden="true">Copy failed</span>'

  const links = el('nav', 'ct-links ct-in', undefined, plate)
  links.setAttribute('aria-label', 'Elsewhere')
  const addLink = (label: string, href: string) => {
    const a = el('a', 'ct-link', undefined, links)
    a.href = href
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    el('span', '', label, a)
    el('span', 'ct-arr', '↗', a).setAttribute('aria-hidden', 'true')
  }
  addLink('Classic site', BRAND.classicSite)
  addLink('Orbit', BRAND.orbitSite)
  addLink('Resonance', BRAND.resonanceSite)
  addLink('Press', BRAND.pressSite)
  const top = el('button', 'ct-link ct-top', undefined, links)
  top.type = 'button'
  el('span', '', 'Back to top', top)
  el('span', 'ct-arr', '↑', top).setAttribute('aria-hidden', 'true')
  top.addEventListener('click', () => window.__hark?.goto(0))

  const foot = el('p', 'ct-foot ct-in', undefined, plate)
  const parts = [`© 2026 ${BRAND.name}`, ...BRAND.locale.split(' · ')]
  parts.forEach((p, i) => {
    if (i) foot.append(' · ')
    el('span', 'ct-nw', p, foot)
  })

  const night = el('p', 'ct-night', undefined, stage)
  night.innerHTML = ICON_MOON
  const nightText = rise(el('span', 'ct-night-text', undefined, night), 'Goodnight from Hark Town')

  const hud: Hud = {
    stage,
    probe,
    col,
    slot,
    plate,
    eyebrow,
    title,
    body,
    cta,
    mail,
    copyBtn,
    links,
    foot,
    night,
    nightText,
    hover: false,
    copiedAt: -1e9,
    dirty: true,
  }

  // the post box flag goes up while the address has your attention
  const on = () => (hud.hover = true)
  const off = () => (hud.hover = false)
  for (const n of [mail, copyBtn]) {
    n.addEventListener('pointerenter', on)
    n.addEventListener('pointerleave', off)
    n.addEventListener('focus', on)
    n.addEventListener('blur', off)
  }

  let resetT = 0
  copyBtn.addEventListener('click', async () => {
    const ok = await copyText(BRAND.email)
    window.clearTimeout(resetT)
    copyBtn.classList.toggle('is-copied', ok)
    copyBtn.classList.toggle('is-failed', !ok)
    if (ok) hud.copiedAt = performance.now()
    resetT = window.setTimeout(() => copyBtn.classList.remove('is-copied', 'is-failed'), 1900)
  })

  const dirty = () => (hud.dirty = true)
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(dirty)
    ro.observe(probe)
    ro.observe(slot)
    ro.observe(night)
  }
  window.addEventListener('resize', dirty)
  document.fonts?.ready.then(dirty).catch(() => {})
  return hud
}

export interface HudLayout {
  W: number
  H: number
  portrait: boolean
  /** where the island may sit (px, viewport) */
  art: Rect
  /** the sign-off's height (reserved at the top of the art rect in the finale) */
  nightH: number
  plate: Rect
}

export const isPortrait = (w: number, h: number) => w < 768 || w / Math.max(1, h) < 0.9

/*
 * Short viewports: step the plate down until it fits its share of the safe
 * band (landscape: the whole band; portrait: ~62%, leaving the rest to the
 * island). 1 tightens type, 2 compacts the rows, 3 shortens the copy label,
 * 4 trims the body to a smaller size.
 */
const FIT = ['ct-fit-1', 'ct-fit-2', 'ct-fit-3', 'ct-fit-4'] as const

export function measureHud(hud: Hud, W: number, H: number): HudLayout {
  const stage = hud.stage
  const portrait = isPortrait(window.innerWidth || W, window.innerHeight || H)
  stage.classList.toggle('ct-portrait', portrait)
  stage.classList.remove(...FIT)
  const p = hud.probe.getBoundingClientRect()
  const band = Math.max(1, p.height)
  const limit = portrait ? band * (W < 420 ? 0.66 : 0.6) : band
  for (let i = 0; i < FIT.length && hud.slot.offsetHeight > limit; i++) stage.classList.add(FIT[i])

  const s = hud.slot.getBoundingClientRect()
  const plate = { x0: s.left, y0: s.top, x1: s.right, y1: s.bottom }
  const nightH = hud.night.offsetHeight || 28
  let art: Rect
  if (!portrait) {
    const gap = Math.max(28, W * 0.03)
    art = { x0: s.right + gap, x1: p.right, y0: p.top, y1: p.bottom }
  } else {
    const gap = Math.max(14, H * 0.02)
    // the lantern may rise a little into the top band's empty middle
    art = { x0: p.left, x1: p.right, y0: p.top - Math.min(24, p.top * 0.25), y1: Math.max(p.top + 110, s.top - gap) }
  }
  return { W, H, portrait, art, nightH, plate }
}
