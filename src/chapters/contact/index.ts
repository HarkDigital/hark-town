import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { setRise } from '../../core/dom'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { buildHud, measureHud, type Hud, type HudLayout, type Rect } from './hud'
import { buildScene, LANTERN, type LighthouseScene } from './build'
import { skyMaterial, skyUniforms } from './shaders'
import './contact.css'

/*
 * LIGHTHOUSE — the last island (1.5 vh, nav lands at 0.3). Sunset → dusk.
 *
 *   0.00–0.27  the camera sinks out of a cloud bank onto a rocky islet in a
 *              sea of clouds; windows light (0.12), the little green LED
 *              lamps come on down the path (0.15–0.2), the lantern flickers
 *              on (0.19–0.235): the Hark mark glows green and two beams —
 *              warm and green — start sweeping the clouds
 *   0.17–0.23  the signage plate pops up: Say hello. · the address · copy ·
 *              sister sites · back to top · colophon
 *   0.27–0.74  hold: a slow drone orbit; sailboats on the clouds, gulls
 *              round the lantern, smoke from the keeper's chimney
 *   0.72–0.95  the camera lowers to eye level: the sky comes into frame,
 *              the Belt of Venus, a full moon rises out of the clouds, the
 *              stars come out (dusk, time 1)
 *   0.86       "Goodnight from Hark Town"
 */

