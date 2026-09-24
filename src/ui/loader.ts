import { BRAND, MICROCOPY } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { mountRotateGate } from './rotate'
import { holdInert, releaseInert } from './inert'
import { balloonSvg, buildIslandSvg, cloudSvg } from './art'

/*
 * Boot screen: a morning sky where a tiny floating island gets built.
 *
 * Soft clouds drift past at two depths and a pair of birds flap across.
 * In the middle, the island pops up out of nothing, then, as loading
 * progresses, its town is built piece by piece with a squash-and-stretch
 * spring: a path and a pond, a house, a tree and bushes, a green LED lamp and
 * a little walker, and finally bunting and the Hark flag, which waves once
 * the town is done. Below it: "Building the town… 64%" and a playful status
 * line ("Pouring the foundations", "Planting trees", "Hanging the bunting").
 *
 * Exit: the site's own chapter cut, in CSS. Two banks of cloud roll in from
 * the sides and meet over the island, the loader is lifted away behind them,
 * and they part to reveal the town. Reduced motion: a plain crossfade.
 *
 * While the loader is up everything behind it is inert. It never looks
 * frozen: a stalled load keeps a slow creep and, after a while, says so.
 *
 * API: createLoader(root, { skip }) -> { progress(0..1), finish(): Promise<void> }
 * finish() resolves as the clouds start to part (so the chrome's reveal
 * overlaps it); the node removes itself once the sky is clear.
 */

const MIN_DISPLAY = 1.25 // seconds before the counter may reach 100
const SLOW_AFTER = 10 // seconds without finish() before the status admits a slow load
const CLOSE_MS = 560
const PART_MS = 980

/** progress thresholds for each build stage (art.ts data-stage) and the line shown while it runs */
const STAGES: { at: number; line: string }[] = [
  { at: 0, line: 'Pouring the foundations' },
  { at: 0.16, line: 'Laying the paths' },
  { at: 0.3, line: 'Raising the roofs' },
  { at: 0.5, line: 'Planting trees' },
  { at: 0.68, line: 'Switching on the lamps' },
  { at: 0.84, line: 'Hanging the bunting' },
]

/** little celebration sparkles around the finished island: x %, y %, colour */
const SPARKS: [number, number, string][] = [
  [14, 30, 'm'],
  [30, 12, 'g'],
  [52, 4, 'w'],
  [76, 10, 'm'],
  [90, 34, 'g'],
  [8, 58, 'w'],
  [94, 60, 'm'],
]

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** big puffs along the inner edge of a cloud bank (y in %, size in vmax) */
const PUFFS: [number, number, number][] = [
  [-6, 30, 2],
  [8, 26, -3],
  [21, 31, 4],
  [34, 27, -2],
  [47, 33, 3],
  [60, 27, -4],
  [73, 31, 2],
  [86, 26, -2],
  [99, 30, 3],
]
const bank = (side: 'l' | 'r') =>
  `<div class="ld-bank ld-bank--${side}" aria-hidden="true"><i class="ld-bank-fill"></i>${PUFFS.map(
    ([y, s, dx], i) => `<i class="ld-puff" style="--y:${y}%;--s:${s}vmax;--dx:${dx}vmax;--i:${i}"></i>`,
  ).join('')}</div>`

