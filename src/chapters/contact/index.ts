import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { setRise } from '../../core/dom'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { buildHud, measureHud, type Hud, type HudLayout, type Rect } from './hud'
import { buildScene, GALLERY_Y, KEEPER_A, LANTERN, LH_TOP, type LighthouseScene } from './build'
import { deckHeight } from './clouds'
import { skyMaterial, skyUniforms } from './shaders'
import './contact.css'

/*
 * LIGHTHOUSE — the last island (1.5 vh, nav lands at 0.3). Sunset → dusk.
 *
 *   0.00–0.27  the cloud bank parts (clear by ~0.09, as the cut's wipe opens)
 *              and the camera sinks onto a rocky islet on a sunset cloud
 *              deck; windows light (0.12), the little green LED
 *              lamps come on down the path (0.15–0.2), the lantern flickers
 *              on (0.19–0.235): the Hark mark glows green and two beams —
 *              warm and green — start sweeping the clouds
 *   0.17–0.23  the signage plate pops up: Say hello. · the address · copy ·
 *              sister sites · back to top · colophon
 *   0.27–0.74  hold: a slow drone orbit; sailboats on the clouds, gulls
 *              round the lantern, smoke from the keeper's chimney
 *   0.74–0.86  the camera comes down and in to the lamp room: the Hark mark
 *              glowing green, face on, beams sweeping past (the payoff)
 *   0.86–0.96  and pulls back to eye level: the sky comes into frame, the
 *              Belt of Venus, a full moon rises out of the clouds, the stars
 *              come out (dusk, time 1)
 *   0.9        "Goodnight from Hark Town"
 */

const DEG = Math.PI / 180
const ISLAND_YAW = 0
/** camera azimuth: the camera sits at (sin az, cos az) from the island */
const AZ_HOLD = -0.3
const AZ_FINAL = 0.5
/** the lamp-room close-up (0.74–0.96): straight down the lantern's clear pane */
const AZ_CLOSE = 0.5
const EL_CLOSE = 3 * DEG
const EL_START = 60 * DEG
const EL_HOLD = 25 * DEG
const EL_HOLD_END = 20.5 * DEG
/** in the finale the camera settles at this height: the lantern stands against the sky */
const EYE_Y = 2.35
const PIVOT = new THREE.Vector3(0, 2.1, 0)
/** middle of the lamp room (gallery → vane), the close-up's pivot */
const ROOM = new THREE.Vector3(LANTERN.x, (GALLERY_Y + LH_TOP) / 2 - 0.1, LANTERN.z)
const Y = new THREE.Vector3(0, 1, 0)

const SKY_A = { sea: '#f0b2a2', glow: '#ffc7a0', belt: '#f5a3a8', low: '#b58cb6', high: '#6e68a4' }
const SKY_B = { sea: '#766c98', glow: '#ee9f84', belt: '#d4819c', low: '#5d5290', high: '#1f2250' }
const toCol = (o: typeof SKY_A) => ({
  sea: new THREE.Color(o.sea),
  glow: new THREE.Color(o.glow),
  belt: new THREE.Color(o.belt),
  low: new THREE.Color(o.low),
  high: new THREE.Color(o.high),
})

interface Fit {
  dist: number
  sx: number
  sy: number
  el: number
}

/** 0 → 1 → 0: into the lamp-room close-up and back out to the finale */
function closeK(l: number) {
  const a = ease.inOutCubic(segment(l, 0.745, 0.835))
  const b = ease.inOutCubic(segment(l, 0.872, 0.958))
  return a * (1 - b)
}

type NdcRect = { x0: number; y0: number; x1: number; y1: number }

/**
 * Publish the copy plate so the world's far field stays out from behind it.
 * Guarded: only when the world exposes params.keepOut (an NDC rect:
 * Vector4 x0,y0,x1,y1 / Box2 / {x0,y0,x1,y1}).
 */
