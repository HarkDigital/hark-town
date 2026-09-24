import * as THREE from 'three'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js'
import { fbm2, vnoise2 } from '../../kit/geo'
import { clamp, lerp, rng, smoothstep } from '../../core/math'
import { nextFrame } from '../../core/yield'

/*
 * The Lighthouse's cloud deck: flying above a sunset cloud layer.
 *
 *   floor   one continuous, softly displaced sheet (slow fbm swells plus
 *           rounded billows), white on the crests and lilac in the troughs,
 *           hazed into the sky's own below-horizon colour so it melts into
 *           the horizon with no seam
 *   masses  a few cumulus heaps of very different sizes: a low collar that
 *           tucks the rock in, a couple beside the island, a sparse mid-field
 *           and a broad line of them on the horizon for the eye-level finale.
 *           Each heap is a smooth-union SDF of nested spheres, polygonised
 *           once (marching cubes) with gradient normals, so it reads as one
 *           soft mass rather than a pile of balls
 *
 * Both share one lit material: wrap lighting over the sun terminator, a low
 * sun silver lining, a sky-tinted lift, and haze into the sky by distance.
 */

/** mean height of the deck's surface near the island */
const FLOOR_Y = -0.62

/**
 * Height of the deck surface at (x, z) (world = island-local here). The
 * boats ride on it, so it is a pure function shared by the mesh and the
 * chapter.
 */
export function deckHeight(x: number, z: number) {
  const r = Math.sqrt(x * x + z * z)
  const swell = fbm2(x * 0.026 + 11.3, z * 0.026 - 4.1, 3) - 0.5
  const b = clamp((fbm2(x * 0.085 - 2.7, z * 0.085 + 8.2, 3) - 0.44) / 0.24)
  const billow = 1 - (1 - b) * (1 - b)
  const fine = vnoise2(x * 0.42 + 1.7, z * 0.42 - 3.3) - 0.5
  // calm round the island (the jetty's posts and the rowboat sit in it)
  const amp = lerp(0.24, 1, smoothstep(7, 22, r))
  return FLOOR_Y + amp * (swell * 3.0 + billow * 1.25 - 0.45 + fine * 0.14)
}

// ------------------------------------------------------------------ material

export interface DeckUniforms {
  [k: string]: THREE.IUniform
  uTime: { value: number }
  uBreath: { value: number }
  uSea: { value: THREE.Color }
  uGlow: { value: THREE.Color }
  uLift: { value: THREE.Color }
  uHazeNear: { value: number }
  uHazeFar: { value: number }
  uHazeMax: { value: number }
  /** lilac the billow creases shade toward */
  uCrease: { value: THREE.Color }
}

function deckUniforms(shared?: DeckUniforms): DeckUniforms {
  return {
    uTime: shared?.uTime ?? { value: 0 },
    uBreath: shared?.uBreath ?? { value: 1 },
    uSea: shared?.uSea ?? { value: new THREE.Color('#f0b2a2') },
    uGlow: shared?.uGlow ?? { value: new THREE.Color('#ffc7a0') },
    uLift: { value: new THREE.Color(0.12, 0.1, 0.12) },
    uHazeNear: { value: 80 },
    uHazeFar: { value: 200 },
    uHazeMax: { value: 1 },
    uCrease: shared?.uCrease ?? { value: new THREE.Color('#b0a2d6') },
  }
}

const SKY_BELOW = /* glsl */ `
  float deckHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float deckNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(deckHash(i), deckHash(i + vec2(1.0, 0.0)), u.x), mix(deckHash(i + vec2(0.0, 1.0)), deckHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // the chapter sky's own below-horizon colour (see skyMaterial), so the
  // hazed deck lands exactly on the sky where it runs out
  vec3 deckSky(vec3 d) {
    float h = d.y;
    float az = atan(d.z, d.x);
    float streak = deckNoise(vec2(az * 26.0, h * 380.0)) * 0.6 + deckNoise(vec2(az * 70.0, h * 900.0)) * 0.4;
    vec3 sea = mix(uGlow, mix(uSea, uGlow, 0.3), smoothstep(0.0, -0.012, h));
    sea = mix(sea, uSea, smoothstep(-0.01, -0.06, h));
    return sea * (0.95 + 0.1 * streak * smoothstep(0.0, -0.01, h));
  }
  // cotton: soft rounded lumps of a few sizes, flat-ish tops, soft troughs
  float deckPuff(vec2 p) {
    float n = deckNoise(p) * 0.58 + deckNoise(p * 2.07 + 9.3) * 0.28 + deckNoise(p * 4.31 - 3.1) * 0.14;
    return smoothstep(0.26, 0.78, n);
  }
`