const DEG = Math.PI / 180
const ISLAND_YAW = 0
/** camera azimuth: the camera sits at (sin az, cos az) from the island */
const AZ_HOLD = -0.3
const AZ_FINAL = 0.5
const EL_START = 60 * DEG
const EL_HOLD = 25 * DEG
const EL_HOLD_END = 20.5 * DEG
/** in the finale the camera settles at this height: the lantern stands against the sky */
const EYE_Y = 2.35
const PIVOT = new THREE.Vector3(0, 2.1, 0)
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
  const fitHold: Fit = { ...tgtHold }
  const fitFinal: Fit = { ...tgtFinal }
  let fitted = false
  const focus = { hold: { y: 0.5, band: 0.2 }, final: { y: 0.5, band: 0.3 } }
  let fitKey = ''
  let worldFit: THREE.Vector3[] = []

  // sky
  const skyU = skyUniforms()
  const PAL_A = toCol(SKY_A)
  const PAL_B = toCol(SKY_B)
  const moon = { el0: 5 * DEG, az: AZ_FINAL + Math.PI, rad: 0.02 }

  // scratch
  const _dir = new THREE.Vector3()
  const _f = new THREE.Vector3()
  const _r = new THREE.Vector3()
  const _u = new THREE.Vector3()
  const _t = new THREE.Vector3()
  const _v = new THREE.Vector3()
  const _w = new THREE.Vector3()
  const _m = new THREE.Matrix4()
  const _q = new THREE.Quaternion()
  const _s = new THREE.Vector3()
  const fitCam = new THREE.PerspectiveCamera(16, 1, 0.1, 3000)
  const lanternWorld = new THREE.Vector3()

  /** camera position + target for a pose (target offset sideways/up in screen space) */
  function pose(el: number, az: number, dist: number, sx: number, sy: number, pos: THREE.Vector3, target: THREE.Vector3) {
    _dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
    _f.copy(_dir).negate()
    _r.crossVectors(_f, Y).normalize()
    _u.crossVectors(_r, _f)
    target.copy(PIVOT).addScaledVector(_r, sx).addScaledVector(_u, sy)
    pos.copy(target).addScaledVector(_dir, dist)
  }

  function placeFitCam(el: number, az: number, f: Fit, W: number, H: number) {
    fitCam.fov = fov
    fitCam.aspect = W / Math.max(1, H)
    fitCam.updateProjectionMatrix()
    pose(el, az, f.dist, f.sx, f.sy, fitCam.position, _t)
    fitCam.up.set(0, 1, 0)
    fitCam.lookAt(_t)
    fitCam.updateMatrixWorld(true)
  }

  const toPx = (p: THREE.Vector3, W: number, H: number) => {
    _v.copy(p).project(fitCam)
    return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H] as const
  }

  /**
   * Solve distance + screen-space target offset so the island's fit points
   * fill `rect` (contain). With `eye`, the pitch is solved too so the camera
   * sits at world height `eye` (the horizon crosses the tower there).
   */
  function solveFit(rect: Rect, W: number, H: number, az: number, out: Fit, eye?: number) {
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
      placeFitCam(out.el, az, out, W, H)
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const p of worldFit) {
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

    // hold
    tgtHold.el = (EL_HOLD + EL_HOLD_END) / 2
    solveFit(art, W, H, AZ_HOLD, tgtHold)
    focus.hold.y = 1 - (art.y0 + art.y1) / 2 / H
    focus.hold.band = clamp(((art.y1 - art.y0) / H) * 0.24, 0.1, 0.22)

    // finale: leave room for the sign-off at the top of the art rect
    const nightTop = Math.max(safeTop, art.y0)
    const fr: Rect = { ...art, y0: nightTop + layout.nightH + (layout.portrait ? 10 : 22) }
    tgtFinal.el = 1 * DEG
    solveFit(fr, W, H, AZ_FINAL, tgtFinal, EYE_Y)
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
      fitted = true
    }
  }

  function dampFits(dt: number) {
    const k = 1 - Math.exp(-5 * Math.min(dt, 0.1))
    for (const [c, t] of [
      [fitHold, tgtHold],
      [fitFinal, tgtFinal],
    ] as [Fit, Fit][]) {
      c.dist += (t.dist - c.dist) * k
      c.sx += (t.sx - c.sx) * k
      c.sy += (t.sy - c.sy) * k
      c.el += (t.el - c.el) * k
    }
  }

  /** the cloud bank the camera sinks through at the start */
  function placeUpperClouds(W: number, H: number) {
    const p = camParams(0.03, tgtHold, tgtFinal)
    placeFitCam(p.el, p.az, { dist: p.dist, sx: p.sx, sy: p.sy, el: p.el }, W, H)
    const P = fitCam.position
    fitCam.getWorldDirection(_f)
    _r.crossVectors(_f, Y).normalize()
    _u.crossVectors(_r, _f)
    const tanH = Math.tan((fov * DEG) / 2)
    const aspect = W / Math.max(1, H)
    const n = S.upper.count
    let seed = 11
    const rnd = () => hash(seed++)
    for (let i = 0; i < n; i++) {
      // a ring round the view: the island shows through the middle, and the
      // bank slides outward (parts) as the camera sinks toward it
      const z = lerp(14, 40, rnd())
      const hh = z * tanH
      const hw = hh * aspect
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5
      const rr = lerp(0.62, 1.15, rnd())
      const sx = Math.cos(a) * hw * rr
      const sy = Math.sin(a) * hh * rr
      _v.copy(P).addScaledVector(_f, z).addScaledVector(_r, sx).addScaledVector(_u, sy)
      const rad = hh * lerp(0.32, 0.55, rnd())
      _s.set(rad, rad * 0.8, rad)
      _q.setFromAxisAngle(Y, rnd() * 6.28)
      _m.compose(_v, _q, _s)
      S.upper.setMatrixAt(i, _m)
    }
    S.upper.instanceMatrix.needsUpdate = true
  }

  // ---------------------------------------------------------------- camera timeline
  /**
   * Pure function of local progress (+ the layout fits): descent from the
   * cloud bank, a slow drone drift through the hold, then down to eye level.
   */
  function camParams(l: number, fh: Fit = fitHold, ff: Fit = fitFinal) {
    const kd = ease.inOutCubic(segment(l, 0, 0.27))
    const kh = segment(l, 0.27, 0.74)
    const kf = ease.inOutCubic(segment(l, 0.72, 0.95))
    const ko = smoothstep(0.08, 0.26, l)
    let el = kd < 1 ? lerp(EL_START, EL_HOLD, kd) : lerp(EL_HOLD, EL_HOLD_END, kh)
    el = lerp(el, ff.el, kf)
    let az = AZ_HOLD - 0.62 * (1 - kd) - 0.1 + 0.2 * kh
    az = lerp(az, AZ_FINAL, kf)
    const dist = lerp(fh.dist * lerp(1.9, 1, kd) * (1 - 0.05 * kh), ff.dist, kf)
    const sx = lerp(fh.sx * ko, ff.sx, kf)
    const sy = lerp(fh.sy * ko, ff.sy, kf)
    return { el, az, dist, sx, sy, kd, kh, kf, ko }
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

  function sail(boat: THREE.Group, t: number, radius: number, speed: number, phase: number, scale = 1, cx = 0, cz = 0) {
    const a = t * speed + phase
    const dirn = Math.sign(speed) || 1
    boat.position.set(cx + Math.sin(a) * radius, -0.42 + Math.sin(t * 1.3 + phase) * 0.035, cz + Math.cos(a) * radius)
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
      // the moon rises out of the far clouds as the camera comes down
      const km = ease.inOutQuad(segment(l, 0.85, 0.99))
      const mel = lerp(-moon.rad * 1.4, moon.el0, km)
      const md = skyU.uMoonDir.value.set(Math.sin(moon.az) * Math.cos(mel), Math.sin(mel), Math.cos(moon.az) * Math.cos(mel))
      skyU.uMoonU.value.crossVectors(Y, md).normalize()
      skyU.uMoonV.value.crossVectors(md, skyU.uMoonU.value).normalize()
      skyU.uMoonR.value = moon.rad
      skyU.uMoon.value = smoothstep(0.8, 0.84, l)

      // ---- the sea of clouds melts into the far sky colour
      S.puffU.uTime.value = t
      S.puffU.uBreath.value = reduced ? 0 : 1
      S.puffU.uHaze.value.copy(skyU.uSea.value).lerp(skyU.uGlow.value, 0.3)
      S.puffU.uHazeNear.value = cp.dist * 1.1
      S.puffU.uHazeFar.value = cp.dist * 2.7
      S.upper.visible = l < 0.3

      // ---- lights on
      const lamp = lampOn(l)
      const beamOn = smoothstep(0.215, 0.29, l) * (lamp > 0.5 ? 1 : 0.2)
      S.markMat.emissiveIntensity = lamp * lerp(1.5, 2.3, dusk)
      S.glassMat.emissiveIntensity = lamp * lerp(0.08, 0.18, dusk)
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

      // ---- the lens turns: beams sweep; the lamp flares when one faces us
      const spin = t * (reduced ? 0.22 : 0.5) + 0.8
      S.beamPivot.rotation.y = spin
      S.mark.rotation.y = spin
      _t.set(Math.cos(spin), 0, -Math.sin(spin)) // warm beam direction (pivot +x)
      pose(cp.el, cp.az, cp.dist, cp.sx, cp.sy, _v, _w)
      _v.sub(lanternWorld).setY(0).normalize()
      const fa = Math.max(0, _t.dot(_v))
      const fb = Math.max(0, -_t.dot(_v))
      const flare = Math.pow(Math.max(fa, fb), 18) * beamOn
      const gk = lamp * (0.22 + 0.3 * dusk) + flare * 0.55
      ;(S.glow.material as THREE.SpriteMaterial).color.setRGB(gk * 0.75, gk * 1.25, gk * 0.85)
      S.glow.scale.setScalar(2.0 + 0.8 * dusk + flare * 0.5)
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
      S.keeper.rotation.y = 0.75 + Math.sin(t * 0.35) * 0.7 * bs
      S.keeper.position.y = 4.6 + Math.abs(Math.sin(t * 0.9)) * 0.012

      // ---- the post box: flag up while the address has your attention; a hop on copy
      const since = (performance.now() - hud.copiedAt) / 1000
      const flagUp = hud.hover || since < 2.2 ? 1 : 0
      const cur = S.mailFlag.rotation.x
      const want = (1 - flagUp) * Math.PI * 0.5
      S.mailFlag.rotation.x = reduced ? want : cur + (want - cur) * (1 - Math.exp(-9 * frame.dt))
      const hop = since < 0.5 && !reduced ? Math.sin(Math.PI * (since / 0.5)) : 0
      S.mailbox.position.y = hop * 0.16
      S.mailbox.scale.set(1.35 * (1 + hop * 0.06), 1.35 * (1 - hop * 0.08), 1.35 * (1 + hop * 0.06))

      // ---- post: the miniature lens; the focus band follows the island
      const fy = lerp(lerp(0.5, focus.hold.y, cp.ko), focus.final.y, cp.kf)
      post.focusY = fy
      post.band = lerp(lerp(0.2, focus.hold.band, cp.ko), focus.final.band, cp.kf)
      post.blur = lerp(mobile ? 6.5 : 8.5, 3.5, cp.kf)
      post.sat = 1.1
      post.exposure = lerp(1, 0.9, smoothstep(0.5, 0.95, l))
      post.bloomStrength = lerp(0.42, 0.85, dusk)
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
      tog(hud.night, l > 0.86)
      setRise(hud.nightText, l > 0.86)
    },

    camera(l: number, frame: Frame, out: CameraPose) {
      refit(frame)
      const p = camParams(l)
      pose(p.el, p.az, p.dist, p.sx, p.sy, out.position, out.target)
      // a lazy drone sway during the hold
      if (!reduced) {
        const sway = 1 - p.kf
        out.position.y += Math.sin(frame.time * 0.35) * 0.35 * sway
        out.position.x += Math.sin(frame.time * 0.23) * 0.4 * sway
      }
      out.fov = fov
      out.roll = 0
      out.parallax = reduced ? 0 : 0.7
    },
  }
}
