import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { Site } from './site'
import { SiteHud, type Band, type Box } from './hud'
import { makeTextures, whenSignFontsReady } from './textures'
import * as T from './timeline'
import './process.css'

/*
 * BUILDING SITE — "We listen first. Then we build." (see timeline.ts for the
 * beat sheet). One building goes up in four steps on a floating island at
 * golden hour; the site-fence panels revolve to show the stats; the camera
 * climbs back into the clouds.
 */

const DEG = Math.PI / 180

/** An NDC rect: x0/x1 left/right, y0 bottom, y1 top. */
interface NdcRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Publish the copy box to the world's far-field keep-out (world.params.keepOut,
 * an NDC rect, y up, reset to null every frame) so distant islets never drift
 * behind the words. Guarded, in case the world holds another shape.
 */
function publishKeepOut(wp: object, r: NdcRect) {
  const holder = wp as { keepOut?: unknown }
  const ko = holder.keepOut
  if (ko instanceof THREE.Vector4) ko.set(r.x0, r.y0, r.x1, r.y1)
  else if (ko instanceof THREE.Box2) {
    ko.min.set(r.x0, r.y0)
    ko.max.set(r.x1, r.y1)
  } else if (ko && typeof ko === 'object') {
    if (ko !== r) Object.assign(ko, r)
  } else holder.keepOut = r
}

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
  const keep: NdcRect = { x0: -2, y0: -2, x1: -2, y1: -2 }
  const box = { left: 0, top: 0, right: 0, bottom: 0 }
  const grow = (b: Box, first: boolean) => {
    box.left = first ? b.left : Math.min(box.left, b.left)
    box.top = first ? b.top : Math.min(box.top, b.top)
    box.right = first ? b.right : Math.max(box.right, b.right)
    box.bottom = first ? b.bottom : Math.max(box.bottom, b.bottom)
  }

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
      await nextFrame()
      site = new Site(ctx.mobile, tex)
      await site.build(nextFrame)
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
        const statsOn = l >= T.STATS_AT[0] - 0.004 && l < T.HUD_OUT
        // the first row arrives with the plate (never an empty plate), the rest with their panels
        for (let i = 0; i < 3; i++) stats[i] = i === 0 ? statsOn : l >= T.STATS_AT[i] + 0.004 && l < T.HUD_OUT
        const head = l >= T.HEAD_IN && l < T.HUD_OUT && !(shortSteps && plate) && !(shortStats && statsOn)
        hud.update({ head, plate, step: plate ? step : -1, fills, statsOn, stats })

        // ---- keep the world's distant islets out from behind the copy: the
        // headline (plus, beside it in landscape, whichever plate is up)
        const bx = hud.boxes
        let n = 0
        if (head) grow(bx.head, n++ === 0)
        if ((!portrait || !n) && plate) grow(bx.plate, n++ === 0)
        if ((!portrait || !n) && statsOn) grow(bx.stats, n++ === 0)
        const W = Math.max(1, frame.width)
        if (n) {
          const pad = 14
          keep.x0 = (2 * (box.left - pad)) / W - 1
          keep.x1 = (2 * (box.right + pad)) / W - 1
          keep.y1 = 1 - (2 * (box.top - pad)) / H
          keep.y0 = 1 - (2 * (box.bottom + pad)) / H
          publishKeepOut(w, keep)
        }
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
