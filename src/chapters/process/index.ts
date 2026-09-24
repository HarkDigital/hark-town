import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, lerp, smoothstep } from '../../core/math'
import { Site } from './site'
import { SiteHud, type Band } from './hud'
import { makeTextures, whenSignFontsReady } from './textures'
import * as T from './timeline'
import './process.css'

/*
 * BUILDING SITE — "We listen first. Then we build." (see timeline.ts for the
 * beat sheet). One building goes up in four steps on a floating island at
 * golden hour; the hoarding panels revolve to show the stats; the camera
 * climbs back into the clouds.
 */

const DEG = Math.PI / 180

/** Yield a frame between heavy init steps (rAF never fires in a hidden tab, so time out too). */
const yieldFrame = () =>
  new Promise<void>(resolve => {
    let done = false
    const go = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (typeof document !== 'undefined' && document.hidden) {
      setTimeout(go, 0)
      return
    }
    requestAnimationFrame(go)
    setTimeout(go, 120)
  })

const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()

/** Place the camera so the subject (w × h world units) fills the free band (px). */
function applyShot(s: T.Shot, groundY: number, W: number, H: number, band: Band, out: CameraPose) {
  const aspect = W / Math.max(1, H)
  const tv = Math.tan((s.fov * DEG) / 2)
  const th = tv * aspect
  const wn = Math.max(0.2, ((band.r - band.l) / W) * 2)
  const hn = Math.max(0.2, ((band.b - band.t) / H) * 2)
  const dist = Math.max(s.w / (th * wn), s.h / (tv * hn))
  const sx = (band.l + band.r) / W - 1
  const sy = 1 - (band.t + band.b) / H
  const az = s.az * DEG
  const el = s.el * DEG
  _dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
  _right.set(Math.cos(az), 0, -Math.sin(az))
  _up.crossVectors(_dir, _right)
  out.target
    .set(s.p[0], s.p[1] + groundY, s.p[2])
    .addScaledVector(_right, -sx * dist * th)
    .addScaledVector(_up, -sy * dist * tv)
  out.position.copy(out.target).addScaledVector(_dir, dist)
  out.fov = s.fov
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let site: Site | null = null
  let hud: SiteHud | null = null

  const shot: T.Shot = { p: [0, 0, 0], az: 0, el: 30, w: 10, h: 8, fov: 15 }
  const bandIntro: Band = { l: 0, r: 1, t: 0, b: 1 }
  const bandSteps: Band = { l: 0, r: 1, t: 0, b: 1 }
  const bandStats: Band = { l: 0, r: 1, t: 0, b: 1 }
  const bandNow: Band = { l: 0, r: 1, t: 0, b: 1 }
  let portrait = false
  let shortSteps = false
  let shortStats = false
  let measuredW = 0
  let measuredH = 0
  let measure: (() => void) | null = null
  const fills = [0, 0, 0, 0]
  const stats = [false, false, false]

  /** local where the step plate arrives (later on short phones: headline first) */
  const plateFrom = () => (shortSteps ? 0.135 : T.STEPS[0][0] + 0.004)

  return {
    id: 'process',
    group,
    anchors: T.ANCHORS,

    async init(ctx: ChapterContext) {
      hud = new SiteHud(ctx.stage)
      const aniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy())
      const tex = makeTextures(aniso, ctx.mobile)
      await yieldFrame()
      site = new Site(ctx.mobile, tex)
      await site.build(yieldFrame)
      group.add(site.root)
      // painted signs pick up the web fonts once they're in
      void whenSignFontsReady().then(() => tex.redraw())

      const h = hud
      measure = () => {
        const W = ctx.stage.clientWidth || window.innerWidth
        const H = ctx.stage.clientHeight || window.innerHeight
        const r = h.layout(W, H)
        Object.assign(bandIntro, r.intro)
        Object.assign(bandSteps, r.steps)
        Object.assign(bandStats, r.stats)
        portrait = r.portrait
        shortSteps = r.shortSteps
        shortStats = r.shortStats
        measuredW = W
        measuredH = H
      }
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => measure?.())
        ro.observe(ctx.stage)
        for (const n of h.measured()) ro.observe(n)
      }
      window.addEventListener('resize', () => measure?.())
      measure()
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      const l = clamp(local)
      const calm = frame.reducedMotion
      if (measure && (Math.abs(measuredW - frame.width) > 1 || Math.abs(measuredH - frame.height) > 1)) measure()

      // ---- shot + free band (camera() reuses them this frame)
      T.shotAt(portrait ? T.TALL : T.WIDE, l, shot)
      if (!calm) {
        shot.az += Math.sin(frame.time * 0.11) * 1.1
        shot.el += Math.sin(frame.time * 0.087 + 1) * 0.5
      }
      const pf = plateFrom()
      const k1 = smoothstep(pf - 0.03, pf, l)
      const k2 = smoothstep(T.STATS_AT[0] - 0.03, T.STATS_AT[0], l)
      for (const key of ['l', 'r', 't', 'b'] as const) bandNow[key] = lerp(lerp(bandIntro[key], bandSteps[key], k1), bandStats[key], k2)

      // ---- light: golden hour deepening as the building goes up
      const w = ctx.world.params
      w.time = lerp(0.72, 0.8, smoothstep(0.05, 0.95, l))
      const gy = site?.groundY ?? 0
      w.focus.set(shot.p[0] * 0.7, gy + 0.6, shot.p[2] * 0.7 - 0.3)
      w.shadowSize = clamp(Math.max(shot.w * 0.55, shot.h * 0.62), 5.4, 8.2)

      // ---- lens: tilt-shift band on the subject, dreamier in the cloud beats
      const H = Math.max(1, frame.height)
      const p = ctx.post.params
      const mid = (bandNow.t + bandNow.b) / 2 / H
      const beat = Math.max(1 - smoothstep(0.02, 0.1, l), smoothstep(0.92, 1, l))
      p.focusY = 1 - mid
      p.band = clamp(((bandNow.b - bandNow.t) / H) * 0.3, 0.1, 0.24) * (1 - beat * 0.4)
      p.blur = (frame.mobile ? 5 : 6.5) + beat * 3
      p.sat = 1.14
      p.bloomStrength = 0.5
      p.bloomRadius = 0.5
      p.vignette = 0.24
      p.flash = (1 - smoothstep(0, 0.07, l)) * 0.22 + smoothstep(0.95, 1, l) * 0.25

      // ---- scene
      site?.update(l, frame.time, calm)

      // ---- HUD
      if (hud) {
        const step = T.stepAt(l)
        for (let i = 0; i < 4; i++) fills[i] = T.stepProgress(l, i)
        const plate = l >= pf && l < T.STEPS[3][1]
        for (let i = 0; i < 3; i++) stats[i] = l >= T.STATS_AT[i] + 0.004 && l < T.HUD_OUT
        const statsOn = l >= T.STATS_AT[0] - 0.004 && l < T.HUD_OUT
        hud.update({
          head: l >= T.HEAD_IN && l < T.HUD_OUT && !(shortSteps && plate) && !(shortStats && statsOn),
          plate,
          step: plate ? step : -1,
          fills,
          statsOn,
          stats,
        })
      }
    },

    camera(_local: number, frame: Frame, out: CameraPose) {
      applyShot(shot, site?.groundY ?? 0, Math.max(1, frame.width), Math.max(1, frame.height), bandNow, out)
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : 0.35
    },

    onEnter() {
      site?.resetScrub()
    },
  }
}
