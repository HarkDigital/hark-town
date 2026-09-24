import * as THREE from 'three'
import { rng } from '../core/math'
import { C, clay, clayVC } from './palette'
import { Builder, col, twoTone, vnoise2 } from './geo'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'

/** Weld a non-indexed polyhedron so computeVertexNormals gives smooth normals. */
function mergeVerts(g: THREE.BufferGeometry) {
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const m = mergeVertices(g, 1e-4)
  m.computeVertexNormals()
  return m
}
import { KIT } from './anim'

/*
 * Nature pieces: trees, bushes, rocks, flowers, grass tufts, clouds, ponds,
 * waterfalls and birds. Geometry is vertex-coloured and cached, so copies
 * share buffers and instance cheaply (treeGeometry(seed) + clayVC()).
 */

// ------------------------------------------------------------------ trees

const TREE_KINDS = ['round', 'cluster', 'pine', 'poplar', 'round', 'blossom', 'cluster', 'round'] as const
export type TreeKind = 'round' | 'cluster' | 'pine' | 'poplar' | 'blossom'

const LEAVES: [string, string, string][] = [
  [C.leaf, C.leafLight, C.leafDark],
  [C.meadow, '#b5dd7c', '#4f9a55'],
  ['#5dbb78', '#98dc8a', '#2f8a5c'],
  ['#8cc46a', '#c6e28a', '#5a9a4e'],
]
const treeCache = new Map<string, THREE.BufferGeometry>()

/**
 * Tree geometry (vertex-coloured, ~1.3–1.9 units tall at scale 1, base at
 * y = 0). Cached per kind + colour variant: use it for InstancedMesh.
 */
export function treeGeometry(seed = 1, kind?: TreeKind): THREE.BufferGeometry {
  const rand = rng(seed * 7 + 3)
  const k: TreeKind = kind ?? TREE_KINDS[Math.floor(rand() * TREE_KINDS.length)]
  const v = Math.floor(rand() * LEAVES.length)
  const key = `${k}|${k === 'pine' || k === 'blossom' ? 0 : v}`
  let g = treeCache.get(key)
  if (g) return g
  const b = new Builder()
  const [base, light, dark] = LEAVES[v]
  const bark = C.bark
  if (k === 'pine') {
    b.cyl(0.06, 0.09, 0.4, 6, bark, { y: 0.2 })
    const tone = twoTone(C.pine, '#63b27a', '#236b46', 0.3, 1.8)
    for (let i = 0; i < 3; i++) {
      const r = 0.52 - i * 0.12
      b.add(new THREE.ConeGeometry(r, 0.72 - i * 0.08, 9, 1), tone, { y: 0.62 + i * 0.36, ry: i * 0.6 })
    }
  } else if (k === 'poplar') {
    b.cyl(0.05, 0.08, 0.5, 6, bark, { y: 0.25 })
    b.sphere(0.34, twoTone(base, light, dark, 0.4, 1.9), { y: 1.12, sy: 2.1 }, 2)
  } else if (k === 'cluster') {
    b.cyl(0.06, 0.09, 0.62, 6, bark, { y: 0.31 })
    const tone = twoTone(base, light, dark, 0.5, 1.75)
    b.sphere(0.38, tone, { y: 0.86, x: 0.1, sy: 0.9 }, 2)
    b.sphere(0.32, tone, { y: 1.02, x: -0.2, z: 0.12, sy: 0.9 }, 2)
    b.sphere(0.3, tone, { y: 1.34, x: 0.02, z: -0.04, sy: 0.9 }, 2)
  } else {
    const blossom = k === 'blossom'
    b.cyl(0.065, 0.1, 0.62, 6, blossom ? C.woodDark : bark, { y: 0.31 })
    const tone = blossom ? twoTone(C.blossom, '#ffd9e2', '#d98298', 0.5, 1.6) : twoTone(base, light, dark, 0.5, 1.6)
    b.sphere(0.5, tone, { y: 1.0, sy: 0.92 }, 2)
    b.sphere(0.26, tone, { y: 0.9, x: 0.4, z: 0.16 }, 1)
    b.sphere(0.24, tone, { y: 0.84, x: -0.34, z: -0.22 }, 1)
  }
  g = b.build()
  treeCache.set(key, g)
  return g
}