export function createLoader(root: HTMLElement, { skip = false } = {}) {
  // phones held sideways get the rotate card from the very first frame
  mountRotateGate()
  if (skip) {
    root.remove()
    return { progress() {}, finish: () => Promise.resolve() }
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  root.innerHTML = `
  <div class="ld" data-phase="build">
    <p class="sr-only" role="status">Loading ${BRAND.name}</p>
    <div class="ld-sky" aria-hidden="true">
      <span class="ld-sun"></span>
      ${cloudSvg('ld-cloud ld-cloud--1')}${cloudSvg('ld-cloud ld-cloud--2')}${cloudSvg('ld-cloud ld-cloud--3')}
      <svg class="ld-birds" viewBox="0 0 60 24" focusable="false"><path class="ld-bird" d="M2 10q5-6 10 0 5-6 10 0"/><path class="ld-bird ld-bird--b" d="M34 18q4-5 8 0 4-5 8 0"/></svg>
      <span class="ld-balloon"><span class="ld-balloon-sway">${balloonSvg('ld-balloon-svg')}</span></span>
    </div>
    <div class="ld-brand" aria-hidden="true"><span class="ld-brand-mark">${markSvg('ld-brand-svg')}</span><span class="ld-brand-text"><span class="ld-word">${WORDMARK}</span><span class="ld-sub">${CONCEPT_TAG}</span></span></div>

    <div class="ld-center" aria-hidden="true">
      <div class="ld-float">${buildIslandSvg('ld-isle')}<span class="ld-sparks">${SPARKS.map(
        ([x, y, c], i) => `<i class="ld-spark ld-spark--${c}" style="left:${x}%;top:${y}%;--i:${i}"></i>`,
      ).join('')}</span></div>
      <p class="ld-count"><span class="ld-count-t">Building the town…</span> <span class="ld-count-n">0</span><span class="ld-count-u">%</span></p>
      <p class="ld-status"><span class="ld-status-v">${STAGES[0].line}</span></p>
    </div>
    ${cloudSvg('ld-cloud ld-cloud--4')}${cloudSvg('ld-cloud ld-cloud--5')}
  </div>
  ${bank('l')}${bank('r')}`

  const wrap = root.querySelector<HTMLElement>('.ld')!
  const num = root.querySelector<HTMLElement>('.ld-count-n')!
  const countT = root.querySelector<HTMLElement>('.ld-count-t')!
  const statusV = root.querySelector<HTMLElement>('.ld-status-v')!
  const parts = [...root.querySelectorAll<SVGGElement>('.ld-isle [data-stage]')]
  const live = root.querySelector<HTMLElement>('[role="status"]')!

  // nothing behind the loader is reachable while it is up
  holdInert('loader', [
    ...['chrome', 'stages', 'track'].map(id => document.getElementById(id)),
    document.querySelector<HTMLElement>('.skip-link'),
  ])

  const t0 = performance.now()
  let target = 0
  let shown = 0
  let finishing = false
  let done100 = false
  let slow = false
  let raf = 0
  let last = t0
  let status = ''
  let built = -1

  const setStatus = (s: string) => {
    if (s === status) return
    status = s
    statusV.textContent = s
    // each new line pops in like a sign flipping over
    if (!reduced && typeof statusV.animate === 'function')
      statusV.animate(
        [
          { transform: 'translate3d(0, 0.6em, 0) scale(0.9)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 420, easing: 'cubic-bezier(0.34, 1.7, 0.5, 1)' },
      )
  }

  const draw = () => {
    const pct = Math.min(100, Math.floor(shown * 100 + 1e-4))
    const s = String(pct)
    if (num.textContent !== s) num.textContent = s

    // build the town, stage by stage
    let stage = 0
    for (let i = 0; i < STAGES.length; i++) if (shown >= STAGES[i].at) stage = i
    if (stage !== built) {
      built = stage
      for (const p of parts) p.classList.toggle('is-on', Number(p.dataset.stage) <= stage)
    }
    if (done100) {
      setStatus(MICROCOPY.signalEyebrow)
    } else if (slow) setStatus('Still building, nearly there')
    else setStatus(STAGES[stage].line)
  }

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    const elapsed = (now - t0) / 1000
    // the time cap keeps the build readable even when loading is instant
    const cap = finishing ? 1 : Math.min(0.97, elapsed / MIN_DISPLAY)
    // a stalled load keeps a slow creep so the town never looks frozen
    const creep = Math.min(0.9, shown + dt * 0.02)
    const goal = Math.min(cap, Math.max(target, finishing ? 1 : creep))
    const k = 1 - Math.exp(-(finishing ? 9 : 4.5) * dt)
    shown += (goal - shown) * k
    if (finishing && goal - shown < 0.004) shown = 1
    if (!finishing && !slow && elapsed > SLOW_AFTER) slow = true
    draw()
    raf = requestAnimationFrame(tick)
  }
  // the island itself pops up at once
  parts.filter(p => p.dataset.stage === '0').forEach(p => p.classList.add('is-on'))
  raf = requestAnimationFrame(tick)
  draw()

  let finished: Promise<void> | null = null

  return {
    progress(p: number) {
      if (Number.isFinite(p)) target = Math.max(target, clamp01(p))
    },
    finish(): Promise<void> {
      if (finished) return finished
      finished = (async () => {
        const elapsed = (performance.now() - t0) / 1000
        if (elapsed < MIN_DISPLAY) await wait((MIN_DISPLAY - elapsed) * 1000)
        finishing = true
        target = 1
        // let the counter land on 100 (capped: a hidden tab has no rAF)
        const land = performance.now()
        while (shown < 1 && performance.now() - land < 900) await wait(30)
        shown = 1
        done100 = true
        draw()
        countT.textContent = 'Town built!'
        wrap.dataset.phase = 'done'
        await wait(reduced ? 150 : 620)

        if (reduced) {
          // no clouds: a plain crossfade (WAAPI, so the global reduced-motion
          // transition kill in base.css cannot turn it into a hard cut)
          releaseInert('loader')
          root.style.pointerEvents = 'none'
          live.textContent = ''
          root.querySelectorAll<HTMLElement>('.ld-bank').forEach(b => (b.style.display = 'none'))
          const fade = wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease', fill: 'forwards' })
          fade.finished
            .catch(() => {})
            .then(() => {
              cancelAnimationFrame(raf)
              root.remove()
            })
          await wait(160)
          return
        }

        // the clouds roll in over the island…
        root.dataset.phase = 'close'
        await wait(CLOSE_MS)
        // …the loader is lifted away behind them…
        cancelAnimationFrame(raf)
        wrap.style.visibility = 'hidden'
        root.dataset.phase = 'part'
        releaseInert('loader')
        root.style.pointerEvents = 'none'
        live.textContent = ''
        // …and they part to reveal the town
        window.setTimeout(() => root.remove(), PART_MS + 80)
        await wait(PART_MS * 0.22)
      })()
      return finished
    },
  }
}
