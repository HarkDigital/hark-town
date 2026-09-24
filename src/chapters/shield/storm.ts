import * as THREE from 'three'
import { cloudGeometry } from '../../kit/props'
import { clamp, ease, rng } from '../../core/math'

/*
 * Weather for The Storm: dark toy clouds, a rain field that parts around the
 * shield dome, red 'hack' lightning (camera-facing jagged ribbons with forks
 * that crackle between shapes), spark bursts at every strike, and glowing
 * crack decals where bolts land.
 */

const _v = new THREE.Vector3()
const _x = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _c = new THREE.Color()

// ------------------------------------------------------------------ clouds

const CLOUDS: { p: [number, number, number]; s: number; seed: number }[] = [
  { p: [-3.3, 7.9, -1.7], s: 1.75, seed: 3 },
  { p: [0.5, 8.6, -3.1], s: 2.1, seed: 1 },
  { p: [3.6, 7.7, -0.9], s: 1.7, seed: 4 },
  { p: [-1.1, 7.5, 1.3], s: 1.4, seed: 2 },
  { p: [2.2, 7.5, 2.3], s: 1.3, seed: 0 },
  { p: [-5.2, 7.0, 1.6], s: 1.15, seed: 3 },
  { p: [5.4, 7.2, -2.6], s: 1.35, seed: 1 },
]

const STORM_GREY = new THREE.Color('#6b7383')
const CLEAR_WHITE = new THREE.Color('#ffffff')
const STORM_GLOW = new THREE.Color('#262c38')
const CLEAR_GLOW = new THREE.Color('#5c5a58')
const FLASH = new THREE.Color('#ece6ff')

interface Cloud {
  mesh: THREE.Mesh
  mat: THREE.MeshStandardMaterial
  base: THREE.Vector3
  out: THREE.Vector3
  seed: number
}

// ------------------------------------------------------------------ bolts