/** A tree (Group with one mesh). Casts shadows. */
export function makeTree(seed = 1, scale = 1, kind?: TreeKind): THREE.Group {
  const rand = rng(seed * 13 + 1)
  const g = new THREE.Group()
  const m = new THREE.Mesh(treeGeometry(seed, kind), clayVC())
  m.scale.setScalar(scale * (0.88 + rand() * 0.24))
  m.rotation.y = rand() * Math.PI * 2
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
  return g
}

// ------------------------------------------------------------------ bushes, rocks, flowers, tufts

const bushCache = new Map<number, THREE.BufferGeometry>()
/** Bush geometry (3 variants, ~0.35 tall). */
export function bushGeometry(seed = 1): THREE.BufferGeometry {
  const v = Math.abs(seed) % 3
  let g = bushCache.get(v)
  if (g) return g
  const b = new Builder()
  const [base, light, dark] = LEAVES[v]
  const tone = twoTone(base, light, dark, 0, 0.4)
  b.sphere(0.24, tone, { y: 0.16, sy: 0.8 }, 1)
  b.sphere(0.17, tone, { y: 0.13, x: 0.2, z: 0.05, sy: 0.85 }, 1)
  b.sphere(0.15, tone, { y: 0.11, x: -0.18, z: -0.08, sy: 0.85 }, 1)
  if (v === 2) {
    // a flowering bush
    const r = rng(5)
    for (let i = 0; i < 7; i++) {
      const a = r() * 6.28, h = 0.12 + r() * 0.16
      b.sphere(0.03, i % 2 ? C.white : C.blossom, { x: Math.cos(a) * 0.22, y: h + 0.1, z: Math.sin(a) * 0.2 }, 0)
    }
  }
  g = b.build()
  bushCache.set(v, g)
  return g
}

export function makeBush(seed = 1, scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(bushGeometry(seed), clayVC())
  m.scale.setScalar(scale)
  m.rotation.y = seed * 1.7
  m.castShadow = false
  m.receiveShadow = true
  return m
}

const rockCache = new Map<number, THREE.BufferGeometry>()
export function rockGeometry(seed = 1): THREE.BufferGeometry {
  const v = Math.abs(seed) % 3
  let g = rockCache.get(v)
  if (g) return g
  const b = new Builder()
  const geo = new THREE.IcosahedronGeometry(0.22, 1)
  const r = rng(v + 3)
  const pos = geo.attributes.position
  const f1 = r() * 6, f2 = r() * 6
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const k = 0.85 + 0.25 * (0.5 + 0.5 * Math.sin(x * 9 + f1) * Math.cos(z * 8 + f2))
    pos.setXYZ(i, x * k * 1.15, y * 0.62 * k, z * k)
  }
  geo.computeVertexNormals()
  const lo = col(C.rockDark), hi = col(C.rockLight)
  b.add(mergeVerts(geo), (_x, _y, _z, out, _nx, ny) => out.copy(lo).lerp(hi, Math.min(1, ny * 0.6 + 0.55)), { y: 0.1, ry: v })
  g = b.build()
  rockCache.set(v, g)
  return g
}

export function makeRock(seed = 1, scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(rockGeometry(seed), clayVC())
  m.scale.setScalar(scale)
  m.rotation.y = seed * 2.3
  m.castShadow = false
  m.receiveShadow = true
  return m
}

let flowerGeo: THREE.BufferGeometry | null = null
/** A tiny flower head on a stem, painted white so instance colours tint the head (stem stays green-ish). */
export function flowerGeometry(): THREE.BufferGeometry {
  if (flowerGeo) return flowerGeo
  const b = new Builder()
  b.cyl(0.008, 0.01, 0.07, 3, '#8fbf6a', { y: 0.035 })
  b.sphere(0.045, C.white, { y: 0.08, sy: 0.75 }, 1)
  flowerGeo = b.build()
  return flowerGeo
}

