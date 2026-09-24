import * as THREE from 'three'
import { World } from './World'
import { Post } from '../core/post'
import type { Frame } from '../core/types'
import { rng } from '../core/math'
import { C, CARS, clayVC } from '../kit/palette'
import {
  flowerGeometry,
  islandPoints,
  makeBalloon,
  makeBench,
  makeBirds,
  makeBoat,
  makeBush,
  makeCar,
  makeCrowd,
  makeFence,
  makeFlag,
  makeHouse,
  makeIsland,
  makeLamp,
  makePath,
  makePond,
  makeRails,
  makeRoad,
  makeRock,
  makeShop,
  makeSign,
  makeStreetLamp,
  makeTower,
  makeTram,
  makeTree,
  makeWaterfall,
  makeWindmill,
  mergeStatic,
  scatter,
  treeGeometry,
  tuftGeometry,
} from '../kit/props'

/*
 * DEV ONLY — kit + sky lab (http://localhost:5480/lab.html). Not part of the
 * build (index.html is the only entry). Renders a sample diorama with the
 * shared World + post so the kit can be art-directed in isolation.
 *
 * URL: ?t=0.3&storm=0&cam=hero&az=0&el=32&dist=60&fov=15&sec=4
 */

const q = new URLSearchParams(location.search)
const state = {
  t: parseFloat(q.get('t') ?? '0.3'),
  storm: parseFloat(q.get('storm') ?? '0'),
  az: parseFloat(q.get('az') ?? '0'),
  el: parseFloat(q.get('el') ?? '32'),
  dist: parseFloat(q.get('dist') ?? '62'),
  fov: parseFloat(q.get('fov') ?? '15'),
  sec: q.has('sec') ? parseFloat(q.get('sec')!) : -1,
  tx: parseFloat(q.get('tx') ?? '0'),
  ty: parseFloat(q.get('ty') ?? '0'),
  tz: parseFloat(q.get('tz') ?? '0'),
  focusY: parseFloat(q.get('focusY') ?? '0.5'),
  shadow: parseFloat(q.get('shadow') ?? '11'),
}

const canvas = document.getElementById('gl') as HTMLCanvasElement
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 768
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
renderer.setClearColor(0xe9f2f4, 1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(15, 1, 0.1, 3000)
const world = new World(scene, mobile)
scene.add(world.object)
const dpr = Math.min(2, devicePixelRatio || 1)
const post = new Post(renderer, scene, camera, dpr > 1.5 || mobile)

function resize() {
  const w = innerWidth, h = innerHeight
  renderer.setPixelRatio(dpr)
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  post.setSize(w, h, dpr)
}
resize()
addEventListener('resize', resize)

// ------------------------------------------------------------------ diorama
const t0 = performance.now()
const town = new THREE.Group()
scene.add(town)
const rand = rng(9)

const main = makeIsland({ radius: 7.5, seed: 5, detail: mobile ? 0.6 : 1 })
town.add(main)
const statics = new THREE.Group()

// road loop around the middle
const loop: [number, number][] = []
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2
  loop.push([Math.cos(a) * 4.1 * 1.05, Math.sin(a) * 3.6])
}
const road = makeRoad(loop, { closed: true, width: 0.85 })
statics.add(road)
const curve = road.userData.curve as THREE.CatmullRomCurve3

// houses along the outside of the loop
const houseSpots: { x: number; z: number; ry: number }[] = []
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI * 2 + 0.2
  const r = 5.6
  houseSpots.push({ x: Math.cos(a) * r * 1.02, z: Math.sin(a) * r * 0.95, ry: -a + Math.PI / 2 + Math.PI })
}
houseSpots.forEach((s, i) => {
  const h = i % 4 === 0 ? makeShop({ seed: i + 3 }) : makeHouse({ seed: i + 11, h: 0.9 + (i % 3) * 0.35, w: 1.1 + (i % 2) * 0.4 })
  h.position.set(s.x, 0, s.z)
  h.lookAt(0, 0, 0)
  statics.add(h)
})

