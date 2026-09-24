import * as THREE from 'three'
import { rng } from '../../core/math'
import { C, MAT, clayVC } from '../../kit/palette'
import { Builder, col } from '../../kit/geo'
import { cloudGeometry, cloudMaterial, makeBirds } from '../../kit/nature'
import { makeBalloon, makeCrowd, type Crowd } from '../../kit/props'
import { logoFaceGeometry } from '../../logo/logo'
import { rboxGeo, vcMesh } from './bake'
import { K, type ActorPose } from './workshops'
import type { IslandRT } from './islands'
import { ACROSS, DEEP, OVERVIEW, angDiff } from './layout'

/*
 * Everything that moves between the islands:
 *   Bridges  plank-and-rope bridges from each island to the next (one mesh)
 *   Route    the Hark van's tour: lanes + bridges as one world polyline, with
 *            the arc length of each island's stop (scroll decides where it is)
 *   People   every townsfolk actor on every island (two instanced meshes)
 *   Sky      a sea of clouds below, puffs drifting between the islands, the
 *            Hark balloon, gulls, and the big wipe clouds for the in/out beats
 */

const _v = new THREE.Vector3()
const _w = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()

function localToWorld(rt: IslandRT, x: number, y: number, z: number, out: THREE.Vector3) {
  rt.group.updateMatrixWorld()
  return out.set(x, y, z).applyMatrix4(rt.group.matrixWorld)
}

// ------------------------------------------------------------------ bridges + route

export interface Bridge {
  a: THREE.Vector3
  b: THREE.Vector3
  at(t: number, out: THREE.Vector3): THREE.Vector3
}

function makeBridgeCurve(a: THREE.Vector3, b: THREE.Vector3): Bridge {
  const len = a.distanceTo(b)
  const arch = Math.min(0.45, 0.12 + len * 0.06)
  return {
    a,
    b,
    at(t, out) {
      return out.lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t + Math.sin(t * Math.PI) * arch)
    },
  }
}

export function buildBridges(islands: IslandRT[]) {
  const bridges: Bridge[] = []
  for (let k = 0; k < islands.length - 1; k++) {
    const A = islands[k], B = islands[k + 1]
    const pa = localToWorld(A, Math.cos(A.def.aOut) * (A.rimAt(A.def.aOut) - 0.12), 0.03, Math.sin(A.def.aOut) * (A.rimAt(A.def.aOut) - 0.12), new THREE.Vector3())
    const pb = localToWorld(B, Math.cos(B.def.aIn) * (B.rimAt(B.def.aIn) - 0.12), 0.03, Math.sin(B.def.aIn) * (B.rimAt(B.def.aIn) - 0.12), new THREE.Vector3())
    bridges.push(makeBridgeCurve(pa, pb))
  }
  const bld = new Builder()
  const up = new THREE.Vector3(0, 1, 0)
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), p = new THREE.Vector3(), p2 = new THREE.Vector3()
  const HW = 0.28
  for (const br of bridges) {
    const len = br.a.distanceTo(br.b)
    const n = Math.max(6, Math.round(len / 0.15))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      br.at(t, p)
      br.at(Math.min(1, t + 0.01), p2)
      if (t >= 1) br.at(t - 0.01, p2).sub(p).negate().add(p)
      tan.subVectors(p2, p).normalize()
      const yaw = Math.atan2(-tan.z, tan.x)
      const pitch = Math.asin(THREE.MathUtils.clamp(tan.y, -1, 1))
      bld.box(0.11, 0.04, HW * 2, i % 3 === 1 ? C.woodDark : C.wood, { x: p.x, y: p.y - 0.02, z: p.z, ry: yaw, rz: pitch })
    }
    // posts + ropes
    side.crossVectors(up, tan.subVectors(br.b, br.a).setY(0).normalize()).normalize()
    for (const end of [br.a, br.b]) {
      for (const sgn of [-1, 1]) {
        _v.copy(end).addScaledVector(side, sgn * (HW + 0.02))
        bld.cyl(0.028, 0.034, 0.42, 6, C.woodDark, { x: _v.x, y: _v.y + 0.19, z: _v.z })
        bld.sphere(0.036, C.woodDark, { x: _v.x, y: _v.y + 0.42, z: _v.z }, 0)
      }
    }
    for (const sgn of [-1, 1]) {
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 12; i++) {
        const t = i / 12
        br.at(t, p)
        pts.push(p.clone().addScaledVector(side, sgn * (HW + 0.02)).setY(p.y + 0.38 - Math.sin(t * Math.PI) * 0.1))
      }
      bld.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.014, 4), C.woodDark)
      for (let i = 1; i < 12; i++) {
        const t = i / 12
        br.at(t, p)
        _w.copy(p).addScaledVector(side, sgn * (HW + 0.02))
        const h = 0.38 - Math.sin(t * Math.PI) * 0.1
        bld.cyl(0.006, 0.006, h, 3, C.woodDark, { x: _w.x, y: _w.y + h / 2 - 0.02, z: _w.z })
      }
    }
  }
  const mesh = new THREE.Mesh(bld.build(), clayVC())
  mesh.castShadow = true
  mesh.receiveShadow = true
  // LED lanterns on the bridge posts: Hark green
  const leds = new Builder()
  for (const br of bridges) {
    tan.subVectors(br.b, br.a).setY(0).normalize()
    side.crossVectors(up, tan).normalize()
    for (const end of [br.a, br.b]) {
      _v.copy(end).addScaledVector(side, HW + 0.02)
      leds.sphere(0.03, C.signalBright, { x: _v.x, y: _v.y + 0.47, z: _v.z }, 1)
    }
  }
  const ledMesh = new THREE.Mesh(leds.build(), MAT.led)
  return { bridges, mesh, ledMesh }
}