let tuftGeo: THREE.BufferGeometry | null = null
/** A little grass tuft (5 blades). */
export function tuftGeometry(): THREE.BufferGeometry {
  if (tuftGeo) return tuftGeo
  const b = new Builder()
  const paint = (_x: number, y: number, _z: number, out: THREE.Color) => out.copy(col(C.grass)).lerp(col(C.grassLight), Math.min(1, y / 0.13))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const h = 0.11 + (i % 2) * 0.04
    b.add(new THREE.ConeGeometry(0.028, h, 3), paint, { x: Math.cos(a) * 0.035, y: h / 2, z: Math.sin(a) * 0.035, rx: Math.sin(a) * 0.4, rz: -Math.cos(a) * 0.4 })
  }
  tuftGeo = b.build()
  return tuftGeo
}

// ------------------------------------------------------------------ clouds

const cloudCache = new Map<number, THREE.BufferGeometry>()
/** Puffy stylised cloud geometry: flat-ish bottom, white top, soft lilac-grey underside. ~3 units long at scale 1. */
export function cloudGeometry(seed = 1): THREE.BufferGeometry {
  const v = Math.abs(seed) % 5
  let g = cloudCache.get(v)
  if (g) return g
  const rand = rng(v * 31 + 7)
  const b = new Builder()
  const count = 5 + Math.floor(rand() * 3)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5
    const r = (0.55 + (1 - Math.abs(t) * 1.6) * 0.45) * (0.85 + rand() * 0.3)
    const s = new THREE.IcosahedronGeometry(r, 2)
    s.translate(t * 2.6 + (rand() - 0.5) * 0.2, r * 0.35 + rand() * 0.1, (rand() - 0.5) * 0.7)
    parts.push(s)
  }
  // a couple of puffs behind for volume
  for (let i = 0; i < 2; i++) {
    const r = 0.5 + rand() * 0.2
    const s = new THREE.IcosahedronGeometry(r, 1)
    s.translate((rand() - 0.5) * 1.4, r * 0.3, -0.45 - rand() * 0.2)
    parts.push(s)
  }
  const top = col('#ffffff'), bot = col('#dfe2f0')
  for (const p of parts) {
    // flatten the undersides; keep smooth sphere normals (bend them down where flattened)
    const pos = p.attributes.position, nor = p.attributes.normal
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i)
      if (y < 0) {
        pos.setY(i, y * 0.25)
        const nx = nor.getX(i) * 0.45, ny = nor.getY(i) * 0.45 - 0.55, nz = nor.getZ(i) * 0.45
        const l = Math.hypot(nx, ny, nz)
        nor.setXYZ(i, nx / l, ny / l, nz / l)
      }
    }
    b.add(p, (_x, y, _z, out, _nx, ny) => out.copy(bot).lerp(top, Math.min(1, Math.max(0, y * 0.9 + 0.25 + ny * 0.3))))
  }
  g = b.build()
  cloudCache.set(v, g)
  return g
}

/** Puffy cloud mesh (no shadows by default; set castShadow for a drifting shadow). */
export function makeCloud(seed = 1, scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(cloudGeometry(seed), cloudMaterial())
  m.scale.setScalar(scale)
  m.castShadow = false
  m.receiveShadow = false
  return m
}

let cloudMat: THREE.MeshStandardMaterial | null = null
/**
 * Bright, soft cloud material (vertex colours + a sky-tinted luminous lift
 * driven by the World, so clouds stay creamy at golden hour and grey in
 * storms instead of going muddy). Shared: don't mutate.
 */
export function cloudMaterial() {
  if (cloudMat) return cloudMat
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 })
  const base = clayVC().onBeforeCompile
  m.onBeforeCompile = (shader, r) => {
    base.call(m, shader, r)
    shader.uniforms.uCloudLift = KIT.uCloudLift
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCloudLift;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uCloudLift * diffuseColor.rgb;')
  }
  m.customProgramCacheKey = () => 'kit-cloud'
  cloudMat = m
  return m
}

// ------------------------------------------------------------------ water