// middle: a green with a pond, a tower, benches, lamps
const pond = makePond({ radius: 1.1, seed: 3 })
pond.position.set(-1.2, 0, 0.4)
statics.add(pond)
const tower = makeTower({ h: 2.6, r: 0.38, color: C.white, band: C.signal, top: 'dome' })
tower.position.set(1.4, 0, -0.6)
statics.add(tower)
for (let i = 0; i < 3; i++) {
  const b = makeBench(i === 1 ? C.teal : C.wood)
  b.position.set(0.2 + i * 0.7, 0, 1.4)
  statics.add(b)
}
const lamps: THREE.Object3D[] = []
for (const [x, z, hark] of [[-0.4, 1.6, 1], [2.3, 0.9, 0], [0.5, -1.7, 0], [-2.6, -0.8, 1]] as const) {
  const l = hark ? makeStreetLamp({ hark: true }) : makeLamp()
  l.position.set(x, 0, z)
  lamps.push(l)
  town.add(l)
}
const path = makePath([[-2.4, 1.2], [-0.8, 1.9], [1.2, 1.9], [2.6, 0.2]], { stones: true })
statics.add(path)
const fence = makeFence([[2.6, -2.2], [3.3, -1.2], [3.6, 0.1]])
statics.add(fence)
const sign = makeSign('Hark Town', { hark: true, font: 'display', sub: 'POP. 1,024 LISTENERS' })
sign.position.set(-0.3, 0, 2.55)
town.add(sign)
const sign2 = makeSign('Main St', { arrow: 'right', w: 1, h: 0.26, post: 0.9 })
sign2.position.set(3.0, 0, 2.2)
sign2.rotation.y = -0.5
town.add(sign2)

// trees: instanced on the outer ring + the green
const pts = islandPoints(main, 26, { seed: 4, margin: 0.5, spacing: 0.9, minR: 6.2 })
const inner = islandPoints(main, 8, { seed: 8, margin: 0.5, spacing: 1, avoid: [{ x: -1.2, z: 0.4, r: 1.7 }, { x: 1.4, z: -0.6, r: 0.9 }, { x: 0.8, z: 1.4, r: 1.1 }] }).filter(p => Math.hypot(p.x / 1.05, p.z) < 2.8)
for (const k of [0, 1, 2]) {
  const mine = pts.filter((_, i) => i % 3 === k)
  town.add(scatter(treeGeometry(k * 3 + 1), clayVC(), mine, { seed: k, castShadow: true, scale: [0.8, 1.15] }))
}
town.add(scatter(treeGeometry(5, 'blossom'), clayVC(), inner, { seed: 12, castShadow: true, scale: [0.6, 0.85] }))
for (let i = 0; i < 8; i++) {
  const b = makeBush(i, 1 + rand() * 0.4)
  const p = main.userData.randomPoint(rand, 0.6)
  b.position.copy(p)
  statics.add(b)
}
for (let i = 0; i < 5; i++) {
  const r = makeRock(i, 1 + rand())
  const p = main.userData.randomPoint(rand, 0.3)
  r.position.copy(p)
  statics.add(r)
}
const tufts = islandPoints(main, 60, { seed: 21, margin: 0.2, spacing: 0.3 })
town.add(scatter(tuftGeometry(), clayVC(), tufts, { seed: 3 }))
const flowers = islandPoints(main, 70, { seed: 31, margin: 0.3, spacing: 0.18, minR: 5.8 })
town.add(scatter(flowerGeometry(), clayVC(), flowers, { seed: 5, colors: ['#ffffff', C.blossom, C.mustard, C.coral, C.lavender] }))

const merged = mergeStatic(statics)
town.add(merged)

// flags
const flags: THREE.Object3D[] = []
for (const [x, z, mark] of [[1.9, -1.3, 1], [2.3, -1.1, 0]] as const) {
  const f = makeFlag({ color: mark ? C.signal : C.roofRed, mark: !!mark })
  f.position.set(x, 0, z)
  flags.push(f)
  town.add(f)
}

