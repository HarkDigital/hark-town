import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { Builder, paint, xfMatrix, type Paint, type Xf } from '../../kit/geo'
import { clayVC } from '../../kit/palette'

/*
 * One island = one draw call. Every piece of a workshop (the building, each
 * tree, the signpost…) is painted with the kit's vertex-colour Builder and
 * tagged with a pop pivot + delay (aPop). The island's material squashes and
 * stretches each piece up out of the ground around its own pivot as the
 * island's uBuild rises, so buildings POP and trees bounce in one after the
 * other, all in the vertex shader (shadows too, via a matching depth
 * material). aLed marks always-on Hark-green LEDs (bloom); a small atlas
 * (uv) carries the signs' numbers.
 */

type Color = string | THREE.Color | Paint

const _a = new THREE.Matrix4()
const _b = new THREE.Matrix4()

/** Atlas cell rect in uv (4 x 4 grid, cell 0 = plain white) */
export function cellUV(i: number): [number, number, number, number] {
  const c = i % 4, r = Math.floor(i / 4)
  return [c / 4, 1 - (r + 1) / 4, (c + 1) / 4, 1 - r / 4]
}
const WHITE_U = 0.125
const WHITE_V = 0.875

/** static pieces never pop */
export const STATIC = -100

export class PopBuilder {
  private pieces: THREE.BufferGeometry[] = []
  private b = new Builder()
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()]
  private pivot = new THREE.Vector3()
  private delay = STATIC

  private get base() {
    return this.stack[this.stack.length - 1]
  }

  private mat(t?: Xf) {
    return _b.multiplyMatrices(this.base, t ? xfMatrix(t, _a) : _a.identity()).clone()
  }

  /** Build a sub-assembly in a moved/rotated frame. */
  at(t: Xf, fn: () => void) {
    this.stack.push(this.base.clone().multiply(xfMatrix(t, new THREE.Matrix4())))
    fn()
    this.stack.pop()
    return this
  }

  /** Parts added inside fn pop together around (x, y, z) (current frame) after `delay`. */
  piece(x: number, z: number, delay: number, fn: () => void, y = 0) {
    this.flush()
    const pp = this.pivot.clone(), pd = this.delay
    this.pivot.set(x, y, z).applyMatrix4(this.base)
    this.delay = delay
    fn()
    this.flush()
    this.pivot.copy(pp)
    this.delay = pd
    return this
  }

  add(geo: THREE.BufferGeometry, color: Color | null, t?: Xf) {
    this.b.add(geo, color, this.mat(t))
    return this
  }
  /** already-painted kit geometry (e.g. treeGeometry), not consumed */
  painted(geo: THREE.BufferGeometry, t?: Xf) {
    this.b.addPainted(geo, this.mat(t))
    return this
  }
  box(w: number, h: number, d: number, color: Color, t?: Xf) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, t)
  }
  /** rounded clay box, bottom at t.y (small pieces get fewer segments, tiny radii a plain box) */
  rbox(w: number, h: number, d: number, r: number, color: Color, t: Xf = {}, seg?: number) {
    const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3)
    const g = rr < 0.012 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, seg ?? (Math.max(w, h, d) > 0.6 ? 2 : 1), rr)
    g.translate(0, h / 2, 0)
    return this.add(g, color, t)
  }
  /** cylinder, bottom at t.y */
  cyl(rt: number, rb: number, h: number, seg: number, color: Color, t: Xf = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg)
    g.translate(0, h / 2, 0)
    return this.add(g, color, t)
  }
  sphere(r: number, color: Color, t?: Xf, detail = 2) {
    return this.add(new THREE.IcosahedronGeometry(r, Math.min(detail, r < 0.05 ? 0 : r < 0.14 ? 1 : 2)), color, t)
  }
  /** cone, bottom at t.y */
  cone(r: number, h: number, seg: number, color: Color, t: Xf = {}) {
    const g = new THREE.ConeGeometry(r, h, seg)
    g.translate(0, h / 2, 0)
    return this.add(g, color, t)
  }
  /** triangular prism roof along z: base width w at y=0, apex height h, length d */
  gable(w: number, h: number, d: number, color: Color, t?: Xf, over = 0.08) {
    const s = new THREE.Shape()
    s.moveTo(-w / 2 - over, 0)
    s.lineTo(0, h)
    s.lineTo(w / 2 + over, 0)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 1 })
    g.translate(0, 0, -d / 2)
    return this.add(g, color, t)
  }

  /** always-on LED (blooms) */
  led(geo: THREE.BufferGeometry, color: string, t?: Xf) {
    const g = paint(geo, color, this.mat(t))
    this.push(g, 1)
    return this
  }
  ledBall(r: number, color: string, t?: Xf) {
    return this.led(new THREE.IcosahedronGeometry(r, 1), color, t)
  }

  /** a textured face (atlas cell), plane in x/y facing +z */
  face(w: number, h: number, cell: number, t?: Xf) {
    const plane = new THREE.PlaneGeometry(w, h).toNonIndexed()
    const uv = plane.attributes.uv.array as Float32Array
    const [u0, v0, u1, v1] = cellUV(cell)
    const out = new Float32Array(uv.length)
    for (let i = 0; i < uv.length; i += 2) {
      out[i] = u0 + (u1 - u0) * (0.04 + uv[i] * 0.92)
      out[i + 1] = v0 + (v1 - v0) * (0.04 + uv[i + 1] * 0.92)
    }
    const g = paint(plane, '#ffffff', this.mat(t))
    this.push(g, 0, out)
    return this
  }

  private push(g: THREE.BufferGeometry, led: number, uv?: Float32Array) {
    const n = g.attributes.position.count
    const pop = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      pop[i * 4] = this.pivot.x
      pop[i * 4 + 1] = this.pivot.y
      pop[i * 4 + 2] = this.pivot.z
      pop[i * 4 + 3] = this.delay
    }
    g.setAttribute('aPop', new THREE.BufferAttribute(pop, 4))
    const l = new Float32Array(n)
    if (led) l.fill(led)
    g.setAttribute('aLed', new THREE.BufferAttribute(l, 1))
    if (!uv) {
      uv = new Float32Array(n * 2)
      for (let i = 0; i < n; i++) {
        uv[i * 2] = WHITE_U
        uv[i * 2 + 1] = WHITE_V
      }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    this.pieces.push(g)
  }

  flush() {
    if (this.b.empty) return
    this.push(this.b.build(), 0)
  }

  /** Bake a kit object (vertex-coloured or plain clay meshes) as-is. */
  object(o: THREE.Object3D, t?: Xf) {
    o.updateMatrixWorld(true)
    const m = this.mat(t)
    o.traverse(c => {
      const mesh = c as THREE.Mesh
      if (!mesh.isMesh) return
      const mm = new THREE.Matrix4().multiplyMatrices(m, mesh.matrixWorld)
      const geo = mesh.geometry.clone()
      if (geo.attributes.color) this.b.add(geo, null, mm)
      else {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
        this.b.add(geo, mat.color ? mat.color.clone() : '#ffffff', mm)
      }
    })
    return this
  }

  get empty() {
    return this.pieces.length === 0 && this.b.empty
  }

  build(): THREE.BufferGeometry {
    this.flush()
    const g = mergeGeometries(this.pieces, false)
    for (const p of this.pieces) p.dispose()
    this.pieces = []
    g.computeBoundingSphere()
    return g
  }
}