const WATER_GLSL = /* glsl */ `
float kitHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float kitNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(kitHash(i), kitHash(i + vec2(1.0, 0.0)), u.x), mix(kitHash(i + vec2(0.0, 1.0)), kitHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

let waterMat: THREE.MeshStandardMaterial | null = null
/**
 * Shared toy-water material: vertex colours (shallow → deep), glossy, with
 * drifting sparkle lines driven by KIT.uTime (world-space, so any water mesh
 * can use it).
 */
export function waterMaterial() {
  if (waterMat) return waterMat
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0 })
  m.onBeforeCompile = shader => {
    shader.uniforms.uKitTime = KIT.uTime
    shader.uniforms.uRim = KIT.uRim
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKitW;\nuniform float uKitTime;\nuniform vec3 uRim;\n' + WATER_GLSL)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec2 q = vKitW.xz * 3.6;
          float n1 = kitNoise(q + vec2(uKitTime * 0.5, uKitTime * 0.3));
          float n2 = kitNoise(q * 1.37 - vec2(uKitTime * 0.4, -uKitTime * 0.45) + 7.1);
          float line = 1.0 - abs(n1 + n2 - 1.0);
          float sparkle = smoothstep(0.95, 0.99, line);
          totalEmissiveRadiance += vec3(0.9, 0.97, 1.0) * sparkle * 0.22;
          totalEmissiveRadiance += diffuseColor.rgb * 0.08 * (n1 - 0.5);
          float kitF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uRim * (kitF * kitF) * 0.25;
        }`,
      )
  }
  m.customProgramCacheKey = () => 'kit-water'
  waterMat = m
  return m
}

/** Wobbly disc geometry with shallow → deep vertex colours, y = 0. */
function waterDisc(radius: number, aspect: number, seed: number, segs = 40, shallow: string = C.water, deep: string = C.waterDeep) {
  const rand = rng(seed)
  const f1 = rand() * 6.28, f2 = rand() * 6.28
  const rAt = (a: number) => radius * (1 + 0.1 * Math.sin(a * 2 + f1) + 0.06 * Math.sin(a * 3 + f2))
  const rings = [0.35, 0.7, 0.9, 1]
  const pos: number[] = [0, 0, 0]
  const cs = col(shallow), cd = col(deep), foam = col(C.foam)
  const cols: number[] = [cd.r, cd.g, cd.b]
  const c = new THREE.Color()
  for (const s of rings) {
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2
      const r = rAt(a) * s
      pos.push(Math.cos(a) * r * aspect, 0, Math.sin(a) * r)
      if (s === 1) c.copy(cs).lerp(foam, 0.35)
      else c.copy(cd).lerp(cs, s * s)
      cols.push(c.r, c.g, c.b)
    }
  }
  const idx: number[] = []
  for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i)
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < segs; i++) {
      const a = 1 + k * segs + i, b = 1 + k * segs + ((i + 1) % segs), cc = 1 + (k + 1) * segs + i, d = 1 + (k + 1) * segs + ((i + 1) % segs)
      idx.push(a, b, cc, b, d, cc)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))
  g.setIndex(idx)
  return { geo: g, rAt }
}

