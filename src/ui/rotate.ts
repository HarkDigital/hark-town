import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { holdScene, releaseScene } from './scene'
import { buildIslandSvg, cloudSvg, phoneSvg } from './art'

/*
 * Phone-landscape gate. Hark Town is framed in portrait on phones, so a
 * short, touch-first landscape viewport gets a sky card ("Turn your phone
 * upright") with the little island bobbing on it instead of a cramped
 * scene. Tablets and laptops in landscape are taller than 500px and never
 * see it.
 *
 * Visibility is pure CSS (the same query, in ui.css) so it is right on the
 * very first paint; JS makes the rest of the page inert while it shows,
 * announces it, and pauses the (fully hidden) scene via scene.ts.
 *
 * API: mountRotateGate(onChange?) / unmountRotateGate()
 */

export const ROTATE_QUERY = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)'

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
      onChange(gate.mq.matches)
    }
    return
  }
  if (typeof matchMedia === 'undefined') return
  const el = document.createElement('div')
  el.className = 'rot'
  el.setAttribute('role', 'dialog')
  el.setAttribute('aria-modal', 'true')
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
      </div>
    </div>
    <p class="sr-only" aria-live="assertive" data-rot-live></p>`
  document.body.appendChild(el)

  const live = el.querySelector<HTMLElement>('[data-rot-live]')!
  const mq = matchMedia(ROTATE_QUERY)
  const listeners: ((shown: boolean) => void)[] = onChange ? [onChange] : []
  let on = false
  const sync = () => {
    if (mq.matches === on) return
    on = mq.matches
    el.classList.toggle('is-on', on)
    if (on) {
      holdScene('rotate')
      holdInert('rotate', ['chrome', 'stages', 'track', 'loader'].map(id => document.getElementById(id)))
      holdInert('rotate', [document.querySelector<HTMLElement>('.skip-link')])
      // focus is now stranded in an inert layer (or on <body>): bring it in
      el.focus({ preventScroll: true })
      // a live region only speaks when its text changes after it is shown
      requestAnimationFrame(() => (live.textContent = 'Turn your phone upright. The little town is built for portrait.'))
    } else {
      releaseInert('rotate')
      releaseScene('rotate')
      live.textContent = ''
    }
    for (const fn of listeners) fn(on)
  }
  mq.addEventListener?.('change', sync)
  gate = { el, mq, sync, listeners }
  sync()
}

/** The plain HTML fallback reads fine in any orientation. */
export function unmountRotateGate() {
  if (!gate) return
  gate.mq.removeEventListener?.('change', gate.sync)
  gate.el.remove()
  releaseInert('rotate')
  releaseScene('rotate')
  gate = null
}