// ------------------------------------------------------------------ materials

export interface PopUniforms {
  uBuild: { value: number }
  uJig: { value: number }
}

const POP_VERT_HEAD = /* glsl */ `
attribute vec4 aPop;
uniform float uBuild;
uniform float uJig;
`
const POP_VERT = /* glsl */ `
if (aPop.w > -50.0) {
  float pt = clamp(uBuild - aPop.w, 0.0, 1.0);
  float ys = 1.0 - exp(-5.0 * pt) * cos(10.0 * pt) * (1.0 - pt);
  float xs = min(1.0, pt * 6.0) * (1.0 + 0.45 * (1.0 - ys));
  ys *= 1.0 + uJig;
  xs *= 1.0 - uJig * 0.45;
  transformed = aPop.xyz + (transformed - aPop.xyz) * vec3(xs, ys, xs);
}
`

function patchPop(shader: THREE.WebGLProgramParametersWithUniforms, u: PopUniforms, color: boolean) {
  shader.uniforms.uBuild = u.uBuild
  shader.uniforms.uJig = u.uJig
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${POP_VERT_HEAD}${color ? 'attribute float aLed;\nvarying float vSvcLed;' : ''}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${POP_VERT}${color ? 'vSvcLed = aLed;' : ''}`)
  if (color) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vSvcLed;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (vSvcLed * 2.4);')
  }
}

export function popUniforms(): PopUniforms {
  return { uBuild: { value: 2 }, uJig: { value: 0 } }
}

/** The island's clay: kit look (rim light, dusk glow) + pop + LEDs + sign atlas. */
export function popMaterial(map: THREE.Texture, u: PopUniforms) {
  const kit = clayVC()
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map, roughness: 0.84, metalness: 0 })
  m.onBeforeCompile = (shader, renderer) => {
    kit.onBeforeCompile(shader, renderer)
    patchPop(shader, u, true)
  }
  m.customProgramCacheKey = () => 'svc-pop'
  return m
}

export function popDepthMaterial(u: PopUniforms) {
  const m = new THREE.MeshDepthMaterial()
  m.onBeforeCompile = shader => patchPop(shader, u, false)
  m.customProgramCacheKey = () => 'svc-pop-depth'
  return m
}

/** JS twin of the shader spring (for animated parts): writes a scale. */
export function popScale(pt: number, out: THREE.Vector3, jig = 0) {
  const t = Math.min(1, Math.max(0, pt))
  let ys = 1 - Math.exp(-5 * t) * Math.cos(10 * t) * (1 - t)
  let xs = Math.min(1, t * 6) * (1 + 0.45 * (1 - ys))
  ys *= 1 + jig
  xs *= 1 - jig * 0.45
  return out.set(xs, ys, xs)
}

/** A poke / hello wobble, seconds since the poke. */
export function jiggle(t: number) {
  if (t < 0 || t > 2.5) return 0
  return 0.13 * Math.exp(-3.2 * t) * Math.sin(15 * t)
}

// ------------------------------------------------------------------ small helpers for animated parts

/** Build a vertex-coloured mesh with the kit Builder (clayVC). */
export function vcMesh(fn: (b: Builder) => void, shadow = true): THREE.Mesh {
  const b = new Builder()
  fn(b)
  const m = new THREE.Mesh(b.build(), clayVC())
  m.castShadow = shadow
  m.receiveShadow = true
  return m
}

/** rounded box geometry with its base at y = 0 (for kit Builder.add) */
export function rboxGeo(w: number, h: number, d: number, r: number, seg = 2) {
  const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
  g.translate(0, h / 2, 0)
  return g
}

/** A gear: disc + teeth, axis along z. */
export function gearGeo(r: number, teeth: number, thick: number) {
  const s = new THREE.Shape()
  const inner = r * 0.8
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2
    const w = (Math.PI * 2) / teeth
    const pts: [number, number][] = [
      [inner, a0],
      [r, a0 + w * 0.12],
      [r, a0 + w * 0.42],
      [inner, a0 + w * 0.56],
    ]
    pts.forEach(([rr, a], j) => {
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr
      if (i === 0 && j === 0) s.moveTo(x, y)
      else s.lineTo(x, y)
    })
  }
  s.closePath()
  const hole = new THREE.Path()
  hole.absarc(0, 0, r * 0.28, 0, Math.PI * 2, true)
  s.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1, curveSegments: 6 })
  g.translate(0, 0, -thick / 2)
  return g
}