/** A little pond: shimmering water in a sandy/stone rim, sitting on the island top. */
export function makePond(o: { radius?: number; aspect?: number; seed?: number; rim?: string; lilies?: boolean } = {}): THREE.Group {
  const R = o.radius ?? 1.4
  const aspect = o.aspect ?? 1
  const seed = o.seed ?? 2
  const { geo, rAt } = waterDisc(R, aspect, seed)
  const g = new THREE.Group()
  const water = new THREE.Mesh(geo, waterMaterial())
  water.position.y = 0.035
  water.receiveShadow = true
  water.name = 'water'
  g.add(water)
  // rim: a ring of soft pebbles/sand
  const b = new Builder()
  const segs = 48
  const inner: number[] = [], outer: number[] = [], top: number[] = []
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const r = rAt(a)
    inner.push(Math.cos(a) * (r - 0.02) * aspect, 0.02, Math.sin(a) * (r - 0.02))
    top.push(Math.cos(a) * (r + 0.08) * aspect, 0.075, Math.sin(a) * (r + 0.08))
    outer.push(Math.cos(a) * (r + 0.24) * aspect, 0.0, Math.sin(a) * (r + 0.24))
  }
  const ring = new THREE.BufferGeometry()
  const all = [...inner, ...top, ...outer]
  ring.setAttribute('position', new THREE.Float32BufferAttribute(all, 3))
  const idx: number[] = []
  for (let k = 0; k < 2; k++)
    for (let i = 0; i < segs; i++) {
      const a0 = k * segs + i, b0 = k * segs + ((i + 1) % segs), c0 = (k + 1) * segs + i, d0 = (k + 1) * segs + ((i + 1) % segs)
      idx.push(a0, c0, b0, b0, c0, d0)
    }
  ring.setIndex(idx)
  ring.computeVertexNormals()
  const rimCol = o.rim ?? C.sand
  b.add(ring, (x, _y, z, out) => out.copy(col(rimCol)).multiplyScalar(0.94 + vnoise2(x * 4, z * 4) * 0.1))
  const rand = rng(seed + 9)
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const r = rAt(a) + 0.12
    b.add(new THREE.DodecahedronGeometry(0.08 + rand() * 0.06, 0), i % 2 ? C.rockLight : C.stone, { x: Math.cos(a) * r * aspect, y: 0.05, z: Math.sin(a) * r, sy: 0.6, ry: rand() * 3 })
  }
  if (o.lilies !== false) {
    for (let i = 0; i < 3; i++) {
      const a = rand() * Math.PI * 2
      const r = rAt(a) * (0.35 + rand() * 0.4)
      b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 10), '#5fae5a', { x: Math.cos(a) * r * aspect, y: 0.045, z: Math.sin(a) * r })
      if (i === 0) b.sphere(0.03, C.blossom, { x: Math.cos(a) * r * aspect, y: 0.07, z: Math.sin(a) * r }, 0)
    }
  }
  const rim = new THREE.Mesh(b.build(), clayVC())
  rim.receiveShadow = true
  g.add(rim)
  g.userData.radius = R
  return g
}

/** Flat water surface of any size (e.g. a lagoon or canal), y = 0, shimmering. */
export function makeWater(o: { radius?: number; aspect?: number; seed?: number } = {}): THREE.Mesh {
  const { geo } = waterDisc(o.radius ?? 3, o.aspect ?? 1, o.seed ?? 4, 56)
  const m = new THREE.Mesh(geo, waterMaterial())
  m.receiveShadow = true
  return m
}

