import * as THREE from 'three'
import { rng } from '../../core/math'
import { C } from '../../kit/palette'
import { makeCloud } from '../../kit/props'
import { Kit, roundBox, finishes } from './kit'
import * as L from './layout'

/*
 * The idle life of Main Street, all time-driven (never scroll-driven):
 * people bobbing along the sidewalks, waiting at stops and minding stalls;
 * little cars in the lanes; boats and glints on the canal; a flock of birds
 * over whatever the camera is looking at; two Hark balloons; drifting clouds.
 */

interface Walker {
  x0: number
  z: number
  speed: number
  dir: number
  ph: number
  y: number
  /** 0 = stands still */
  walk: boolean
}

const BODY = ['#4d8fd6', '#e2694a', '#f0b43c', '#2f8f55', '#a98bd6', '#fbfaf6', '#1d2321', '#63c1e3', '#c8603a', '#f2b63d']
const SKIN = ['#f1c9a5', '#d9a07a', '#a8704a', '#7a4f33', '#e8b98f']
const CAR = ['#e2694a', '#4d8fd6', '#f0b43c', '#fbfaf6', '#63c1e3', '#a98bd6', '#7fbf64']

const WOODISH = '#c9955f'
const X0 = L.STREET_X0 + 0.8
const X1 = L.STALL_X[8] + 1.6
const wrap = (v: number, a: number, b: number) => a + ((((v - a) % (b - a)) + (b - a)) % (b - a))


export class Life {
  group = new THREE.Group()
  private walkers: Walker[] = []
  private bodies: THREE.InstancedMesh
  private heads: THREE.InstancedMesh
  private cars: { x0: number; z: number; dir: number; speed: number }[] = []
  private carBody: THREE.InstancedMesh
  private carTop: THREE.InstancedMesh
  private boats: THREE.Group[] = []
  private boatX: number[] = []
  private glints: THREE.InstancedMesh
  private glintData: { x: number; z: number; ph: number; s: number }[] = []
  private birds: THREE.InstancedMesh
  private wings: THREE.InstancedMesh
  private balloons: { g: THREE.Group; x: number; y: number; z: number; ph: number }[] = []
  private drift: { m: THREE.Object3D; x0: number; speed: number; range: [number, number] }[] = []
  private transit: { m: THREE.Object3D; x0: number; ph: number }[] = []
  private fallMap: THREE.Texture | null = null
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private e = new THREE.Euler()
  private v = new THREE.Vector3()
  private s = new THREE.Vector3()

