import * as THREE from 'three'
import { makeCloud } from '../../kit/props'

/*
 * After the storm: a chunky clay toy rainbow that sweeps over the island
 * (each band draws on from one foot to the other), two puffs of cloud at its
 * feet, and little star glints twinkling on the puddles.
 */

const BANDS = ['#e8604a', '#f39a3c', '#f5cd4e', '#7ccb6a', '#56a7e0', '#8d7ad8']

class Arc extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number) {
    super()
  }
  getPoint(t: number, out = new THREE.Vector3()) {
    const a = Math.PI * (1 - t)
    return out.set(Math.cos(a) * this.r, Math.sin(a) * this.r, 0)
  }
}

export class Rainbow {
  group = new THREE.Group()
  private mat: THREE.MeshStandardMaterial
  private uArc = { value: 0 }
  private feet: THREE.Mesh[] = []

  constructor(radius = 5.4, tube = 0.15) {
    const geos: THREE.BufferGeometry[] = []
    BANDS.forEach((hex, i) => {
      const r = radius - i * tube * 1.85
      const g = new THREE.TubeGeometry(new Arc(r), 64, tube, 8, false)
      const n = g.attributes.position.count
      const col = new THREE.Color(hex)
      const colors = new Float32Array(n * 3)
      const arc = new Float32Array(n)
      const band = new Float32Array(n)
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let k = 0; k < n; k++) {
        colors.set([col.r, col.g, col.b], k * 3)
        arc[k] = uv.getX(k)
        band[k] = i / (BANDS.length - 1)
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      g.setAttribute('aArc', new THREE.BufferAttribute(arc, 1))
      g.setAttribute('aBand', new THREE.BufferAttribute(band, 1))
      g.deleteAttribute('uv')
      geos.push(g.index ? g.toNonIndexed() : g)
    })
    const merged = mergeAll(geos)
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0.12 })
    const uArc = this.uArc
    this.mat.onBeforeCompile = shader => {
      shader.uniforms.uArc = uArc
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aArc;\nattribute float aBand;\nvarying float vArc;\nvarying float vBand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArc = aArc;\nvBand = aBand;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uArc;\nvarying float vArc;\nvarying float vBand;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vArc > uArc * 1.12 - vBand * 0.12) discard;')
      // vertex colours are sRGB-authored; three converts them in the colour pipeline
    }
    this.mat.customProgramCacheKey = () => 'shield-rainbow'
    const mesh = new THREE.Mesh(merged, this.mat)
    // light, not stuff: and the depth pass would ignore the sweep anyway
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    this.group.add(mesh)

    // cloud puffs at the feet
    for (const s of [-1, 1]) {
      const m = makeCloud(s < 0 ? 2 : 4, 0.5)
      m.position.set(s * (radius - tube * 4.5), 0.12, 0)
      this.feet.push(m)
      this.group.add(m)
    }
  }

  /** sweep 0..1 draws the arc on; feet pop with `feet` 0..1 */
  set(sweep: number, feet: number) {
    this.uArc.value = sweep
    this.group.visible = sweep > 0.001 || feet > 0.001
    const [f0, f1] = this.feet
    const s0 = Math.max(1e-4, feet)
    f0.scale.set(s0, s0, s0)
    const s1 = Math.max(1e-4, Math.min(1, Math.max(0, sweep * 1.3 - 0.3)) * feet)
    f1.scale.set(s1, s1, s1)
  }
}

function mergeAll(list: THREE.BufferGeometry[]) {
  const out = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'color', 'aArc', 'aBand']) {
    const size = list[0].attributes[name].itemSize
    let n = 0
    for (const g of list) n += g.attributes[name].count
    const arr = new Float32Array(n * size)
    let o = 0
    for (const g of list) {
      const a = g.attributes[name].array as Float32Array
      arr.set(a, o)
      o += a.length
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size))
  }
  out.computeBoundingSphere()
  return out
}

// ------------------------------------------------------------------ glints

export class Glints {
  points: THREE.Points
  mat: THREE.ShaderMaterial

  constructor(spots: THREE.Vector3[]) {
    const pos = new Float32Array(spots.length * 3)
    const seed = new Float32Array(spots.length)
    spots.forEach((p, i) => {
      pos.set([p.x, p.y, p.z], i * 3)
      seed[i] = (i * 0.618) % 1
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmp: { value: 0 }, uScale: { value: 500 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uAmp;
        uniform float uScale;
        attribute float aSeed;
        varying float vI;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float tw = 0.5 + 0.5 * sin(uTime * (2.2 + aSeed * 2.0) + aSeed * 40.0);
          tw = tw * tw * tw;
          vI = uAmp * tw;
          gl_PointSize = uScale * 0.34 * (0.35 + 0.65 * tw) * step(0.001, uAmp) / max(0.5, -mv.z);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vI;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float x = abs(c.x);
          float y = abs(c.y);
          float star = max(exp(-x * 60.0) * exp(-y * 7.0), exp(-y * 60.0) * exp(-x * 7.0));
          float core = exp(-dot(c, c) * 90.0);
          float v = (star + core) * vI;
          gl_FragColor = vec4(vec3(3.2, 3.1, 2.7) * v, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(g, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 6
  }
}
