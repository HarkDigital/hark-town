import type { Engine, EngineState } from '../core/Engine'
import type { Frame } from '../core/types'
import type { Sound } from './sound'
import { BRAND, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { holdInert, releaseInert } from './inert'
import { mountRotateGate } from './rotate'
import { bindScene, holdScene, onScenePause, releaseScene, sceneHeld } from './scene'
import { balloonSvg, cloudSvg, miniIslandSvg } from './art'

/*
 * Persistent chrome: the wayfinding signage of Hark Town.
 *
 *   top-left      an enamel street-sign plate: the Hark mark (ink loops,
 *                 green diamond), the real "Hark.Digital" wordmark (its dot
 *                 is a little green LED) and a "Concept · Town" tag
 *                 (→ back to start)
 *   top-right     Work · Services · Contact on a sign plate + a chunky green
 *                 "Start a project" button. ≤ 720px: Menu → a full-screen
 *                 town directory (a signpost of arrow blades, "You are here")
 *   bottom-left   Sound: Off / On (little notes float up while it plays)
 *   bottom-right  the ISLAND MINIMAP: seven tiny floating islands joined by a
 *                 dotted flight path, a green hot-air balloon riding it by
 *                 scroll progress, the current stop lit in green, the readout
 *                 "Stop 03 / 07 — The Works · Services" and a tiny clock that
 *                 follows the sun (world time). Islands are buttons. Phones
 *                 get a compact readout instead.
 *
 * After dark (storm, dusk, or a stage marked .is-dark) the plates flip to
 * night signage: dark enamel, light type, the green LEDs glowing. During the
 * cloud wipe of a cut they stay daylight so nothing sits white-on-white.
 *
 * API: createChrome(root, engine, sound) -> { update(frame, state) }
 */

const NAV = [
  { id: 'work', label: 'Work' },
  { id: 'services', label: 'Services' },
  { id: 'contact', label: 'Contact' },
]

/** Plain business names shown beside each island's town name. */
const PLAIN: Record<string, string> = {
  hero: 'Home',
  work: 'Work',
  services: 'Services',
  voices: 'Clients',
  shield: 'Security',
  process: 'Process',
  contact: 'Contact',
}

/** the directory's sign blades: each a toy colour, ink type ≥ 4.5:1 */
const BLADE = ['cream', 'mustard', 'sky', 'grass', 'clay', 'sand', 'cream']

/**
 * World time (0 dawn … 1 dusk) → wall clock, piecewise through the day the
 * story walks: morning at HQ, noon at the Works, golden hour, sunset.
 */
const CLOCK: [number, number][] = [
  [0, 5.5],
  [0.28, 9 + 40 / 60],
  [0.5, 12],
  [0.66, 15 + 20 / 60],
  [0.75, 17 + 15 / 60],
  [0.9, 19 + 55 / 60],
  [1, 20 + 45 / 60],
]

function clockAt(t: number) {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0.3))
  let h = CLOCK[CLOCK.length - 1][1]
  for (let i = 1; i < CLOCK.length; i++) {
    const [t1, h1] = CLOCK[i]
    if (x <= t1) {
      const [t0, h0] = CLOCK[i - 1]
      h = h0 + ((h1 - h0) * (x - t0)) / Math.max(1e-6, t1 - t0)
      break
    }
  }
  // the town clock moves in five-minute steps
  const mins = Math.round((h * 60) / 5) * 5
  const H = Math.floor(mins / 60) % 24
  const M = mins % 60
  const h12 = ((H + 11) % 12) + 1
  return { text: `${h12}:${String(M).padStart(2, '0')} ${H < 12 ? 'am' : 'pm'}`, H, M, mins }
}

/** chapter progress → a smooth position along the route (fast near the cuts, slow mid-chapter) */
const along = (l: number) => l - 0.5 - (0.7 * Math.sin(2 * Math.PI * (l - 0.5))) / (2 * Math.PI)