const BOLT_L = 8
const BOLT_VERT = /* glsl */ `
attribute float aSide;
attribute float aCore;
attribute float aFade;
varying float vSide;
varying float vCore;
varying float vFade;
varying float vY;
void main() {
  vSide = aSide;
  vCore = aCore;
  vFade = aFade;
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const BOLT_FRAG = /* glsl */ `
uniform vec3 uGlow;
uniform vec3 uCore;
uniform float uAmp;
varying float vSide;
varying float vCore;
varying float vFade;
varying float vY;
void main() {
  float e = clamp(1.0 - abs(vSide), 0.0, 1.0);
  float glow = e * e;
  float coreI = smoothstep(0.0, 0.75, e);
  vec3 col = mix(uGlow * glow, uCore * coreI, vCore);
  float top = 1.0 - smoothstep(0.8, 1.0, vY);
  gl_FragColor = vec4(col * uAmp * vFade * top, 1.0);
}
`

/** A jagged bolt ribbon from y = 0 (impact) to y = 1 (cloud); x in world units. */
function boltGeometry(seed: number, forks: number): THREE.BufferGeometry {
  const rand = rng(seed)
  const pos: number[] = []
  const side: number[] = []
  const core: number[] = []
  const fade: number[] = []
  const idx: number[] = []
  const strip = (pts: [number, number][], w: number, isCore: number, fadeAlong: boolean) => {
    const base = pos.length / 3
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]
      const b = pts[Math.min(pts.length - 1, i + 1)]
      // perpendicular in world-ish space (y scaled by the nominal length)
      let dx = b[0] - a[0]
      let dy = (b[1] - a[1]) * BOLT_L
      const l = Math.hypot(dx, dy) || 1
      dx /= l
      dy /= l
      const px = -dy
      const py = dx / BOLT_L
      const t = i / (pts.length - 1)
      const ww = w * (fadeAlong ? 1 - t * 0.7 : 1)
      const f = fadeAlong ? 1 - t : 1
      for (const s of [-1, 1]) {
        pos.push(pts[i][0] + px * ww * 0.5 * s, pts[i][1] + py * ww * 0.5 * s, 0)
        side.push(s)
        core.push(isCore)
        fade.push(f)
      }
      if (i > 0) {
        const k = base + i * 2
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k)
      }
    }
  }
  const N = 24
  const xs = new Array<number>(N + 1).fill(0)
  const disp = (a: number, b: number, amp: number) => {
    if (b - a < 2) return
    const m = (a + b) >> 1
    xs[m] = (xs[a] + xs[b]) / 2 + (rand() - 0.5) * amp
    disp(a, m, amp * 0.56)
    disp(m, b, amp * 0.56)
  }
  disp(0, N, 1.5)
  const main: [number, number][] = xs.map((x, i) => [x, i / N])
  strip(main, 0.42, 0, false)
  strip(main, 0.075, 1, false)
  for (let f = 0; f < forks; f++) {
    const start = 7 + Math.floor(rand() * 12)
    let x = main[start][0]
    let y = main[start][1]
    const dir = rand() < 0.5 ? -1 : 1
    const pts: [number, number][] = []
    const n = 5 + Math.floor(rand() * 3)
    for (let k = 0; k <= n; k++) {
      pts.push([x, y])
      x += dir * (0.1 + rand() * 0.2)
      y -= 0.018 + rand() * 0.028
    }
    strip(pts, 0.26, 0, true)
    strip(pts, 0.05, 1, true)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1))
  g.setAttribute('aCore', new THREE.Float32BufferAttribute(core, 1))
  g.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1))
  g.setIndex(idx)
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3)
  return g
}

class Bolt {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  variants: THREE.BufferGeometry[]
  constructor(seed: number) {
    this.variants = [0, 1, 2].map(k => boltGeometry(seed * 17 + k * 101, 2))
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uGlow: { value: new THREE.Color(3.0, 0.1, 0.07) },
        uCore: { value: new THREE.Color(4.2, 1.7, 1.5) },
        uAmp: { value: 0 },
      },
      vertexShader: BOLT_VERT,
      fragmentShader: BOLT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.variants[0], this.mat)
    this.mesh.matrixAutoUpdate = false
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
    this.mesh.visible = false
  }
  /** Place from cloud point S to impact E, facing the camera. */
  set(S: THREE.Vector3, E: THREE.Vector3, amp: number, variant: number, cam: THREE.Vector3) {
    this.mat.uniforms.uAmp.value = amp
    this.mesh.visible = amp > 0.01
    if (!this.mesh.visible) return
    this.mesh.geometry = this.variants[variant % 3]
    _y.subVectors(S, E)
    const len = _y.length() || 1
    _y.divideScalar(len)
    _v.subVectors(cam, E).normalize()
    _x.crossVectors(_y, _v)
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0)
    _x.normalize()
    _z.crossVectors(_x, _y)
    this.mesh.matrix.makeBasis(_x, _y.multiplyScalar(len), _z).setPosition(E)
    this.mesh.matrixWorldNeedsUpdate = true
  }
}

// ------------------------------------------------------------------ rain

const RAIN_VERT = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform float uTop;
uniform float uBottom;
uniform float uRadius;
uniform float uIsland;
uniform float uGround;
uniform float uLen;
uniform float uWidth;
uniform vec3 uWind;
uniform vec4 uDome;
attribute vec4 aSeed;
attribute vec2 aCorner;
varying float vA;
varying float vU;
void main() {
  float H = uTop - uBottom;
  float speed = 9.0 + aSeed.w * 4.0;
  float y = uBottom + fract(aSeed.z - uTime * speed / H) * H;
  float r = sqrt(aSeed.x) * uRadius;
  float a = aSeed.y * 6.28318;
  vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.z));
  // wind drift so the whole column slants
  vec3 head = vec3(cos(a) * r, y, sin(a) * r) + vec3(uWind.x, 0.0, uWind.z) * (y - uGround);
  vec3 tail = head - dir * uLen * (0.8 + aSeed.w * 0.5);
  float on = step(aSeed.w, uAmount);
  // stop at the grass on the island; beyond its rim drops fall on into the sky
  float rimD = length(head.xz);
  on *= 1.0 - step(rimD, uIsland) * step(head.y, uGround);
  // the dome keeps the town dry
  on *= step(uDome.w, length(head - uDome.xyz));
  // fade in under the clouds and out below the island
  float fadeTop = 1.0 - smoothstep(uTop - 1.5, uTop, y);
  float fadeBot = smoothstep(uBottom, uBottom + 2.0, y);
  vec4 mvH = modelViewMatrix * vec4(head, 1.0);
  vec4 mvT = modelViewMatrix * vec4(tail, 1.0);
  vec2 ax = mvH.xy - mvT.xy;
  ax = ax / max(length(ax), 1e-5);
  vec2 sd = vec2(-ax.y, ax.x);
  vec4 mv = mix(mvH, mvT, aCorner.y);
  mv.xy += sd * aCorner.x * uWidth * on;
  gl_Position = projectionMatrix * mv;
  vA = on * fadeTop * fadeBot * (0.55 + 0.45 * aSeed.w);
  vU = aCorner.y;
}
`
const RAIN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying float vU;
void main() {
  float a = vA * uOpacity * (1.0 - vU * 0.85);
  gl_FragColor = vec4(uColor * a, a);
}
`

// ------------------------------------------------------------------ sparks

export const MAX_HITS = 8
const SPARK_VERT = /* glsl */ `
uniform float uScale;
uniform float uGround;
uniform vec3 uPos[${MAX_HITS}];
uniform vec3 uNrm[${MAX_HITS}];
uniform vec3 uCol[${MAX_HITS}];
uniform float uAmp[${MAX_HITS}];
uniform float uPhase[${MAX_HITS}];
attribute vec4 aSeed;
varying vec3 vCol;
varying float vA;
void main() {
  int s = int(aSeed.x + 0.5);
  vec3 P = uPos[s];
  vec3 N = uNrm[s];
  float t = clamp(uPhase[s] * 2.2 - aSeed.y * 0.35, 0.0, 1.0);
  vec3 rnd = vec3(aSeed.z - 0.5, fract(aSeed.z * 7.13 + aSeed.w * 3.7) - 0.5, fract(aSeed.y * 5.31 + aSeed.z * 2.1) - 0.5);
  vec3 dir = normalize(N * (0.7 + aSeed.w * 0.6) + rnd * 1.6 + vec3(1e-4));
  float spd = 0.9 + aSeed.w * 1.4;
  vec3 p = P + dir * spd * t - vec3(0.0, 1.0, 0.0) * t * t * 1.1;
  p.y = max(p.y, uGround + 0.02);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float alive = step(0.0001, t) * (1.0 - t);
  gl_PointSize = uScale * (0.06 + 0.06 * aSeed.w) * alive / max(0.5, -mv.z);
  vCol = uCol[s];
  vA = uAmp[s] * alive;
}
`
const SPARK_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = clamp(1.0 - dot(c, c) * 4.0, 0.0, 1.0);
  gl_FragColor = vec4(vCol * vA * d * d, 1.0);
}
`

