import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { clamp, rng } from '../../core/math'
import { paint } from './batch'
import { spring, pol, faceCentre, Y0, type Seat, type SpeakerSpot } from './square'

/*
 * The townsfolk: toy peg people (rounded body, big round head with two dot
 * eyes and rosy cheeks, hair cap, stubby arms), all instanced, so ~80 of them
 * cost five draw calls. Everything is a pure function of (time, focus), so the
 * crowd looks right at any scroll position:
 *
 *  - speakers  (8) stand on their soapboxes; the one with the floor hops up,
 *              bounces as they talk and waves an arm
 *  - listeners small groups by each spot; they chat among themselves, then
 *              turn to face their speaker when it's their turn
 *  - walkers   stroll in loops round the fountain (bob, sway, swing arms)
 *              and glance over at whoever is talking as they pass
 *  - sitters   at the café tables; keepers behind the stalls
 */

type Kind = 'speaker' | 'listener' | 'walker' | 'sitter' | 'keeper'

interface Person {
  kind: Kind
  x: number
  z: number
  y: number
  yaw: number
  /** speaker index (speakers + their listeners) */
  owner: number
  ring: number
  speed: number
  phase: number
  sit: boolean
  seed: number
  /** pop-in delay (0..1 of the pop window) */
  delay: number
  hair: boolean
  /** chatting partner direction for idle listeners */
  chatYaw: number
}

/** Shirt colours for the eight voices (their bubbles show the same dot). */
export const SPEAKER_SHIRTS = ['#e2694a', '#4d8fd6', '#f0b43c', '#9b7fd1', '#2fa36b', '#f28db2', '#4bb3c9', '#d9774b']

const SHIRTS = ['#e2694a', '#4d8fd6', '#f0b43c', '#f6f1e7', '#9b7fd1', '#f28db2', '#6fb5e6', '#d9774b', '#46b36b', '#3a4a5c', '#c8603a', '#ffd166']
const SKINS = ['#f3cfb0', '#e7b48f', '#c98d63', '#9a6440', '#6e4630', '#f6dcc4']
const HAIRS = ['#3b2a20', '#1f1b18', '#8a5a33', '#e2b862', '#b5542c', '#d9d4cc', '#5b3a26']

const NECK = 0.395
const SHOULDER = 0.255

export interface CrowdFrame {
  t: number
  calm: boolean
  /** where attention goes (the active speaker's head) and how strongly */
  focus: THREE.Vector3
  focusW: number
  /** which speaker the focus belongs to (-1 none) */
  focusOwner: number
  /** per-speaker 0..1 "has the floor" */
  talk: Float32Array
  /** per-speaker hop progress 0..1 (outside 0..1 = grounded) */
  hop: Float32Array
  /** 0..1 pop-in window progress for the whole crowd */
  pop: number
}

export class Crowd {
  people: Person[] = []
  body!: THREE.InstancedMesh
  head!: THREE.InstancedMesh
  hair!: THREE.InstancedMesh
  arms!: THREE.InstancedMesh
  group = new THREE.Group()
  /** head-top world positions of the speakers (updated every frame) */
  speakerHeads: THREE.Vector3[] = []
  private looks: { shirt: string; skin: string; hair: string | null }[] = []

  /** colours of speaker k (for the bubble's little portrait) */
  speakerLook(k: number) {
    return this.looks[k] ?? { shirt: SPEAKER_SHIRTS[k % SPEAKER_SHIRTS.length], skin: SKINS[0], hair: HAIRS[0] }
  }