function publishKeepOut(wp: object, r: NdcRect) {
  const ko = (wp as { keepOut?: unknown }).keepOut
  if (!ko || typeof ko !== 'object') return
  if (ko instanceof THREE.Vector4) ko.set(r.x0, r.y0, r.x1, r.y1)
  else if (ko instanceof THREE.Box2) {
    ko.min.set(r.x0, r.y0)
    ko.max.set(r.x1, r.y1)
  } else if ('x0' in ko && 'y1' in ko) Object.assign(ko, r)
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let S!: LighthouseScene
  let hud!: Hud
  let layout: HudLayout | null = null
  let reduced = false
  let mobile = false
  let fov = 16
  // solved fits (targets) and the damped ones the camera uses, so a layout
  // change (a phone toolbar sliding away, a resize) eases instead of popping
  const tgtHold: Fit = { dist: 70, sx: 0, sy: 0, el: (EL_HOLD + EL_HOLD_END) / 2 }
  const tgtFinal: Fit = { dist: 80, sx: 0, sy: 0, el: 1 * DEG }
  const tgtClose: Fit = { dist: 28, sx: 0, sy: 0, el: EL_CLOSE }
  const fitHold: Fit = { ...tgtHold }
  const fitFinal: Fit = { ...tgtFinal }
  const fitClose: Fit = { ...tgtClose }
  let fitted = false
  const focus = { hold: { y: 0.5, band: 0.2 }, final: { y: 0.5, band: 0.3 }, close: { y: 0.5, band: 0.3 } }
  let fitKey = ''
  let worldFit: THREE.Vector3[] = []
  let roomFit: THREE.Vector3[] = []
  /** the copy plate in NDC (x0, y0 bottom, x1, y1 top), for world.params.keepOut */
  const keep: NdcRect = { x0: -1, y0: -1, x1: -1, y1: -1 }
  const noKeep: NdcRect = { x0: -1, y0: -1, x1: -1, y1: -1 }

  // sky
  const skyU = skyUniforms()
  const PAL_A = toCol(SKY_A)
  const PAL_B = toCol(SKY_B)
  const moon = { el0: 5 * DEG, az: AZ_FINAL + Math.PI, rad: 0.02 }

  // the cloud bank we sink through at the start: rest pose + how far each puff parts
  let upperBase = new Float32Array(0)
  let upperPush = new Float32Array(0)
  let upperRad = new Float32Array(0)
  let upperYaw = new Float32Array(0)
  let upperPart = -1

  // scratch
  const _dir = new THREE.Vector3()
  const _f = new THREE.Vector3()
  const _r = new THREE.Vector3()
  const _u = new THREE.Vector3()
  const _t = new THREE.Vector3()
  const _v = new THREE.Vector3()
  const _w = new THREE.Vector3()
  const _pv = new THREE.Vector3()
  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _s = new THREE.Vector3()
  const fitCam = new THREE.PerspectiveCamera(16, 1, 0.1, 3000)
  const lanternWorld = new THREE.Vector3()

  /** camera position + target for a pose (target offset sideways/up in screen space from `pivot`) */
  function pose(el: number, az: number, dist: number, sx: number, sy: number, pos: THREE.Vector3, target: THREE.Vector3, pivot = PIVOT) {
    _dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    _f.copy(_dir).negate()
    _r.crossVectors(_f, Y).normalize()
    _u.crossVectors(_r, _f)
    target.copy(pivot).addScaledVector(_r, sx).addScaledVector(_u, sy)
    pos.copy(target).addScaledVector(_dir, dist)
  }

  function placeFitCam(el: number, az: number, f: Fit, W: number, H: number, pivot = PIVOT) {
    fitCam.fov = fov
    fitCam.aspect = W / Math.max(1, H)
    fitCam.updateProjectionMatrix()
    pose(el, az, f.dist, f.sx, f.sy, fitCam.position, _t, pivot)
    fitCam.up.set(0, 1, 0)
    fitCam.lookAt(_t)
    fitCam.updateMatrixWorld(true)
  }

  const toPx = (p: THREE.Vector3, W: number, H: number) => {
    _v.copy(p).project(fitCam)
    return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H] as const
  }

  /**
   * Solve distance + screen-space target offset so `pts` fill `rect`
   * (contain). With `eye`, the pitch is solved too so the camera sits at
   * world height `eye` (the horizon crosses the tower there).
   */
  function solveFit(rect: Rect, W: number, H: number, az: number, out: Fit, pts: THREE.Vector3[], pivot: THREE.Vector3, eye?: number) {
    const pad = clamp(Math.min(rect.x1 - rect.x0, rect.y1 - rect.y0) * 0.05, 8, 36)
    const r = { x0: rect.x0 + pad, x1: rect.x1 - pad, y0: rect.y0 + pad, y1: rect.y1 - pad }
    const rw = Math.max(30, r.x1 - r.x0)
    const rh = Math.max(30, r.y1 - r.y0)
    const cx = (r.x0 + r.x1) / 2
    const cy = (r.y0 + r.y1) / 2
    const tanH = Math.tan((fov * DEG) / 2)
    out.dist = 70
    out.sx = 0
    out.sy = 0
    for (let it = 0; it < 14; it++) {
      placeFitCam(out.el, az, out, W, H, pivot)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of pts) {
        const [x, y] = toPx(p, W, H)
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
      const wpp = (2 * out.dist * tanH) / H
      out.sx -= (cx - (minX + maxX) / 2) * wpp
      out.sy += (cy - (minY + maxY) / 2) * wpp
      const s = Math.max((maxX - minX) / rw, (maxY - minY) / rh)
      if (Number.isFinite(s) && s > 0) out.dist *= s
      if (eye !== undefined) {
        // pitch so that world height `eye` at the island projects onto the horizon
        _w.set(lanternWorld.x, eye, lanternWorld.z)
        const [, yc] = toPx(_w, W, H)
        const want = ((H / 2 - yc) / (H / 2)) * tanH
        out.el = clamp(out.el + (Math.atan(want) - out.el) * 0.8, -3 * DEG, 12 * DEG)
      }
    }
    if (!Number.isFinite(out.dist + out.sx + out.sy + out.el)) {
      out.dist = 70
      out.sx = 0
      out.sy = 0
    }
  }

  // ---------------------------------------------------------------- layout → fits
  function refit(frame: Frame) {
    if (!hud || !S) return
    const W = frame.width
    const H = frame.height
    const key = `${W}x${H}`
    if (!hud.dirty && key === fitKey && layout) return
    hud.dirty = false
    fitKey = key
    layout = measureHud(hud, W, H)
    fov = layout.portrait ? 19 : 16
    const art = layout.art
    const safeTop = hud.probe.getBoundingClientRect().top

    // the plate, for the world's keep-out
    keep.x0 = (layout.plate.x0 / W) * 2 - 1
    keep.x1 = (layout.plate.x1 / W) * 2 - 1
    keep.y0 = 1 - (layout.plate.y1 / H) * 2
    keep.y1 = 1 - (layout.plate.y0 / H) * 2

    // hold
    tgtHold.el = (EL_HOLD + EL_HOLD_END) / 2
    solveFit(art, W, H, AZ_HOLD, tgtHold, worldFit, PIVOT)
    focus.hold.y = 1 - (art.y0 + art.y1) / 2 / H
    focus.hold.band = clamp(((art.y1 - art.y0) / H) * 0.24, 0.1, 0.22)

    // the lamp-room close-up: the room fills the middle of the art rect
    {
      const aw = art.x1 - art.x0
      const ah = art.y1 - art.y0
      const ccx = (art.x0 + art.x1) / 2
      const ccy = (art.y0 + art.y1) / 2 - (layout.portrait ? 0 : ah * 0.03)
      const fw = aw * (layout.portrait ? 0.78 : 0.56)
      const fh = ah * (layout.portrait ? 0.84 : 0.66)
      const cr: Rect = { x0: ccx - fw / 2, x1: ccx + fw / 2, y0: ccy - fh / 2, y1: ccy + fh / 2 }
      tgtClose.el = EL_CLOSE
      solveFit(cr, W, H, AZ_CLOSE, tgtClose, roomFit, ROOM)
      focus.close.y = 1 - ccy / H
      focus.close.band = clamp((fh / H) * 0.62, 0.16, 0.34)
    }

    // finale: leave room for the sign-off at the top of the art rect
    const nightTop = Math.max(safeTop, art.y0)
    const fr: Rect = { ...art, y0: nightTop + layout.nightH + (layout.portrait ? 10 : 22) }
    tgtFinal.el = 1 * DEG
    solveFit(fr, W, H, AZ_FINAL, tgtFinal, worldFit, PIVOT, EYE_Y)
    focus.final.y = 1 - (fr.y0 + fr.y1) / 2 / H
    focus.final.band = clamp(((fr.y1 - fr.y0) / H) * 0.5, 0.18, 0.36)

    // sign-off: centred over the island, at the top of the art rect
    placeFitCam(tgtFinal.el, AZ_FINAL, tgtFinal, W, H)
    const [lx, ly] = toPx(lanternWorld, W, H)
    const half = hud.night.offsetWidth / 2 + 6
    hud.night.style.left = `${Math.round(clamp(lx, art.x0 + half, Math.max(art.x0 + half, art.x1 - half)))}px`
    hud.night.style.top = `${Math.round(nightTop)}px`

    // the moon: beside the lantern in the final frame, inside the art rect
    const mr = clamp(Math.min(fr.x1 - fr.x0, fr.y1 - fr.y0) * 0.1, 22, 64)
    const roomR = fr.x1 - lx
    const roomL = lx - fr.x0
    const side = roomR >= roomL ? 1 : -1
    const mx = clamp(lx + side * mr * 2.1, fr.x0 + mr + 6, fr.x1 - mr - 6)
    const my = clamp(ly - mr * 0.9, fr.y0 + mr + 4, fr.y1 - mr)
    _v.set((mx / W) * 2 - 1, -((my / H) * 2 - 1), 0.5).unproject(fitCam).sub(fitCam.position).normalize()
    moon.el0 = Math.asin(clamp(_v.y, -1, 1))
    moon.az = Math.atan2(_v.x, _v.z)
    moon.rad = (mr / H) * fov * DEG

    placeUpperClouds(W, H)
    if (!fitted) {
      Object.assign(fitHold, tgtHold)
      Object.assign(fitFinal, tgtFinal)
      Object.assign(fitClose, tgtClose)
      fitted = true
    }
  }

  function dampFits(dt: number) {
    const k = 1 - Math.exp(-5 * Math.min(dt, 0.1))
    for (const [c, t] of [
      [fitHold, tgtHold],
      [fitFinal, tgtFinal],
      [fitClose, tgtClose],
    ] as [Fit, Fit][]) {
      c.dist += (t.dist - c.dist) * k
      c.sx += (t.sx - c.sx) * k
      c.sy += (t.sy - c.sy) * k
      c.el += (t.el - c.el) * k
    }
  }

  /** the cloud bank the camera sinks through at the start (rest pose; applyUpper parts it) */
  function placeUpperClouds(W: number, H: number) {
    const p = camParams(0.03, tgtHold, tgtFinal, tgtClose)
    placeFitCam(p.el, p.az, { dist: p.dist, sx: p.sx, sy: p.sy, el: p.el }, W, H)
    const P = fitCam.position
    fitCam.getWorldDirection(_f)
    _r.crossVectors(_f, Y).normalize()
    _u.crossVectors(_r, _f)
    const tanH = Math.tan((fov * DEG) / 2)
    const aspect = W / Math.max(1, H)
    const n = S.upper.count
    if (upperBase.length !== n * 3) {
      upperBase = new Float32Array(n * 3)
      upperPush = new Float32Array(n * 3)
      upperRad = new Float32Array(n)
      upperYaw = new Float32Array(n)
    }
    let seed = 11
    const rnd = () => hash(seed++)
    for (let i = 0; i < n; i++) {
      // a ring round the view: the island shows through the middle, and the
      // bank slides outward (parts) as the wipe opens
      const z = lerp(14, 40, rnd())
      const hh = z * tanH
      const hw = hh * aspect
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5
      const rr = lerp(0.62, 1.15, rnd())
      const cx = Math.cos(a)
      const cy = Math.sin(a)
      _v.copy(P).addScaledVector(_f, z).addScaledVector(_r, cx * hw * rr).addScaledVector(_u, cy * hh * rr)
      upperBase.set([_v.x, _v.y, _v.z], i * 3)
      _w.set(0, 0, 0).addScaledVector(_r, cx * hw * 1.7).addScaledVector(_u, cy * hh * 1.7)
      upperPush.set([_w.x, _w.y, _w.z], i * 3)
      upperRad[i] = hh * lerp(0.32, 0.55, rnd())
      upperYaw[i] = rnd() * 6.28
    }
    upperPart = -1
  }

  /** part the bank: clear of the frame by ~0.09, as the cut's wipe opens */
  function applyUpper(l: number) {
    const part = ease.inOutQuad(segment(l, 0.01, 0.092))
    if (part === upperPart) return
    upperPart = part
    S.upper.visible = part < 1
    if (part >= 1) return
    const n = S.upper.count
    for (let i = 0; i < n; i++) {
      _v.set(upperBase[i * 3], upperBase[i * 3 + 1], upperBase[i * 3 + 2])
      _v.x += upperPush[i * 3] * part
      _v.y += upperPush[i * 3 + 1] * part
      _v.z += upperPush[i * 3 + 2] * part
      const rad = upperRad[i] * (1 - 0.2 * part)
      _s.set(rad, rad * 0.8, rad)
      _q.setFromAxisAngle(Y, upperYaw[i])
      _m.compose(_v, _q, _s)
      S.upper.setMatrixAt(i, _m)
    }
    S.upper.instanceMatrix.needsUpdate = true
  }

  // ---------------------------------------------------------------- camera timeline
  /**
   * Pure function of local progress (+ the layout fits): descent from the
   * cloud bank, a slow drone drift through the hold, in to the lamp room,
   * then back out at eye level.
   */
  function camParams(l: number, fh: Fit = fitHold, ff: Fit = fitFinal, fc: Fit = fitClose) {
    const kd = ease.inOutCubic(segment(l, 0, 0.27))
    const kh = segment(l, 0.27, 0.74)
    const kf = ease.inOutCubic(segment(l, 0.72, 0.95))
    const ko = smoothstep(0.08, 0.26, l)
    let el = kd < 1 ? lerp(EL_START, EL_HOLD, kd) : lerp(EL_HOLD, EL_HOLD_END, kh)
    el = lerp(el, ff.el, kf)
    let az = AZ_HOLD - 0.62 * (1 - kd) - 0.1 + 0.2 * kh
    az = lerp(az, AZ_FINAL, kf)
    let dist = lerp(fh.dist * lerp(1.9, 1, kd) * (1 - 0.05 * kh), ff.dist, kf)
    let sx = lerp(fh.sx * ko, ff.sx, kf)
    let sy = lerp(fh.sy * ko, ff.sy, kf)
    // the haze keeps the wide shot's scale through the close-up
    const baseDist = dist
    const kc = closeK(l)
    if (kc > 0) {
      el = lerp(el, fc.el, kc)
      az = lerp(az, AZ_CLOSE, kc)
      dist = Math.exp(lerp(Math.log(Math.max(1, dist)), Math.log(Math.max(1, fc.dist)), kc))
      sx = lerp(sx, fc.sx, kc)
      sy = lerp(sy, fc.sy, kc)
    }
    const pivot = _pv.copy(PIVOT).lerp(ROOM, kc)
    return { el, az, dist, sx, sy, kd, kh, kf, ko, kc, baseDist, pivot }
  }

  // ---------------------------------------------------------------- per-frame helpers
  const ledOn: boolean[] = []
  const ledCol = new THREE.Color()
  let lastLedGain = -1

  function lampOn(l: number) {
    const f = segment(l, 0.19, 0.235)
    if (f <= 0) return 0
    if (f >= 1) return 1
    return hash(Math.floor(f * 11)) > 0.42 ? 0.35 + 0.65 * f : 0.06
  }

  /** a boat sailing a circle on the cloud deck, riding its swells */
  function sail(boat: THREE.Group, t: number, radius: number, speed: number, phase: number, scale = 1, cx = 0, cz = 0) {
    const a = t * speed + phase
    const dirn = Math.sign(speed) || 1
    const x = cx + Math.sin(a) * radius
    const z = cz + Math.cos(a) * radius
    boat.position.set(x, deckHeight(x, z) + 0.12 + Math.sin(t * 1.3 + phase) * 0.035, z)
    // tangent of travel (d/da of (sin, cos))
    const tx = Math.cos(a) * dirn
    const tz = -Math.sin(a) * dirn
    boat.rotation.set(0, 0, 0)
    boat.rotation.order = 'YXZ'
    boat.rotation.y = Math.atan2(-tz, tx)
    boat.rotation.x = -0.1 * dirn + Math.sin(t * 1.1 + phase) * 0.04
    boat.rotation.z = Math.sin(t * 0.9 + phase) * 0.035
    boat.scale.setScalar(scale)
  }

  function updateSmoke(t: number) {
    const n = S.smoke.count
    for (let i = 0; i < n; i++) {
      const ph = (t * (reduced ? 0.12 : 0.22) + i / n) % 1
      const k = Math.sin(Math.PI * Math.min(1, ph * 1.1))
      const s = 0.035 + 0.15 * k * (1 - ph * 0.35)
      _v.copy(S.smokeOrigin).add(_w.set(ph * 0.55 + Math.sin(ph * 6 + i) * 0.05, ph * 1.35, -ph * 0.2))
      _q.identity()
      _s.set(s, s * 0.9, s)
      _m.compose(_v, _q, _s)
      S.smoke.setMatrixAt(i, _m)
    }
    S.smoke.instanceMatrix.needsUpdate = true
  }

  // ---------------------------------------------------------------- chapter
  return {
    id: 'contact',
    group,
    anchors: [0.3],

    async init(ctx: ChapterContext) {
      reduced = ctx.reducedMotion
      mobile = ctx.mobile
      hud = buildHud(ctx.stage)

      const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 32), skyMaterial(skyU))
      sky.frustumCulled = false
      sky.renderOrder = -9
      group.add(sky)

      S = await buildScene(group, mobile)
      S.island.rotation.y = ISLAND_YAW
      group.updateMatrixWorld(true)
      lanternWorld.copy(LANTERN).applyMatrix4(S.island.matrixWorld)
      worldFit = S.fitPoints.map(p => p.clone().applyMatrix4(S.island.matrixWorld))
      // the lamp room: gallery rail, a band of tower below it, the vane on top
      const room: THREE.Vector3[] = []
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        room.push(new THREE.Vector3(LANTERN.x + Math.cos(a) * 0.98, GALLERY_Y + 0.3, LANTERN.z + Math.sin(a) * 0.98))
        room.push(new THREE.Vector3(LANTERN.x + Math.cos(a) * 0.56, GALLERY_Y - 0.45, LANTERN.z + Math.sin(a) * 0.56))
      }
      room.push(new THREE.Vector3(LANTERN.x, LH_TOP, LANTERN.z))
      roomFit = room.map(p => p.applyMatrix4(S.island.matrixWorld))
      for (let i = 0; i < S.leds.count; i++) ledOn.push(false)
    },

    update(l, frame, ctx) {
      refit(frame)
      dampFits(frame.dt)
      const t = frame.time
      const w = ctx.world.params
      const post = ctx.post.params
      const cp = camParams(l)

      // ---- time of day: sunset → dusk
      w.time = l < 0.25 ? lerp(0.84, 0.9, l / 0.25) : lerp(0.9, 1, smoothstep(0.25, 0.93, l))
      w.sun = lerp(1, 0.42, smoothstep(0.4, 0.95, l))
      w.focus.set(0, 0, 0)
      w.shadowSize = mobile ? 10 : 11
      // this island brings its own sea of clouds and sky
      w.clouds = 0
      w.sea = 0
      // the keeper switches the lights on as we arrive
      w.glow = lerp(0.2, 1, smoothstep(0.1, 0.14, l))
      const dusk = smoothstep(0.25, 0.92, l)
      // the copy plate, for the world's far field (while it is up)
      publishKeepOut(w, l > 0.165 ? keep : noKeep)

      // ---- sky
      const ks = smoothstep(0.3, 0.93, l)
      skyU.uSea.value.lerpColors(PAL_A.sea, PAL_B.sea, ks)
      skyU.uGlow.value.lerpColors(PAL_A.glow, PAL_B.glow, ks)
      skyU.uBelt.value.lerpColors(PAL_A.belt, PAL_B.belt, ks)
      skyU.uLow.value.lerpColors(PAL_A.low, PAL_B.low, ks)
      skyU.uHigh.value.lerpColors(PAL_A.high, PAL_B.high, ks)
      skyU.uStars.value = smoothstep(0.8, 0.92, l)
      skyU.uTime.value = t
      skyU.uPx.value = (fov * DEG) / Math.max(1, ctx.renderer.domElement.height)
      _v.copy(ctx.world.sun.position).sub(ctx.world.sun.target.position)
      if (_v.lengthSq() > 1e-6) skyU.uSunDir.value.copy(_v.normalize())
      // the moon rises out of the far clouds as the camera pulls back
      const km = ease.inOutQuad(segment(l, 0.85, 0.99))
      const mel = lerp(-moon.rad * 1.4, moon.el0, km)
      const md = skyU.uMoonDir.value.set(Math.sin(moon.az) * Math.cos(mel), Math.sin(mel), Math.cos(moon.az) * Math.cos(mel))
      skyU.uMoonU.value.crossVectors(Y, md).normalize()
      skyU.uMoonV.value.crossVectors(md, skyU.uMoonU.value).normalize()
      skyU.uMoonR.value = moon.rad
      skyU.uMoon.value = smoothstep(0.8, 0.84, l)

      // ---- the cloud deck melts into the sky's own below-horizon colour
      S.deck.update({
        time: t,
        breath: reduced ? 0 : 1,
        sea: skyU.uSea.value,
        glow: skyU.uGlow.value,
        dist: cp.baseDist,
        lift: lerp(0.26, 0.13, dusk),
        massLift: lerp(0.14, 0.24, dusk),
      })
      applyUpper(l)

      // ---- lights on
      const lamp = lampOn(l)
      const beamOn = smoothstep(0.215, 0.29, l) * (lamp > 0.5 ? 1 : 0.2)
      S.markMat.emissiveIntensity = lamp * lerp(1.15, 1.45, dusk)
      S.glassMat.emissiveIntensity = lamp * lerp(0.035, 0.07, dusk)
      S.beamMat.uniforms.uI.value = beamOn * lerp(0.6, 1.3, dusk)
      for (const s of S.spots) s.intensity = beamOn * lerp(10, 48, dusk)
      const ledGain = Math.round(lerp(1.6, 2.6, dusk) * 20) / 20
      let ledDirty = ledGain !== lastLedGain
      lastLedGain = ledGain
      for (let i = 0; i < S.leds.count; i++) {
        const on = l > 0.15 + S.ledOrder[i] * 0.05
        if (on !== ledOn[i] || ledDirty) {
          ledOn[i] = on
          if (on) ledCol.setRGB(0.12 * ledGain, 1.25 * ledGain, 0.55 * ledGain)
          else ledCol.setRGB(0.05, 0.08, 0.06)
          S.leds.setColorAt(i, ledCol)
          ledDirty = true
        }
      }
      if (ledDirty && S.leds.instanceColor) S.leds.instanceColor.needsUpdate = true

      // ---- the lens turns (the beams sweep); the mark turns to face us, with
      // its glow just behind it so the silhouette holds; the lamp flares when
      // a beam faces us
      const spin = t * (reduced ? 0.22 : 0.5) + 0.8
      S.beamPivot.rotation.y = spin
      pose(cp.el, cp.az, cp.dist, cp.sx, cp.sy, _v, _w, cp.pivot)
      _v.sub(lanternWorld).setY(0).normalize()
      S.mark.rotation.y = Math.atan2(_v.x, _v.z) + (reduced ? 0 : Math.sin(t * 0.4) * 0.07)
      S.glow.position.copy(LANTERN).addScaledVector(_v, -0.32)
      _t.set(Math.cos(spin), 0, -Math.sin(spin)) // warm beam direction (pivot +x)
      const fa = Math.max(0, _t.dot(_v))
      const fb = Math.max(0, -_t.dot(_v))
      const flare = Math.pow(Math.max(fa, fb), 18) * beamOn
      const gk = lamp * (0.2 + 0.24 * dusk) + flare * 0.45
      ;(S.glow.material as THREE.SpriteMaterial).color.setRGB(gk * 0.7, gk * 1.2, gk * 0.82)
      S.glow.scale.setScalar(2.3 + 0.8 * dusk + flare * 0.5)
      S.glow.visible = gk > 0.01

      // ---- life
      updateSmoke(t)
      const bs = reduced ? 0.4 : 1
      sail(S.sailboat, t, 10.6, 0.05 * bs, 2.2, 1.6)
      // a distant sail on a wide loop well behind the island
      if (S.farBoat) sail(S.farBoat, t, 13, -0.03 * bs, 0.6, 2.2, -3.2, -34)
      S.rowboat.position.y = S.rowboatAt.y + Math.sin(t * 1.4) * 0.03 * bs
      S.rowboat.rotation.z = Math.sin(t * 1.1) * 0.06 * bs
      // the walker strolls between the door and the jetty
      {
        const period = 26
        const u = (t / period) % 1
        const pp = u < 0.5 ? u * 2 : 2 - u * 2
        const k = ease.inOutQuad(pp)
        const u2 = lerp(0.12, 0.93, k)
        S.walkPath.getPointAt(u2, _v)
        S.walker.position.set(_v.x, _v.y + Math.abs(Math.sin(t * 8.5)) * 0.035 * bs, _v.z)
        S.walkPath.getTangentAt(u2, _w)
        if (u >= 0.5) _w.negate()
        S.walker.rotation.y = Math.atan2(_w.x, _w.z)
      }
      S.keeper.rotation.y = KEEPER_A + Math.sin(t * 0.35) * 0.7 * bs
      S.keeper.position.y = GALLERY_Y + 0.1 + Math.abs(Math.sin(t * 0.9)) * 0.012

      // ---- the post box: flag up while the address has your attention; a hop on copy
      const since = (performance.now() - hud.copiedAt) / 1000
      const flagUp = hud.hover || since < 2.2 ? 1 : 0
      const cur = S.mailFlag.rotation.x
      const want = (1 - flagUp) * Math.PI * 0.5
      S.mailFlag.rotation.x = reduced ? want : cur + (want - cur) * (1 - Math.exp(-9 * frame.dt))
      const hop = since < 0.5 && !reduced ? Math.sin(Math.PI * (since / 0.5)) : 0
      S.mailbox.position.y = hop * 0.16
      S.mailbox.scale.set(1.35 * (1 + hop * 0.06), 1.35 * (1 - hop * 0.08), 1.35 * (1 + hop * 0.06))

      // ---- post: the miniature lens; the focus band follows the island (then the lamp)
      const kc = cp.kc
      post.focusY = lerp(lerp(lerp(0.5, focus.hold.y, cp.ko), focus.final.y, cp.kf), focus.close.y, kc)
      post.band = lerp(lerp(lerp(0.2, focus.hold.band, cp.ko), focus.final.band, cp.kf), focus.close.band, kc)
      post.blur = lerp(lerp(mobile ? 6.5 : 8.5, 3.5, cp.kf), 3, kc)
      post.sat = 1.1
      post.exposure = lerp(1, 0.9, smoothstep(0.5, 0.95, l))
      post.bloomStrength = lerp(0.42, 0.85, dusk) * (1 - 0.3 * kc)
      post.bloomRadius = 0.55
      post.bloomThreshold = 0.95
      post.vignette = lerp(0.3, 0.44, dusk)
      post.grain = 0.03

      // ---- HUD
      const tog = (n: HTMLElement, on: boolean) => {
        if (n.classList.contains('is-in') !== on) n.classList.toggle('is-in', on)
      }
      tog(hud.plate, l > 0.165)
      tog(hud.eyebrow, l > 0.175)
      setRise(hud.title, l > 0.185)
      tog(hud.body, l > 0.2)
      tog(hud.cta, l > 0.21)
      tog(hud.links, l > 0.22)
      tog(hud.foot, l > 0.23)
      tog(hud.night, l > 0.905)
      setRise(hud.nightText, l > 0.905)
    },

    camera(l: number, frame: Frame, out: CameraPose) {
      refit(frame)
      const p = camParams(l)
      pose(p.el, p.az, p.dist, p.sx, p.sy, out.position, out.target, p.pivot)
      // a lazy drone sway during the hold
      if (!reduced) {
        const sway = (1 - p.kf) * (1 - p.kc)
        out.position.y += Math.sin(frame.time * 0.35) * 0.35 * sway
        out.position.x += Math.sin(frame.time * 0.23) * 0.4 * sway
      }
      out.fov = fov
      out.roll = 0
      out.parallax = reduced ? 0 : 0.7 * (1 - 0.6 * p.kc)
    },
  }
}
