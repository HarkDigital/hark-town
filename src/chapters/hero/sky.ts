import * as THREE from 'three'
import { rng, smoothstep } from '../../core/math'
import { C, clayVC } from '../../kit/palette'
import { Builder, col } from '../../kit/geo'
import { makeIsland } from '../../kit/island'
import { cloudMaterial, makeBirds, makeTree } from '../../kit/nature'
import { makeHouse } from '../../kit/props'
import { bake } from './bake'

/*
 * Everything in the air around the HQ island:
 *   - ambient clouds drifting around the island, a sea of clouds far below
 *   - the "veil": big clouds riding in front of the camera, used for the
 *     descend-out-of-cloud opening and the rise-into-cloud exit
 *   - little islets in the distance (they bob), a Hark balloon, gulls
 */

const TAU = Math.PI * 2

/**
 * Smooth puffy cloud (analytic normals, so it reads soft instead of faceted):
 * a row of spheres with flattened bottoms, white on top, lilac-grey below.
 * ~3 units long.
 */
function smoothCloud(seed: number): THREE.BufferGeometry {
  const rand = rng(seed * 31 + 7)
  const b = new Builder()
  const top = col('#ffffff'), bot = col('#dcdff0')
  const count = 5 + Math.floor(rand() * 3)
  const puffs: [number, number, number, number][] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5
    const r = (0.55 + (1 - Math.abs(t) * 1.6) * 0.45) * (0.85 + rand() * 0.3)
    puffs.push([t * 2.6 + (rand() - 0.5) * 0.2, r * 0.35 + rand() * 0.1, (rand() - 0.5) * 0.7, r])
  }
  for (let i = 0; i < 2; i++) {
    const r = 0.5 + rand() * 0.2
    puffs.push([(rand() - 0.5) * 1.4, r * 0.3, -0.45 - rand() * 0.2, r])
  }
  const FLAT = 0.3
  for (const [cx, cy, cz, r] of puffs) {
    const g = new THREE.IcosahedronGeometry(r, 2)
    const pos = g.attributes.position
    const nor = g.attributes.normal
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      let y = pos.getY(i)
      let ny = y
      if (y < 0) {
        // flattened underside: an ellipsoid, normal ∝ (x, y / s², z)
        y *= FLAT
        ny = y / (FLAT * FLAT)
      }
      const l = Math.hypot(x, ny, z) || 1
      pos.setXYZ(i, x + cx, y + cy, z + cz)
      nor.setXYZ(i, x / l, ny / l, z / l)
    }
    b.add(g, (_x, y, _z, out, _nx, ny) => out.copy(bot).lerp(top, Math.min(1, Math.max(0, y * 0.9 + 0.25 + ny * 0.3))))
  }
  return b.build()
}

interface CloudSlot {
  kind: 'amb' | 'sea' | 'veil'
  a: number
  r: number
  y: number
  s: number
  sy: number
  spin: number
  /** veil: screen anchor (ndc) when covering, and exit direction */
  nx: number
  ny: number
  ex: number
  ey: number
  depth: number
}

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()
const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _Y = new THREE.Vector3(0, 1, 0)

export class Sky {
  group = new THREE.Group()
  private clouds: THREE.InstancedMesh[] = []
  private slots: CloudSlot[][] = []
  private islets: { mesh: THREE.Mesh; y: number; ph: number }[] = []
  balloon = new THREE.Group()
  birds: THREE.Mesh
  /** 0..1: how much the camera veil covers the frame */
  veil = 0
  /** invisible clouds overhead that only cast soft shadows drifting over the town */
  private shade: THREE.Mesh[] = []