export class Route {
  pts: THREE.Vector3[] = []
  cum: number[] = []
  /** arc length at each island's stop */
  stops: number[] = []
  length = 0

  constructor(islands: IslandRT[], bridges: Bridge[]) {
    const add = (p: THREE.Vector3) => {
      const last = this.pts[this.pts.length - 1]
      if (last && last.distanceToSquared(p) < 1e-6) return
      this.cum.push(last ? this.cum[this.cum.length - 1] + last.distanceTo(p) : 0)
      this.pts.push(p.clone())
    }
    const p = new THREE.Vector3()
    const arc = (rt: IslandRT, a0: number, a1: number) => {
      const rl = rt.def.lane
      const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * rl) / 0.12))
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n
        add(localToWorld(rt, Math.cos(a) * rl, 0.03, Math.sin(a) * rl, p))
      }
    }
    islands.forEach((rt, k) => {
      const d = rt.def
      if (k > 0) {
        const aIn = d.aIn
        add(localToWorld(rt, Math.cos(aIn) * (rt.rimAt(aIn) - 0.12), 0.03, Math.sin(aIn) * (rt.rimAt(aIn) - 0.12), p))
        arc(rt, aIn, aIn + angDiff(aIn, d.aStop))
      } else add(localToWorld(rt, Math.cos(d.aStop) * d.lane, 0.03, Math.sin(d.aStop) * d.lane, p))
      this.stops.push(this.cum[this.cum.length - 1])
      if (k < islands.length - 1) {
        arc(rt, d.aStop, d.aStop + angDiff(d.aStop, d.aOut))
        const br = bridges[k]
        for (let i = 0; i <= 16; i++) add(br.at(i / 16, p))
      }
    })
    this.length = this.cum[this.cum.length - 1]
  }

  at(s: number, out: THREE.Vector3) {
    const c = this.cum
    const x = THREE.MathUtils.clamp(s, 0, this.length)
    let lo = 0, hi = c.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (c[mid] <= x) lo = mid
      else hi = mid
    }
    const f = (x - c[lo]) / Math.max(1e-6, c[hi] - c[lo])
    return out.lerpVectors(this.pts[lo], this.pts[hi], f)
  }
}