  constructor(mobile: boolean) {
    const r = rng(77)
    // ---- people
    const nWalk = mobile ? 16 : 30
    for (let i = 0; i < nWalk; i++) {
      const far = i % 2 === 0
      const zr = far ? L.WALK_FAR : L.WALK_NEAR
      this.walkers.push({
        x0: X0 + r() * (X1 - X0),
        z: (far ? zr.z0 + 0.3 : zr.z0 + 0.45) + r() * 0.35,
        speed: 0.28 + r() * 0.3,
        dir: r() < 0.5 ? -1 : 1,
        ph: r() * 6.28,
        y: 0.1,
        walk: true,
      })
    }
    // waiting at every stop
    for (const sx of L.STOP_X) {
      const px = sx + L.POLE_DX
      for (let i = 0; i < 2; i++)
        this.walkers.push({ x0: px + 0.35 + i * 0.32 + r() * 0.1, z: -1.72 - r() * 0.1, speed: 0, dir: 1, ph: r() * 6, y: 0.1, walk: false })
    }
    // minding the stalls, and browsing
    L.STALL_X.forEach((x, j) => {
      this.walkers.push({ x0: x + (r() - 0.5) * 0.5, z: L.STALL_Z - 0.18, speed: 0, dir: 1, ph: r() * 6, y: 0, walk: false })
      if (!mobile || j % 2 === 0)
        this.walkers.push({ x0: x - 0.3 + r() * 0.3, z: -1.95 + r() * 0.2, speed: 0, dir: 1, ph: r() * 6, y: 0.1, walk: false })
    })
    const n = this.walkers.length
    const bodyGeo = new THREE.CapsuleGeometry(0.075, 0.16, 3, 8)
    bodyGeo.translate(0, 0.155, 0)
    const headGeo = new THREE.SphereGeometry(0.068, 10, 8)
    headGeo.translate(0, 0.39, 0)
    const pm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })
    this.bodies = new THREE.InstancedMesh(bodyGeo, pm, n)
    this.heads = new THREE.InstancedMesh(headGeo, pm, n)
    const c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      this.bodies.setColorAt(i, c.set(BODY[Math.floor(r() * BODY.length)]))
      this.heads.setColorAt(i, c.set(SKIN[Math.floor(r() * SKIN.length)]))
    }
    for (const m of [this.bodies, this.heads]) {
      m.frustumCulled = false
      m.castShadow = !mobile
      m.receiveShadow = false
      this.group.add(m)
    }

    // ---- cars (body tinted per instance; wheels stay dark)
    const nCars = mobile ? 4 : 7
    for (let i = 0; i < nCars; i++) {
      const dir = i % 2 ? 1 : -1
      this.cars.push({ x0: X0 + (i / nCars) * (X1 - X0) + r() * 3, z: dir > 0 ? -0.84 : 0.84, dir, speed: 1.1 + r() * 0.6 })
    }
    const ck = new Kit()
    ck.add(roundBox(0.64, 0.2, 0.34, 0.07, 2), '#ffffff', { y: 0.06 })
    for (const [x, z] of [
      [0.2, 0.17],
      [-0.2, 0.17],
      [0.2, -0.17],
      [-0.2, -0.17],
    ])
      ck.cyl(0.075, 0.075, 0.07, '#222', { x, y: 0.075, z: z + (z > 0 ? -0.035 : 0.035), rx: Math.PI / 2 }, 10)
    ck.ball(0.035, '#fff4d6', { x: 0.32, y: 0.16, z: 0.1 }, 0)
    ck.ball(0.035, '#fff4d6', { x: 0.32, y: 0.16, z: -0.1 }, 0)
    const bodyMesh = ck.build().children[0] as THREE.Mesh
    const tk = new Kit()
    tk.add(roundBox(0.34, 0.17, 0.3, 0.06, 2), '#2b4153', { x: -0.04, y: 0.24 }, 'gloss')
    tk.add(roundBox(0.3, 0.03, 0.3, 0.01, 1), '#fbfaf6', { x: -0.04, y: 0.405 }, 'gloss')
    const topMesh = tk.build().children[0] as THREE.Mesh
    this.carBody = new THREE.InstancedMesh(bodyMesh.geometry, finishes().matte, nCars)
    this.carTop = new THREE.InstancedMesh(topMesh.geometry, finishes().gloss, nCars)
    for (let i = 0; i < nCars; i++) this.carBody.setColorAt(i, c.set(CAR[i % CAR.length]))
    for (const m of [this.carBody, this.carTop]) {
      m.frustumCulled = false
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
    }

    // ---- canal boats
    const cz = (L.CANAL.z0 + L.CANAL.z1) / 2
    for (let i = 0; i < (mobile ? 2 : 3); i++) {
      const bk = new Kit()
      const col = ['#e2694a', '#fbfaf6', '#4d8fd6'][i]
      bk.box(0.62, 0.12, 0.26, col, { y: -0.04 }, 0.06, 'matte', 2)
      bk.box(0.56, 0.03, 0.22, WOODISH, { y: 0.07 }, 0.01)
      if (i === 1) {
        bk.cyl(0.012, 0.012, 0.55, '#8a735d', { y: 0.08 }, 4)
        const sail = new THREE.Shape()
        sail.moveTo(0, 0)
        sail.lineTo(0, 0.46)
        sail.lineTo(0.3, 0)
        sail.closePath()
        bk.add(new THREE.ShapeGeometry(sail), '#fbfaf6', { x: 0.01, y: 0.14, z: 0.005 })
        bk.add(new THREE.ShapeGeometry(sail), '#fbfaf6', { x: 0.01, y: 0.14, z: -0.005, ry: Math.PI, sx: -1 })
      } else {
        bk.box(0.22, 0.14, 0.18, '#fbfaf6', { x: -0.08, y: 0.08 }, 0.03)
        bk.box(0.26, 0.03, 0.22, col === '#fbfaf6' ? C.roofBlue : '#fbfaf6', { x: -0.08, y: 0.22 }, 0.01)
      }
      const g = bk.build({ cast: false })
      g.position.set(0, 0.02, cz + (i - 1) * 0.18)
      this.boats.push(g)
      this.boatX.push(-6 + i * 23 + r() * 4)
      this.group.add(g)
    }
    // ---- glints twinkling on the water
    const nG = mobile ? 28 : 56
    for (let i = 0; i < nG; i++) this.glintData.push({ x: -9 + r() * 71, z: L.CANAL.z0 + 0.1 + r() * 0.7, ph: r() * 6.28, s: 0.6 + r() * 0.8 })
    this.glints = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.004, 0.025),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.25, 1.2) }),
      nG,
    )
    this.glints.frustumCulled = false
    this.group.add(this.glints)

    // ---- birds: a small flock (body + flapping wings)
    const nB = 5
    const wingGeo = new THREE.BufferGeometry()
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.05, 0, 0, 0.06, 0.24, 0, 0.02], 3))
    wingGeo.computeVertexNormals()
    const birdMat = new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.7, side: THREE.DoubleSide })
    this.birds = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6).scale(1, 0.8, 1.9), birdMat, nB)
    this.wings = new THREE.InstancedMesh(wingGeo, birdMat, nB * 2)
    for (const m of [this.birds, this.wings]) {
      m.frustumCulled = false
      this.group.add(m)
    }

    // ---- two Hark balloons
    const bk = new Kit()
    const R = 0.85
    for (let i = 0; i < 10; i++) {
      const g = new THREE.SphereGeometry(R, 3, 14, (i * Math.PI * 2) / 10, (Math.PI * 2) / 10, 0, Math.PI * 0.82)
      bk.add(g, i % 2 ? '#fbfaf6' : C.signal, { sy: 1.16 })
    }
    bk.cyl(0.2, 0.28, 0.14, '#fbfaf6', { y: -R * 1.16 * 0.86 - 0.02 }, 12)
    for (const [x, z] of [
      [0.14, 0.14],
      [-0.14, 0.14],
      [0.14, -0.14],
      [-0.14, -0.14],
    ])
      bk.cyl(0.008, 0.008, 0.36, '#6f5c49', { x, y: -1.34, z }, 3)
    bk.box(0.34, 0.28, 0.34, '#c9955f', { y: -1.62 }, 0.04)
    bk.ball(0.06, '#ffc16b', { y: -1.12 }, 1, 'glow', 2.4)
    const proto = bk.build({ cast: true })
    const spots: [number, number, number][] = [
      [17.5, 9.4, -10.5],
      [55.5, 6.8, -6.8],
    ]
    spots.forEach(([x, y, z], i) => {
      const g = i === 0 ? proto : proto.clone()
      g.position.set(x, y, z)
      this.balloons.push({ g, x, y, z, ph: i * 2.1 })
      this.group.add(g)
    })

    // ---- the canal spills off the west end: a curling sheet of water
    {
      const cz = (L.CANAL.z0 + L.CANAL.z1) / 2
      const cw = L.CANAL.z1 - L.CANAL.z0 - 0.06
      const H = 9
      const geo = new THREE.PlaneGeometry(1, 1, 1, 28)
      const pos = geo.attributes.position as THREE.BufferAttribute
      const uv = geo.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const u = uv.getX(i)
        const d = 1 - uv.getY(i)
        const fall = H * d
        // a thrown arc: out past the island's lip, then straight down
        pos.setXYZ(i, L.FALL_X - 0.05 - 0.95 * Math.sqrt(fall + 0.02), 0.028 - fall, cz + (u - 0.5) * cw * (1 + d * 0.5))
      }
      geo.computeVertexNormals()
      const streak = document.createElement('canvas')
      streak.width = 64
      streak.height = 128
      const g = streak.getContext('2d')!
      g.fillStyle = '#9fdcf0'
      g.fillRect(0, 0, 64, 128)
      for (let i = 0; i < 26; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.85)' : 'rgba(214,242,252,0.9)'
        g.fillRect(Math.floor(r() * 64), Math.floor(r() * 128), 2 + Math.floor(r() * 3), 18 + r() * 50)
      }
      const map = new THREE.CanvasTexture(streak)
      map.colorSpace = THREE.SRGBColorSpace
      map.wrapS = map.wrapT = THREE.RepeatWrapping
      map.repeat.set(1, 3)
      const fade = document.createElement('canvas')
      fade.width = 4
      fade.height = 64
      const fg = fade.getContext('2d')!
      const grad = fg.createLinearGradient(0, 0, 0, 64)
      grad.addColorStop(0, '#fff')
      grad.addColorStop(0.55, '#ddd')
      grad.addColorStop(1, '#000')
      fg.fillStyle = grad
      fg.fillRect(0, 0, 4, 64)
      const alpha = new THREE.CanvasTexture(fade)
      this.fallMap = map
      const sheet = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ map, alphaMap: alpha, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(1.02, 1.02, 1.02) }),
      )
      sheet.frustumCulled = false
      this.group.add(sheet)
      // foam on the lip and spray where it fades out
      const fk = new Kit()
      for (let i = 0; i < 7; i++) fk.ball(0.09 + r() * 0.05, '#ffffff', { x: L.FALL_X - 0.1 - r() * 0.3, y: 0.05, z: cz + (r() - 0.5) * cw }, 1)
      this.group.add(fk.build({ cast: false, receive: false }))
      for (let i = 0; i < 2; i++) {
        const cl = makeCloud(200 + i, 0.9 + i * 0.3)
        cl.castShadow = false
        cl.position.set(L.FALL_X - 3.2 - i * 0.6, -H + 1.4 + i * 0.5, cz + (i - 0.5) * 1.2)
        this.group.add(cl)
      }
    }

    // ---- ambient clouds around and below the island
    const cr = rng(5)
    const nC = mobile ? 7 : 12
    for (let i = 0; i < nC; i++) {
      const cl = makeCloud(40 + i, 1.4 + cr() * 1.6)
      cl.castShadow = false
      cl.receiveShadow = false
      const below = i % 3 !== 0
      const x = -30 + (i / nC) * 130 + cr() * 8
      const back = cr() < 0.55
      cl.position.set(x, below ? -5 - cr() * 7 : back ? 1 + cr() * 5 : -1.5 - cr() * 2.5, below ? -4 + (cr() - 0.5) * 30 : back ? -17 - cr() * 8 : 11 + cr() * 6)
      this.drift.push({ m: cl, x0: x, speed: 0.12 + cr() * 0.18, range: [-40, 115] })
      this.group.add(cl)
    }
  }

  /** Big puffs the camera descends out of / rises into at the chapter cuts. */
  addTransitClouds(points: { x: number; y: number; z: number; s: number }[]) {
    points.forEach((p, i) => {
      const cl = makeCloud(120 + i, p.s)
      cl.castShadow = false
      cl.receiveShadow = false
      cl.position.set(p.x, p.y, p.z)
      this.transit.push({ m: cl, x0: p.x, ph: i * 1.7 })
      this.group.add(cl)
    })
  }

  update(t: number, calm: boolean, focusX: number) {
    const m = this.m
    const q = this.q
    const v = this.v
    const s = this.s
    const tt = calm ? t * 0.25 : t

    // people
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i]
      let x = w.x0
      let sc = 1
      let bob = 0
      let yaw = 0
      if (w.walk && !calm) {
        x = wrap(w.x0 + w.dir * w.speed * t, X0, X1)
        // tiny pop in/out at the ends of the street
        sc = Math.min(1, (x - X0) / 0.6, (X1 - x) / 0.6)
        bob = Math.abs(Math.sin(t * 8 * w.speed + w.ph)) * 0.035
        yaw = w.dir > 0 ? 0 : Math.PI
        this.e.set(0, yaw, Math.sin(t * 8 * w.speed + w.ph) * 0.08 * w.dir)
      } else {
        bob = calm ? 0 : Math.max(0, Math.sin(tt * 1.3 + w.ph)) * 0.012
        this.e.set(0, w.ph, calm ? 0 : Math.sin(tt * 0.9 + w.ph) * 0.05)
      }
      q.setFromEuler(this.e)
      s.setScalar(Math.max(0.001, sc))
      m.compose(v.set(x, w.y + bob, w.z), q, s)
      this.bodies.setMatrixAt(i, m)
      this.heads.setMatrixAt(i, m)
    }
    this.bodies.instanceMatrix.needsUpdate = true
    this.heads.instanceMatrix.needsUpdate = true

    // cars
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]
      const x = calm ? c.x0 : wrap(c.x0 + c.dir * c.speed * t, X0, X1 + 2)
      const sc = Math.max(0.001, Math.min(1, (x - X0) / 0.8, (X1 + 2 - x) / 0.8))
      this.e.set(0, c.dir > 0 ? 0 : Math.PI, 0)
      q.setFromEuler(this.e)
      m.compose(v.set(x, 0.05 + (calm ? 0 : Math.abs(Math.sin(t * 11 + i)) * 0.006), c.z), q, s.setScalar(sc))
      this.carBody.setMatrixAt(i, m)
      this.carTop.setMatrixAt(i, m)
    }
    this.carBody.instanceMatrix.needsUpdate = true
    this.carTop.instanceMatrix.needsUpdate = true

    // boats
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i]
      const dir = i % 2 ? -1 : 1
      const x = wrap(this.boatX[i] + dir * 0.35 * tt, -8.6, 62)
      b.position.x = x
      b.rotation.y = dir > 0 ? 0 : Math.PI
      b.rotation.z = Math.sin(tt * 1.8 + i) * 0.05
      b.position.y = 0.03 + Math.sin(tt * 2.2 + i * 2) * 0.012
      const sc = Math.max(0.001, Math.min(1, (x + 8.6) / 0.8, (62 - x) / 0.8))
      b.scale.setScalar(sc)
    }

    // glints
    q.identity()
    for (let i = 0; i < this.glintData.length; i++) {
      const gd = this.glintData[i]
      const k = Math.max(0, Math.sin(tt * 1.6 + gd.ph))
      const x = wrap(gd.x + tt * 0.12, -9, 62)
      s.set(gd.s * k * k, 1, 1)
      m.compose(v.set(x, 0.033, gd.z), q, s)
      this.glints.setMatrixAt(i, m)
    }
    this.glints.instanceMatrix.needsUpdate = true

    // birds circle over whatever we're looking at
    const n = this.birds.count
    const a = tt * 0.22
    const cx = focusX + Math.cos(a) * 3
    const cz = -6.5 + Math.sin(a) * 2.5
    const heading = Math.atan2(-3 * Math.sin(a), 2.5 * Math.cos(a))
    const fx = Math.sin(heading)
    const fz = Math.cos(heading)
    for (let i = 0; i < n; i++) {
      const row = Math.ceil(i / 2)
      const side = i % 2 ? 1 : -1
      const back = -row * 0.42
      const lat = side * row * 0.36
      const bx = cx + fx * back + fz * lat
      const bz = cz + fz * back - fx * lat
      const by = 8.6 + Math.sin(tt * 1.3 + i) * 0.15
      this.e.set(0, heading, 0)
      q.setFromEuler(this.e)
      m.compose(v.set(bx, by, bz), q, s.setScalar(1))
      this.birds.setMatrixAt(i, m)
      const flap = calm ? 0.2 : Math.sin(t * 13 + i * 0.9) * 0.7
      for (const w of [0, 1]) {
        this.e.set(0, heading + (w ? Math.PI : 0), w ? -flap : flap, 'YXZ')
        q.setFromEuler(this.e)
        m.compose(v.set(bx, by + 0.01, bz), q, s.setScalar(1))
        this.wings.setMatrixAt(i * 2 + w, m)
      }
      this.e.order = 'XYZ'
    }
    this.birds.instanceMatrix.needsUpdate = true
    this.wings.instanceMatrix.needsUpdate = true

    // balloons bob and drift
    for (const b of this.balloons) {
      b.g.position.set(b.x + Math.sin(tt * 0.15 + b.ph) * 1.4, b.y + Math.sin(tt * 0.7 + b.ph) * 0.18, b.z)
      b.g.rotation.y = tt * 0.1 + b.ph
    }

    // the waterfall pours
    if (this.fallMap) this.fallMap.offset.y = (tt * 0.9) % 1
    // clouds drift
    for (const d of this.drift) d.m.position.x = wrap(d.x0 + tt * d.speed, d.range[0], d.range[1])
    for (const d of this.transit) d.m.position.x = d.x0 + Math.sin(tt * 0.05 + d.ph) * 2.5
  }
}

