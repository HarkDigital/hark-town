import * as THREE from 'three'
import type { CameraPose, Chapter } from '../../core/types'
import { Callout, el, reveal, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, segment, smoothstep, window01 } from '../../core/math'
import { SECURITY, STATS } from '../../content'
import { T } from './timeline'
import { Town } from './town'
import { Storm } from './storm'
import { Dome } from './dome'
import { Glints, Rainbow } from './clear'
import { fract, hash1, nextFrame, pop } from './util'
import './shield.css'

/*
 * THE STORM — "Hacked? Breathe."
 *
 * A cosy little island town under a hack storm: red lightning crackles into
 * the houses, then the Hark beacon blows a green hex shield over everyone,
 * the bolts splash off it, the sky clears and a toy rainbow comes out.
 * See ./timeline.ts for the beat sheet.
 */

const STAT = STATS.find(s => s.value === '24/7') ?? STATS[STATS.length - 1]

/** dome radius (world units, centred on the island's grass) */
const DOME_R = 6.3
const FOV = 15
/** the rainbow faces the camera's azimuth around the CTA beat */
const RAINBOW_AZ = 0.2

/** storm bolts: which house they hit (for red windows) and which cloud fires them */
const STORM_BOLTS = [
  { house: 0, cloud: 0, dx: 0.3 },
  { house: 2, cloud: 2, dx: -0.4 },
  { house: 4, cloud: 5, dx: 0.5 },
  { house: 5, cloud: 4, dx: -0.2 },
]
/** dome bolts: impact direction on the dome (object space) and source cloud */
const DOME_BOLTS = [
  { dir: new THREE.Vector3(-0.42, 0.78, 0.46).normalize(), cloud: 0, dx: -0.6 },
  { dir: new THREE.Vector3(0.52, 0.74, 0.42).normalize(), cloud: 2, dx: 0.4 },
  { dir: new THREE.Vector3(0.05, 0.9, -0.1).normalize(), cloud: 1, dx: 0 },
]

const RED = new THREE.Color(3.2, 0.5, 0.3)
const MINT = new THREE.Color(0.9, 3.0, 1.4)
const CRACK_RED = new THREE.Color(2.6, 0.18, 0.12)
const CRACK_GREEN = new THREE.Color(0.25, 2.4, 0.9)
const UP = new THREE.Vector3(0, 1, 0)

/** portrait framing: copy below, island above */
const isPortrait = (w: number, h: number) => w / Math.max(1, h) < 0.84

/** gentle springy settle for the dome (≈9% overshoot) */
const inflateCurve = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-7 * u) * Math.cos(9 * u))