// cars on the loop
const cars: THREE.Object3D[] = []
for (let i = 0; i < 4; i++) {
  const c = makeCar(CARS[i * 2 % CARS.length], { seed: i })
  cars.push(c)
  town.add(c)
}

// crowd walking the path
const crowd = makeCrowd(14, { seed: 2 })
town.add(crowd.group)

// second island: windmill, waterfall, trees, rails + tram
const isle2 = makeIsland({ radius: 3.4, seed: 12, beach: 0.5 })
isle2.position.set(12, -1.5, -6)
town.add(isle2)
const mill = makeWindmill({ roof: C.roofBlue })
mill.position.set(0.6, 0, -0.4)
mill.rotation.y = 0.5
isle2.add(mill)
for (let i = 0; i < 5; i++) {
  const t = makeTree(i + 40, 0.9)
  const p = isle2.userData.randomPoint(rand, 0.8)
  if (Math.hypot(p.x - 0.6, p.z + 0.4) < 1) continue
  t.position.copy(p)
  isle2.add(t)
}
const fallA = 0.9
const wf = makeWaterfall({ height: 3.5, width: 0.55 })
wf.position.copy(isle2.userData.edge(fallA))
wf.rotation.y = Math.PI / 2 - fallA
isle2.add(wf)
const rails = makeRails([[-2.4, 1.6], [-0.5, 2.1], [1.6, 1.6]])
isle2.add(rails)
const tram = makeTram(C.signal)
tram.scale.setScalar(0.8)
isle2.add(tram)

// third tiny island with a balloon over it
const isle3 = makeIsland({ radius: 2.2, seed: 19 })
isle3.position.set(-11, 1.2, -4)
town.add(isle3)
const house3 = makeHouse({ seed: 99, style: 'gable', wall: C.blush })
house3.position.set(0, 0, 0)
isle3.add(house3)
const balloon = makeBalloon({ hark: true })
town.add(balloon)
const boat = makeBoat({ sail: C.signal })
boat.scale.setScalar(0.8)
town.add(boat)

const birds = makeBirds({ count: 7, radius: 9, height: 5 })
town.add(birds)

const buildMs = performance.now() - t0

// ?bench: time the kit makers (second call, warm JIT)
const bench: Record<string, number> = {}
if (q.has('bench')) {
  const time = (name: string, fn: () => unknown, n = 1) => {
    fn()
    const a = performance.now()
    for (let i = 0; i < n; i++) fn()
    bench[name] = +((performance.now() - a) / n).toFixed(2)
  }
  time('island r8', () => makeIsland({ radius: 8, seed: 3 }), 5)
  time('island r8 mobile', () => makeIsland({ radius: 8, seed: 3, detail: 0.6 }), 5)
  time('island r3', () => makeIsland({ radius: 3, seed: 4 }), 5)
  time('island r8 bare', () => makeIsland({ radius: 8, seed: 3, drips: false, hanging: 0 }), 5)
  time('island r8 no drips', () => makeIsland({ radius: 8, seed: 3, drips: false }), 5)
  time('house', () => makeHouse({ seed: 7 }), 10)
  time('house flat 2-floor', () => makeHouse({ seed: 8, style: 'flat', h: 1.4 }), 10)
  time('shop', () => makeShop({ seed: 3 }), 10)
  time('tree (cached)', () => makeTree(9), 20)
  time('road loop', () => makeRoad(loop, { closed: true }))
  time('fence', () => makeFence([[0, 0], [3, 0], [3, 3]]))
  time('sign', () => makeSign('Main Street'))
  time('car', () => makeCar(C.teal), 10)
  time('tram', () => makeTram())
  time('windmill', () => makeWindmill())
  time('balloon', () => makeBalloon())
  time('pond', () => makePond())
  time('crowd 20', () => makeCrowd(20))
  const g = new THREE.Group()
  for (let i = 0; i < 12; i++) {
    const h = makeHouse({ seed: i })
    h.position.set(i * 2, 0, 0)
    g.add(h)
  }
  time('mergeStatic 12 houses', () => mergeStatic(g))
}