  private mBody = new THREE.Matrix4()
  private mLocal = new THREE.Matrix4()
  private mOut = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()
  private col = new THREE.Color()
  private zero = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(
    spots: SpeakerSpot[],
    seats: Seat[],
    keepers: Seat[],
    balloonSeller: THREE.Vector3,
    obstacles: { x: number; z: number; r: number }[],
    mobile: boolean,
  ) {
    const rand = rng(404)
    const P = this.people
    const add = (p: Partial<Person> & Pick<Person, 'kind' | 'x' | 'z'>) => {
      P.push({
        y: Y0,
        yaw: 0,
        owner: -1,
        ring: 0,
        speed: 0,
        phase: 0,
        sit: false,
        seed: P.length * 7 + 3,
        delay: rand() * 0.6,
        hair: rand() > 0.18,
        chatYaw: 0,
        ...p,
      })
    }

    // speakers first: index i = testimonial i
    spots.forEach((s, i) => {
      add({ kind: 'speaker', x: s.pos.x, z: s.pos.z, y: s.pos.y, yaw: s.yaw, owner: i, hair: true, delay: 0.1 + i * 0.05 })
      this.speakerHeads.push(new THREE.Vector3(s.pos.x, s.pos.y + NECK + 0.1, s.pos.z))
    })

    // is this a free spot to stand? (props, other people, the walkers' rings)
    const rings = [2.3, 2.76]
    const free = (x: number, z: number) => {
      for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.14) return false
      for (const q of P) if (q.kind !== 'walker' && Math.hypot(x - q.x, z - q.z) < 0.27) return false
      const r = Math.hypot(x, z)
      for (const rr of rings) if (Math.abs(r - rr) < 0.29) return false
      return r < 4.7
    }

    // listeners: a little knot facing each spot (toward the square)
    const per = mobile ? 2 : 3
    spots.forEach((s, i) => {
      const fx = Math.sin(s.yaw)
      const fz = Math.cos(s.yaw)
      // the fountain speaker faces out: their knot gathers round the rim instead
      const fountain = Math.hypot(s.pos.x, s.pos.z) < 2
      const dist = fountain ? 0.62 : 0.9
      const cx = s.pos.x + fx * dist
      const cz = s.pos.z + fz * dist
      const lx = Math.cos(s.yaw)
      const lz = -Math.sin(s.yaw)
      let placed = 0
      for (let k = 0; k < per * 4 && placed < per; k++) {
        const slot = placed + Math.floor(k / per) * 0.5
        const side = (slot - (per - 1) / 2) * 0.58 * (k % 2 ? -1 : 1) + (rand() - 0.5) * 0.14
        const back = fountain ? 0 : -((placed % 2) * 0.22) + (rand() - 0.5) * 0.1
        const x = cx + lx * side + fx * back
        const z = cz + lz * side + fz * back
        if (!free(x, z)) continue
        // idle: chat with the knot's centre
        const chat = Math.atan2(cx + fx * 0.1 - x, cz + fz * 0.1 - z)
        add({ kind: 'listener', x, z, owner: i, yaw: chat, chatYaw: chat })
        placed++
      }
    })

    // café sitters: fill most chairs
    seats.forEach((st, i) => {
      if (mobile && i % 2) return
      if (i % 4 === 3) return
      add({ kind: 'sitter', x: st.x, z: st.z, y: st.y, yaw: st.yaw, sit: true })
    })

    // keepers behind stalls + the balloon seller
    keepers.forEach(k => add({ kind: 'keeper', x: k.x, z: k.z, yaw: k.yaw }))
    add({ kind: 'keeper', x: balloonSeller.x, z: balloonSeller.z, yaw: faceCentre(balloonSeller.x, balloonSeller.z) + 0.4 })

    // walkers on two rings round the fountain, opposite directions
    const walks = [
      { r: rings[0], speed: 0.3, dir: 1, n: mobile ? 6 : 9 },
      { r: rings[1], speed: 0.34, dir: -1, n: mobile ? 6 : 10 },
    ]
    walks.forEach((rg, ri) => {
      for (let k = 0; k < rg.n; k++) {
        add({
          kind: 'walker',
          x: 0,
          z: 0,
          ring: rg.r + (rand() - 0.5) * 0.1,
          speed: rg.speed * rg.dir * (0.94 + rand() * 0.12),
          phase: (k / rg.n) * Math.PI * 2 + (rand() - 0.5) * 0.35 + ri,
        })
      }
    })