/** flat, jagged glowing crack (XZ plane) */
function crackGeometry(seed: number) {
  const rand = rng(seed)
  const pos: number[] = []
  const ray = (x0: number, z0: number, ang: number, len: number, w: number, depth: number) => {
    let x = x0
    let z = z0
    let a = ang
    const segs = 4
    for (let i = 0; i < segs; i++) {
      const l = len / segs
      a += (rand() - 0.5) * 0.9
      const nx = x + Math.cos(a) * l
      const nz = z + Math.sin(a) * l
      const w0 = w * (1 - i / segs)
      const w1 = w * (1 - (i + 1) / segs)
      const px = -Math.sin(a)
      const pz = Math.cos(a)
      pos.push(x + px * w0, 0, z + pz * w0, nx + px * w1, 0, nz + pz * w1, x - px * w0, 0, z - pz * w0)
      pos.push(x - px * w0, 0, z - pz * w0, nx + px * w1, 0, nz + pz * w1, nx - px * w1, 0, nz - pz * w1)
      if (depth > 0 && i === 1) ray(nx, nz, a + (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.5), len * 0.45, w * 0.55, depth - 1)
      x = nx
      z = nz
    }
  }
  const n = 6
  for (let k = 0; k < n; k++) ray(0, 0, (k / n) * Math.PI * 2 + rand() * 0.6, 0.38 + rand() * 0.3, 0.035, 1)
  // hot core
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2
    const a1 = ((k + 1) / 8) * Math.PI * 2
    pos.push(0, 0, 0, Math.cos(a1) * 0.07, 0, Math.sin(a1) * 0.07, Math.cos(a0) * 0.07, 0, Math.sin(a0) * 0.07)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

export class Storm {
  group = new THREE.Group()
  clouds: Cloud[] = []
  bolts: Bolt[] = []
  rain!: THREE.Mesh
  rainMat!: THREE.ShaderMaterial
  sparks!: THREE.Points
  sparkMat!: THREE.ShaderMaterial
  cracks!: THREE.InstancedMesh

  build(mobile: boolean, ground: number, island: number) {
    // clouds
    const list = mobile ? CLOUDS.slice(0, 6) : CLOUDS
    list.forEach((c, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: STORM_GREY.clone(), vertexColors: true, roughness: 1, emissive: STORM_GLOW.clone(), emissiveIntensity: 1 })
      const mesh = new THREE.Mesh(cloudGeometry(c.seed), mat)
      mesh.userData.s = c.s
      mesh.castShadow = false
      mesh.receiveShadow = false
      const base = new THREE.Vector3(...c.p).setY(c.p[1] + ground)
      const out = new THREE.Vector3(c.p[0], 0, c.p[2]).normalize().multiplyScalar(1).setY(0.15)
      if (out.lengthSq() < 0.01) out.set(0, 0.15, -1)
      mesh.rotation.y = (i * 0.7) % 1.2 - 0.6
      this.clouds.push({ mesh, mat, base, out, seed: c.seed })
      this.group.add(mesh)
    })

    // rain
    const N = mobile ? 550 : 1200
    const seeds = new Float32Array(N * 4 * 4)
    const corners = new Float32Array(N * 4 * 2)
    const index: number[] = []
    const rr = rng(99)
    for (let i = 0; i < N; i++) {
      const s = [rr(), rr(), rr(), rr()]
      for (let k = 0; k < 4; k++) {
        seeds.set(s, (i * 4 + k) * 4)
        corners.set([k % 2 === 0 ? -1 : 1, k < 2 ? 0 : 1], (i * 4 + k) * 2)
      }
      const b = i * 4
      index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
    const rg = new THREE.BufferGeometry()
    rg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 4 * 3), 3))
    rg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4))
    rg.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2))
    rg.setIndex(index)
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAmount: { value: 0 },
        uTop: { value: ground + 8.2 },
        uBottom: { value: ground - 5 },
        uRadius: { value: 7.5 },
        uIsland: { value: island },
        uGround: { value: ground },
        uLen: { value: 0.6 },
        uWidth: { value: 0.02 },
        uWind: { value: new THREE.Vector3(0.12, 0, 0.05) },
        uDome: { value: new THREE.Vector4(0, -100, 0, 0) },
        uColor: { value: new THREE.Color(0.78, 0.85, 0.95) },
        uOpacity: { value: 0.45 },
      },
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      // quads are built in view space, so their winding flips with the streak direction
      side: THREE.DoubleSide,
    })
    this.rain = new THREE.Mesh(rg, this.rainMat)
    this.rain.frustumCulled = false
    this.rain.renderOrder = 3
    this.group.add(this.rain)

    // bolts: 4 storm + 3 dome
    for (let i = 0; i < 7; i++) {
      const b = new Bolt(i + 1)
      this.bolts.push(b)
      this.group.add(b.mesh)
    }

    // sparks
    const per = mobile ? 16 : 26
    const sp = new Float32Array(MAX_HITS * per * 4)
    const sr = rng(31)
    for (let s = 0; s < MAX_HITS; s++) for (let k = 0; k < per; k++) sp.set([s, sr(), sr(), sr()], (s * per + k) * 4)
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(MAX_HITS * per * 3), 3))
    sg.setAttribute('aSeed', new THREE.Float32BufferAttribute(sp, 4))
    const vec3s = () => Array.from({ length: MAX_HITS }, () => new THREE.Vector3())
    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: {
        uScale: { value: 500 },
        uGround: { value: ground },
        uPos: { value: vec3s() },
        uNrm: { value: vec3s().map(v => v.set(0, 1, 0)) },
        uCol: { value: vec3s().map(v => v.set(3, 0.5, 0.3)) },
        uAmp: { value: new Array(MAX_HITS).fill(0) },
        uPhase: { value: new Array(MAX_HITS).fill(1) },
      },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.sparks = new THREE.Points(sg, this.sparkMat)
    this.sparks.frustumCulled = false
    this.sparks.renderOrder = 5
    this.group.add(this.sparks)

    // cracks
    this.cracks = new THREE.InstancedMesh(
      crackGeometry(7),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      4,
    )
    for (let i = 0; i < 4; i++) {
      this.cracks.setMatrixAt(i, _m.makeScale(1e-4, 1e-4, 1e-4))
      this.cracks.setColorAt(i, _c.setRGB(2.5, 0.2, 0.15))
    }
    this.cracks.frustumCulled = false
    this.group.add(this.cracks)
  }

  /**
   * Clouds gather from outside the frame (0 → 1 = `gather`) and leave again
   * (`leave`), darkening with the storm and lighting up red when they strike.
   */
  updateClouds(gather: number, leave: number, storm: number, time: number, flashes: number[]) {
    this.clouds.forEach((c, i) => {
      const g = ease.outCubic(clamp(gather * 1.15 - i * 0.03))
      const l = ease.inCubic(clamp(leave * 1.1 - (this.clouds.length - i) * 0.015))
      const p = c.mesh.position
      p.copy(c.base).addScaledVector(c.out, (1 - g) * 11 + l * 14)
      p.y += Math.sin(time * 0.4 + c.seed) * 0.12 + (1 - g) * 1.5
      p.x += Math.sin(time * 0.13 + c.seed * 2.1) * 0.25
      const s = (0.75 + 0.25 * g) * (c.mesh.userData.s as number)
      c.mesh.scale.set(s, 0.8 * s * (1 - 0.25 * l), s)
      c.mat.color.copy(CLEAR_WHITE).lerp(STORM_GREY, storm)
      c.mat.emissive.copy(CLEAR_GLOW).lerp(STORM_GLOW, storm)
      c.mat.emissive.add(_c.copy(FLASH).multiplyScalar(Math.min(1.2, flashes[i] ?? 0) * 0.32))
    })
  }

  cloudPoint(i: number, out: THREE.Vector3, dx = 0) {
    const c = this.clouds[i % this.clouds.length]
    return out.copy(c.mesh.position).add(_v.set(dx, -0.35, 0.2))
  }

  updateRain(time: number, amount: number, dome: THREE.Vector4, wind: number) {
    const u = this.rainMat.uniforms
    u.uTime.value = time
    u.uAmount.value = amount
    u.uDome.value.copy(dome)
    u.uWind.value.set(0.12 * wind, 0, 0.05 * wind)
    this.rain.visible = amount > 0.001
  }

  /** Spark burst slot: position, surface normal, colour (HDR), amplitude, phase since strike (0..1). */
  setHit(slot: number, pos: THREE.Vector3, nrm: THREE.Vector3, col: THREE.Color, amp: number, phase: number) {
    const u = this.sparkMat.uniforms
    ;(u.uPos.value as THREE.Vector3[])[slot].copy(pos)
    ;(u.uNrm.value as THREE.Vector3[])[slot].copy(nrm)
    ;(u.uCol.value as THREE.Vector3[])[slot].set(col.r, col.g, col.b)
    ;(u.uAmp.value as number[])[slot] = amp
    ;(u.uPhase.value as number[])[slot] = phase
  }

  setSparkScale(px: number) {
    this.sparkMat.uniforms.uScale.value = px
  }

  /** crack i at pos: size 0..1 (pop), colour HDR */
  setCrack(i: number, pos: THREE.Vector3, size: number, rot: number, col: THREE.Color) {
    const s = Math.max(1e-4, size)
    _m.compose(pos, _q.setFromAxisAngle(_v.set(0, 1, 0), rot), _s.set(s, 1, s))
    this.cracks.setMatrixAt(i, _m)
    this.cracks.setColorAt(i, col)
    this.cracks.instanceMatrix.needsUpdate = true
    if (this.cracks.instanceColor) this.cracks.instanceColor.needsUpdate = true
  }
}