  constructor(mobile: boolean) {
    const rand = rng(77)
    // ---- clouds (two archetypes, one instanced draw each)
    const lists: CloudSlot[][] = [[], []]
    const push = (s: CloudSlot) => lists[lists[0].length <= lists[1].length ? 0 : 1].push(s)
    const blank = { nx: 0, ny: 0, ex: 0, ey: 0, depth: 0 }
    const amb = mobile ? 5 : 8
    // mostly on the far side of the drone's orbit (a in ~[2.2, 5.9]) so they frame, not cover
    for (let i = 0; i < amb; i++) {
      const far = i < amb - 2
      const a = far ? 2.2 + (i / (amb - 3)) * 3.7 + (rand() - 0.5) * 0.3 : 0.4 + (i - amb + 2) * 0.9
      push({ kind: 'amb', a, r: far ? 12 + rand() * 6 : 15 + rand() * 3, y: far ? -2 - rand() * 4 : -7 - rand() * 2, s: 1 + rand() * 0.9, sy: 0.85, spin: rand() * TAU, ...blank })
    }
    for (let i = 0; i < (mobile ? 7 : 12); i++) {
      push({ kind: 'sea', a: rand() * TAU, r: 10 + rand() * 34, y: -24 - rand() * 8, s: 3.2 + rand() * 3.2, sy: 0.5, spin: rand() * TAU, ...blank })
    }
    // the veil: anchors spread around the frame, exiting outward
    const veil: [number, number][] = [
      [-0.85, 0.75], [0.15, 0.95], [0.95, 0.6], [-1.05, -0.1], [1.05, -0.2], [-0.6, -0.9], [0.55, -0.95], [0.05, 0.15],
    ]
    veil.forEach(([nx, ny], i) => {
      const len = Math.hypot(nx, ny) || 1
      push({
        kind: 'veil', a: 0, r: 0, y: 0, s: 1, sy: 0.75, spin: rand() * TAU,
        nx: nx * 0.6, ny: ny * 0.55, ex: nx / len, ey: ny / len + 0.35, depth: 0.3 + (i % 3) * 0.08,
      })
    })
    const mat = cloudMaterial()
    ;[smoothCloud(1), smoothCloud(3)].forEach((g, k) => {
      const im = new THREE.InstancedMesh(g, mat, lists[k].length)
      im.frustumCulled = false
      im.castShadow = false
      im.receiveShadow = false
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.clouds.push(im)
      this.slots.push(lists[k])
      this.group.add(im)
    })

    // ---- distant islets (one baked mesh each, so they can bob independently)
    const isles = [
      { x: -30, y: -21, z: -34, r: 2.8, seed: 21, house: true },
      { x: -22, y: -30, z: 44, r: 2.2, seed: 34, house: false },
      { x: 4, y: -30, z: 44, r: 2.3, seed: 12, house: false },
    ].slice(0, mobile ? 2 : 3)
    for (const d of isles) {
      const g = new THREE.Group()
      const isle = makeIsland({ radius: d.r, seed: d.seed, wobble: 0.16, detail: 0.6, hanging: 2 })
      g.add(isle)
      const rr = rng(d.seed)
      const contains = isle.userData.contains as ((x: number, z: number, m?: number) => boolean) | undefined
      for (let i = 0, placed = 0; i < 30 && placed < 3 + d.r; i++) {
        const a = rr() * TAU, q = Math.sqrt(rr()) * d.r * 0.75
        const x = Math.cos(a) * q, z = Math.sin(a) * q
        if (contains && !contains(x, z, 0.4)) continue
        if (d.house && Math.hypot(x, z) < 1) continue
        const t = makeTree(d.seed + i, 0.85 + rr() * 0.35)
        t.position.set(x, 0, z)
        g.add(t)
        placed++
      }
      if (d.house) {
        const h = makeHouse({ seed: d.seed, w: 1.1, h: 0.9, d: 1 })
        h.rotation.y = rr() * TAU
        g.add(h)
      }
      const geo = bake(g)
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, clayVC())
      mesh.position.set(d.x, d.y, d.z)
      mesh.rotation.y = rr() * TAU
      this.group.add(mesh)
      this.islets.push({ mesh, y: d.y, ph: rr() * TAU })
    }

    // ---- a Hark balloon: green + cream gores, wicker basket
    const prof: THREE.Vector2[] = []
    for (let i = 0; i <= 16; i++) {
      const t = i / 16
      const ang = -Math.PI / 2 + t * Math.PI
      // teardrop: round crown, tapering neck
      const bulge = Math.cos(ang) * (0.64 + 0.16 * Math.sin(ang))
      const neck = t < 0.28 ? 0.45 + (t / 0.28) * 0.55 : 1
      prof.push(new THREE.Vector2(Math.max(0.03, bulge * neck), 0.72 + Math.sin(ang) * 0.74))
    }
    const bb = new Builder()
    const green = col(C.signal), cream = col(C.paper)
    bb.add(new THREE.LatheGeometry(prof, 20), (x, _y, z, out) => {
      const a = Math.atan2(z, x)
      out.copy(Math.floor(((a + Math.PI) / TAU) * 20 + 0.5) % 2 ? green : cream)
    }, { y: 0.92 })
    bb.rbox(0.34, 0.26, 0.34, 0.05, C.wood, { y: 0.13 })
    for (const [x, z] of [[0.15, 0.15], [-0.15, 0.15], [0.15, -0.15], [-0.15, -0.15]]) {
      bb.cyl(0.012, 0.012, 0.74, 4, C.woodDark, { x, y: 0.62, z })
    }
    const balloon = new THREE.Mesh(bb.build(), clayVC())
    this.balloon.add(balloon)
    this.group.add(this.balloon)