function deckMaterial(u: DeckUniforms, floor: boolean) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, vertexColors: true })
  if (floor) m.defines = { DECK_FLOOR: '' }
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uBreath;\nvarying vec3 vDeckW;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float deckPh = instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.29;
          transformed *= 1.0 + 0.016 * uBreath * sin(uTime * 0.42 + deckPh);
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 dw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            dw = instanceMatrix * dw;
          #endif
          vDeckW = (modelMatrix * dw).xyz;
        }`,
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSea, uGlow, uLift, uCrease;
        uniform float uHazeNear, uHazeFar, uHazeMax;
        varying vec3 vDeckW;
        ${SKY_BELOW}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifdef DECK_FLOOR
        {
          // small billows as a bump (the mesh carries the big swells): tilt
          // the normal by the billow slope, shade the creases lilac. Fades out
          // with distance before it can shimmer.
          float bd = length(vDeckW - cameraPosition);
          float bf = 1.0 - smoothstep(160.0, 420.0, bd);
          if (bf > 0.0) {
            vec2 bp = vDeckW.xz * 0.19;
            float e = 0.05;
            float b0 = deckPuff(bp);
            float bx = deckPuff(bp + vec2(e, 0.0));
            float bz = deckPuff(bp + vec2(0.0, e));
            // slope in world units: lumps ~0.9 high over ~5 units
            vec2 bg = vec2(bx - b0, bz - b0) / e * 0.19 * 0.9 * bf;
            normal = normalize(normal + mat3(viewMatrix) * vec3(-bg.x, 0.0, -bg.y));
            float trough = 1.0 - smoothstep(0.0, 0.55, b0);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uCrease, trough * 0.3 * bf);
          }
        }
        #endif`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uLift * diffuseColor.rgb;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          // soft wrap over the terminator, and light scattering through the
          // thin edges when we look toward the low sun
          vec3 dL = directionalLights[0].direction;
          vec3 dC = directionalLights[0].color;
          float ndl = dot(geometryNormal, dL);
          float wrapL = saturate((ndl + 0.6) / 1.6) - saturate(ndl);
          reflectedLight.directDiffuse += dC * BRDF_Lambert(material.diffuseColor) * wrapL * 0.45;
          float fwd = saturate(dot(-geometryViewDir, dL));
          fwd *= fwd;
          fwd *= fwd;
          float rim = 1.0 - saturate(dot(geometryNormal, geometryViewDir));
          reflectedLight.directDiffuse += dC * material.diffuseColor * rim * rim * (fwd * 0.3 + 0.04);
        }
        #endif`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
        {
          vec3 dv = vDeckW - cameraPosition;
          float dd = length(dv);
          float hf = smoothstep(uHazeNear, uHazeFar, dd) * uHazeMax;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, deckSky(dv / max(dd, 1e-3)), hf);
        }`,
      )
  }
  m.customProgramCacheKey = () => (floor ? 'town-contact-deck-floor' : 'town-contact-deck-mass')
  return m
}

// ------------------------------------------------------------------ the floor

const LILAC = new THREE.Color('#c4b6e2')
const DUSK = new THREE.Color('#f6e2ea')
const CREAM = new THREE.Color('#ffffff')

/**
 * A polar sheet (rings get wider with distance, so the detail sits where
 * the camera looks closely), displaced by deckHeight, smooth normals.
 */
function floorGeometry(mobile: boolean) {
  const rings = mobile ? 78 : 104
  const segs = mobile ? 176 : 248
  const r0 = 3.2
  const r1 = 900
  const k = Math.pow(r1 / r0, 1 / (rings - 1))
  const n = rings * segs
  const pos = new Float32Array(n * 3)
  const nor = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const c = new THREE.Color()
  let r = r0
  for (let i = 0; i < rings; i++) {
    const e = Math.max(0.06, r * (k - 1) * 0.5)
    for (let j = 0; j < segs; j++) {
      const a = ((j + (i % 2) * 0.5) / segs) * Math.PI * 2
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      const y = deckHeight(x, z)
      const v = i * segs + j
      pos.set([x, y, z], v * 3)
      const dx = (deckHeight(x + e, z) - deckHeight(x - e, z)) / (2 * e)
      const dz = (deckHeight(x, z + e) - deckHeight(x, z - e)) / (2 * e)
      const l = Math.sqrt(dx * dx + 1 + dz * dz)
      nor.set([-dx / l, 1 / l, -dz / l], v * 3)
      // crests cream, troughs lilac; a blush of dusk pink on the mid slopes
      const t = clamp((y - FLOOR_Y + 0.6) / 1.7)
      c.copy(LILAC).lerp(DUSK, smoothstep(0.0, 0.45, t)).lerp(CREAM, smoothstep(0.3, 0.85, t))
      col.set([c.r, c.g, c.b], v * 3)
    }
    r *= k
  }
  const idx: number[] = []
  // rings alternate a half-segment stagger, so the outer vertex that sits
  // between a and b is c2 on even rings and d on odd ones
  const tri = (p: number, q: number, s: number) => {
    // facing up (+y): (q - p) × (s - p) must have a positive y
    const y = (pos[s * 3] - pos[p * 3]) * (pos[q * 3 + 2] - pos[p * 3 + 2]) - (pos[q * 3] - pos[p * 3]) * (pos[s * 3 + 2] - pos[p * 3 + 2])
    if (y >= 0) idx.push(p, q, s)
    else idx.push(p, s, q)
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j
      const b = i * segs + ((j + 1) % segs)
      const c2 = (i + 1) * segs + j
      const d = (i + 1) * segs + ((j + 1) % segs)
      if (i % 2) {
        tri(a, b, d)
        tri(a, d, c2)
      } else {
        tri(a, b, c2)
        tri(b, d, c2)
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

// ------------------------------------------------------------------ cumulus masses

type Kind = 'heap' | 'tower' | 'low'
interface Ball {
  x: number
  y: number
  z: number
  r: number
}

/** 3D value noise in [0, 1) (integer-lattice hash, smooth fade). */
function hash3(x: number, y: number, z: number) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440670441)) | 0
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const fx = x - xi
  const fy = y - yi
  const fz = z - zi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const w = fz * fz * (3 - 2 * fz)
  const a = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u)
  const b = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u)
  const c = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u)
  const d = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u)
  return lerp(lerp(a, b, v), lerp(c, d, v), w)
}

/**
 * Nested spheres for one heap: a core (broad dome / stacked tower / low
 * bank), a ring of billows on its upper surface, and smaller billows on
 * those. Unit scale: about 4 units across, base at y ≈ 0.
 */
function heapBalls(kind: Kind, seed: number): Ball[] {
  const rnd = rng(seed * 13 + 5)
  const core: Ball[] = []
  if (kind === 'tower') {
    core.push({ x: 0, y: 0, z: 0, r: 1.05 }, { x: -1.0, y: -0.22, z: 0.15, r: 0.72 }, { x: 1.0, y: -0.26, z: -0.1, r: 0.66 })
    core.push({ x: 0.14, y: 0.95, z: 0.02, r: 0.84 }, { x: -0.12, y: 1.72, z: -0.05, r: 0.66 }, { x: 0.12, y: 2.34, z: 0.06, r: 0.46 })
  } else if (kind === 'heap') {
    core.push(
      { x: 0, y: 0.05, z: 0, r: 1.0 },
      { x: -1.0, y: -0.14, z: 0.22, r: 0.74 },
      { x: 1.02, y: -0.18, z: -0.15, r: 0.7 },
      { x: 0.32, y: 0.55, z: -0.3, r: 0.62 },
    )
  } else {
    for (let i = 0; i < 5; i++) {
      core.push({
        x: -1.9 + i * 0.95 + (rnd() - 0.5) * 0.2,
        y: -0.2 + rnd() * 0.12 + (i === 2 ? 0.1 : 0),
        z: (rnd() - 0.5) * 0.5,
        r: 0.5 + rnd() * 0.2 + (i === 2 ? 0.16 : 0),
      })
    }
  }
  const onTop = (list: Ball[], count: number, out: Ball[], rMin: number, rMax: number) => {
    for (let i = 0; i < count; i++) {
      const c = list[Math.floor(rnd() * list.length)]
      const th = rnd() * Math.PI * 2
      const dy = lerp(0.12, 0.92, rnd())
      const h = Math.sqrt(1 - dy * dy)
      const d = c.r * 0.8
      out.push({ x: c.x + Math.cos(th) * h * d, y: c.y + dy * d, z: c.z + Math.sin(th) * h * d, r: c.r * lerp(rMin, rMax, rnd()) })
    }
  }
  const l1: Ball[] = []
  onTop(core, kind === 'low' ? 7 : 11, l1, 0.36, 0.54)
  const l2: Ball[] = []
  onTop(l1, kind === 'low' ? 8 : 15, l2, 0.34, 0.5)
  return [...core, ...l1, ...l2]
}

/** heap SDF: smooth union of the balls, flat base, a little billowing noise */
function heapSdf(balls: Ball[], x: number, y: number, z: number) {
  let d = 1e9
  const k = 0.16
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]
    const dx = x - b.x
    const dy = y - b.y
    const dz = z - b.z
    const s = Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r
    const h = clamp(0.5 + (0.5 * (d - s)) / k)
    d = lerp(d, s, h) - k * h * (1 - h)
  }
  // flat underside (smooth max with the plane y = -0.34)
  const p = -0.34 - y
  const h = clamp(0.5 - (0.5 * (p - d)) / 0.14)
  d = lerp(p, d, h) + 0.14 * h * (1 - h)
  return d + (noise3(x * 2.4 + 7.1, y * 2.4, z * 2.4 - 3.3) - 0.5) * 0.08
}

const DOMAIN: Record<Kind, { ex: number; ez: number; y0: number; y1: number }> = {
  heap: { ex: 2.75, ez: 2.55, y0: -0.6, y1: 2.75 },
  tower: { ex: 2.65, ez: 2.45, y0: -0.6, y1: 3.95 },
  low: { ex: 3.3, ez: 2.0, y0: -0.6, y1: 1.95 },
}

const HEAP_TOP = new THREE.Color('#fffaf5')
const HEAP_MID = new THREE.Color('#f3dfe6')
const HEAP_LOW = new THREE.Color('#c3b2da')

/** yield to the loader when a slice of work has run past its budget */
function slicer(budget = 10) {
  let t0 = performance.now()
  return async () => {
    if (performance.now() - t0 < budget) return
    await nextFrame()
    t0 = performance.now()
  }
}

/**
 * Polygonise one heap once (marching cubes over the SDF) with SDF-gradient
 * normals; time-sliced so the loader keeps painting.
 */
async function heapGeometry(kind: Kind, seed: number, res: number) {
  const slice = slicer()
  const balls = heapBalls(kind, seed)
  const dm = DOMAIN[kind]
  const yc = (dm.y0 + dm.y1) / 2
  const ey = (dm.y1 - dm.y0) / 2
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 60000)
  mc.isolation = 0
  const size = mc.size
  const half = mc.halfsize
  const field = mc.field
  for (let zi = 0; zi < size; zi++) {
    const z = ((zi - half) / half) * dm.ez
    for (let yi = 0; yi < size; yi++) {
      const y = yc + ((yi - half) / half) * ey
      for (let xi = 0; xi < size; xi++) {
        const x = ((xi - half) / half) * dm.ex
        field[xi + yi * size + zi * size * size] = -heapSdf(balls, x, y, z)
      }
    }
    await slice()
  }
  mc.update()
  await slice()
  const count = mc.count
  const src = mc.positionArray
  const pos = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = src[i * 3] * dm.ex
    pos[i * 3 + 1] = yc + src[i * 3 + 1] * ey
    pos[i * 3 + 2] = src[i * 3 + 2] * dm.ez
  }
  mc.geometry.dispose()
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g = mergeVertices(g, 1e-4)
  const p = g.attributes.position
  const index = g.index!
  const nor = new Float32Array(p.count * 3)
  const col = new Float32Array(p.count * 3)
  const e = 0.02
  let top = -1e9
  for (let i = 0; i < p.count; i++) top = Math.max(top, p.getY(i))
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    if (i % 256 === 0) await slice()
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    let nx = heapSdf(balls, x + e, y, z) - heapSdf(balls, x - e, y, z)
    let ny = heapSdf(balls, x, y + e, z) - heapSdf(balls, x, y - e, z)
    let nz = heapSdf(balls, x, y, z + e) - heapSdf(balls, x, y, z - e)
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    nx /= l
    ny /= l
    nz /= l
    nor.set([nx, ny, nz], i * 3)
    // height gradient, darkened into the creases between billows (cheap AO)
    const t = clamp((y + 0.3) / (top + 0.3))
    const open = clamp(heapSdf(balls, x + nx * 0.32, y + ny * 0.32, z + nz * 0.32) / 0.32)
    c.copy(HEAP_LOW).lerp(HEAP_MID, smoothstep(0.0, 0.45, t)).lerp(HEAP_TOP, smoothstep(0.3, 0.85, t) * (0.55 + 0.45 * open))
    c.lerp(HEAP_LOW, (1 - open) * 0.35)
    col.set([c.r, c.g, c.b], i * 3)
  }
  // marching cubes' winding follows the field sign: make sure faces point out
  // (a vote over the first triangles, so a degenerate sliver can't decide it)
  {
    const pa = new THREE.Vector3()
    const pb = new THREE.Vector3()
    const pc = new THREE.Vector3()
    let vote = 0
    for (let i = 0; i < Math.min(index.count, 600); i += 3) {
      const a = index.getX(i)
      pa.fromBufferAttribute(p, a)
      pb.fromBufferAttribute(p, index.getX(i + 1)).sub(pa)
      pc.fromBufferAttribute(p, index.getX(i + 2)).sub(pa)
      pb.cross(pc)
      vote += Math.sign(pb.x * nor[a * 3] + pb.y * nor[a * 3 + 1] + pb.z * nor[a * 3 + 2])
    }
    if (vote < 0) {
      for (let i = 0; i < index.count; i += 3) {
        const t = index.getX(i + 1)
        index.setX(i + 1, index.getX(i + 2))
        index.setX(i + 2, t)
      }
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeBoundingSphere()
  return g
}

interface Placement {
  kind: Kind
  /** polar angle from +x toward +z (island-local), distance, scale */
  a: number
  r: number
  s: number
  /** how deep the base sinks into the floor, in heap units */
  sink?: number
  /** vertical squash (the horizon line is broad, not tall) */
  sy?: number
}

/**
 * Where the heaps go. Cameras: the hold looks from angle ≈ 1.8 (the +z
 * side), the finale from ≈ 1.07; "behind the island" is ≈ 4.2–4.9. The
 * sailboat circles at r ≈ 10.6 and the far boat loops round (-3.2, -34),
 * so nothing sits on either track.
 */
function placements(mobile: boolean): Placement[] {
  const P: Placement[] = []
  // a low collar tucked round the rock (clear of the jetty, smaller in front)
  const jet = 0.374
  const n = mobile ? 9 : 12
  for (let i = 0; i < n; i++) {
    const a = jet + 0.62 + (i / n) * (Math.PI * 2 - 1.24)
    const front = Math.max(0, Math.cos(a - 1.5))
    P.push({ kind: i % 3 === 1 ? 'heap' : 'low', a, r: 4.3 * lerp(1.1, 1.02, front), s: lerp(0.6, 0.36, front), sink: lerp(0.1, 0.22, front) })
  }
  // beside the island, and a sparse mid-field: broad and low, so from eye
  // level (the lamp close-up, the finale) they sit in the deck instead of
  // poking up into the sky
  P.push({ kind: 'heap', a: 4.25, r: 17, s: 1.5, sink: 0.4 })
  P.push({ kind: 'low', a: 5.75, r: 19, s: 1.8, sink: 0.35 })
  P.push({ kind: 'heap', a: 2.55, r: 15, s: 1.15, sink: 0.35 })
  P.push({ kind: 'low', a: 4.72, r: 56, s: 3.2 })
  P.push({ kind: 'heap', a: 3.72, r: 44, s: 2.4, sink: 0.4 })
  if (!mobile) P.push({ kind: 'heap', a: 5.35, r: 70, s: 2.6, sink: 0.4 })
  // a line of cumulus along the horizon behind the finale (a couple of
  // towers among them; the last ones only reach into view on wide screens)
  const hz: [Kind, number, number, number][] = [
    ['heap', 3.78, 250, 9.5],
    ['low', 3.98, 185, 7.5],
    ['tower', 4.12, 330, 6.5],
    ['heap', 4.3, 215, 8.2],
    ['low', 4.46, 265, 9.8],
    ['heap', 4.64, 195, 7.0],
    ['low', 4.86, 240, 8.6],
    ['low', 3.55, 205, 8.4],
    ['heap', 5.1, 225, 8.0],
  ]
  for (const [kind, a, r, s] of mobile ? hz.slice(0, 7) : hz) P.push({ kind, a, r, s, sy: 0.72 })
  return P
}

// ------------------------------------------------------------------ deck

export interface CloudDeck {
  floor: THREE.Mesh
  masses: THREE.InstancedMesh[]
  /** per-frame: sky colours, breath, the haze scale (≈ camera distance) */
  update(o: { time: number; breath: number; sea: THREE.Color; glow: THREE.Color; dist: number; lift: number; massLift: number }): void
}

export async function buildCloudDeck(root: THREE.Group, mobile: boolean): Promise<CloudDeck> {
  const floorU = deckUniforms()
  const massU = deckUniforms(floorU)
  const floor = new THREE.Mesh(floorGeometry(mobile), deckMaterial(floorU, true))
  floor.receiveShadow = true
  floor.castShadow = false
  floor.frustumCulled = false
  root.add(floor)
  await nextFrame()

  const massMat = deckMaterial(massU, false)
  const kinds: Kind[] = ['heap', 'tower', 'low']
  const res: Record<Kind, number> = mobile ? { heap: 34, tower: 34, low: 30 } : { heap: 46, tower: 44, low: 40 }
  const lists: Record<Kind, THREE.Matrix4[]> = { heap: [], tower: [], low: [] }
  const pr = rng(91)
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  for (const p of placements(mobile)) {
    const x = Math.cos(p.a) * p.r
    const z = Math.sin(p.a) * p.r
    const sy = p.s * lerp(0.85, 1.08, pr()) * (p.sy ?? 1)
    const y = deckHeight(x, z) - (p.sink ?? 0.3) * sy
    q.setFromEuler(e.set(0, pr() * Math.PI * 2, 0))
    lists[p.kind].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(p.s * lerp(0.92, 1.12, pr()), sy, p.s)))
  }
  const masses: THREE.InstancedMesh[] = []
  for (const kind of kinds) {
    const list = lists[kind]
    if (!list.length) continue
    const geo = await heapGeometry(kind, kinds.indexOf(kind) + 1, res[kind])
    const im = new THREE.InstancedMesh(geo, massMat, list.length)
    list.forEach((m, i) => im.setMatrixAt(i, m))
    im.receiveShadow = true
    im.castShadow = false
    im.frustumCulled = false
    root.add(im)
    masses.push(im)
    await nextFrame()
  }

  return {
    floor,
    masses,
    update(o) {
      floorU.uTime.value = o.time
      floorU.uBreath.value = o.breath
      floorU.uSea.value.copy(o.sea)
      floorU.uGlow.value.copy(o.glow)
      floorU.uLift.value.copy(o.glow).lerp(o.sea, 0.3).multiplyScalar(o.lift)
      floorU.uHazeNear.value = o.dist * 1.25
      floorU.uHazeFar.value = o.dist * 3.3
      floorU.uHazeMax.value = 1
      // the heaps keep their shape (and some glow) further out, so the
      // horizon line of cumulus still reads at dusk
      massU.uLift.value.copy(o.glow).multiplyScalar(o.massLift)
      massU.uHazeNear.value = o.dist * 1.8
      massU.uHazeFar.value = o.dist * 5
      massU.uHazeMax.value = 0.6
    },
  }
}