/** The little Hark-green van that leads the tour. Faces +x. */
export function makeVan() {
  const g = new THREE.Group()
  const body = vcMesh(b => {
    b.add(rboxGeo(0.5, 0.22, 0.26, 0.06), K.hark, { y: 0.06 })
    b.add(rboxGeo(0.34, 0.12, 0.25, 0.05), C.white, { x: -0.07, y: 0.24 })
    b.box(0.02, 0.1, 0.21, '#3f5866', { x: 0.1, y: 0.3, rz: -0.35 })
    b.box(0.2, 0.08, 0.255, '#3f5866', { x: -0.08, y: 0.28 })
    b.box(0.08, 0.04, 0.22, C.ink, { x: 0.25, y: 0.08 })
    for (const [x, z] of [[0.15, 0.13], [-0.16, 0.13], [0.15, -0.13], [-0.16, -0.13]]) {
      b.cyl(0.058, 0.058, 0.05, 12, C.ink, { x, y: 0.058, z, rx: Math.PI / 2 })
      b.cyl(0.026, 0.026, 0.055, 8, K.steel, { x, y: 0.058, z, rx: Math.PI / 2 })
    }
    // the Hark mark on both flanks
    const mark = logoFaceGeometry()
    for (const sgn of [1, -1]) {
      b.add(mark.clone(), C.white, { x: -0.04, y: 0.17, z: sgn * 0.132, s: 0.11, ry: sgn > 0 ? 0 : Math.PI })
    }
  })
  g.add(body)
  const lights = new Builder()
  lights.sphere(0.022, '#fff3d6', { x: 0.25, y: 0.14, z: 0.085 }, 1)
  lights.sphere(0.022, '#fff3d6', { x: 0.25, y: 0.14, z: -0.085 }, 1)
  const lm = new THREE.Mesh(lights.build(), MAT.warm)
  g.add(lm)
  g.scale.setScalar(0.92)
  return g
}

// ------------------------------------------------------------------ people

export class People {
  crowd: Crowd
  private list: { rt: IslandRT; a: (t: number, o: ActorPose) => void }[] = []
  private pose: ActorPose = { x: 0, y: 0, z: 0, yaw: 0, s: 1 }

  constructor(islands: IslandRT[]) {
    for (const rt of islands) for (const a of rt.actors) this.list.push({ rt, a: a.pose })
    this.crowd = makeCrowd(Math.max(1, this.list.length), { seed: 7, variants: 7 })
  }

  update(t: number) {
    const o = this.pose
    const c = this.crowd
    for (let i = 0; i < this.list.length; i++) {
      const { rt, a } = this.list[i]
      if (!rt.awake && rt.build >= 1.8) continue
      a(t, o)
      const k = Math.min(1, Math.max(0, (rt.build - 0.7) / 0.5)) * o.s
      if (k < 0.01) {
        c.hide(i)
        continue
      }
      rt.group.updateMatrixWorld()
      _v.set(o.x, o.y, o.z).applyMatrix4(rt.group.matrixWorld)
      c.set(i, _v.x, _v.y, _v.z, o.yaw + rt.def.az, 0, 0.72 * k)
    }
    c.commit()
  }
}

// ------------------------------------------------------------------ sky life

export class Sky {
  group = new THREE.Group()
  sea: THREE.InstancedMesh
  mid: THREE.InstancedMesh
  wipe: THREE.InstancedMesh
  balloon: THREE.Group
  birds: THREE.Mesh
  private midBase: { u: number; v: number; y: number; s: number; r: number }[] = []
  private wipeBase: { x: number; y: number; s: number; r: number; side: number }[] = []

