import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { holdScene, releaseScene } from './scene'
import { buildIslandSvg, cloudSvg, phoneSvg } from './art'

/*
 * Phone-landscape suggestion. Hark Town is framed in portrait on phones, so
 * a short, touch-first landscape viewport gets a sky card ("Turn your phone
 * upright") with the little island bobbing on it instead of a cramped
 * scene. Tablets and laptops in landscape are taller than 500px and never
 * see it.
 *
 * It is a suggestion, never a lock (WCAG 1.3.4): "Continue anyway" puts the
 * town back in landscape for the rest of the session, and while the card
 * shows, the skip link and the linear copy layer in #track stay reachable
 * for keyboards and screen readers (only the hidden chrome, stages and
 * loader behind it are inert).
 *
 * Visibility is pure CSS (the same query, in ui.css) so it is right on the
 * very first paint; JS makes the covered layers inert while it shows,
 * announces it, and pauses the (fully hidden) scene via scene.ts.
 *
 * API: mountRotateGate(onChange?) / unmountRotateGate()
 */

export const ROTATE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'

const DISMISS_KEY = 'hark-town:rotate-ok'
const wasDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
const rememberDismissed = () => {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode / blocked storage: the choice lasts until reload */
  }
}

const arrowSvg = `<svg class="rot-go-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 8h10.5M9 3.8 13.2 8 9 12.2"/></svg>`

let gate: {
  el: HTMLElement
  mq: MediaQueryList
  sync: () => void
  listeners: ((shown: boolean) => void)[]
} | null = null

export function mountRotateGate(onChange?: (shown: boolean) => void) {
  if (gate) {
    if (onChange) {
      gate.listeners.push(onChange)
      onChange(gate.el.classList.contains('is-on'))
    }
    return
  }
  if (typeof matchMedia === 'undefined') return
  let dismissed = wasDismissed()
  const el = document.createElement('div')
  el.className = dismissed ? 'rot is-dismissed' : 'rot'
  // non-modal: the copy layer behind it stays in reach
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-labelledby', 'rot-title')
  el.setAttribute('aria-describedby', 'rot-sub')
  el.tabIndex = -1
  el.innerHTML = `
    <div class="rot-sky" aria-hidden="true">
      ${cloudSvg('rot-cloud rot-cloud--a')}${cloudSvg('rot-cloud rot-cloud--b')}${cloudSvg('rot-cloud rot-cloud--c')}
    </div>
    <p class="rot-brand" aria-hidden="true"><span class="rot-brand-mark">${markSvg('rot-brand-svg')}</span><span class="rot-brand-text"><span class="rot-word">${WORDMARK}</span><span class="rot-tag">${CONCEPT_TAG}</span></span></p>
    <div class="rot-card">
      <div class="rot-art" aria-hidden="true">
        <div class="rot-isle">${buildIslandSvg('rot-isle-svg')}</div>
      </div>
      <div class="rot-text">
        <p class="hud-eyebrow rot-eyebrow" aria-hidden="true">Hark Town</p>
        <h2 class="rot-title" id="rot-title">Turn your phone <em>upright.</em></h2>
        <p class="rot-sub" id="rot-sub"><span class="rot-phone-ic" aria-hidden="true">${phoneSvg('rot-phone-svg')}</span>The little town is built for portrait.</p>
        <p class="rot-actions"><button class="rot-go" type="button">Continue anyway${arrowSvg}</button></p>
      </div>
    </div>
    <p class="sr-only" aria-live="assertive" data-rot-live></p>`
  // right after the skip link: Tab goes skip link → this card → the copy layer
  const skip = document.querySelector('.skip-link')
  if (skip && skip.parentNode === document.body) skip.after(el)
  else document.body.prepend(el)

  const live = el.querySelector<HTMLElement>('[data-rot-live]')!
  const go = el.querySelector<HTMLButtonElement>('.rot-go')!
  const mq = matchMedia(ROTATE_QUERY)
  const listeners: ((shown: boolean) => void)[] = onChange ? [onChange] : []
  let on = false
  const sync = () => {
    const want = mq.matches && !dismissed
    if (want === on) return
    on = want
    el.classList.toggle('is-on', on)
    document.documentElement.classList.toggle('is-rotate', on)
    if (on) {
      holdScene('rotate')
      // only the layers the card hides; the skip link and #track stay reachable
      holdInert('rotate', ['chrome', 'stages', 'loader'].map(id => document.getElementById(id)))
      // focus stranded in a now-inert layer (or on <body>) comes to the card;
      // a reader already in the copy layer or on the skip link stays put
      const a = document.activeElement
      const keep = a instanceof HTMLElement && a !== document.body && (a.closest('#track') || a.matches('.skip-link'))
      if (!keep) el.focus({ preventScroll: true })
      // a live region only speaks when its text changes after it is shown
      requestAnimationFrame(() => {
        if (on) live.textContent = 'Turn your phone upright. The little town is built for portrait.'
      })
    } else {
      releaseInert('rotate')
      releaseScene('rotate')
      live.textContent = ''
    }
    for (const fn of listeners) fn(on)
  }

  go.addEventListener('click', () => {
    const hadFocus = el.contains(document.activeElement)
    dismissed = true
    rememberDismissed()
    el.classList.add('is-dismissed')
    sync()
    if (!hadFocus) return
    // the card is gone: hand focus to the story, like the skip link does
    const main = document.getElementById('track')
    if (main && !main.closest('[inert], [aria-hidden="true"]')) main.focus({ preventScroll: true })
    else (document.activeElement as HTMLElement | null)?.blur?.()
  })

  mq.addEventListener?.('change', sync)
  gate = { el, mq, sync, listeners }
  sync()
}

/** The plain HTML fallback reads fine in any orientation. */
export function unmountRotateGate() {
  if (!gate) return
  gate.mq.removeEventListener?.('change', gate.sync)
  gate.el.remove()
  document.documentElement.classList.remove('is-rotate')
  releaseInert('rotate')
  releaseScene('rotate')
  gate = null
}
