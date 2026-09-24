import * as THREE from 'three'
import type { Chapter, ChapterContext, Frame } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { clamp, ease, lerp, segment, smoothstep } from '../../core/math'
import { SECTIONS, TESTIMONIALS } from '../../content'
import { TownSquare, softCloud, spring } from './square'
import { Crowd } from './people'
import { Bubble, type Insets, type Side } from './bubble'
import { nextFrame } from '../../core/yield'
import './voices.css'

/*
 * TOWN SQUARE — client voices.
 *
 * A round cobbled square on its own floating island at mid-afternoon: a
 * fountain crowned with the Hark mark, café umbrellas, a little market,
 * bunting, and a crowd of peg people milling about. Eight townsfolk stand on
 * soapboxes round the square; for each testimonial the drone-camera glides
 * to one of them, they hop up and start talking, a green ring lights under
 * their feet, the people nearby turn to listen, and a comic speech bubble
 * pops out of their head with the quote.
 *
 *   0.00–0.06   in-beat (under the cut's cloud wipe, which clears at 0.06 =
 *               0.18 vh): the camera sinks out of cloud onto the island, the
 *               crowd and umbrellas pop up
 *   0.03–0.135  header 'We listen. They talk.' + eyebrow; from 0.06 (the nav
 *               landing, a clear frame) the camera holds the overview and map
 *               pins sit over the eight speakers (click one to jump to it)
 *   0.135–0.94  eight beats (~0.1 each); the camera holds on the speaker for
 *               the middle ~half of each beat and glides between them
 *   0.88–1.00   out-beat: lamps, bunting bulbs and windows light up in the
 *               evening light, the camera rises into the clouds
 *
 * The camera, crowd and scene are pure functions of `local` (+ idle time).
 * The bubbles are time-driven from the scroll position's wish so a card that
 * has popped is held long enough to read and a steady scroll never resets it
 * mid-read; jumps and off-screen speakers skip straight to the new card.
 */

const N = TESTIMONIALS.length
const B0 = 0.135
const B1 = 0.94
const SPAN = (B1 - B0) / N
const HYST = 0.006
/** camera holds on a speaker over this part of its beat */
const HOLD_A = 0.24
const HOLD_B = 0.7
/** the camera settles on the overview just as the cut clears (nav landing 0.06) */
const IN_END = 0.064
/** overview hold (pins live) ends; the drone glides down to the first speaker */
const OV_END = 0.12
const PINS_A = 0.045
const PINS_B = OV_END + 0.008
const OUT_START = 0.922
/** the header rises once the cut's clouds have half parted */
const HEAD_IN = 0.03
/** bubble timing (s) */
const GAP = 0.18
const SETTLE = 0.5
const DWELL = 0.55

const beatStart = (k: number) => B0 + k * SPAN
const anchorAt = (k: number) => B0 + (k + 0.52) * SPAN

interface Pose {
  x: number
  y: number
  z: number
  az: number
  el: number
  /** view height (world units) at the look point */
  vh: number
  /** where the look point lands on screen (NDC) */
  sx: number
  sy: number
}
const mkPose = (): Pose => ({ x: 0, y: 0, z: 0, az: 0, el: 0, vh: 1, sx: 0, sy: 0 })
function lerpPose(a: Pose, b: Pose, t: number, o: Pose) {
  o.x = lerp(a.x, b.x, t)
  o.y = lerp(a.y, b.y, t)
  o.z = lerp(a.z, b.z, t)
  o.az = lerp(a.az, b.az, t)
  o.el = lerp(a.el, b.el, t)
  o.vh = lerp(a.vh, b.vh, t)
  o.sx = lerp(a.sx, b.sx, t)
  o.sy = lerp(a.sy, b.sy, t)
  return o
}

interface Layout {
  W: number
  H: number
  aspect: number
  dock: boolean
  fov: number
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let square: TownSquare
  let crowd: Crowd
  const bubbles: Bubble[] = []
  let head: HTMLElement
  let headParts: HTMLElement[] = []
  const pins: HTMLButtonElement[] = []
  let probe: HTMLElement
  const ins: Insets = { top: 90, bottom: 90, left: 24, right: 24 }
  /** probe offsets are re-read only when the stage or viewport resizes */
  let insDirty = true
  let insW = -1
  let insH = -1
  let stageEl: HTMLElement