// ------------------------------------------------------------------ loop
const frame: Frame = {
  time: 0,
  dt: 1 / 60,
  progress: 0,
  velocity: 0,
  pointer: new THREE.Vector2(),
  pointerRaw: new THREE.Vector2(),
  width: innerWidth,
  height: innerHeight,
  mobile,
  reducedMotion: false,
}
const target = new THREE.Vector3()
const clock = new THREE.Timer()
const hud = document.getElementById('hud')!
let frames = 0

function animate(time: number) {
  // cars
  cars.forEach((c, i) => {
    const u = (time * 0.035 + i / cars.length) % 1
    const p = curve.getPointAt(u)
    const tn = curve.getTangentAt(u)
    c.position.set(p.x, 0.02, p.z)
    c.rotation.y = Math.atan2(-tn.z, tn.x)
  })
  // walkers on an ellipse around the green
  for (let i = 0; i < crowd.count; i++) {
    const u = time * 0.03 * (i % 2 ? 1 : -1) + i / crowd.count
    const a = u * Math.PI * 2
    const x = Math.cos(a) * 2.9 * 1.05, z = Math.sin(a) * 2.5
    const heading = Math.atan2(-Math.sin(a) * (i % 2 ? 1 : -1), Math.cos(a) * (i % 2 ? 1 : -1))
    crowd.set(i, x, 0.012, z, heading + Math.PI, Math.abs(Math.sin(time * 7 + i)), 1)
  }
  crowd.commit()
  // tram shuttles on the rails
  const rc = rails.userData.curve as THREE.CatmullRomCurve3
  const u = 0.5 + 0.35 * Math.sin(time * 0.3)
  const tp = rc.getPointAt(u), tt = rc.getTangentAt(u)
  tram.position.set(tp.x, 0, tp.z)
  tram.rotation.y = Math.atan2(-tt.z, tt.x)
  balloon.position.set(-9 + Math.sin(time * 0.2) * 0.4, 5.5 + Math.sin(time * 0.6) * 0.25, -2)
  const pa = time * 0.25
  boat.position.set(-1.2 + Math.cos(pa) * 0.55, 0.035, 0.4 + Math.sin(pa) * 0.45)
  boat.rotation.y = -pa - Math.PI / 2
}

function tick() {
  renderer.info.reset()
  clock.update()
  const dt = Math.min(clock.getDelta(), 0.1)
  frames++
  frame.dt = dt
  frame.time = state.sec >= 0 ? state.sec : frame.time + dt
  frame.width = innerWidth
  frame.height = innerHeight
  animate(frame.time)

  world.resetParams()
  post.resetParams()
  world.params.time = state.t
  world.params.storm = state.storm
  world.params.shadowSize = state.shadow
  world.params.focus.set(state.tx, 0, state.tz)
  post.params.focusY = state.focusY
  post.params.band = 0.17

  const el = THREE.MathUtils.degToRad(state.el), az = THREE.MathUtils.degToRad(state.az)
  target.set(state.tx, state.ty, state.tz)
  camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(state.dist).add(target)
  camera.lookAt(target)
  if (camera.fov !== state.fov) {
    camera.fov = state.fov
    camera.updateProjectionMatrix()
  }
  world.update(frame, camera)
  post.render(dt, frame.time)
  if (frames % 30 === 0) {
    const info = renderer.info
    hud.textContent = `t ${state.t.toFixed(2)} · build ${buildMs.toFixed(0)}ms · calls ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(0)}k`
  }
  requestAnimationFrame(tick)
}
renderer.info.autoReset = false
requestAnimationFrame(tick)

declare global {
  interface Window {
    __lab: { ready: boolean; set: (s: Partial<typeof state>) => void; stats: () => unknown }
  }
}
window.__lab = {
  ready: true,
  set: s => Object.assign(state, s),
  stats: () => ({ bench, build: buildMs, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, programs: renderer.info.programs?.length }),
}