    // a few strollers idling near the kerb, looking about
    const idle = mobile ? 3 : 6
    for (let k = 0; k < idle; k++) {
      const theta = [200, 250, 340, 20, 112, 158][k]
      for (let tries = 0; tries < 6; tries++) {
        const p = pol(theta + tries * 7, 3.3 + rand() * 0.6)
        if (!free(p.x, p.z)) continue
        add({ kind: 'listener', x: p.x, z: p.z, owner: -1, yaw: rand() * 6.28, chatYaw: rand() * 6.28 })
        break
      }
    }

    this.build()
  }

  private build() {
    const n = this.people.length
    // ---- body: a peg-doll lathe with dark "shoes" band
    const prof: [number, number][] = [
      [0.0, 0.0],
      [0.1, 0.0],
      [0.116, 0.022],
      [0.118, 0.036],
      [0.119, 0.05],
      [0.12, 0.12],
      [0.11, 0.2],
      [0.094, 0.262],
      [0.066, 0.3],
      [0.0, 0.312],
    ]
    const bodyGeo = new THREE.LatheGeometry(
      prof.map(([r, y]) => new THREE.Vector2(r, y)),
      14,
    )
    {
      const pos = bodyGeo.attributes.position
      const c = new Float32Array(pos.count * 3)
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i)
        const k = y < 0.04 ? 0.32 : 1
        c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k
      }
      bodyGeo.setAttribute('color', new THREE.BufferAttribute(c, 3))
    }
    // ---- head: sphere + dot eyes + rosy cheeks (vertex colours × skin)
    const parts: THREE.BufferGeometry[] = []
    parts.push(paint(new THREE.SphereGeometry(0.1, 16, 11), 1, 1, 1))
    for (const sgn of [-1, 1]) {
      const eye = new THREE.SphereGeometry(0.0155, 6, 4)
      eye.scale(1, 1.3, 0.55)
      const yaw = sgn * 0.34
      const pitch = 0.07
      eye.rotateY(yaw)
      eye.translate(Math.sin(yaw) * Math.cos(pitch) * 0.096, Math.sin(pitch) * 0.096, Math.cos(yaw) * Math.cos(pitch) * 0.096)
      parts.push(paint(eye, 0.07, 0.07, 0.08))
      const ck = new THREE.SphereGeometry(0.021, 6, 4)
      ck.scale(1.15, 0.7, 0.45)
      const cy = sgn * 0.6
      const cp = -0.12
      ck.rotateY(cy)
      ck.translate(Math.sin(cy) * Math.cos(cp) * 0.093, Math.sin(cp) * 0.093, Math.cos(cy) * Math.cos(cp) * 0.093)
      parts.push(paint(ck, 1.0, 0.64, 0.62))
    }
    const headGeo = mergeGeometries(parts)!
    // ---- hair: a cap over the top and back
    const hairGeo = new THREE.SphereGeometry(0.108, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.52)
    hairGeo.rotateX(-0.42)
    hairGeo.translate(0, 0.008, -0.008)
    // ---- arm: capsule hanging from the shoulder pivot
    const armGeo = new THREE.CapsuleGeometry(0.03, 0.1, 3, 8)
    armGeo.translate(0, -0.07, 0)

    const vmat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 })
    this.body = new THREE.InstancedMesh(bodyGeo, vmat(), n)
    this.head = new THREE.InstancedMesh(headGeo, vmat(), n)
    this.hair = new THREE.InstancedMesh(hairGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), n)
    this.arms = new THREE.InstancedMesh(armGeo, new THREE.MeshStandardMaterial({ roughness: 0.78 }), n * 2)
    for (const m of [this.body, this.head, this.hair, this.arms]) {
      m.frustumCulled = false
      m.receiveShadow = true
      this.group.add(m)
    }
    this.body.castShadow = true
    this.head.castShadow = true

    const rand = rng(9)
    this.people.forEach((p, i) => {
      const shirt = p.kind === 'speaker' ? SPEAKER_SHIRTS[p.owner] : SHIRTS[Math.floor(rand() * SHIRTS.length)]
      const skin = SKINS[Math.floor(rand() * SKINS.length)]
      const hair = HAIRS[Math.floor(rand() * HAIRS.length)]
      this.col.set(shirt)
      this.body.setColorAt(i, this.col)
      this.arms.setColorAt(i * 2, this.col)
      this.arms.setColorAt(i * 2 + 1, this.col)
      this.head.setColorAt(i, this.col.set(skin))
      this.hair.setColorAt(i, this.col.set(hair))
      if (p.kind === 'speaker') this.looks[p.owner] = { shirt, skin, hair: p.hair ? hair : null }
    })
    for (const m of [this.body, this.head, this.hair, this.arms]) if (m.instanceColor) m.instanceColor.needsUpdate = true
  }

  update(f: CrowdFrame) {
    const t = f.t
    const calm = f.calm
    const P = this.people
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      let x = p.x
      let z = p.z
      let y = p.y
      let yaw = p.yaw
      let bob = 0
      let sway = 0
      let lean = 0
      let swing = 0
      let spread = 0.12
      let raise = 0
      let headYaw = 0
      let nod = 0
      let sy = 1
      let sxz = 1

      const seed = p.seed
      const idle = calm ? 0.3 : 1

      if (p.kind === 'walker') {
        const w = (p.speed / p.ring) * (calm ? 0.35 : 1)
        const a = p.phase + w * t
        x = Math.sin(a) * p.ring
        z = Math.cos(a) * p.ring
        const dir = Math.sign(p.speed)
        yaw = Math.atan2(Math.cos(a) * dir, -Math.sin(a) * dir)
        const step = t * (calm ? 3.2 : 9) + seed
        bob = Math.abs(Math.sin(step)) * (calm ? 0.01 : 0.032)
        sway = Math.sin(step) * (calm ? 0.02 : 0.07)
        swing = Math.sin(step) * (calm ? 0.2 : 0.6)
        lean = 0.06
      } else {
        // idle life: a slow weight shift, the odd look around
        sway = Math.sin(t * 1.1 + seed) * 0.03 * idle
        headYaw = Math.sin(t * 0.55 + seed * 1.7) * 0.35 * idle
        nod = Math.sin(t * 1.7 + seed) * 0.05 * idle
        if (p.kind === 'listener' || p.kind === 'keeper') {
          // chatting: little nods and hand talk
          swing = Math.sin(t * 2.2 + seed) * 0.12 * idle
          bob = Math.max(0, Math.sin(t * 2.6 + seed * 3)) * 0.012 * idle
        }
      }

      if (p.sit) {
        sy = 0.74
        swing = -0.9
      }

      // ---- listening: turn toward whoever has the floor
      if (p.kind !== 'speaker' && f.focusW > 0) {
        const dx = f.focus.x - x
        const dz = f.focus.z - z
        const d = Math.hypot(dx, dz)
        const toward = Math.atan2(dx, dz)
        const own = p.owner >= 0 && p.owner === f.focusOwner
        const near = clamp(1 - (d - 1.6) / 2.4)
        const w = f.focusW * (own ? 1 : near * 0.85)
        if (w > 0.001) {
          if (p.kind === 'walker') {
            headYaw = clamp(wrap(toward - yaw), -1.3, 1.3) * w
          } else {
            const bodyW = p.sit ? 0.45 * w : w * 0.92
            yaw = yaw + wrap(toward - yaw) * bodyW
            headYaw = headYaw * (1 - w) + clamp(wrap(toward - yaw), -1.2, 1.2) * w
            nod = nod * (1 - w) - 0.12 * w
            swing = swing * (1 - w)
          }
        }
      }

      // ---- the speaker with the floor: hop up, bounce, gesture
      if (p.kind === 'speaker') {
        const k = p.owner
        const talk = f.talk[k]
        const hop = f.hop[k]
        if (hop > 0 && hop < 1) {
          const arc = Math.sin(Math.PI * hop)
          y += arc * 0.26
          sy *= 1 + arc * 0.14
          sxz *= 1 - arc * 0.06
          // squash on landing
          if (hop > 0.82) {
            const l = (hop - 0.82) / 0.18
            sy *= 1 - Math.sin(l * Math.PI) * 0.12
            sxz *= 1 + Math.sin(l * Math.PI) * 0.06
          }
        }
        if (talk > 0) {
          const tk = calm ? 0.25 : 1
          const beat = t * 6.5 + k
          bob += Math.abs(Math.sin(beat)) * 0.022 * talk * tk
          sy *= 1 + Math.sin(beat * 2) * 0.035 * talk * tk
          nod += Math.sin(beat) * 0.1 * talk * tk
          headYaw += Math.sin(t * 0.9 + k) * 0.45 * talk * tk
          raise = talk
          sway += Math.sin(t * 1.3 + k) * 0.05 * talk * tk
        }
      }

      // ---- pop in (springy, squash-and-stretch)
      let sc = 1
      if (f.pop < 1) {
        const px = clamp((f.pop - p.delay * 0.55) / 0.45)
        sc = spring(px)
        const st = Math.sin(px * Math.PI)
        sy *= 1 + st * 0.3
        sxz *= 1 - st * 0.12
      }
      if (sc < 0.002) {
        this.body.setMatrixAt(i, this.zero)
        this.head.setMatrixAt(i, this.zero)
        this.hair.setMatrixAt(i, this.zero)
        this.arms.setMatrixAt(i * 2, this.zero)
        this.arms.setMatrixAt(i * 2 + 1, this.zero)
        continue
      }

      // body
      this.e.set(lean, yaw, sway, 'YXZ')
      this.q.setFromEuler(this.e)
      this.v.set(x, y + bob, z)
      this.s.set(sc * sxz, sc * sy, sc * sxz)
      this.mBody.compose(this.v, this.q, this.s)
      this.body.setMatrixAt(i, this.mBody)

      // head (+ hair), counter-scaled so squash doesn't egg it
      const inv = 1 / Math.max(0.2, sy)
      this.e.set(nod, headYaw, 0, 'YXZ')
      this.q.setFromEuler(this.e)
      this.v.set(0, NECK + 0.005, 0)
      this.s.set(1 / sxz, inv, 1 / sxz)
      this.mLocal.compose(this.v, this.q, this.s)
      this.mOut.multiplyMatrices(this.mBody, this.mLocal)
      this.head.setMatrixAt(i, this.mOut)
      if (p.hair) this.hair.setMatrixAt(i, this.mOut)
      else this.hair.setMatrixAt(i, this.zero)
      if (p.kind === 'speaker') {
        const h = this.speakerHeads[p.owner]
        h.set(0, 0.1, 0).applyMatrix4(this.mOut)
      }

      // arms
      for (let side = 0; side < 2; side++) {
        const sgn = side === 0 ? -1 : 1
        let rz = sgn * spread
        let rx = side === 0 ? swing : -swing
        if (raise > 0 && side === 1) {
          // the gesturing arm: up and out, waving
          const wave = Math.sin(t * 5 + p.owner) * 0.35 * (calm ? 0.3 : 1)
          rz = sgn * (spread + raise * (2.1 + wave))
          rx = rx * (1 - raise) - raise * 0.35
        } else if (raise > 0) {
          rx = rx * (1 - raise) - raise * (0.5 + Math.sin(t * 3.3 + p.owner) * 0.25 * (calm ? 0.3 : 1))
        }
        this.e.set(rx, 0, rz, 'YXZ')
        this.q.setFromEuler(this.e)
        this.v.set(sgn * 0.098, SHOULDER, 0)
        this.s.set(1 / sxz, inv, 1 / sxz)
        this.mLocal.compose(this.v, this.q, this.s)
        this.mOut.multiplyMatrices(this.mBody, this.mLocal)
        this.arms.setMatrixAt(i * 2 + side, this.mOut)
      }
    }
    for (const m of [this.body, this.head, this.hair, this.arms]) m.instanceMatrix.needsUpdate = true
  }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

