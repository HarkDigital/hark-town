import * as THREE from 'three'
import { HASH } from '../../core/glsl'

/*
 * The Hark shield: a soft green bubble of hex cells that blows up out of the
 * beacon and settles over the town like a cake cover. Lightning that hits it
 * splashes into expanding hex ripples. After the storm it relaxes into a
 * faint "keeping watch" state with a slow scan band.
 *
 * Geometry: the dual of a subdivided icosahedron (hexagons + 12 pentagons)
 * emitted as kites, so every fragment knows its cell centre (aCell) and how
 * close it is to the cell border (aEdge: 0 centre → 1 border). Whatever dips
 * below the grass is clipped in the shader.
 */

export const MAX_IMPACTS = 4

function hexDomeGeometry(detail: number): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, detail)
  const p = ico.getAttribute('position') as THREE.BufferAttribute
  const verts: THREE.Vector3[] = []
  const lookup = new Map<string, number>()
  const ids: number[] = []
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = `${Math.round(x * 1e4)}|${Math.round(y * 1e4)}|${Math.round(z * 1e4)}`
    let id = lookup.get(k)
    if (id === undefined) {
      id = verts.length
      verts.push(new THREE.Vector3(x, y, z).normalize())
      lookup.set(k, id)
    }
    ids.push(id)
  }
  ico.dispose()

  const tris = ids.length / 3
  const n = tris * 18
  const pos = new Float32Array(n * 3)
  const cell = new Float32Array(n * 3)
  const edge = new Float32Array(n)
  let o = 0
  const push = (v: THREE.Vector3, c: THREE.Vector3, e: number) => {
    const k = o * 3
    pos[k] = v.x
    pos[k + 1] = v.y
    pos[k + 2] = v.z
    cell[k] = c.x
    cell[k + 1] = c.y
    cell[k + 2] = c.z
    edge[o++] = e
  }
  const g = new THREE.Vector3()
  const m1 = new THREE.Vector3()
  const m2 = new THREE.Vector3()
  for (let t = 0; t < tris; t++) {
    const c = [verts[ids[t * 3]], verts[ids[t * 3 + 1]], verts[ids[t * 3 + 2]]]
    g.copy(c[0]).add(c[1]).add(c[2]).normalize()
    for (let k = 0; k < 3; k++) {
      const v = c[k]
      m1.copy(v).add(c[(k + 1) % 3]).normalize()
      m2.copy(v).add(c[(k + 2) % 3]).normalize()
      push(v, v, 0)
      push(m1, v, 1)
      push(g, v, 1)
      push(v, v, 0)
      push(g, v, 1)
      push(m2, v, 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aCell', new THREE.BufferAttribute(cell, 3))
  geo.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1)
  return geo
}

const VERT = /* glsl */ `
attribute vec3 aCell;
attribute float aEdge;
varying vec3 vCell;
varying float vEdge;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vCell = aCell;
  vEdge = aEdge;
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * position);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAG = /* glsl */ `
#define MAX_IMPACTS ${MAX_IMPACTS}
uniform float uTime;
uniform float uFront;
uniform float uIntensity;
uniform float uWatch;
uniform float uGround;
uniform float uPing;
uniform vec3 uCamPos;
uniform vec4 uImpacts[MAX_IMPACTS];
uniform float uImpactAmp[MAX_IMPACTS];
varying vec3 vCell;
varying float vEdge;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vN;

const vec3 G = vec3(0.0, 0.76, 0.2);
const vec3 MINT = vec3(0.55, 1.0, 0.72);
${HASH}
float gauss(float x) { return exp(-x * x); }

void main() {
  // derivatives first, outside any branch
  float fw = max(fwidth(vEdge), 1e-4);
  float line = smoothstep(1.0 - fw * 1.8, 1.0 - fw * 0.3, vEdge);
  float inner = smoothstep(0.55, 1.0, vEdge);

  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vWorld);
  float facing = abs(dot(N, V));
  float fres = clamp(1.0 - facing, 0.0, 1.0);
  fres = fres * fres;
  vec3 cell = normalize(vCell);
  vec3 P = normalize(vObj);
  float h = hash13(cell * 311.7 + 1.3);
  float polarC = acos(clamp(cell.y, -1.0, 1.0));

  // build-in: cells tile on from the apex down and around
  float front = uFront * 3.3;
  float on = 1.0 - smoothstep(front - 0.08, front, polarC + h * 0.06);
  float band = gauss((polarC - front) / 0.05) * step(0.001, uFront) * (1.0 - step(0.999, uFront));

  // impacts: expanding hex ripple + hot spot
  float rip = 0.0;
  float hot = 0.0;
  for (int i = 0; i < MAX_IMPACTS; i++) {
    vec4 im = uImpacts[i];
    float amp = uImpactAmp[i];
    float age = clamp(im.w, 0.0, 1.0);
    float dc = acos(clamp(dot(cell, im.xyz), -1.0, 1.0));
    float dp = acos(clamp(dot(P, im.xyz), -1.0, 1.0));
    float r = 0.04 + age * 0.85;
    float fade = (1.0 - age) * (1.0 - age);
    rip += gauss((dc - r) / 0.07) * fade * amp;
    hot += exp(-dp * dp / 0.0035) * fade * fade * amp;
  }

  // where the bubble meets the grass: a bright seam
  float seam = gauss((vWorld.y - uGround) / 0.07);
  float below = step(vWorld.y, uGround - 0.02);

  // watch: a slow scan band climbing the dome + rare cell pings
  float lat = 1.0 - polarC / 1.5708;
  float scanY = fract(uTime * 0.11);
  float scan = gauss((lat - scanY) / 0.035) * uWatch;
  float ping = step(0.993, hash12(vec2(h * 57.0, floor(uTime * 4.0 + h * 9.0)))) * uPing;

  float I = uIntensity * (gl_FrontFacing ? 1.0 : 0.3);
  vec3 col = vec3(0.0);
  float a = 0.0;
  // glassy bubble: a faint body, a bright fresnel rim
  col += G * on * (0.012 + 0.42 * fres) * I;
  a += on * (0.018 + 0.3 * fres) * I;
  // hex borders: thin, brighter toward the silhouette
  col += MINT * on * line * (0.07 + 1.0 * fres) * I;
  a += on * line * (0.08 + 0.4 * fres) * I;
  col += G * on * inner * 0.025 * I;
  // the building front
  col += MINT * band * (0.1 + line * 2.4);
  a += band * (0.05 + line * 0.45);
  // ripples + hot spots
  col += MINT * (rip * (0.25 + line * 3.2 + inner * 0.3) + hot * 5.0);
  a += rip * (0.12 + line * 0.5) + hot * 0.7;
  // ground seam
  col += MINT * seam * on * 1.6 * I;
  a += seam * on * 0.5 * I;
  // watch
  col += MINT * (scan * (0.15 + line * 2.2) + ping * (0.3 + line * 2.0));
  a += scan * (0.08 + line * 0.5) + ping * 0.3;

  a = clamp(a, 0.0, 0.92) * (1.0 - below);
  col *= 1.0 - below;
  gl_FragColor = vec4(col, a);
}
`

export class Dome {
  mesh: THREE.Mesh
  mat: THREE.ShaderMaterial
  ring: THREE.Mesh
  ringMat: THREE.ShaderMaterial
  impacts: THREE.Vector4[] = []
  amps: number[] = []

  constructor(mobile: boolean) {
    for (let i = 0; i < MAX_IMPACTS; i++) {
      this.impacts.push(new THREE.Vector4(0, 1, 0, 1))
      this.amps.push(0)
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFront: { value: 0 },
        uIntensity: { value: 1 },
        uWatch: { value: 0 },
        uGround: { value: 0 },
        uPing: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uImpacts: { value: this.impacts },
        uImpactAmp: { value: this.amps },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(hexDomeGeometry(mobile ? 11 : 14), this.mat)
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false

    // the shockwave that runs across the grass as the dome pops
    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { uAmp: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uAmp;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float ring = exp(-((d - 0.93) * (d - 0.93)) / 0.0018) + 0.25 * smoothstep(0.6, 0.95, d) * step(d, 1.0);
          vec3 c = vec3(0.3, 1.6, 0.6) * ring * uAmp;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const rg = new THREE.PlaneGeometry(2, 2)
    rg.rotateX(-Math.PI / 2)
    this.ring = new THREE.Mesh(rg, this.ringMat)
    this.ring.renderOrder = 3
    this.ring.frustumCulled = false
  }
}
