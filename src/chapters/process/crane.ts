import * as THREE from 'three'
import { Batch, paintFlat } from './util'
import { CRANE, JIB_Y, FOOT, FLOOR_H, type CraneState } from './timeline'

/*
 * A little tower crane in toy mustard: lattice mast, slewing jib with a
 * trolley, a hook on a cable, counterweights, a cab and a green Hark flag on
 * the peak. The mast is one merged mesh, the slewing top another; trolley,
 * cable, hook and slings are tiny separate pieces.
 */

const YEL = '#f2b134'
const YEL_D = '#d99a22'
const INK = '#2a3230'
const CONCRETE = '#bdb6aa'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export class Crane {
  root = new THREE.Group()
  top = new THREE.Group()
  private trolley: THREE.Mesh
  private cable: THREE.Mesh
  private hook: THREE.Group
  private slings: THREE.InstancedMesh
  private flag: THREE.Mesh
  /** world-space (site-local) hook eye position this frame */
  readonly hookPos = new THREE.Vector3()
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private s = new THREE.Vector3()
  private a = new THREE.Vector3()
  private b = new THREE.Vector3()
  private up = new THREE.Vector3(0, 1, 0)

  constructor(material: THREE.Material, led: THREE.Material, flagMat: THREE.Material, mobile: boolean) {
    this.root.position.copy(CRANE)

    // ---- mast (static)
    const mast = new Batch()
    const S = 0.3
    const H = JIB_Y - 0.28
    const T = 0.035
    mast.box(1.0, 0.14, 1.0, CONCRETE, 0, 0.07, 0)
    for (const [x, z] of [
      [-0.32, -0.32],
      [0.32, -0.32],
      [-0.32, 0.32],
      [0.32, 0.32],
    ])
      mast.box(0.26, 0.2, 0.26, CONCRETE, x, 0.24, z)
    const cs: [number, number][] = [
      [-S / 2, -S / 2],
      [S / 2, -S / 2],
      [S / 2, S / 2],
      [-S / 2, S / 2],
    ]
    for (const [x, z] of cs) mast.strut(v(x, 0.14, z), v(x, H, z), T * 1.3, YEL)
    const bays = Math.round((H - 0.14) / (mobile ? 0.42 : 0.3))
    const step = (H - 0.14) / bays
    for (let b = 0; b <= bays; b++) {
      const y = 0.14 + b * step
      for (let f = 0; f < 4; f++) {
        const [x0, z0] = cs[f]
        const [x1, z1] = cs[(f + 1) % 4]
        mast.strut(v(x0, y, z0), v(x1, y, z1), T, YEL)
        if (b < bays) {
          const odd = (b + f) % 2
          mast.strut(v(odd ? x0 : x1, y, odd ? z0 : z1), v(odd ? x1 : x0, y + step, odd ? z1 : z0), T * 0.8, YEL_D)
        }
      }
    }
    // ladder landing halfway
    mast.box(0.46, 0.03, 0.46, YEL_D, 0, H * 0.55, 0)
    const mastMesh = mast.build(material)
    this.root.add(mastMesh)

    // ---- slewing top (jib, counter-jib, cab, peak, ties)
    const top = new Batch()
    const J0 = 0.2
    const J1 = 4.45
    const jy = 0.02
    top.box(0.5, 0.26, 0.5, YEL, 0, jy - 0.1, 0)
    // cab, a little forward and to the side
    top.box(0.3, 0.3, 0.28, YEL, 0.22, jy - 0.08, 0.32)
    top.box(0.31, 0.14, 0.29, '#35516b', 0.25, jy - 0.02, 0.32, 0, 0, 0, 1)
    // jib: triangular lattice
    const jh = 0.24
    const jw = 0.11
    top.strut(v(J0, jy, -jw), v(J1, jy, -jw), T, YEL)
    top.strut(v(J0, jy, jw), v(J1, jy, jw), T, YEL)
    top.strut(v(J0, jy + jh, 0), v(J1 - 0.1, jy + jh * 0.4, 0), T, YEL)
    const jb = Math.round((J1 - J0) / (mobile ? 0.5 : 0.34))
    const js = (J1 - J0) / jb
    for (let i = 0; i <= jb; i++) {
      const x = J0 + i * js
      const topY = jy + jh * (1 - 0.6 * (i / jb))
      top.strut(v(x, jy, -jw), v(x, jy, jw), T * 0.8, YEL_D)
      if (i < jb) {
        const nx = x + js
        const nTopY = jy + jh * (1 - 0.6 * ((i + 1) / jb))
        const up = i % 2 === 0
        top.strut(v(up ? x : nx, jy, -jw), v(up ? nx : x, up ? nTopY : topY, 0), T * 0.8, YEL_D)
        top.strut(v(up ? x : nx, jy, jw), v(up ? nx : x, up ? nTopY : topY, 0), T * 0.8, YEL_D)
      }
    }
    // counter-jib + walkway + counterweights
    top.box(1.6, 0.05, 0.3, YEL, -0.95, jy, 0)
    top.box(1.5, 0.02, 0.36, '#9a9489', -0.92, jy + 0.035, 0)
    top.strut(v(-1.72, jy + 0.03, -0.18), v(-0.2, jy + 0.03, -0.18), T * 0.7, YEL_D)
    top.strut(v(-1.72, jy + 0.12, -0.18), v(-0.2, jy + 0.12, -0.18), T * 0.6, YEL_D)
    for (let i = 0; i < 3; i++) top.box(0.12, 0.3, 0.34, CONCRETE, -1.45 - i * 0.13, jy - 0.1, 0)
    // peak (A-frame) and tie rods
    const P = v(0, jy + 0.95, 0)
    for (const [x, z] of [
      [-0.14, -0.14],
      [0.14, -0.14],
      [0.14, 0.14],
      [-0.14, 0.14],
    ])
      top.strut(v(x, jy + 0.02, z), P, T, YEL)
    top.strut(P, v(3.1, jy + jh * 0.55, 0), 0.014, INK)
    top.strut(P, v(-1.6, jy + 0.08, 0), 0.014, INK)
    top.strut(v(0, jy + 0.95, 0), v(0, jy + 1.08, 0), 0.02, INK)
    const topMesh = top.build(material)
    this.top.add(topMesh)
    this.top.position.set(0, JIB_Y, 0)
    this.root.add(this.top)

    // green LEDs: jib tip and peak (Hark signal)
    const ledGeo = new THREE.SphereGeometry(0.045, 10, 8)
    for (const p of [v(J1 - 0.02, jy + 0.1, 0), v(0, jy + 1.1, 0)]) {
      const l = new THREE.Mesh(ledGeo, led)
      l.position.copy(p)
      this.top.add(l)
    }
    // pennant on the peak
    const fg = new THREE.PlaneGeometry(0.34, 0.2, 4, 1)
    fg.translate(0.17, 0, 0)
    this.flag = new THREE.Mesh(fg, flagMat)
    this.flag.position.set(0.01, jy + 1.0, 0)
    this.top.add(this.flag)

    // ---- trolley, cable, hook (children of the slewing top)
    const tb = new Batch()
    tb.box(0.22, 0.07, 0.26, YEL_D, 0, -0.035, 0)
    tb.box(0.08, 0.03, 0.08, INK, 0, -0.08, 0)
    this.trolley = tb.build(material)
    this.trolley.position.set(2, jy, 0)
    this.top.add(this.trolley)

    const cg = new THREE.CylinderGeometry(0.009, 0.009, 1, 5)
    cg.translate(0, -0.5, 0)
    this.cable = new THREE.Mesh(paintFlat(cg, INK), material)
    this.cable.castShadow = true
    this.top.add(this.cable)

    const hb = new Batch()
    hb.box(0.13, 0.12, 0.09, YEL, 0, 0.06 - 0.02, 0)
    hb.box(0.14, 0.03, 0.1, INK, 0, 0.11, 0)
    const hookG = new THREE.TorusGeometry(0.035, 0.012, 6, 10, Math.PI * 1.4)
    hb.put(hookG, INK, 0, -0.07, 0, 0, 1, 1, 1, 0, Math.PI * 0.8)
    this.hook = new THREE.Group()
    const hm = hb.build(material)
    hm.position.y = -0.04
    this.hook.add(hm)
    this.top.add(this.hook)

    // four slings from the hook to the floor's lifting eyes
    const sg = new THREE.CylinderGeometry(0.006, 0.006, 1, 4)
    sg.translate(0, 0.5, 0)
    this.slings = new THREE.InstancedMesh(paintFlat(sg, INK), material, 4)
    this.slings.frustumCulled = false
    this.slings.castShadow = false
    this.root.add(this.slings)

    this.root.traverse(o => {
      const m = o as THREE.Mesh
      if (m.isMesh && m !== this.slings) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
  }

  /**
   * Pose the crane. `swing` (0..1) scales the pendulum sway of the hook
   * (zero at pick-up and set-down so loads meet their marks). The hook eye
   * in site-local space lands in hookPos.
   */
  pose(st: CraneState, time: number, calm: boolean, swing: number) {
    this.top.rotation.y = st.yaw
    this.trolley.position.x = st.r
    const swayAmt = swing
    const sx = calm ? 0 : Math.sin(time * 1.3) * 0.035 * swayAmt
    const sz = calm ? 0 : Math.sin(time * 1.05 + 1.2) * 0.03 * swayAmt
    const len = Math.max(0.05, st.cable)
    this.cable.position.set(st.r, -0.08, 0)
    // lean the cable toward the swung hook
    this.cable.scale.set(1, len, 1)
    this.cable.rotation.set(-sz / len, 0, sx / len)
    this.hook.position.set(st.r + sx, -0.08 - len, sz)
    // hook eye in site space
    this.top.updateMatrix()
    this.hookPos.set(st.r + sx, -0.08 - len, sz).applyMatrix4(this.top.matrix).add(CRANE)
    if (!calm) {
      const f = this.flag.geometry.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < f.count; i++) {
        const x = f.getX(i)
        f.setZ(i, Math.sin(time * 7 - x * 16) * x * 0.14)
      }
      f.needsUpdate = true
      this.flag.rotation.y = 2.4 - st.yaw + Math.sin(time * 0.6) * 0.2
    }
  }

  /** Slings from the hook to the four lifting eyes on a floor whose base center is `base`. */
  setSlings(base: THREE.Vector3 | null) {
    this.slings.visible = !!base
    if (!base) {
      this.s.set(0, 0, 0)
      this.m.makeScale(0, 0, 0)
      for (let i = 0; i < 4; i++) this.slings.setMatrixAt(i, this.m)
      this.slings.instanceMatrix.needsUpdate = true
      return
    }
    const hx = this.hookPos.x - CRANE.x
    const hy = this.hookPos.y - CRANE.y - 0.1
    const hz = this.hookPos.z - CRANE.z
    const ex = FOOT.w * 0.32
    const ez = FOOT.d * 0.3
    let i = 0
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        this.a.set(base.x - CRANE.x + sx * ex, base.y - CRANE.y + FLOOR_H + 0.02, base.z - CRANE.z + sz * ez)
        this.b.set(hx, hy, hz).sub(this.a)
        const len = this.b.length()
        this.q.setFromUnitVectors(this.up, this.b.divideScalar(len))
        this.m.compose(this.a, this.q, this.s.set(1, len, 1))
        this.slings.setMatrixAt(i++, this.m)
      }
    this.slings.instanceMatrix.needsUpdate = true
  }
}