  constructor(mobile: boolean) {
    const rand = rng(303)
    this.sea = new THREE.InstancedMesh(cloudGeometry(1), cloudMaterial(), 1)
    this.sea.visible = false
    const gaps: [number, number][] = [
      [-7.5, 0.3], [0, 0.5], [7.4, 0.2], [10, 4.5], [5.1, 7.9], [-2.5, 8], [-9, 12], [0.5, 15.8], [8, 16], [-14.5, 8], [15, 9], [-7, 16],
    ]
    const nMid = mobile ? 5 : 8
    this.mid = new THREE.InstancedMesh(cloudGeometry(3), cloudMaterial(), nMid)
    for (let i = 0; i < nMid; i++) this.midBase.push({ u: gaps[i][0], v: gaps[i][1], y: -2.4 - rand() * 1.4, s: 0.55 + rand() * 0.35, r: rand() * 6 })
    const nWipe = 9
    this.wipe = new THREE.InstancedMesh(cloudGeometry(2), cloudMaterial(), nWipe)
    for (let i = 0; i < nWipe; i++) this.wipeBase.push({ x: -1 + (i / (nWipe - 1)) * 2, y: (rand() - 0.5) * 1.6, s: 0.8 + rand() * 0.5, r: rand() * 6, side: i % 2 ? 1 : -1 })
    for (const m of [this.sea, this.mid, this.wipe]) {
      m.castShadow = false
      m.receiveShadow = false
      m.frustumCulled = false
      this.group.add(m)
    }
    this.wipe.renderOrder = 5

    // the Hark balloon (kit)
    this.balloon = makeBalloon({ hark: true, seed: 4 })
    this.balloon.scale.setScalar(0.85)
    this.group.add(this.balloon)

    this.birds = makeBirds({ count: mobile ? 4 : 6, radius: 4.6, height: 4.8, size: 0.14, seed: 12 })
    this.group.add(this.birds)
  }

  update(t: number, balloonAt: THREE.Vector3, focus: THREE.Vector3, cam: { pos: THREE.Vector3; target: THREE.Vector3; fov: number; aspect: number }, wipe: number) {
    this.midBase.forEach((c, i) => {
      _v.set(0, 0, 0)
        .addScaledVector(ACROSS, c.u + Math.sin(t * 0.07 + i) * 1.2)
        .addScaledVector(DEEP, c.v)
        .setY(c.y + Math.sin(t * 0.3 + i * 2) * 0.1)
      _q.setFromEuler(_e.set(0, c.r, 0))
      _s.setScalar(c.s)
      this.mid.setMatrixAt(i, _m.compose(_v, _q, _s))
    })
    this.mid.instanceMatrix.needsUpdate = true

    // the balloon drifts along behind the tour, a little slower than the camera
    this.balloon.position.copy(balloonAt).addScaledVector(DEEP, 8.5).addScaledVector(ACROSS, -2.5 + Math.sin(t * 0.05) * 1.2)
    this.balloon.position.y += 4.6 + Math.sin(t * 0.6) * 0.15
    this.balloon.rotation.y = t * 0.08

    // gulls circle whichever island the camera is on
    this.birds.position.copy(focus)

    // big wipe clouds hung in front of the camera: they part as the chapter opens, close as it ends
    const vis = wipe > 0.001
    this.wipe.visible = vis
    if (vis) {
      const fwd = _w.subVectors(cam.target, cam.pos)
      const dist = fwd.length()
      fwd.normalize()
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
      const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
      const d = dist * 0.45
      const hh = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * d
      const hw = hh * cam.aspect
      this.wipeBase.forEach((c, i) => {
        const open = 1 - wipe
        const x = c.x * hw * 0.9 + c.side * open * hw * 1.9
        const y = c.y * hh * 0.9
        _v.copy(cam.pos).addScaledVector(fwd, d).addScaledVector(right, x).addScaledVector(up, y)
        _q.setFromEuler(_e.set(0, c.r + t * 0.02, 0))
        _s.setScalar(c.s * hh * 0.55)
        this.wipe.setMatrixAt(i, _m.compose(_v, _q, _s))
      })
      this.wipe.instanceMatrix.needsUpdate = true
    }
  }
}