    // ---- cloud shadows: shadow-casters only (no colour, no depth in the main pass)
    const ghost = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    for (let i = 0; i < (mobile ? 1 : 2); i++) {
      const m = new THREE.Mesh(smoothCloud(5 + i), ghost)
      m.castShadow = true
      m.receiveShadow = false
      m.renderOrder = -1
      this.shade.push(m)
      this.group.add(m)
    }

    // ---- gulls circling the mark (GPU-animated by the kit)
    this.birds = makeBirds({ count: mobile ? 5 : 8, radius: 4.2, height: 5.4, seed: 9, size: 0.15 })
    this.group.add(this.birds)
  }

  /** idle motion + veil placement, from the un-parallaxed camera pose */
  update(time: number, motion: number, pos: THREE.Vector3, tgt: THREE.Vector3, fov: number, aspect: number, ground: number, balloonK: number, sunDir: THREE.Vector3) {
    const t = time * motion
    _fwd.copy(tgt).sub(pos)
    const dist = _fwd.length()
    _fwd.normalize()
    _right.crossVectors(_fwd, _Y).normalize()
    _up.crossVectors(_right, _fwd)
    const tanH = Math.tan((fov * Math.PI) / 360)
    const v = this.veil

    this.clouds.forEach((im, k) => {
      const list = this.slots[k]
      for (let i = 0; i < list.length; i++) {
        const c = list[i]
        if (c.kind === 'veil') {
          const d = dist * c.depth
          const hh = d * tanH
          // v = 1: anchors cover the frame; v = 0: pushed out past the edges
          const out = 1 - v
          const nx = c.nx + c.ex * out * 1.4
          const ny = c.ny + c.ey * out * 1.4
          _p.copy(pos)
            .addScaledVector(_fwd, d)
            .addScaledVector(_right, nx * hh * aspect)
            .addScaledVector(_up, ny * hh)
          const s = v > 0.001 ? hh * (0.2 + 0.5 * v) * (0.85 + 0.2 * Math.sin(c.spin)) * Math.max(1, aspect * 0.7) : 0
          _q.setFromEuler(_e.set(0, c.spin * 0.3 + t * 0.02, 0))
          _m.compose(_p, _q, _s.set(s, s * c.sy, s))
        } else {
          const a = c.a + t * (c.kind === 'amb' ? 0.012 : 0.004)
          _p.set(Math.cos(a) * c.r, ground + c.y + Math.sin(t * 0.3 + c.spin) * 0.15, Math.sin(a) * c.r)
          _q.setFromEuler(_e.set(0, c.spin - a, 0))
          _m.compose(_p, _q, _s.set(c.s, c.s * c.sy, c.s))
        }
        im.setMatrixAt(i, _m)
      }
      im.instanceMatrix.needsUpdate = true
    })

    // cloud shadows sail across the island on a slow loop (deterministic in
    // time): pick the ground track, then hang the cloud up-sun of it
    const sy = Math.max(0.2, sunDir.y)
    for (let i = 0; i < this.shade.length; i++) {
      const m = this.shade[i]
      const p = ((t * 0.016 + i * 0.5) % 1) * 2 - 1
      const gx = p * 14 + (i ? 2.5 : -1.5)
      const gz = -p * 4 + (i ? -3 : 2.5)
      const h = 9
      m.position.set(gx + (sunDir.x / sy) * h, ground + h, gz + (sunDir.z / sy) * h)
      m.scale.set(2.2, 1.1, 1.6)
      m.rotation.y = 0.4 + i
    }

    for (const it of this.islets) it.mesh.position.y = it.y + Math.sin(t * 0.35 + it.ph) * 0.35

    // the Hark balloon rises from below the island as the town finishes,
    // and hangs in the open sky beside it for the headline
    const k = balloonK
    const up = smoothstep(0.48, 0.7, k)
    const eased = 1 - Math.pow(1 - up, 3)
    const y = -8 + eased * 9.6 + Math.max(0, k - 0.7) * 3.5 + Math.sin(t * 0.5) * 0.18
    this.balloon.visible = k > 0.47
    this.balloon.position.set(8.2 + Math.sin(t * 0.07) * 0.4, ground + y, 11.6 + Math.cos(t * 0.05) * 0.3)
    this.balloon.rotation.y = t * 0.08
    this.balloon.scale.setScalar(1.3)
    this.birds.position.y = ground
  }
}
