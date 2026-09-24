import * as THREE from 'three'
import { rng } from '../core/math'
import { clayVC, C } from '../kit/palette'
import { cloudGeometry, cloudMaterial, treeGeometry } from '../kit/nature'
import { makeIsland } from '../kit/island'
import { Builder } from '../kit/geo'

/*
 * Depth dressing that follows the camera: a field of big soft clouds drifting
 * below (and a few far above) the islands, and a handful of tiny distant
 * floating islands, on slow rings around the chapter's island
 * (world.params.focus). Everything fades into the haze with distance.
 * ~5 draw calls, no shadows.
 *
 * The distant islands never sit behind copy or crowd the subject: each frame
 * every island is projected with the camera, and it sinks + shrinks away
 * while its screen footprint nears
 *   - the copy column (landscape: the left of the screen above the bottom
 *     quarter, where every chapter's headline and card lives; portrait: all
 *     but a strip on the right),
 *   - the chapter's own island (the screen bounds of a disc of radius
 *     focusR around the focus: the camera's view cone toward it),
 *   - world.params.keepOut, an extra NDC rect a chapter may publish,
 * and grows back once it has drifted clear. Hiding is derived from the
 * current camera + ring angle (lightly eased so a rect appearing never pops),
 * so any jumped-to position is correct.
 */

/** Screen-space rect in NDC: x right, y UP, both -1..1 (x0 < x1, y0 < y1). */
export interface NdcRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Default copy column (NDC) when the screen is landscape / portrait. */
const COPY_LAND: NdcRect = { x0: -2, y0: -0.5, x1: 0.04, y1: 2 }
const COPY_PORT: NdcRect = { x0: -2, y0: -2, x1: 0.42, y1: 2 }
/** how far (NDC) before touching a rect an island starts to go */
const FADE = 0.16

/** Separation (NDC, <0 = overlapping) between a footprint box and a rect. */
function gap(cx: number, cy: number, rx: number, ry: number, r: NdcRect) {
  return Math.max(r.x0 - (cx + rx), cx - rx - r.x1, r.y0 - (cy + ry), cy - ry - r.y1)
}

function away(sep: number) {
  const t = Math.min(1, Math.max(0, sep / FADE))
  return 1 - t * t * (3 - 2 * t)
}

export const HAZE = {
  uHaze: { value: new THREE.Color('#dcecf6') },
  uHazeNear: { value: 50 },
  uHazeFar: { value: 360 },
}

