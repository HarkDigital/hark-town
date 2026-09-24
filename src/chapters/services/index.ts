import * as THREE from 'three'
import type { CameraPose, Chapter, ChapterContext, Frame } from '../../core/types'
import { clamp, ease, lerp, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'
import { makeAtlas } from './atlas'
import { jiggle } from './bake'
import { setAtlas } from './workshops'
import { applyBuild, buildIsland, type IslandRT } from './islands'
import { People, Route, Sky, buildBridges, makeVan } from './life'
import { Hud } from './hud'
import { lerpShot, mixRegion, shot, solveShot, type Region, type Shot } from './shot'
import {
  ANCHORS,
  AZ0,
  BEAT,
  BUILD_LEN,
  FIN_END,
  GLIDE,
  INTRO_END,
  ISLANDS,
  N,
  OUT_START,
  OVERVIEW,
  SVC_END,
  SWITCH,
  beatStart,
  buildStart,
} from './layout'
import './services.css'

/*
 * THE WORKS — services as an archipelago of eleven workshop islands
 * (4.0 viewport heights, noon). See layout.ts for the run sheet.
 *
 * The clouds part over the whole map while the workshops pop up island by
 * island; then a drone camera glides across the plank bridges from one
 * workshop to the next, following the little Hark van, while a signage
 * plate names each one. It pulls back to the map at the end and rises into
 * the clouds for the cut.
 */

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

function overviewShot(out: Shot) {
  const c = OVERVIEW.center
  return Object.assign(
    out,
    shot({
      cx: c.x,
      cy: c.y,
      cz: c.z,
      eu: OVERVIEW.eu,
      ev: OVERVIEW.ev,
      y0: OVERVIEW.y0 - c.y - 1.3,
      y1: OVERVIEW.y1 - c.y,
      n: 5,
      az: AZ0,
      el: 0.86,
      fov: 16,
      fill: 0.98,
      ri: 1,
    }),
  )
}

function islandShot(k: number, d: number, out: Shot) {
  const def = ISLANDS[k]
  return Object.assign(
    out,
    shot({
      cx: def.pos.x,
      cy: def.pos.y,
      cz: def.pos.z,
      eu: def.radius,
      ev: def.radius,
      y0: -0.45,
      y1: 1.55,
      n: 2,
      az: def.az + lerp(-0.07, 0.09, d),
      el: 0.66 - 0.04 * d,
      fov: 16,
      fill: 0.83 + 0.05 * d,
    }),
  )
}

export default function create(): Chapter {
  const group = new THREE.Group()
  let islands: IslandRT[] = []
  let hud: Hud | null = null
  let route: Route | null = null
  let van: THREE.Group | null = null
  let people: People | null = null
  let sky: Sky | null = null
  let calm = false
  let lastShown = -2
  const unculled: THREE.Object3D[][] = []

  const pose: CameraPose = { position: new THREE.Vector3(0, 30, 40), target: new THREE.Vector3(), fov: 16, roll: 0, parallax: 0 }
  const cur = shot(), A = shot(), B = shot()
  const regP: Region = { l: -1, r: 1, b: -1, t: 1 }
  const regI: Region = { l: -1, r: 1, b: -1, t: 1 }
  const regF: Region = { l: -1, r: 1, b: -1, t: 1 }
  const reg: Region = { l: -1, r: 1, b: -1, t: 1 }
  const tmpReg: Region = { l: -1, r: 1, b: -1, t: 1 }
  const projCam = new THREE.PerspectiveCamera(16, 1, 0.1, 3000)
  const pinXY = new Float32Array(N * 2)
  const pinVis: boolean[] = new Array(N).fill(false)
  const _v = new THREE.Vector3()
  const _a = new THREE.Vector3()
  const focus = new THREE.Vector3()
  const balloonAt = new THREE.Vector3()
  const ray = new THREE.Raycaster()
  const keep: NdcRect = { x0: -2, y0: -2, x1: -2, y1: -2 }

  const jumpTo = (k: number) => {
    const eng = window.__hark?.engine
    if (eng) eng.gotoChapter('services', ANCHORS[k], true)
    else window.__hark?.gotoChapter('services', ANCHORS[k])
  }

  function regions(frame: Frame) {
    const m = hud!.metrics()
    const W = frame.width, H = frame.height
    const nx = (px: number) => (2 * px) / W - 1
    const ny = (py: number) => 1 - (2 * py) / H
    const edge = clamp(0.03 * W, 16, 48)
    regF.l = nx(edge)
    regF.r = nx(W - edge)
    regF.t = ny(m.safeTop)
    regF.b = ny(H - m.safeBottom)
    if (m.tall) {
      regP.l = regI.l = nx(8)
      regP.r = regI.r = nx(W - 8)
      regP.t = regI.t = ny(m.safeTop - 8)
      regP.b = ny(Math.max(m.safeTop + 120, m.colTop - 10))
      regI.b = ny(Math.max(m.safeTop + 120, m.introTop - 10))
    } else {
      regP.l = nx(m.colRight + clamp(0.03 * W, 20, 56))
      regI.l = nx(m.introRight + clamp(0.02 * W, 12, 40))
      regP.r = regI.r = nx(W - edge)
      regP.t = regI.t = ny(m.safeTop - 10)
      regP.b = regI.b = ny(H - m.safeBottom + 10)
    }
  }

  return {
    id: 'services',
    group,
    anchors: ANCHORS,

    async init(ctx: ChapterContext) {
      calm = ctx.reducedMotion
      const atlas = await makeAtlas(ctx.renderer)
      setAtlas(atlas)
      for (const def of ISLANDS) {
        const rt = buildIsland(def, atlas, ctx.mobile)
        islands.push(rt)
        group.add(rt.group)
        const list: THREE.Object3D[] = []
        rt.group.traverse(o => {
          if (o !== rt.group && !o.frustumCulled && (o as THREE.Mesh).isMesh) list.push(o)
        })
        unculled.push(list)
        await nextFrame()
      }
      const br = buildBridges(islands)
      group.add(br.mesh, br.ledMesh)
      route = new Route(islands, br.bridges)
      van = makeVan()
      group.add(van)
      people = new People(islands)
      group.add(people.crowd.group)
      sky = new Sky(ctx.mobile)
      group.add(sky.group)
      await nextFrame()
      hud = new Hud(ctx.stage, jumpTo, calm)
    },

    update(local: number, frame: Frame, ctx: ChapterContext) {
      if (!hud || !route || !van || !people || !sky) return
      const t = frame.time * (calm || frame.reducedMotion ? 0.25 : 1)

      /* ---------------- where are we? ---------------- */
      let shown = -1
      let intro = false
      let pins = 0
      let wipe = 0
      let k = 0
      let p = 0
      let tourIsland = -1
      if (local < INTRO_END) {
        overviewShot(cur)
        const lift = 1 - smoothstep(0, 0.5, local / INTRO_END)
        cur.el += 0.34 * lift
        cur.fill *= 1 - 0.45 * lift
        cur.az -= 0.14 * lift
        wipe = lift
        intro = local > 0.034
        pins = local > 0.054 ? 1 : 0
      } else if (local < SVC_END) {
        k = Math.min(N - 1, Math.floor((local - INTRO_END) / BEAT))
        p = (local - beatStart(k)) / BEAT
        tourIsland = k
        if (p < GLIDE) {
          const s = ease.inOutCubic(p / GLIDE)
          if (k === 0) overviewShot(A)
          else islandShot(k - 1, 1, A)
          islandShot(k, 0, B)
          lerpShot(A, B, s, cur)
          const hop = Math.sin(Math.PI * s)
          if (k > 0) {
            cur.fill *= 1 - 0.24 * hop
            cur.el += 0.1 * hop
          }
          if (s < 0.5) tourIsland = k - 1
        } else islandShot(k, (p - GLIDE) / (1 - GLIDE), cur)
        shown = p >= SWITCH ? k : k - 1
        intro = k === 0 && p < SWITCH
        pins = k === 0 && p < SWITCH * 0.5 ? 1 : 0
      } else {
        const f = clamp((local - SVC_END) / (FIN_END - SVC_END))
        islandShot(N - 1, 1, A)
        overviewShot(B)
        B.ri = 0
        B.rf = 1
        B.fill = 0.94
        lerpShot(A, B, ease.inOutCubic(f), cur)
        const o = smoothstep(OUT_START, 1, local)
        cur.el += 0.3 * o
        cur.fill *= 1 - 0.4 * o
        cur.az += 0.1 * o
        wipe = o
        shown = f < 0.22 ? N - 1 : -1
        pins = f > 0.45 && local < 0.962 ? 2 : 0
        tourIsland = f < 0.5 ? N - 1 : -1
      }

      /* ---------------- camera ---------------- */
      regions(frame)
      mixRegion(regP, regI, cur.ri, tmpReg)
      mixRegion(tmpReg, regF, cur.rf, reg)
      const aspect = frame.width / Math.max(1, frame.height)
      const dist = solveShot(cur, reg, aspect, pose)
      pose.parallax = calm ? 0 : Math.min(0.9, dist * 0.012)
      focus.set(cur.cx, cur.cy, cur.cz)

      /* ---------------- the world ---------------- */
      const wp = ctx.world.params
      wp.time = lerp(0.5, 0.6, local)
      wp.sunAzimuth = -0.45
      wp.focus.copy(focus)
      const ext = Math.max(cur.eu, cur.ev)
      wp.shadowSize = ext + (ext > 6 ? 3 : 2.2)

      const pp = ctx.post.params
      const tall = hud.metrics().tall
      pp.focusY = clamp(((reg.t + reg.b) / 2 + 1) / 2 - 0.02, 0.15, 0.85)
      const overview = ext > 6 ? 1 : 0
      pp.band = lerp(tall ? 0.13 : 0.2, tall ? 0.1 : 0.15, overview) * ((reg.t - reg.b) / 1.6)
      pp.blur = frame.mobile ? 5.5 : 7

      /* ---------------- islands ---------------- */
      const radius = ext + 7.5
      for (let i = 0; i < islands.length; i++) {
        const rt = islands[i]
        const b = 1.8 * clamp((local - buildStart(i)) / BUILD_LEN)
        const awake = rt.def.pos.distanceTo(focus) < radius + rt.def.radius
        if (awake !== rt.awake) {
          rt.awake = awake
          for (const o of unculled[i]) o.visible = awake
        }
        applyBuild(rt, b, jiggle(frame.time - rt.poke))
        if (awake && b > 0.2) for (const fn of rt.ticks) fn(t)
      }
      if (shown !== lastShown) {
        if (shown >= 0 && lastShown !== -2) islands[shown].poke = frame.time
        lastShown = shown
      }

      /* ---------------- the Hark van ---------------- */
      const stops = route.stops
      let vs = stops[0]
      let moving = 0
      if (local >= INTRO_END && local < SVC_END) {
        if (p < GLIDE && k > 0) {
          const g = smoothstep(0.02, 0.92, p / GLIDE)
          vs = lerp(stops[k - 1], stops[k], g)
          moving = Math.sin(g * Math.PI)
        } else vs = stops[k]
      } else if (local >= SVC_END) vs = stops[N - 1]
      route.at(vs, van.position)
      route.at(vs + 0.12, _a)
      if (vs + 0.12 > route.length) {
        route.at(vs - 0.12, _v)
        _a.copy(van.position).multiplyScalar(2).sub(_v)
      }
      const dx = _a.x - van.position.x, dz = _a.z - van.position.z
      van.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(_a.y - van.position.y, Math.hypot(dx, dz)) * 0.9, 'YXZ')
      van.position.y += Math.abs(Math.sin(t * 16)) * 0.018 * moving + 0.005
      const vb = clamp((islands[0].build - 0.5) / 0.6)
      van.visible = vb > 0.01
      van.scale.setScalar(0.92 * Math.max(0.001, vb))

      people.update(t)
      // the balloon trails the tour: a continuous (unsnapped) island index, lagging
      const kf = clamp((local - INTRO_END) / BEAT - 0.6, 0, N - 1)
      const k0 = Math.floor(kf), k1 = Math.min(N - 1, k0 + 1)
      balloonAt.lerpVectors(ISLANDS[k0].pos, ISLANDS[k1].pos, kf - k0)
      sky.update(t, balloonAt, focus, { pos: pose.position, target: pose.target, fov: pose.fov, aspect }, wipe)

      /* ---------------- HUD ---------------- */
      hud.update({ intro, shown, pins })
      // keep the world's distant islets out from behind the plate / intro copy
      {
        const m = hud.metrics()
        const bx = shown >= 0 ? m.plateBox : intro ? m.introBox : null
        const W = Math.max(1, frame.width), H = Math.max(1, frame.height)
        if (bx && bx.right > bx.left) {
          const pad = 14
          keep.x0 = (2 * (bx.left - pad)) / W - 1
          keep.x1 = (2 * (bx.right + pad)) / W - 1
          keep.y1 = 1 - (2 * (bx.top - pad)) / H
          keep.y0 = 1 - (2 * (bx.bottom + pad)) / H
          publishKeepOut(wp, keep)
        }
      }
      if (pins) {
        projCam.fov = pose.fov
        projCam.aspect = aspect
        projCam.position.copy(pose.position)
        projCam.lookAt(pose.target)
        projCam.updateProjectionMatrix()
        projCam.updateMatrixWorld()
        for (let i = 0; i < N; i++) {
          const def = ISLANDS[i]
          _v.copy(def.pos)
          _v.y += 1.95
          _v.project(projCam)
          pinXY[i * 2] = (_v.x * 0.5 + 0.5) * frame.width
          pinXY[i * 2 + 1] = (-_v.y * 0.5 + 0.5) * frame.height
          pinVis[i] = _v.z < 1 && islands[i].build > 1
        }
        hud.placePins(pinXY, pinVis)
      }
      void tourIsland
    },

    onPointerDown(frame: Frame, ctx: ChapterContext) {
      if (!islands.length) return
      ray.setFromCamera(frame.pointerRaw, ctx.camera)
      const hits = ray.intersectObjects(
        islands.filter(r => r.awake).map(r => r.mesh),
        false,
      )
      const hit = hits[0]
      if (!hit) return
      const rt = islands.find(r => r.mesh === hit.object)
      if (rt) rt.poke = frame.time
    },

    camera(_local: number, _frame: Frame, out: CameraPose) {
      out.position.copy(pose.position)
      out.target.copy(pose.target)
      out.fov = pose.fov
      out.roll = 0
      out.parallax = pose.parallax
    },
  }
}