let fallMat: THREE.MeshStandardMaterial | null = null
function waterfallMaterial() {
  if (fallMat) return fallMat
  const m = new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.35, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  m.onBeforeCompile = shader => {
    shader.uniforms.uKitTime = KIT.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vKitUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKitUv = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vKitUv;\nuniform float uKitTime;\n' + WATER_GLSL)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float v = vKitUv.y;
          float streak = kitNoise(vec2(vKitUv.x * 9.0, v * 3.0 - uKitTime * 2.4));
          float streak2 = kitNoise(vec2(vKitUv.x * 17.0 + 3.0, v * 5.0 - uKitTime * 3.1));
          float white = smoothstep(0.55, 0.85, streak * 0.6 + streak2 * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.99, 1.0), white * 0.75 + smoothstep(0.55, 1.0, v) * 0.5);
          float edge = smoothstep(0.0, 0.12, vKitUv.x) * smoothstep(1.0, 0.88, vKitUv.x);
          diffuseColor.a = edge * (1.0 - smoothstep(0.35, 0.95, v)) * 0.9;
        }`,
      )
  }
  m.customProgramCacheKey = () => 'kit-fall'
  fallMat = m
  return m
}

/**
 * A waterfall pouring off an island edge toward local +z and dissolving into
 * mist. Place at island.userData.edge(a) with rotation.y = Math.PI / 2 - a.
 */
export function makeWaterfall(o: { height?: number; width?: number; seed?: number } = {}): THREE.Group {
  const H = o.height ?? 3
  const W = o.width ?? 0.6
  const g = new THREE.Group()
  // sheet: pours over the lip, hugs the wall, fans out as it falls
  const cols = 6, rows = 18
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  for (let r = 0; r <= rows; r++) {
    const v = r / rows
    const y = v < 0.08 ? 0.02 - v * 0.5 : -Math.pow((v - 0.08) / 0.92, 1.1) * H
    const z = v < 0.08 ? -0.35 + (v / 0.08) * 0.62 : 0.27 + Math.sqrt((v - 0.08) / 0.92) * 0.55
    const w = W * (1 + v * 0.7)
    for (let c = 0; c <= cols; c++) {
      const u = c / cols
      pos.push((u - 0.5) * w, y, z)
      uv.push(u, v)
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c, b = a + 1, cc = a + cols + 1, d = cc + 1
      idx.push(a, cc, b, b, cc, d)
    }
  const sheet = new THREE.BufferGeometry()
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  sheet.setIndex(idx)
  sheet.computeVertexNormals()
  const fall = new THREE.Mesh(sheet, waterfallMaterial())
  fall.renderOrder = 2
  g.add(fall)
  // stream on the top + foam at the lip
  const b = new Builder()
  b.rbox(W * 0.9, 0.04, 0.9, 0.02, C.water, { y: 0.02, z: -0.75 }, 1)
  const rand = rng(o.seed ?? 4)
  for (let i = 0; i < 5; i++) b.sphere(0.07 + rand() * 0.05, C.foam, { x: (rand() - 0.5) * W, y: 0.03, z: 0.1 + rand() * 0.15 }, 1)
  const top = new THREE.Mesh(b.build(), clayVC())
  top.receiveShadow = true
  g.add(top)
  return g
}

// ------------------------------------------------------------------ birds

/**
 * A flock of little gulls circling the origin, animated entirely on the GPU
 * (KIT.uTime). One draw call. Position the returned mesh at the circle centre.
 */
export function makeBirds(o: { count?: number; radius?: number; height?: number; seed?: number; color?: string; size?: number } = {}): THREE.Mesh {
  const N = o.count ?? 7
  const R = o.radius ?? 6
  const H = o.height ?? 3
  const S = o.size ?? 0.16
  const rand = rng(o.seed ?? 21)
  const pos: number[] = [], bird: number[] = [], wing: number[] = []
  const add = (x: number, y: number, z: number, w: number, p: number[]) => {
    pos.push(x * S, y * S, z * S)
    wing.push(w)
    bird.push(...p)
  }
  for (let i = 0; i < N; i++) {
    const p = [R * (0.6 + rand() * 0.6), H + (rand() - 0.5) * 1.6, (0.28 + rand() * 0.2) * (rand() < 0.3 ? -1 : 1), rand() * 6.28]
    // left wing, body, right wing (two triangles + a tiny body)
    add(0, 0, 0.35, 0, p); add(0, 0, -0.25, 0, p); add(-1.2, 0, -0.1, 1, p)
    add(0, 0, 0.35, 0, p); add(1.2, 0, -0.1, 1, p); add(0, 0, -0.25, 0, p)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3))
  g.setAttribute('bird', new THREE.Float32BufferAttribute(bird, 4))
  g.setAttribute('wing', new THREE.Float32BufferAttribute(wing, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H, 0), R * 1.3 + 2)
  const m = clay(o.color ?? C.white, { plain: true }).clone()
  m.side = THREE.DoubleSide
  m.onBeforeCompile = shader => {
    shader.uniforms.uKitTime = KIT.uTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 bird;\nattribute float wing;\nuniform float uKitTime;')
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position;
        {
          float t = uKitTime * bird.z + bird.w;
          float flap = sin(uKitTime * 9.0 + bird.w * 5.0);
          transformed.y += wing * flap * 0.55 * ${S.toFixed(3)} * 4.0;
          // heading tangent to the circle
          float hd = t + (bird.z > 0.0 ? 0.0 : 3.14159);
          float c = cos(-hd), s = sin(-hd);
          transformed.xz = mat2(c, -s, s, c) * transformed.xz;
          transformed += vec3(cos(t) * bird.x, bird.y + sin(t * 2.3 + bird.w) * 0.25, sin(t) * bird.x);
        }`,
      )
  }
  m.customProgramCacheKey = () => `kit-birds-${S}`
  const mesh = new THREE.Mesh(g, m)
  mesh.castShadow = false
  mesh.receiveShadow = false
  mesh.frustumCulled = true
  return mesh
}