/** Clone a kit material and fade it into the haze with view distance. */
function hazed(base: THREE.MeshStandardMaterial, key: string, lift = 0) {
  const m = base.clone()
  const inner = base.onBeforeCompile
  if (lift) {
    m.emissive = new THREE.Color('#ffffff')
    m.emissiveIntensity = lift
  }
  m.onBeforeCompile = (shader, r) => {
    inner.call(m, shader, r)
    shader.uniforms.uHaze = HAZE.uHaze
    shader.uniforms.uHazeNear = HAZE.uHazeNear
    shader.uniforms.uHazeFar = HAZE.uHazeFar
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nuniform float uHazeNear, uHazeFar;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(uHazeNear, uHazeFar, length(vViewPosition)) * 0.92);`,
      )
  }
  m.customProgramCacheKey = () => key
  return m
}

interface Item {
  /** ring angle (rad) at time 0 */
  a0: number
  /** angular drift (rad/s) */
  w: number
  r: number
  y: number
  scale: number
  ry: number
}

export class FarField {
  object = new THREE.Group()
  private clouds: { mesh: THREE.InstancedMesh; items: Item[] }[] = []
  /** hide: current eased 0..1 (1 = gone); c / r: bounding sphere (local) */
  private islands: { mesh: THREE.Mesh; item: Item; hide: number; c: THREE.Vector3; r: number }[] = []
  private first = true
  private v = new THREE.Vector3()
  private subj: NdcRect = { x0: 0, y0: 0, x1: 0, y1: 0 }
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private s = new THREE.Vector3()
  private e = new THREE.Euler()

  /*
   * Everything sits on slowly drifting rings around the (damped) focus, below
   * the chapter's island, so whichever way a telephoto chapter camera looks
   * there is depth behind the subject — and nothing ever crosses the island.
   */
  constructor(mobile: boolean) {
    const rand = rng(77)
    const cloudMat = hazed(cloudMaterial(), 'far-cloud')
    const perShape = mobile ? 4 : 5
    for (let v = 0; v < 3; v++) {
      const items: Item[] = []
      for (let i = 0; i < perShape; i++) {
        const k = v * perShape + i
        const high = i === perShape - 1
        items.push({
          a0: (k / (perShape * 3)) * Math.PI * 2 + rand() * 0.3,
          w: (0.004 + rand() * 0.004) * (rand() < 0.5 ? 1 : -1),
          r: high ? 150 + rand() * 80 : 46 + rand() * 70,
          y: high ? 16 + rand() * 24 : -26 - rand() * 34,
          scale: high ? 7 + rand() * 5 : 3.6 + rand() * 3.6,
          ry: rand() * Math.PI,
        })
      }
      const mesh = new THREE.InstancedMesh(cloudGeometry(v + 1), cloudMat, items.length)
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      this.object.add(mesh)
      this.clouds.push({ mesh, items })
    }
    // distant islands: tiny merged dioramas
    const islandMat = hazed(clayVC(), 'far-island')
    const count = mobile ? 8 : 12
    for (let i = 0; i < count; i++) {
      const R = 2 + rand() * 2.4
      const isl = makeIsland({ radius: R, seed: 40 + i, detail: 0.45, hanging: 2, depth: R * 1.1, drips: false })
      const b = new Builder()
      b.addPainted((isl.children[0] as THREE.Mesh).geometry)
      const trees = 3 + Math.floor(rand() * 4)
      for (let k = 0; k < trees; k++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R * 0.7
        b.addPainted(treeGeometry(k + i * 5), { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.9 + rand() * 0.5, ry: rand() * 6 })
      }
      if (rand() < 0.75) {
        const hx = (rand() - 0.5) * R * 0.6, hz = (rand() - 0.5) * R * 0.6
        b.rbox(0.9, 0.7, 0.8, 0.05, [C.white, C.butter, C.blush][i % 3], { x: hx, y: 0.37, z: hz }, 1)
        b.add(new THREE.ConeGeometry(0.72, 0.5, 4).rotateY(Math.PI / 4), [C.roofRed, C.roofBlue, C.roofTeal][i % 3], { x: hx, y: 0.97, z: hz, sx: 0.95, sz: 0.85 })
      }
      const mesh = new THREE.Mesh(b.build(), islandMat)
      ;(isl.children[0] as THREE.Mesh).geometry.dispose()
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      this.object.add(mesh)
      const bs = mesh.geometry.boundingSphere!
      this.islands.push({
        mesh,
        hide: 0,
        c: bs.center.clone(),
        r: bs.radius,
        item: {
          a0: ((i + 0.3 + rand() * 0.4) / count) * Math.PI * 2,
          w: 0.002 + rand() * 0.002,
          // three depth layers, the farther the lower: the chapter cameras look
          // ~30° down through a telephoto, so this keeps them in the sky band
          // above and beside the subject rather than off the top of the frame
          r: 56 + (i % 3) * 24 + rand() * 16,
          y: -18 - (i % 3) * 7 - rand() * 8,
          scale: 1,
          ry: rand() * Math.PI * 2,
        },
      })
    }
  }

  private place(it: Item, time: number, focus: THREE.Vector3, out: THREE.Vector3) {
    const a = it.a0 + time * it.w
    return out.set(focus.x + Math.cos(a) * it.r, focus.y + it.y, focus.z + Math.sin(a) * it.r)
  }

  /**
   * @param focusR  radius (world units) of the chapter's subject around focus
   * @param keepOut extra screen rect (NDC) to keep the islands out of
   * @param dt      frame delta (eases the hide; 0 = snap)
   */
  update(time: number, camera: THREE.Camera, focus: THREE.Vector3, amount: number, focusR: number, keepOut: NdcRect | null, dt: number) {
    for (const c of this.clouds) {
      for (let i = 0; i < c.items.length; i++) {
        const it = c.items[i]
        this.place(it, time, focus, this.p)
        const sc = it.scale * amount
        this.s.set(sc, sc * 0.8, sc)
        this.q.setFromEuler(this.e.set(0, it.ry + time * it.w, 0))
        c.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s))
      }
      c.mesh.instanceMatrix.needsUpdate = true
      c.mesh.visible = amount > 0.01
    }

    // ---- distant islands: keep them off the copy and the subject
    camera.updateMatrixWorld()
    const P = camera.projectionMatrix.elements
    const view = camera.matrixWorldInverse
    const persp = (camera as THREE.PerspectiveCamera).isPerspectiveCamera
    // aspect straight from the projection (P[5] / P[0]), so view offsets and odd cameras still work
    const aspect = persp && P[0] ? P[5] / P[0] : 1
    const copy = aspect >= 1 ? COPY_LAND : COPY_PORT
    const subj = persp ? this.subject(focus, focusR, view, P) : null
    const ease = this.first || dt <= 0 ? 1 : 1 - Math.exp(-dt * 7)
    this.first = false
    for (const isl of this.islands) {
      const { mesh, item } = isl
      this.place(item, time, focus, mesh.position)
      const yaw = item.ry + time * 0.01
      let target = 0
      if (persp) {
        // bounding sphere centre (the island is only ever yawed + uniformly scaled)
        const v = this.v.copy(isl.c).applyAxisAngle(UP, yaw).add(mesh.position).applyMatrix4(view)
        const w = -v.z
        if (w > 1) {
          const cx = (P[0] * v.x + P[8] * v.z) / w
          const cy = (P[5] * v.y + P[9] * v.z) / w
          const ry = (isl.r * P[5]) / w
          const rx = ry / aspect
          target = away(gap(cx, cy, rx, ry, copy))
          // the subject only needs clearing, not a wide berth: sky right above it is fine
          if (subj) target = Math.max(target, away(gap(cx, cy, rx, ry, subj) * 3))
          if (keepOut && keepOut.x1 > keepOut.x0 && keepOut.y1 > keepOut.y0) target = Math.max(target, away(gap(cx, cy, rx, ry, keepOut)))
          // never loom close to the camera
          target = Math.max(target, 1 - Math.min(1, Math.max(0, (w - 30) / 20)))
        } else target = 1
      }
      isl.hide += (target - isl.hide) * ease
      const h = isl.hide
      const k = 1 - h * h * (3 - 2 * h)
      // sink a little as it goes, like drifting down into the haze
      mesh.position.y -= h * 5
      mesh.scale.setScalar(Math.max(0.001, amount * k))
      mesh.rotation.y = yaw
      mesh.visible = amount * k > 0.01
    }
  }

  /**
   * The chapter's island on screen: NDC bounds of a disc of radius R around
   * the focus (with a little relief above and the hanging rock below).
   */
  private subject(focus: THREE.Vector3, R: number, view: THREE.Matrix4, P: number[]): NdcRect | null {
    const r = this.subj
    r.x0 = r.y0 = Infinity
    r.x1 = r.y1 = -Infinity
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      for (let j = 0; j < 2; j++) {
        const v = this.v.set(focus.x + Math.cos(a) * R * 0.9, focus.y + (j ? 0.08 : -0.25) * R, focus.z + Math.sin(a) * R * 0.9).applyMatrix4(view)
        const w = -v.z
        if (w < 0.5) return null
        const x = (P[0] * v.x + P[8] * v.z) / w
        const y = (P[5] * v.y + P[9] * v.z) / w
        if (x < r.x0) r.x0 = x
        if (x > r.x1) r.x1 = x
        if (y < r.y0) r.y0 = y
        if (y > r.y1) r.y1 = y
      }
    }
    return r
  }
}

const UP = new THREE.Vector3(0, 1, 0)