export default function create(): Chapter {
  const group = new THREE.Group()
  const town = new Town()
  const storm = new Storm()
  let dome: Dome
  let rainbow: Rainbow
  let glints: Glints
  let G = 0

  // DOM
  let stage: HTMLElement
  let copy: HTMLElement
  let probe: HTMLElement
  let eyebrow: HTMLElement
  let t1: HTMLElement
  let t2: HTMLElement
  let bodyCard: HTMLElement
  let watchCard: HTMLElement
  let alert: Callout
  let shieldTag: Callout
  let fresh = true

  // framing (recomputed on resize)
  const fit = { w: 0, h: 0, d: 60, sx: 0, sy: 0, el: 0.58, portrait: false, focusY: 0.5, band: 0.2 }
  const scratch = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400)
  const pose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: FOV, roll: 0, parallax: 0 }
  const tmpPose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: FOV, roll: 0, parallax: 0 }

  const _a = new THREE.Vector3()
  const _b = new THREE.Vector3()
  const pDir = new THREE.Vector3()
  const pRight = new THREE.Vector3()
  const pUp = new THREE.Vector3()
  const pFwd = new THREE.Vector3()
  const _col = new THREE.Color()
  const _dome = new THREE.Vector4()
  const _size = new THREE.Vector2()
  const flashes: number[] = [0, 0, 0, 0, 0, 0, 0]
  const hack: number[] = [0, 0, 0, 0, 0, 0, 0]

  /** sample points that must stay on screen (relative to the island) */
  const fitPoints: THREE.Vector3[] = []
  const fitPointsTall: THREE.Vector3[] = []

  function measure(w: number, h: number) {
    fit.w = w
    fit.h = h
    fit.portrait = isPortrait(w, h)
    fit.el = fit.portrait ? 0.62 : 0.56
    const pr = probe.getBoundingClientRect()
    const cr = copy.getBoundingClientRect()
    const safeTop = pr.top
    const safeBottom = h - pr.bottom
    const gutter = pr.left
    let x0: number, x1: number, y0: number, y1: number
    if (fit.portrait) {
      x0 = gutter * 0.4
      x1 = w - gutter * 0.4
      y0 = safeTop * 0.9
      y1 = Math.max(y0 + h * 0.2, cr.top - 8)
    } else {
      x0 = cr.right + w * 0.02
      x1 = w - gutter * 1.1
      y0 = safeTop * 0.5
      y1 = h - safeBottom * 0.45
    }
    // project the scene's key points from the reference pose at a known distance
    const d0 = 60
    scratch.aspect = w / Math.max(1, h)
    scratch.fov = FOV
    scratch.updateProjectionMatrix()
    const az = 0
    scratch.position.set(Math.cos(fit.el) * Math.sin(az), Math.sin(fit.el), Math.cos(fit.el) * Math.cos(az)).multiplyScalar(d0)
    scratch.position.y += G + 1.5
    scratch.lookAt(0, G + 1.5, 0)
    scratch.updateMatrixWorld(true)
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    // the dome's silhouette top (seen from the reference pose)
    const domeTop = _b.set(0, DOME_R * Math.cos(fit.el), -DOME_R * Math.sin(fit.el))
    for (const p of [...(fit.portrait ? fitPoints : fitPointsTall), domeTop]) {
      _a.copy(p).setY(p.y + G).project(scratch)
      minX = Math.min(minX, _a.x)
      maxX = Math.max(maxX, _a.x)
      minY = Math.min(minY, _a.y)
      maxY = Math.max(maxY, _a.y)
    }
    const rx0 = (x0 / w) * 2 - 1
    const rx1 = (x1 / w) * 2 - 1
    const ry0 = 1 - (y1 / h) * 2
    const ry1 = 1 - (y0 / h) * 2
    const k = Math.max((maxX - minX) / Math.max(0.05, rx1 - rx0), (maxY - minY) / Math.max(0.05, ry1 - ry0))
    fit.d = d0 * k
    fit.sx = (rx0 + rx1) / 2 - (minX + maxX) / 2 / k
    fit.sy = (ry0 + ry1) / 2 - (minY + maxY) / 2 / k
    // tilt-shift band: centred on the town, wide enough to hold it
    computePose(0.5, 0, tmpPose)
    applyScratch(tmpPose)
    _a.set(0, G + 0.6, 0).project(scratch)
    fit.focusY = clamp(_a.y * 0.5 + 0.5, 0.15, 0.85)
    fit.band = fit.portrait ? 0.13 : 0.19
  }

  function applyScratch(p: CameraPose) {
    scratch.position.copy(p.position)
    scratch.lookAt(p.target)
    scratch.updateMatrixWorld(true)
  }

  function computePose(local: number, time: number, out: CameraPose) {
    const inB = 1 - ease.outCubic(segment(local, 0, 0.12))
    const outB = ease.inCubic(segment(local, T.out[0], 1))
    const az = lerp(-0.36, 0.24, ease.inOutQuad(local)) + Math.sin(time * 0.07) * 0.015
    const el = fit.el + inB * 0.32 - outB * 0.28
    // gentle push-in through the storm, ease back out for the rainbow
    const push = 1 - 0.05 * window01(local, 0.12, 0.62, 0.2)
    const dist = fit.d * push * (1 + inB * 0.3)
    const ty = G + 1.5 + inB * 4.5 + outB * 6.5
    const dir = pDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
    out.target.set(0, ty, 0)
    out.position.copy(out.target).addScaledVector(dir, dist)
    // pan so the island sits in its region of the screen
    const right = pRight.set(Math.cos(az), 0, -Math.sin(az))
    const fwd = pFwd.copy(dir).negate()
    const camUp = pUp.crossVectors(right, fwd).normalize()
    const hh = dist * Math.tan((FOV * Math.PI) / 360)
    const hw = hh * (fit.w / Math.max(1, fit.h))
    const shift = right.multiplyScalar(-fit.sx * hw).addScaledVector(camUp, -fit.sy * hh)
    out.target.add(shift)
    out.position.add(shift)
    // a little kick when the dome pops
    const kick = window01(local, T.inflate[0], T.inflate[0] + 0.06, 0.02) * Math.sin(time * 40) * 0.05
    out.position.y += kick
    out.fov = FOV
    out.roll = 0
    out.parallax = fit.portrait ? 0.3 : 0.7
  }

  return {
    id: 'shield',
    group,

    async init(ctx) {
      stage = ctx.stage
      await town.build(ctx.mobile)
      G = town.ground
      group.add(town.group)
      await nextFrame()

      storm.build(ctx.mobile, G, 5.5)
      group.add(storm.group)
      await nextFrame()
      dome = new Dome(ctx.mobile)
      dome.mat.uniforms.uGround.value = G
      group.add(dome.mesh, dome.ring)
      await nextFrame()
      rainbow = new Rainbow(6.25, 0.155)
      group.add(rainbow.group)
      glints = new Glints(town.glintSpots)
      group.add(glints.points)

      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2
        fitPoints.push(new THREE.Vector3(Math.sin(a) * 6.4, 0, Math.cos(a) * 6.4))
      }
      fitPoints.push(new THREE.Vector3(0, -4.3, 0), new THREE.Vector3(0, DOME_R, 0), new THREE.Vector3(0, 5.6, -3))
      fitPointsTall.push(...fitPoints, new THREE.Vector3(-3.5, 7.2, -1.5), new THREE.Vector3(3.6, 7.0, -0.9))

      // ---------------------------------------------------------------- DOM
      const root = el('div', 'shd', undefined, stage)
      probe = el('div', 'shd-probe', undefined, root)
      copy = el('div', 'shd-copy', undefined, root)
      eyebrow = el('p', 'hud-eyebrow shd-eyebrow', SECURITY.eyebrow, copy)
      const title = el('h2', 'hud-title shd-title', undefined, copy)
      const [w1, w2] = SECURITY.title.split(/\s+(?=\S+$)/)
      t1 = rise(el('span', 'shd-line', undefined, title), w1 ?? 'Hacked?')
      t2 = rise(el('span', 'shd-line', undefined, title), `<em>${w2 ?? 'Breathe.'}</em>`)
      title.setAttribute('aria-label', SECURITY.title)
      const swap = el('div', 'shd-swap', undefined, copy)
      bodyCard = el('div', 'hud-panel shd-card shd-body', undefined, swap)
      el('p', 'hud-body', SECURITY.body, bodyCard)
      watchCard = el('div', 'hud-panel shd-card shd-watch', undefined, swap)
      const stat = el('div', 'shd-stat', undefined, watchCard)
      el('span', 'shd-num', STAT.value, stat)
      el('p', 'shd-stat-label', STAT.label, stat)
      const cta = el('a', 'hud-btn shd-cta', SECURITY.cta, watchCard)
      cta.href = SECURITY.href

      alert = new Callout(root, { side: 'right', offset: { x: 64, y: -58 } })
      alert.root.classList.add('shd-alert')
      alert.label.textContent = 'Intrusion detected'
      shieldTag = new Callout(root, { side: 'right', offset: { x: 58, y: -40 } })
      shieldTag.root.classList.add('shd-tag')
      shieldTag.label.textContent = 'Shield up'

      const relayout = () => {
        if (window.innerWidth > 0) measure(window.innerWidth, window.innerHeight)
      }
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(relayout).observe(copy)
      window.addEventListener('resize', relayout)
      document.fonts?.ready.then(relayout).catch(() => {})
      relayout()
    },

    onEnter() {
      fresh = true
    },

    update(local, frame, ctx) {
      if (frame.width !== fit.w || frame.height !== fit.h) measure(frame.width, frame.height)
      const rm = ctx.reducedMotion
      const pace = rm ? 0.25 : 1
      const time = frame.time
      const t = time * pace

      // ------------------------------------------------------------ phases
      const clearA = ease.inOutQuad(segment(local, T.clear[0], T.clear[1]))
      const stormA = lerp(0.4, 1, ease.outCubic(segment(local, T.stormIn[0], 0.16))) * (1 - clearA)
      const rain = segment(local, T.rainIn[0], T.rainIn[1]) * (1 - segment(local, T.rainOut[0], T.rainOut[1]))
      const inflate = segment(local, T.inflate[0], T.inflate[1])
      const heal = segment(local, T.heal[0], T.heal[1])
      const charge = segment(local, T.charge[0], T.charge[1]) * (1 - segment(local, 0.4, 0.5))
      const deflate = segment(local, T.deflate[0], T.deflate[1])
      const outB = segment(local, T.out[0], 1)

      computePose(local, time, tmpPose)
      applyScratch(tmpPose)
      const camPos = tmpPose.position

      // ------------------------------------------------------------ world + post
      const wp = ctx.world.params
      wp.time = lerp(0.62, 0.72, local)
      wp.storm = stormA
      wp.focus.set(0, G, 0)
      wp.shadowSize = 7.6
      wp.clouds = lerp(1, 0.3, stormA)
      const pp = ctx.post.params
      pp.exposure = 1 - 0.16 * stormA + 0.03 * clearA
      pp.sat = lerp(1.14, 0.86, stormA) + 0.05 * clearA
      pp.bloomStrength = 0.35 + 0.55 * stormA
      pp.bloomRadius = 0.45
      pp.vignette = 0.26 + 0.16 * stormA
      pp.focusY = fit.focusY + outB * 0.2
      pp.band = fit.band
      pp.blur = fit.portrait ? 5 : 7

      // ------------------------------------------------------------ bolts
      flashes.fill(0)
      hack.fill(0)
      let strikeEnv = 0
      STORM_BOLTS.forEach((b, i) => {
        const [a0, a1] = T.bolts[i]
        const pres = window01(local, a0, a1, 0.025)
        const ph = fract(t * 0.85 + i * 0.37)
        const env = rm ? 0.3 : Math.exp(-ph * 7)
        const crackle = rm ? 1 : hash1(Math.floor(t * 16) + i * 7.3) > 0.3 ? 1 : 0.35
        const amp = pres * (0.5 * crackle + 1.3 * env)
        const variant = rm ? i : Math.floor(t * 14 + i * 1.7)
        storm.cloudPoint(b.cloud, _a, b.dx)
        const E = town.hits[i]
        storm.bolts[i].set(_a, E, amp, variant, camPos)
        storm.setHit(i, E, UP, RED, pres, rm ? 1 : ph)
        flashes[b.cloud] += pres * env
        strikeEnv = Math.max(strikeEnv, pres * env)
        // the house it hit flickers red until the shield heals it
        hack[b.house] = Math.max(hack[b.house], segment(local, a0, a0 + 0.02) * (1 - heal))
        // glowing crack where it landed: pops in, heals green, then fades away
        const p = pop(segment(local, a0 + 0.005, a0 + 0.05))
        const fade = 1 - segment(heal, 0.55, 1)
        const flick = rm ? 1 : 0.8 + 0.2 * Math.sin(t * 13 + i * 3)
        _col.copy(CRACK_RED).lerp(CRACK_GREEN, smoothstep(0.0, 0.4, heal)).multiplyScalar(flick * (0.4 + 0.6 * fade))
        storm.setCrack(i, E, p * (0.75 + 0.25 * fade) * (fade > 0 ? 1 : 0), i * 1.3, _col)
      })

      // dome
      const dk = ease.inCubic(deflate)
      const du = inflateCurve(inflate) * (1 - dk)
      const domeOn = inflate > 0.0005 && du > 0.004
      const breathe = rm ? 1 : 1 + 0.006 * Math.sin(t * 1.4)
      const r = Math.max(0.02, DOME_R * du) * breathe
      const cy = lerp(lerp(town.crown.y, G, ease.outCubic(clamp(inflate * 1.25))), town.crown.y, dk)
      dome.mesh.visible = domeOn
      dome.mesh.position.set(0, cy, 0)
      dome.mesh.scale.set(r, r * (1 + 0.04 * Math.sin(inflate * Math.PI * 3) * (1 - inflate)), r)
      const du2 = dome.mat.uniforms
      du2.uTime.value = t
      du2.uFront.value = segment(local, T.inflate[0] + 0.005, T.inflate[1] + 0.01)
      du2.uIntensity.value = 1 + 0.8 * window01(deflate, 0.0, 1.0, 0.3)
      du2.uWatch.value = 0
      du2.uPing.value = rain * (inflate >= 1 ? 1 : 0)
      du2.uCamPos.value.copy(ctx.camera.position)
      _dome.set(0, cy, 0, domeOn ? r * 1.02 : 0)

      DOME_BOLTS.forEach((b, j) => {
        const [a0, a1] = T.domeBolts[j]
        const pres = window01(local, a0, a1, 0.025) * (inflate >= 1 ? 1 : 0)
        const ph = fract(t * 0.8 + j * 0.41 + 0.2)
        const env = rm ? 0.3 : Math.exp(-ph * 7)
        const crackle = rm ? 1 : hash1(Math.floor(t * 16) + j * 5.1 + 3) > 0.3 ? 1 : 0.35
        const amp = pres * (0.5 * crackle + 1.3 * env)
        storm.cloudPoint(b.cloud, _a, b.dx)
        const E = _b.copy(b.dir).multiplyScalar(r).add(dome.mesh.position)
        storm.bolts[4 + j].set(_a, E, amp, rm ? j : Math.floor(t * 14 + j * 2.3), camPos)
        storm.setHit(4 + j, E, b.dir, MINT, pres, rm ? 1 : ph)
        dome.impacts[j].set(b.dir.x, b.dir.y, b.dir.z, rm ? 1 : ph)
        dome.amps[j] = pres * 1.2
        flashes[b.cloud] += pres * env
      })
      dome.amps[3] = 0
      storm.setHit(7, _a.set(0, -99, 0), UP, MINT, 0, 1)
      if (ctx.renderer) {
        ctx.renderer.getDrawingBufferSize(_size)
        const px = _size.y / (2 * Math.tan((FOV * Math.PI) / 360))
        storm.setSparkScale(px)
        glints.mat.uniforms.uScale.value = px
      }

      // shockwave across the grass as the dome pops; afterwards, slow 24/7 "watch" pings
      const sw = segment(local, T.inflate[0], T.inflate[0] + 0.07)
      dome.ring.position.set(0, G + 0.04, 0)
      if (sw > 0 && sw < 1) {
        dome.ring.visible = true
        dome.ring.scale.setScalar(lerp(0.6, 8.5, ease.outCubic(sw)))
        dome.ringMat.uniforms.uAmp.value = (1 - sw) * (1 - sw) * 1.6
      } else {
        const on = segment(local, T.deflate[1] - 0.01, T.deflate[1] + 0.03) * (1 - outB)
        const ph = fract(t / 2.8)
        dome.ring.visible = on > 0.001
        dome.ring.scale.setScalar(lerp(0.9, 6.2, ease.outCubic(ph)))
        dome.ringMat.uniforms.uAmp.value = (1 - ph) * (1 - ph) * 0.55 * on
      }

      // weather
      storm.updateClouds(segment(local, T.stormIn[0], T.stormIn[1]), segment(local, 0.68, 0.9), stormA, t, flashes)
      storm.updateRain(t, rain, _dome, stormA)

      // post punch on hack strikes (before the shield only; calm with reduced motion)
      if (!rm) {
        const preDome = 1 - segment(local, T.inflate[0] - 0.02, T.inflate[0])
        pp.flash = strikeEnv * 0.07 * preDome + (1 - sw) * sw * 0.35 * (sw > 0 ? 1 : 0)
        pp.glitch = strikeEnv * 0.22 * preDome
      }

      // town life
      const cosy = segment(local, 0.4, 0.5) * (1 - segment(local, 0.7, 0.8))
      // kit windows: storm lights with a power dip on every strike, cosy under the dome
      wp.glow = clamp(0.62 * stormA * (1 - 0.6 * strikeEnv) + cosy * 0.45)
      town.update(
        {
          local,
          wind: stormA,
          wet: segment(local, 0.06, 0.3),
          hack,
          led: 1 + charge * 1.3 + (domeOn ? 0.25 : 0) + 0.8 * window01(deflate, 0.2, 1, 0.4),
          spin: ease.inOutCubic(segment(local, T.charge[0], T.inflate[1])) * Math.PI * 4,
          pace,
        },
        time,
      )

      // rainbow + glints
      const sweep = ease.inOutCubic(segment(local, T.rainbow[0], T.rainbow[1]))
      rainbow.set(sweep, pop(segment(local, T.rainbow[0] - 0.01, T.rainbow[0] + 0.05)))
      rainbow.group.position.set(-Math.sin(RAINBOW_AZ) * 1.7, G - 0.1, -Math.cos(RAINBOW_AZ) * 1.7)
      rainbow.group.rotation.y = RAINBOW_AZ
      glints.mat.uniforms.uTime.value = t
      glints.mat.uniforms.uAmp.value = segment(local, 0.74, 0.8) * (1 - outB) * (rm ? 0.6 : 1)

      // ------------------------------------------------------------ DOM
      stage.classList.toggle('is-dark', local < T.lightsUp)
      reveal(eyebrow, window01(local, 0.075, 0.99, 0.03), 10)
      setRise(t1, local > T.hackTitle && local < 0.985)
      setRise(t2, local > T.breathe && local < 0.985)
      bodyCard.classList.toggle('is-in', local > T.body[0] && local < T.body[1])
      watchCard.classList.toggle('is-in', local > T.watch && local < 0.985)

      const cam = ctx.camera
      const ok = !fresh
      alert.update(_a.copy(town.hits[0]).setY(town.hits[0].y + 0.05), cam, frame.width, frame.height, ok ? window01(local, T.alert[0], T.alert[1], 0.02) : 0)
      shieldTag.update(_a.copy(town.crown).setY(town.crown.y + 0.5), cam, frame.width, frame.height, ok ? window01(local, T.shieldTag[0], T.shieldTag[1], 0.02) : 0)
    },

    camera(local, frame, out) {
      computePose(local, frame.time, pose)
      out.position.copy(pose.position)
      out.target.copy(pose.target)
      out.fov = pose.fov
      out.roll = pose.roll
      out.parallax = frame.reducedMotion ? 0 : pose.parallax
      fresh = false
    },

    anchors: [T.cta],
  }
}