  // camera-attached clouds for the in/out beats
  let puffs: THREE.InstancedMesh
  const PUFFS: [number, number, number, number][] = [
    // screen x, y (NDC at full cover), depth fraction, scale
    [-0.75, -0.55, 0.32, 1.25],
    [0.7, -0.62, 0.36, 1.35],
    [-0.15, -0.95, 0.3, 1.2],
    [0.25, 0.8, 0.42, 1.1],
    [-0.8, 0.55, 0.4, 1.15],
    [0.9, 0.35, 0.34, 1.05],
    [0.05, 0.1, 0.46, 1.4],
  ]

  // time-driven card state (0 header, 1..N bubbles, -1 none)
  let shown = -1
  let inAt = -10
  let pendingAt = -1
  let entered = true
  let offAt: number[] = []

  // scratch
  const pose = mkPose()
  const pa = mkPose()
  const pb = mkPose()
  const camPos = new THREE.Vector3()
  const camTarget = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const fwd = new THREE.Vector3()
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)
  const proj = new THREE.PerspectiveCamera(16, 1, 0.1, 3000)
  const ndc = new THREE.Vector3()
  const focus = new THREE.Vector3()
  const talk = new Float32Array(N)
  const hop = new Float32Array(N)
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const v3 = new THREE.Vector3()
  const s3 = new THREE.Vector3()
  const restHeads: THREE.Vector3[] = []
  const ringPos = new THREE.Vector3()

  /* -------------------------------------------------------------- layout */

  function layoutOf(f: Frame): Layout {
    const W = f.width
    const H = f.height
    const aspect = W / Math.max(1, H)
    const dock = aspect < 0.85 || W < 640
    return { W, H, aspect, dock, fov: dock ? 18 : 16 }
  }

  /**
   * The probe's CSS insets only change with the viewport, so the layout read
   * happens once per resize (ResizeObserver, or the engine's frame size as a
   * fallback), never per frame after the bubbles have written to the DOM.
   */
  function measureInsets(f: Frame) {
    if (!probe) return
    if (f.width !== insW || f.height !== insH) {
      insW = f.width
      insH = f.height
      insDirty = true
    }
    if (!insDirty) return
    insDirty = false
    const w = stageEl.clientWidth
    const h = stageEl.clientHeight
    ins.top = probe.offsetTop
    ins.left = probe.offsetLeft
    ins.right = Math.max(0, w - probe.offsetLeft - probe.offsetWidth)
    ins.bottom = Math.max(0, h - probe.offsetTop - probe.offsetHeight)
  }

  /** the speaker's side of the screen for beat k (bubble opens the other way) */
  const sideOf = (k: number): Side => (k % 2 === 0 ? 'right' : 'left')

  /* -------------------------------------------------------------- poses */

  function beatPose(k: number, u: number, L: Layout, o: Pose) {
    const h = restHeads[k]
    const spot = square.speakers[k]
    const fountain = k === 4
    o.x = h.x
    o.y = h.y - 0.08
    o.z = h.z
    // the camera looks across the square at the speaker (sweeps clockwise)
    const base = fountain ? spot.theta : spot.theta + 180
    o.az = base + 12 + (u - 0.5) * 7
    o.el = 41 + (k % 3) * 3.5 + (u - 0.5) * 1.5
    if (L.dock) {
      o.vh = (5.2 / L.aspect) * (1 - u * 0.03)
      o.sx = 0
      // head in the middle of the band above the docked plate
      const bh = bubbles[k]?.h || L.H * 0.34
      const plateTop = L.H - ins.bottom - bh - 6 - 34
      const hy = ins.top + Math.max(60, plateTop - ins.top) * 0.6
      o.sy = 1 - (2 * hy) / L.H
    } else {
      o.vh = 5.4 * (1 - u * 0.035)
      o.sx = (sideOf(k) === 'right' ? -0.3 : 0.3) * Math.min(1, L.aspect / 1.45)
      o.sy = -0.3
    }
    // continuous az: unwrap relative to the sweep order
    while (o.az < k * 45 - 60) o.az += 360
    while (o.az > k * 45 + 120) o.az -= 360
    return o
  }

  function overviewPose(u: number, L: Layout, o: Pose) {
    o.x = 0
    o.y = 0.3
    o.z = 0
    // a slow drone drift while the pins are up, so the hold still answers the scroll
    o.az = -34 + u * 9
    o.el = 47
    if (L.dock) {
      o.vh = 22.5 / L.aspect
      o.sx = 0
      o.sy = -0.18
    } else {
      o.vh = 19.5
      o.sx = 0.2 * Math.min(1, L.aspect / 1.45)
      o.sy = -0.14
    }
    o.vh *= 1 - 0.05 * u
    return o
  }

  function inPose(L: Layout, o: Pose) {
    overviewPose(0, L, o)
    o.az = -62
    o.el = 64
    o.vh *= 1.5
    o.y = 2.2
    return o
  }

  function endPose(L: Layout, o: Pose) {
    beatPose(N - 1, 1, L, o)
    o.az += 34
    o.el = 67
    o.vh = L.dock ? 15 / L.aspect : 15
    o.x *= 0.3
    o.z *= 0.3
    o.y = 5.5
    o.sx = 0
    o.sy = 0.05
    return o
  }

  /** where the story has the camera at `local` */
  function poseAt(local: number, L: Layout, o: Pose) {
    if (local < IN_END) {
      inPose(L, pa)
      overviewPose(0, L, pb)
      return lerpPose(pa, pb, ease.outCubic(local / IN_END), o)
    }
    if (local < OV_END) return overviewPose((local - IN_END) / (OV_END - IN_END), L, o)
    const first = beatStart(0) + HOLD_A * SPAN
    if (local < first) {
      overviewPose(1, L, pa)
      beatPose(0, 0, L, pb)
      const t = (local - OV_END) / (first - OV_END)
      return hopBetween(pa, pb, t, o, 1.25)
    }
    const k = Math.min(N - 1, Math.floor((local - B0) / SPAN))
    const u = (local - beatStart(k)) / SPAN
    if (u < HOLD_A) {
      // arriving from the previous speaker
      beatPose(k - 1, 1, L, pa)
      beatPose(k, 0, L, pb)
      const t = (u + (1 - HOLD_B)) / (HOLD_A + 1 - HOLD_B)
      return hopBetween(pa, pb, t, o, 1)
    }
    if (k === N - 1) {
      const uOut = (OUT_START - beatStart(k)) / SPAN
      if (local < OUT_START) return beatPose(k, (u - HOLD_A) / (uOut - HOLD_A), L, o)
      beatPose(k, 1, L, pa)
      endPose(L, pb)
      return lerpPose(pa, pb, ease.inOutCubic(segment(local, OUT_START, 1)), o)
    }
    if (u <= HOLD_B) return beatPose(k, (u - HOLD_A) / (HOLD_B - HOLD_A), L, o)
    beatPose(k, 1, L, pa)
    beatPose(k + 1, 0, L, pb)
    const t = (u - HOLD_B) / (HOLD_A + 1 - HOLD_B)
    return hopBetween(pa, pb, t, o, 1)
  }

  /** drone glide: ease across, lifting and widening a little mid-flight */
  function hopBetween(a: Pose, b: Pose, t: number, o: Pose, lift: number) {
    const e = ease.inOutCubic(clamp(t))
    lerpPose(a, b, e, o)
    const arc = Math.sin(Math.PI * clamp(t))
    o.vh *= 1 + 0.24 * arc * lift
    o.el += 5 * arc * lift
    return o
  }

  function solve(p: Pose, L: Layout, pos: THREE.Vector3, target: THREE.Vector3) {
    const az = THREE.MathUtils.degToRad(p.az)
    const elv = THREE.MathUtils.degToRad(p.el)
    dir.set(Math.sin(az) * Math.cos(elv), Math.sin(elv), Math.cos(az) * Math.cos(elv))
    fwd.copy(dir).negate()
    right.crossVectors(fwd, UP).normalize()
    up.crossVectors(right, fwd)
    const tv = Math.tan(THREE.MathUtils.degToRad(L.fov / 2))
    const d = p.vh / 2 / tv
    target
      .set(p.x, p.y, p.z)
      .addScaledVector(right, -p.sx * d * tv * L.aspect)
      .addScaledVector(up, -p.sy * d * tv)
    pos.copy(target).addScaledVector(dir, d)
    return d
  }

  /* -------------------------------------------------------------- cards */

  function wantAt(local: number) {
    let want = local >= B1 ? -1 : local < HEAD_IN ? -1 : local < B0 ? 0 : 1 + Math.min(N - 1, Math.floor((local - B0) / SPAN))
    if (shown >= 0 && want !== shown) {
      const so = shown
      const wo = want < 0 ? (local >= B1 ? N + 1 : -1) : want
      if (Math.abs(wo - so) === 1) {
        const hi = Math.max(wo, so)
        const boundary = hi === N + 1 ? B1 : hi === 0 ? HEAD_IN : B0 + (hi - 1) * SPAN
        if (Math.abs(local - boundary) < HYST) want = shown
      }
    }
    return want
  }
  const order = (c: number, local: number) => (c < 0 ? (local >= 0.5 ? N + 1 : -1) : c)

  function setCard(c: number, on: boolean, now: number) {
    if (c === 0) {
      for (const p of headParts) setRise(p, on)
      head.classList.toggle('is-on', on)
    } else if (c > 0) {
      const b = bubbles[c - 1]
      if (b.on && !on) offAt[c - 1] = now
      b.set(on)
    }
  }

  function switchTo(next: number, now: number) {
    const hadOne = shown >= 0
    if (shown >= 0) setCard(shown, false, now)
    shown = next
    if (next >= 0) {
      pendingAt = now + (hadOne ? GAP : 0)
      inAt = pendingAt
      if (next > 0) bubbles[next - 1].snap()
    } else pendingAt = -1
  }

  function updateCards(local: number, now: number, calm: boolean, headOnScreen: (c: number) => boolean) {
    const want = wantAt(local)
    if (entered) {
      entered = false
      for (let c = 0; c <= N; c++) setCard(c, false, -10)
      shown = -1
      if (want >= 0) {
        shown = want
        pendingAt = now
        inAt = now
        if (want > 0) bubbles[want - 1].snap()
      }
    } else if (want !== shown) {
      const k = calm ? 0.6 : 1
      const age = now - inAt
      const settled = shown < 0 || age >= SETTLE * k
      const dwelled = shown < 0 || age >= (SETTLE + DWELL) * k
      const gap = Math.abs(order(want, local) - order(shown, local))
      // a real jump (nav, keyboard, a pin): go straight there
      const far = gap >= 3
      // falling behind a brisk scroll, or the speaker has left the frame:
      // catch up one card at a time rather than skipping anyone
      const behind = gap === 2 || (shown > 0 && !headOnScreen(shown))
      const outro = want < 0 && (settled || local > B1 + 0.015 || local < 0.004)
      if (shown < 0 || outro || (far && settled)) switchTo(want, now)
      else if (dwelled || (behind && settled)) {
        const next = order(shown, local) + Math.sign(order(want, local) - order(shown, local))
        switchTo(next > N || next < 0 ? -1 : next, now)
      }
    }
    if (shown >= 0 && pendingAt >= 0 && now >= pendingAt) {
      setCard(shown, true, now)
      pendingAt = -1
    }
  }

  /* -------------------------------------------------------------- DOM */

  function buildDom(stage: HTMLElement) {
    stageEl = stage
    probe = el('div', 'vo-probe', undefined, stage)
    probe.setAttribute('aria-hidden', 'true')
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        insDirty = true
      }).observe(stage)
    }

    head = el('div', 'vo-head', undefined, stage)
    const eb = el('p', 'hud-eyebrow vo-eyebrow', undefined, head)
    headParts.push(rise(el('span', '', undefined, eb), SECTIONS.voices.eyebrow))
    const m = SECTIONS.voices.title.match(/^(.*?\.)\s+(.*)$/)
    const html = m ? `${m[1]}<br><em>${m[2]}</em>` : SECTIONS.voices.title
    headParts.push(rise(el('h2', 'hud-h2 vo-title', undefined, head), html))

    TESTIMONIALS.forEach((t, i) => {
      const pin = el('button', 'vo-pin', undefined, stage) as HTMLButtonElement
      pin.type = 'button'
      pin.setAttribute('aria-label', `${t.name}, ${t.company}`)
      pin.style.setProperty('--i', String(i))
      const inner = el('span', 'vo-pin-in', undefined, pin)
      el('span', 'vo-pin-n', String(i + 1).padStart(2, '0'), inner)
      el('span', 'vo-pin-name', t.name, inner)
      pin.addEventListener('click', () => window.__hark?.land('voices', true, anchorAt(i)))
      pins.push(pin)
    })

    TESTIMONIALS.forEach((t, i) => {
      bubbles.push(
        new Bubble(stage, {
          quote: t.quote,
          name: t.name,
          company: t.company,
          index: i,
          total: N,
          look: crowd.speakerLook(i),
        }),
      )
    })
    offAt = TESTIMONIALS.map(() => -10)
  }

  /** project a world point with the exact camera the engine will render */
  function project(p: THREE.Vector3, L: Layout) {
    ndc.copy(p).project(proj)
    const ok = ndc.z < 1 && Number.isFinite(ndc.x + ndc.y)
    return {
      x: (ndc.x * 0.5 + 0.5) * L.W,
      y: (-ndc.y * 0.5 + 0.5) * L.H,
      ok,
    }
  }

  /* -------------------------------------------------------------- chapter */

  return {
    id: 'voices',
    group,
    // keyboard stops land mid-beat: camera arrived, quote settled
    anchors: TESTIMONIALS.map((_, i) => anchorAt(i)),

    async init(ctx: ChapterContext) {
      square = new TownSquare(ctx.mobile)
      await square.build()
      group.add(square.group)
      await nextFrame()
      crowd = new Crowd(square.speakers, square.seats, square.keepers, square.balloonSeller, square.obstacles, ctx.mobile)
      group.add(crowd.group)
      for (let k = 0; k < N; k++) restHeads.push(crowd.speakerHeads[k].clone())

      // in/out-beat cloud puffs (one instanced draw)
      const cg = softCloud(5, ctx.mobile ? 10 : 13)
      cg.computeBoundingBox()
      const cb = cg.boundingBox!
      cg.translate(-(cb.min.x + cb.max.x) / 2, -(cb.min.y + cb.max.y) / 2, -(cb.min.z + cb.max.z) / 2)
      puffs = new THREE.InstancedMesh(
        cg,
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, emissive: '#fffaf0', emissiveIntensity: 0.42 }),
        PUFFS.length,
      )
      puffs.frustumCulled = false
      puffs.visible = false
      group.add(puffs)

      buildDom(ctx.stage)
    },

    onEnter() {
      entered = true
      insDirty = true
    },

    onLeave() {
      for (let c = 0; c <= N; c++) setCard(c, false, -10)
      shown = -1
      pendingAt = -1
      for (const p of pins) p.classList.remove('is-on')
    },

    update(local, frame, ctx) {
      const calm = ctx.reducedMotion
      const now = frame.time
      const L = layoutOf(frame)
      measureInsets(frame)

      // ---- camera for this frame (also used to project the DOM exactly)
      poseAt(local, L, pose)
      solve(pose, L, camPos, camTarget)
      proj.fov = L.fov
      proj.aspect = L.aspect
      proj.position.copy(camPos)
      proj.up.set(0, 1, 0)
      proj.lookAt(camTarget)
      const par = calm ? 0 : parallaxAt(local)
      if (par) {
        right.setFromMatrixColumn(proj.matrixWorld, 0)
        up.setFromMatrixColumn(proj.matrixWorld, 1)
        proj.position.addScaledVector(right, frame.pointer.x * par).addScaledVector(up, frame.pointer.y * par * 0.6)
        proj.lookAt(camTarget)
      }
      proj.updateProjectionMatrix()
      proj.updateMatrixWorld()

      // ---- who has the floor (pure function of local)
      const kc = clamp(Math.floor((local - B0) / SPAN), 0, N - 1)
      for (let k = 0; k < N; k++) {
        const s = beatStart(k)
        const e = beatStart(k + 1)
        talk[k] = Math.min(smoothstep(s + 0.004, s + 0.03, local), 1 - smoothstep(e - 0.018, e - 0.002, local))
        hop[k] = segment(local, s - 0.006, s + 0.024)
      }
      const floor = local >= B0 && local < B1 ? kc : -1
      const focusW = floor >= 0 ? talk[floor] : 0
      if (floor >= 0) focus.copy(restHeads[floor])

      // ---- scene
      const pop = segment(local, 0.006, 0.058)
      const lamps = segment(local, 0.878, 0.945)
      let ringScale = 0
      if (floor >= 0) {
        const s = beatStart(floor)
        ringScale = spring(segment(local, s + 0.004, s + 0.03)) * (1 - smoothstep(beatStart(floor + 1) - 0.014, beatStart(floor + 1) - 0.002, local))
      }
      square.update(now, calm, pop, lamps, floor >= 0 ? square.ringFor(floor, ringPos) : null, ringScale)
      crowd.update({ t: now, calm, focus, focusW, focusOwner: floor, talk, hop, pop })

      // ---- in/out clouds riding with the camera
      updatePuffs(local, L)

      // ---- world + lens
      const w = ctx.world.params
      w.time = lerp(0.56, 0.68, segment(local, 0, 0.86)) + 0.08 * smoothstep(0.86, 0.96, local)
      w.focus.set(0, 0, 0)
      w.shadowSize = 9.6
      w.sun = 1 - lamps * 0.12
      // windows light up with the lamps (the world's auto glow only starts
      // past this chapter's time of day); before that, leave it on auto
      if (lamps > 0) w.glow = lamps * 0.5
      const p = ctx.post.params
      p.focusY = clamp((1 + pose.sy) / 2, 0.2, 0.8)
      const wide = 1 - smoothstep(OV_END, OV_END + 0.02, local) + smoothstep(OUT_START, 1, local)
      p.band = lerp(L.dock ? 0.09 : 0.11, 0.22, clamp(wide))
      p.blur = frame.mobile ? 6 : 9
      p.sat = 1.14
      p.bloomStrength = 0.35 + lamps * 0.45
      p.bloomRadius = 0.45
      p.vignette = 0.26

      // ---- DOM: header, pins, bubbles
      const headOnScreen = (c: number) => {
        if (c <= 0) return true
        const pr = project(crowd.speakerHeads[c - 1], L)
        return pr.ok && pr.x > -40 && pr.x < L.W + 40 && pr.y > -40 && pr.y < L.H + 40
      }
      updateCards(local, now, calm, headOnScreen)

      // pins only over a clear frame: never float over the cut's cloud wipe
      const pinsOn = local > PINS_A && local < PINS_B && Math.max(ctx.post.transition, ctx.post.fade) < 0.12
      if (pinsOn || local < PINS_B + 0.06) {
        for (let i = 0; i < N; i++) {
          const pin = pins[i]
          if (pin.classList.contains('is-on') !== pinsOn) pin.classList.toggle('is-on', pinsOn)
          v3.copy(crowd.speakerHeads[i])
          v3.y += 0.1
          const pr = project(v3, L)
          if (pr.ok) pin.style.transform = `translate3d(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px, 0)`
        }
      } else if (pins[0].classList.contains('is-on')) for (const pin of pins) pin.classList.remove('is-on')

      for (let i = 0; i < N; i++) {
        const b = bubbles[i]
        const live = b.on || now - offAt[i] < 0.5
        if (!live) continue
        b.root.classList.toggle('is-dock', L.dock)
        const pr = project(crowd.speakerHeads[i], L)
        b.place(pr.x, pr.y, pr.ok, L.dock ? 'dock' : 'float', sideOf(i), L.W, L.H, ins, frame.dt)
      }
    },

    camera(local, frame, out) {
      const L = layoutOf(frame)
      poseAt(local, L, pose)
      solve(pose, L, out.position, out.target)
      out.fov = L.fov
      out.roll = 0
      out.parallax = frame.reducedMotion ? 0 : parallaxAt(local)
    },
  }

  function parallaxAt(local: number) {
    return 0.35 * (1 - smoothstep(0.9, 0.96, local))
  }

  function updatePuffs(local: number, L: Layout) {
    const cover = Math.max(1 - smoothstep(0, 0.05, local), smoothstep(0.955, 1, local))
    puffs.visible = cover > 0.01
    if (!puffs.visible) return
    // the camera for this frame (from the pose just solved)
    fwd.subVectors(camTarget, camPos)
    const dist = fwd.length()
    fwd.normalize()
    right.crossVectors(fwd, UP).normalize()
    up.crossVectors(right, fwd)
    const tv = Math.tan(THREE.MathUtils.degToRad(L.fov / 2))
    const c = ease.inOutQuad(cover)
    for (let i = 0; i < PUFFS.length; i++) {
      const [sx, sy, df, sc] = PUFFS[i]
      const d = dist * df
      const hh = d * tv
      const hw = hh * L.aspect
      // parted: every puff sits outside the frame along its own direction
      const len = Math.hypot(sx, sy) || 1
      const r = lerp(2.3 + sc * 0.6, len, c)
      v3.copy(camPos)
        .addScaledVector(fwd, d)
        .addScaledVector(right, (sx / len) * r * hw)
        .addScaledVector(up, (sy / len) * r * hh)
      const s = hh * sc * (0.75 + c * 0.55)
      q.setFromAxisAngle(fwd, i * 0.7)
      m4.compose(v3, q, s3.set(s * 1.1, s * 0.8, s))
      puffs.setMatrixAt(i, m4)
    }
    puffs.instanceMatrix.needsUpdate = true
  }
}
