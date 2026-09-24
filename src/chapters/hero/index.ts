import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame } from '../../core/types'
import { Callout } from '../../core/dom'
import { clamp, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { AUTO_DUR, AUTO_END, Town, autoLocal, waveFront } from './town'
import { Sculpture } from './mark'
import { ListenRings } from './rings'
import { Sky } from './sky'
import { HeroUI } from './ui'
import { heroPose, type HeroPose } from './camera'
import { SPRING, Springs, squashOf } from './pop'
import { R } from './layout'
import './hero.css'

/*
 * 01 · HQ — the first impression.
 *
 * The camera sinks out of the clouds onto a grassy island: a plinth, a pond
 * and a few trees. When the loader hands over, the Hark mark pops up on the
 * plinth as a big glossy green landmark, a "listen" ring bursts from its
 * diamond and the town answers by itself: plaza, paths and park, a ring road
 * laid in a sweep with green LED lamps, then a ring of houses (about 2.2 s).
 * Scroll, and the listen wave rolls on: trees among the houses, a windmill,
 * townsfolk strolling and cars driving the ring. The camera glides to a
 * three-quarter hero view for the headline, then rises back into the clouds
 * for the cut.
 *
 *   0.00–0.10  descend out of cloud; welcome plate + scroll hint (the core
 *              town builds itself on reveal)
 *   0.10–0.60  the rest of the town (wave front from 1 → 7.4 units)
 *   0.64–0.92  payoff: "Make the internet listen." + CTAs
 *   0.92–1.00  rise into the clouds
 */

const PAYOFF = 0.78
/** seconds after the reveal the town starts building (just after the mark's ring burst) */
const AUTO_DELAY = 0.52
/** the intro build only plays for a visitor who starts in the opening */
const AUTO_MAX_LOCAL = 0.12
const PENDING = 0, RUN = 1, DONE = 2

/** how far the camera veil covers the frame at this local */
function veilAt(local: number) {
  if (local < 0.08) return 0.24 * (1 - smoothstep(0, 0.08, local))
  if (local > 0.9) return smoothstep(0.9, 1, local)
  return 0
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let town: Town
  let sculpt: Sculpture
  let rings: ListenRings
  let sky: Sky
  let ui: HeroUI
  let callout: Callout
  const pose: HeroPose = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 15, az: 0, el: 0, dist: 1, sx: 0, sy: 0, portrait: false }
  const scratch = new THREE.PerspectiveCamera(15, 1, 0.5, 2000)
  const markSpring = new Springs(1, SPRING.mark)
  const sq = { g: 0, xz: 0, y: 0 }
  const ray = new THREE.Raycaster()
  const pin = new THREE.Vector3()
  let revealAt = -1
  let lastLocal = -1
  let snapNext = true
  let lastTime = -1
  let burstAt = -99
  let introBurst = false
  let reduced = false
  const lastPtr = new THREE.Vector2(9, 9)
  const sunDir = new THREE.Vector3(0, 1, 0)
  let sun: THREE.DirectionalLight
  let hovering = false
  // the intro build: decided once, on the first hero frame after the reveal
  let autoMode = PENDING
  let autoT0 = 0
  let lateBurst = false
  let entered = 0
  let hiddenAtReveal = false
  const pinNdc = new THREE.Vector3()

  const now = () => performance.now() / 1000

  return {
    id: 'hero',
    group,
    anchors: [PAYOFF],

    async init(ctx: ChapterContext) {
      const t0 = performance.now()
      let busy = 0
      const slices: number[] = []
      const yieldFrame = async () => {
        slices.push(Math.round(performance.now() - mark))
        busy += performance.now() - mark
        await nextFrame()
        mark = performance.now()
      }
      let mark = t0
      reduced = ctx.reducedMotion
      sun = ctx.world.sun
      town = new Town(ctx.mobile)
      await town.build(yieldFrame)
      group.add(town.group)
      await yieldFrame()
      sculpt = await Sculpture.create(ctx.renderer, yieldFrame)
      group.add(sculpt.root)
      rings = new ListenRings(R * 0.98)
      group.add(rings.mesh)
      await yieldFrame()
      sky = new Sky(ctx.mobile)
      group.add(sky.group)

      ui = new HeroUI(ctx.stage)
      callout = new Callout(ctx.stage, { side: 'right', offset: { x: 64, y: -46 } })
      callout.label.textContent = 'Hark HQ'
      callout.root.classList.add('hero-callout')

      busy += performance.now() - mark
      if (location.search.includes('debug')) console.log(`[hero] init ${busy.toFixed(0)}ms busy (${slices.join(' / ')} / ${Math.round(performance.now() - mark)}), ${(performance.now() - t0).toFixed(0)}ms total`)
      const onReveal = () => {
        if (revealAt >= 0) return
        revealAt = now()
        hiddenAtReveal = document.hidden
      }
      if (document.documentElement.dataset.ready === '1') onReveal()
      else window.addEventListener('hark:reveal', onReveal, { once: true })
    },

    onEnter() {
      snapNext = true
      entered++
    },

    onLeave(ctx: ChapterContext) {
      if (hovering) ctx.renderer.domElement.style.cursor = ''
      hovering = false
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      const motion = reduced ? 0.25 : 1
      const rt = revealAt < 0 ? -1 : now() - revealAt
      const jump = snapNext || lastLocal < 0 || Math.abs(local - lastLocal) > 0.12
      snapNext = false
      lastLocal = local
      const step = frame.time === lastTime ? 0 : frame.dt
      lastTime = frame.time
      const aspect = frame.width / Math.max(1, frame.height)
      heroPose(local, aspect, pose, ui.keepLeft)

      // ---- morning light, tight shadows on the island
      const wp = ctx.world.params
      wp.time = lerp(0.22, 0.31, local)
      wp.focus.set(0, 0, 0)
      wp.shadowSize = 8.8

      // ---- the mark pops when the loader hands over; faces the drone
      markSpring.tgt[0] = rt >= (reduced ? 0 : 0.2) ? 1 : 0
      if (jump) markSpring.snap()
      markSpring.step(step, reduced)
      squashOf(markSpring, 0, sq)
      const p = sculpt.pivot
      p.scale.set(Math.max(1e-4, sq.xz), Math.max(1e-4, sq.y), Math.max(1e-4, sq.xz))
      p.visible = sq.g > 0.001
      p.rotation.y = pose.az - 0.22 + Math.sin(frame.time * 0.35) * 0.05 * motion
      if (!introBurst && rt >= 0.42) {
        introBurst = true
        if (!jump || rt < 2) burstAt = frame.time
      }

      // ---- the intro build. It plays once, for a visitor who is looking at
      // the opening when the loader hands over (or, in a tab opened in the
      // background, on the first frame they see). Deep links, jumps past the
      // opening, a first visit to the hero later on, and reduced motion get
      // the built core at once, with no animation.
      let snapTown = false
      if (autoMode === PENDING && rt >= 0) {
        const late = rt >= 1.5
        if (!reduced && entered <= 1 && local <= AUTO_MAX_LOCAL && (!late || hiddenAtReveal)) {
          autoMode = RUN
          autoT0 = late ? now() + 0.35 : revealAt + AUTO_DELAY
          lateBurst = late
        } else {
          autoMode = DONE
          snapTown = true
        }
      }
      const ta = autoMode === RUN ? now() - autoT0 : -1
      if (lateBurst && ta >= -0.1) {
        lateBurst = false
        burstAt = frame.time
      }
      const autoL = autoMode === DONE ? AUTO_END : autoLocal(ta)

      // ---- the town
      town.update(local, autoL, rt, frame.time, frame.dt, motion, reduced, jump || snapTown)

      // ---- listen rings + the diamond lamp
      const build = smoothstep(0.08, 0.14, local) * (1 - smoothstep(0.54, 0.62, local))
      // the intro build's own front ring, ahead of the scroll wave while it runs
      const autoFront = waveFront(autoL)
      const autoAmt = ta >= 0 && ta < AUTO_DUR + 0.6 && autoFront > waveFront(local) ? smoothstep(0, 0.2, ta) * (1 - smoothstep(AUTO_DUR - 0.1, AUTO_DUR + 0.6, ta)) : 0
      const u = rings.u
      u.uTime.value = frame.time * motion
      u.uAmt.value = 0.42 + Math.max(build, autoAmt) * 0.3
      u.uFront.value = autoAmt > 0 ? autoFront : waveFront(local)
      u.uFrontAmt.value = Math.max(build, autoAmt) * 0.95
      const be = frame.time - burstAt
      u.uBurst.value = 1 + be * 4.2
      u.uBurstAmt.value = be >= 0 && be < 2 ? (1 - smoothstep(0.2, 1.8, be)) * 1.1 : 0
      const pulse = rings.pulse(frame.time * motion)
      sculpt.diamondMat.emissiveIntensity = 0.75 + pulse * 0.9 + Math.max(build, autoAmt) * 0.3 + u.uBurstAmt.value * 0.9

      // ---- post: keep the island's top in the tilt-shift sweet spot
      const pp = ctx.post.params
      pp.focusY = 0.5 + pose.sy * 0.5 + (pose.portrait ? 0.02 : 0.03)
      pp.band = pose.portrait ? 0.11 : 0.14
      pp.blur = 7.5 + veilAt(local) * 4
      pp.bloomStrength = 0.4
      pp.bloomRadius = 0.45

      // ---- hover: the mark is a toy you can poke
      if (!frame.mobile && !lastPtr.equals(frame.pointerRaw)) {
        lastPtr.copy(frame.pointerRaw)
        ray.setFromCamera(frame.pointerRaw, ctx.camera)
        const over = sq.g > 0.5 && local < 0.93 && ray.intersectObjects([sculpt.mark, sculpt.diamond], false).length > 0
        if (over !== hovering) {
          hovering = over
          ctx.renderer.domElement.style.cursor = over ? 'pointer' : ''
        }
      }

      // ---- DOM
      ui.update({ local, intro: rt < 0 ? 0 : clamp(rt / 1.2), portrait: pose.portrait, pop: town.population() })

      // ---- keep the world's distant islets out from behind the copy (the
      // box is cached by the UI, re-measured only on resize / reflow)
      const keep = ui.copyRect()
      if (keep) wp.keepOut = keep
    },

    camera(local: number, frame: Frame, out) {
      const aspect = frame.width / Math.max(1, frame.height)
      heroPose(local, aspect, pose, ui.keepLeft)
      out.position.copy(pose.pos)
      out.target.copy(pose.tgt)
      out.fov = pose.fov
      out.roll = 0
      out.parallax = reduced ? 0 : 1.6 * (1 - veilAt(local))

      // camera-riding clouds + idle sky
      sky.veil = veilAt(local)
      sunDir.copy(sun.position).sub(sun.target.position).normalize()
      sky.update(frame.time, reduced ? 0.25 : 1, pose.pos, pose.tgt, pose.fov, aspect, 0, local, sunDir)

      // the HQ pin, projected with this frame's (un-parallaxed) pose
      scratch.position.copy(pose.pos)
      scratch.fov = pose.fov
      scratch.aspect = aspect
      scratch.lookAt(pose.tgt)
      scratch.updateProjectionMatrix()
      scratch.updateMatrixWorld()
      pin.set(0, sculpt.topY * Math.max(0, sq.y) + 0.15, 0)
      const vis = smoothstep(0.13, 0.17, local) * (1 - smoothstep(0.54, 0.58, local)) * (sq.g > 0.9 ? 1 : 0)
      // keep the label below the chrome band (short viewports put the pin
      // near the top): the elbow bends down instead of up when it must
      pinNdc.copy(pin).project(scratch)
      const py = (-pinNdc.y * 0.5 + 0.5) * frame.height
      const top = ui.safe.top + 12
      const bottom = frame.height - ui.safe.bottom - 20
      const ly = Math.min(bottom, Math.max(top, py - 46))
      callout.offset.y = Number.isFinite(py) ? ly - py : -46
      callout.update(pin, scratch, frame.width, frame.height, vis)
    },

    onPointerDown(frame: Frame, ctx: ChapterContext) {
      ray.setFromCamera(frame.pointerRaw, ctx.camera)
      const hit = ray.intersectObjects([sculpt.mark, sculpt.diamond], false)[0]
      if (hit) {
        markSpring.kick(0, -2.6)
        burstAt = frame.time
        return
      }
      town.poke(ray)
    },
  }
}