const pad2 = (n: number) => String(n).padStart(2, '0')
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const arrowSvg = `<svg class="ch-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 8h10.5M9 3.8 13.2 8 9 12.2"/></svg>`
const speakerSvg = `<svg class="ch-spk" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="ch-spk-body" d="M3 7.6h2.8L10 4v12l-4.2-3.6H3z"/><path class="ch-spk-w1" d="M12.6 7.4a3.6 3.6 0 0 1 0 5.2"/><path class="ch-spk-w2" d="M14.8 5.2a6.8 6.8 0 0 1 0 9.6"/><path class="ch-spk-x" d="M12.8 7.8l4.4 4.4M17.2 7.8l-4.4 4.4"/></svg>`
const clockSvg = `<svg class="ch-clock-face" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.6"/><path class="ch-hand-h" d="M8 8V4.8"/><path class="ch-hand-m" d="M8 8V3"/><circle class="ch-clock-pin" cx="8" cy="8" r="1"/></svg>`

/* ------------------------------------------------------------------ minimap geometry (CSS px) */
const ISLE_W = 34
const ISLE_GAP = 38
const MAP_H = 50
/** island top-surface anchor (where the flight path touches down), per stop */
const JITTER = [2, -2, 1, -3, 2, -1, 1]

export function createChrome(root: HTMLElement, engine: Engine, sound: Sound) {
  const slots = engine.slots
  const total = slots.length
  const indexOf = (id: string) => slots.findIndex(s => s.def.id === id)
  const plainOf = (id: string, fallback: string) => PLAIN[id] ?? fallback
  const nav = NAV.filter(n => indexOf(n.id) >= 0)

  // rotate card, open menu: an unseen scene is not rendered (holds are shared via scene.ts)
  bindScene(engine)
  mountRotateGate(shown => (engine.paused = shown || sceneHeld()))
  onScenePause.push(paused => {
    if (paused) sound.hush()
  })
  // dev-only handle for audio checks in headless tests
  if (import.meta.env.DEV) (window as unknown as { __harkSound?: Sound }).__harkSound = sound

  // ---------------------------------------------------------------- markup

  const mapW = (total - 1) * ISLE_GAP + ISLE_W
  const pts = slots.map((_, i) => ({ x: ISLE_W / 2 + i * ISLE_GAP, y: 22 + (JITTER[i % JITTER.length] ?? 0) }))
  /** quadratic hop between neighbouring islands: [p0, control, p1] */
  const hops = pts.slice(1).map((p1, i) => {
    const p0 = pts[i]
    return { p0, c: { x: (p0.x + p1.x) / 2, y: Math.min(p0.y, p1.y) - 15 }, p1 }
  })
  const routeD = hops.length
    ? `M${pts[0].x} ${pts[0].y}` + hops.map(h => `Q${h.c.x} ${h.c.y} ${h.p1.x} ${h.p1.y}`).join('')
    : ''

  const isles = slots
    .map((s, i) => {
      const plain = plainOf(s.def.id, s.def.label)
      return `<li><button class="ch-isle" type="button" data-goto="${s.def.id}" data-i="${i}" style="left:${pts[i].x - ISLE_W / 2}px;--dy:${JITTER[i % JITTER.length]}px" aria-label="Stop ${i + 1} of ${total}: ${esc(plain)} (${esc(s.def.label)})">${miniIslandSvg(s.def.id)}</button></li>`
    })
    .join('')

  const miniDots = slots.map((_, i) => `<i data-i="${i}"></i>`).join('')

  const navLinks = nav
    .map(n => `<li><a class="ch-link" href="#${n.id}" data-goto="${n.id}">${n.label}</a></li>`)
    .join('')

  const menuItems = slots
    .map((s, i) => {
      const plain = plainOf(s.def.id, s.def.label)
      return `<li style="--i:${i}" data-blade="${BLADE[i % BLADE.length]}"><a class="ch-ml" href="#${s.def.id}" data-goto="${s.def.id}" aria-label="${esc(plain)}, ${esc(s.def.label)}">
        <span class="ch-ml-n" aria-hidden="true">${pad2(i + 1)}</span>
        <span class="ch-ml-name" aria-hidden="true">${esc(plain)}</span>
        <span class="ch-ml-town" aria-hidden="true">${esc(s.def.label)}</span>
        <span class="ch-ml-here" aria-hidden="true">You are here</span>
      </a></li>`
    })
    .join('')

  const brandInner = `<span class="ch-mark">${markSvg('ch-mark-svg')}</span>
        <span class="ch-brand-text" aria-hidden="true">
          <span class="ch-word">${WORDMARK}</span>
          <span class="ch-sub">${CONCEPT_TAG}</span>
        </span>`

  root.innerHTML = `
  <div class="chrome">
    <header class="ch-top">
      <a class="ch-brand ch-plate ch-swing" href="#hero" data-goto="hero" aria-label="${esc(BRAND.name)}, back to start">
        ${brandInner}
      </a>
      <nav class="ch-nav ch-swing" aria-label="Primary">
        <ul class="ch-links ch-plate">${navLinks}</ul>
        <a class="ch-cta" href="#contact" data-goto="contact" data-focus><span>Start a project</span>${arrowSvg}</a>
      </nav>
      <button class="ch-menu-btn ch-plate ch-swing" type="button" aria-expanded="false" aria-controls="ch-menu" aria-haspopup="dialog">
        <span class="ch-menu-btn-txt">Menu</span><span class="ch-burger" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
    </header>

    <div class="ch-menu" id="ch-menu" role="dialog" aria-modal="true" aria-labelledby="ch-menu-title" data-lenis-prevent hidden>
      <div class="ch-menu-sky" aria-hidden="true">
        ${cloudSvg('ch-mcloud ch-mcloud--a')}${cloudSvg('ch-mcloud ch-mcloud--b')}${cloudSvg('ch-mcloud ch-mcloud--c')}
      </div>
      <div class="ch-menu-top">
        <span class="ch-brand ch-plate ch-menu-brand" aria-hidden="true">${brandInner}</span>
        <button class="ch-menu-btn ch-plate ch-menu-close" type="button" aria-label="Close menu">
          <span class="ch-menu-btn-txt" aria-hidden="true">Close</span><span class="ch-burger is-x" aria-hidden="true"><i></i><i></i><i></i></span>
        </button>
      </div>
      <div class="ch-menu-body">
        <p class="hud-eyebrow ch-menu-eyebrow"><span id="ch-menu-title">Town directory</span><span aria-hidden="true"> · ${total} stops</span></p>
        <div class="ch-post">
          <span class="ch-post-pole" aria-hidden="true"></span>
          <ol class="ch-blades">${menuItems}</ol>
        </div>
        <div class="ch-menu-foot">
          <a class="hud-btn ch-menu-cta" href="#contact" data-goto="contact">Start a project ${arrowSvg}</a>
          <a class="ch-menu-mail" href="mailto:${BRAND.email}">${BRAND.email}</a>
        </div>
      </div>
    </div>

    <div class="ch-bottom">
      <button class="ch-sound ch-plate ch-pop" type="button" data-sound-toggle aria-pressed="false">
        <span class="ch-sound-ic" aria-hidden="true">${speakerSvg}<i class="ch-note ch-note--a">♪</i><i class="ch-note ch-note--b">♫</i></span>
        <span class="ch-sound-txt">${MICROCOPY.audio}<span aria-hidden="true">:</span> <span class="ch-sound-state" aria-hidden="true">${MICROCOPY.audioOff}</span></span>
      </button>

      <div class="ch-map ch-plate ch-pop">
        <p class="ch-read" aria-hidden="true">
          <span class="ch-read-row">
            <span class="ch-key">Island</span>&nbsp;<span class="ch-num">01</span><span class="ch-of">&nbsp;/&nbsp;${pad2(total)}</span>
            <span class="ch-clock">${clockSvg}<span class="ch-time">9:40 am</span></span>
          </span>
          <span class="ch-read-name"><span class="ch-town"></span><span class="ch-plain"></span></span>
        </p>
        <span class="ch-mini" aria-hidden="true"><span class="ch-mini-line"></span>${miniDots}<b class="ch-mini-dot"></b></span>
        <nav class="ch-route" aria-label="Islands" style="width:${mapW}px;height:${MAP_H}px">
          <svg class="ch-path" viewBox="0 0 ${mapW} ${MAP_H}" width="${mapW}" height="${MAP_H}" aria-hidden="true" focusable="false">
            <defs><clipPath id="ch-trail-clip"><rect class="ch-trail-rect" x="0" y="-20" width="0" height="${MAP_H + 40}"/></clipPath></defs>
            <path class="ch-path-base" d="${routeD}"/>
            <path class="ch-path-trail" d="${routeD}" clip-path="url(#ch-trail-clip)"/>
          </svg>
          <ol class="ch-isles">${isles}</ol>
          <span class="ch-balloon" aria-hidden="true">${balloonSvg('ch-balloon-svg')}</span>
        </nav>
      </div>
    </div>
  </div>`

  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector<T>(s)!
  const chrome = $('.chrome')
  const soundBtn = $<HTMLButtonElement>('.ch-sound')
  const soundState = $('.ch-sound-state')
  const menuBtn = $<HTMLButtonElement>('.ch-top .ch-menu-btn')
  const menuClose = $<HTMLButtonElement>('.ch-menu-close')
  const menu = $('.ch-menu')
  const isleEls = [...root.querySelectorAll<HTMLButtonElement>('.ch-isle')]
  const navEls = [...root.querySelectorAll<HTMLAnchorElement>('.ch-link')]
  const menuLinks = [...root.querySelectorAll<HTMLAnchorElement>('.ch-ml')]
  const miniEls = [...root.querySelectorAll<HTMLElement>('.ch-mini i')]
  const miniDot = $('.ch-mini-dot')
  const keyEl = $('.ch-key')
  const numEl = $('.ch-num')
  const townEl = $('.ch-town')
  const plainEl = $('.ch-plain')
  const nameEl = $('.ch-read-name')
  const timeEl = $('.ch-time')
  const handH = $<SVGPathElement>('.ch-hand-h')
  const handM = $<SVGPathElement>('.ch-hand-m')
  const balloon = $('.ch-balloon')
  const trailRect = $<SVGRectElement>('.ch-trail-rect')
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  // header-first tab order: the chrome comes before the active chapter's content
  const stagesEl = document.getElementById('stages')
  if (stagesEl && stagesEl.parentNode === root.parentNode && root.compareDocumentPosition(stagesEl) & Node.DOCUMENT_POSITION_PRECEDING) {
    stagesEl.parentNode!.insertBefore(root, stagesEl)
  }

  // ---------------------------------------------------------------- navigation

  const go = (id: string) => {
    if (indexOf(id) >= 0) engine.land(id)
  }

  root.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLElement>('[data-goto]')
    if (!a || !root.contains(a)) return
    e.preventDefault()
    const id = a.dataset.goto!
    const fromMenu = menuOpen && menu.contains(a)
    if (menuOpen) closeMenu(false)
    sound.blip(a.matches('.ch-cta, .ch-menu-cta') ? 5 : 2 + indexOf(id) * 0.5)
    go(id)
    // menu links always hand focus on (the menu they lived in is gone); the
    // top nav, CTA and islands do it for keyboard activation (click.detail 0)
    if (fromMenu || (e.detail === 0 && (a.matches('.ch-link, .ch-isle, .ch-brand') || a.hasAttribute('data-focus'))))
      engine.focusChapter(id)
  })

  // a little pop on hover (mouse / pen only)
  root.querySelectorAll<HTMLElement>('.ch-link, .ch-cta, .ch-isle, .ch-brand, .ch-sound, .ch-menu-btn, .ch-ml').forEach((node, i) => {
    node.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType !== 'touch') sound.blip(i % 7)
    })
  })

  // ------------------------------------------------------------- stop readout

  let lastIndex = -1
  let cueIndex = -1
  const popName = () => {
    if (reduced || typeof nameEl.animate !== 'function') return
    nameEl.animate(
      [
        { transform: 'translate3d(0, 0.5em, 0) scale(0.86)', opacity: 0 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 460, easing: 'cubic-bezier(0.34, 1.7, 0.5, 1)' },
    )
  }
  const showStop = (i: number, animate = true) => {
    const s = slots[i]
    if (!s) return
    const n = pad2(i + 1)
    if (numEl.textContent === n && townEl.textContent === s.def.label) return
    numEl.textContent = n
    townEl.textContent = s.def.label
    plainEl.textContent = ` · ${plainOf(s.def.id, s.def.label)}`
    if (animate) popName()
  }
  const cue = (i: number) => {
    cueIndex = i
    chrome.classList.add('is-cue')
    keyEl.textContent = 'Fly to'
    showStop(i)
  }
  const uncue = () => {
    if (cueIndex < 0) return
    cueIndex = -1
    chrome.classList.remove('is-cue')
    keyEl.textContent = 'Stop'
    if (lastIndex >= 0) showStop(lastIndex)
  }
  isleEls.forEach((b, i) => {
    // a fingertip tap goes straight there; no hover cue left stuck behind
    b.addEventListener('pointerenter', e => {
      if ((e as PointerEvent).pointerType !== 'touch') cue(i)
    })
    b.addEventListener('focus', () => cue(i))
    b.addEventListener('pointerleave', uncue)
    b.addEventListener('blur', uncue)
  })

  // --------------------------------------------------------------------- sound

  const syncSound = (on: boolean) => {
    soundBtn.setAttribute('aria-pressed', String(on))
    soundState.textContent = on ? MICROCOPY.audioOn : MICROCOPY.audioOff
    chrome.classList.toggle('is-sound', on)
  }
  soundBtn.addEventListener('click', () => sound.toggle())
  sound.onChange.push(syncSound)
  syncSound(sound.enabled)

  // ---------------------------------------------------------------- mobile menu

  // A real modal: its own Close button lives inside the dialog (drawn exactly
  // where Menu sits), focus moves in on open and back on close, Escape closes,
  // and everything behind it is inert while it is open. The signpost drops in
  // and its blades pop out one after another.
  let menuOpen = false
  let hideTimer = 0
  let pauseTimer = 0
  const focusables = () =>
    [...menu.querySelectorAll<HTMLElement>('a[href], button')].filter(el => !el.hidden && el.getClientRects().length > 0)
  const openMenu = () => {
    if (menuOpen) return
    menuOpen = true
    clearTimeout(hideTimer)
    menu.hidden = false
    // flush the closed state so the entrance transition runs
    void menu.offsetWidth
    chrome.classList.add('is-menu')
    menuBtn.setAttribute('aria-expanded', 'true')
    holdInert('menu', [
      document.getElementById('stages'),
      document.getElementById('track'),
      document.querySelector<HTMLElement>('.skip-link'),
      $('.ch-top'),
      $('.ch-bottom'),
    ])
    engine.lenis.stop()
    sound.blip(6)
    // once the sky has fully covered the scene, stop rendering it
    clearTimeout(pauseTimer)
    pauseTimer = window.setTimeout(() => menuOpen && holdScene('menu'), reduced ? 60 : 520)
    menu.scrollTop = 0
    const now = menuLinks[lastIndex] ?? menuLinks[0]
    now?.focus({ preventScroll: true })
  }
  const closeMenu = (restoreFocus = true) => {
    if (!menuOpen) return
    menuOpen = false
    chrome.classList.remove('is-menu')
    menuBtn.setAttribute('aria-expanded', 'false')
    releaseInert('menu')
    clearTimeout(pauseTimer)
    releaseScene('menu')
    engine.lenis.start()
    hideTimer = window.setTimeout(() => {
      if (!menuOpen) menu.hidden = true
    }, reduced ? 30 : 380)
    if (restoreFocus) menuBtn.focus({ preventScroll: true })
  }
  menuBtn.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()))
  menuClose.addEventListener('click', () => closeMenu())
  window.addEventListener('keydown', e => {
    if (!menuOpen) return
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    } else if (e.key === 'Tab') {
      const f = focusables()
      if (!f.length) return
      const i = f.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i === f.length - 1 ? 0 : i + 1
      e.preventDefault()
      f[next].focus()
    }
  })
  matchMedia('(min-width: 721px)').addEventListener('change', e => {
    if (e.matches) closeMenu(false)
  })

  // -------------------------------------------------------------------- reveal

  let revealed = false
  const revealChrome = () => {
    if (revealed) return
    revealed = true
    chrome.classList.add('is-in')
  }
  if (document.documentElement.dataset.ready) revealChrome()
  else window.addEventListener('hark:reveal', revealChrome, { once: true })
  // safety net: never leave the chrome hidden
  const safety = () => (document.querySelector('#loader .ld') ? window.setTimeout(safety, 2000) : revealChrome())
  window.setTimeout(safety, 9000)

  // -------------------------------------------------------------------- update

  let dark = false
  let lastClock = -1
  let lastF = -99
  let lastBx = -1
  let lastBy = -1
  let lastRot = 99
  let lastMini = -1
  /** the balloon's shown position: it flies (damped) rather than teleporting on nav jumps */
  let fShown = -1

  /** position on the route for a fractional stop index */
  const routeAt = (f: number) => {
    if (!hops.length) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0 }
    const i = Math.min(hops.length - 1, Math.max(0, Math.floor(f)))
    const t = Math.min(1, Math.max(0, f - i))
    const h = hops[i]
    const u = 1 - t
    return {
      x: u * u * h.p0.x + 2 * u * t * h.c.x + t * t * h.p1.x,
      y: u * u * h.p0.y + 2 * u * t * h.c.y + t * t * h.p1.y,
    }
  }

  return {
    update(frame: Frame, state: EngineState) {
      const slot = state.slots[state.index]
      if (!slot) return

      if (state.index !== lastIndex) {
        const first = lastIndex < 0
        lastIndex = state.index
        if (cueIndex < 0) showStop(state.index, !first)
        isleEls.forEach((t, i) => {
          t.classList.toggle('is-active', i === state.index)
          t.classList.toggle('is-past', i < state.index)
          if (i === state.index) t.setAttribute('aria-current', 'step')
          else t.removeAttribute('aria-current')
        })
        miniEls.forEach((t, i) => {
          t.classList.toggle('is-active', i === state.index)
          t.classList.toggle('is-past', i < state.index)
        })
        navEls.forEach(a => {
          const on = a.dataset.goto === slot.def.id
          a.classList.toggle('is-active', on)
          if (on) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        menuLinks.forEach((a, i) => {
          a.parentElement?.classList.toggle('is-now', i === state.index)
          if (i === state.index) a.setAttribute('aria-current', 'location')
          else a.removeAttribute('aria-current')
        })
        chrome.dataset.chapter = slot.def.id
      }

      // ---- night signage: storm, dusk, or a stage that says it is dark
      const world = engine.world
      const storm = world.params.storm
      const t = world.time
      const cut = engine.post.transition
      let wantDark = dark
        ? storm > 0.32 || t > 0.9 || slot.stage.classList.contains('is-dark')
        : storm > 0.45 || t > 0.93 || slot.stage.classList.contains('is-dark')
      // the cloud wipe is daylight white: keep daylight signage over it
      if (cut > 0.45) wantDark = false
      if (wantDark !== dark) {
        dark = wantDark
        chrome.classList.toggle('is-dark', dark)
      }

      // ---- the town clock
      const c = clockAt(t)
      if (c.mins !== lastClock) {
        lastClock = c.mins
        timeEl.textContent = c.text
        handH.style.transform = `rotate(${(((c.H % 12) + c.M / 60) * 30).toFixed(1)}deg)`
        handM.style.transform = `rotate(${(c.M * 6).toFixed(1)}deg)`
      }

      // ---- the balloon rides the flight path with scroll progress
      const fTarget = Math.min(total - 1, Math.max(0, state.index + along(Math.min(1, Math.max(0, state.local)))))
      if (fShown < 0 || reduced || !Number.isFinite(fShown)) fShown = fTarget
      else {
        fShown += (fTarget - fShown) * (1 - Math.exp(-5 * Math.min(0.1, frame.dt)))
        if (Math.abs(fTarget - fShown) < 0.0005) fShown = fTarget
      }
      const f = fShown
      const idle = reduced ? 0 : frame.time
      const bob = Math.sin(idle * 1.9) * 1.2
      if (Math.abs(f - lastF) > 0.0004 || !reduced) {
        const p = routeAt(f)
        const bx = Math.round(p.x * 4) / 4
        const by = Math.round((p.y + bob) * 4) / 4
        // lean into the scroll, and into the flight on a nav jump
        const lean = Math.max(-16, Math.min(16, frame.velocity * 26 + (fTarget - fShown) * 14))
        const rot = Math.round((Math.sin(idle * 1.3) * 4 + lean) * 2) / 2
        if (bx !== lastBx || by !== lastBy || rot !== lastRot) {
          lastBx = bx
          lastBy = by
          lastRot = rot
          balloon.style.transform = `translate3d(${bx}px, ${by}px, 0) rotate(${rot}deg)`
        }
        if (Math.abs(f - lastF) > 0.0004) {
          lastF = f
          trailRect.setAttribute('width', p.x.toFixed(1))
          const m = Math.round((f / Math.max(1, total - 1)) * 1000) / 1000
          if (m !== lastMini) {
            lastMini = m
            miniDot.style.setProperty('--m', String(m))
          }
        }
      }
    },
  }
}
