import * as THREE from 'three'

/*
 * Time-of-day palette + the sky dome shader.
 *
 * The chapters mostly look DOWN at an island through a telephoto lens, so
 * most of the visible "sky" is below the horizon. The dome ray-casts a soft
 * stylised cloud sea far below (world-space, so it parallaxes correctly as
 * the camera glides), fading into a warm haze toward the horizon. Above the
 * horizon: zenith → horizon gradient with a sun glow.
 */

export interface SkyKey {
  t: number
  zenith: string
  horizon: string
  sun: string
  /** lit cloud-sea tops */
  seaLit: string
  /** shaded cloud-sea sides */
  seaShade: string
  /** gaps between the clouds (looking down into the deep sky) */
  seaGap: string
  /** far haze (what distant things fade into) */
  haze: string
  /** sun elevation (deg) and azimuth (deg, 0 = +z/camera front, + toward +x) */
  el: number
  az: number
  /** sun intensity */
  power: number
}

export const SKY_KEYS: SkyKey[] = [
  { t: 0.0, zenith: '#7d8ccc', horizon: '#f8c5b2', sun: '#ffb48e', seaLit: '#fbe0d3', seaShade: '#c4b4cf', seaGap: '#a4a7d2', haze: '#e9c9c6', el: 12, az: -70, power: 1.6 },
  { t: 0.28, zenith: '#85c0ef', horizon: '#fde9d6', sun: '#ffe7cc', seaLit: '#fffaf2', seaShade: '#cbdaf0', seaGap: '#9fc6ea', haze: '#e8eef2', el: 40, az: -55, power: 2.35 },
  { t: 0.5, zenith: '#5eaeea', horizon: '#e2f1f8', sun: '#fff8ee', seaLit: '#ffffff', seaShade: '#c9def2', seaGap: '#8fc0ea', haze: '#dcecf6', el: 62, az: -20, power: 2.6 },
  { t: 0.62, zenith: '#66aae4', horizon: '#f1efe0', sun: '#fff1da', seaLit: '#fffaf0', seaShade: '#cfdcee', seaGap: '#95bee4', haze: '#e6ebec', el: 52, az: 5, power: 2.5 },
  { t: 0.76, zenith: '#7ba3d8', horizon: '#ffd49e', sun: '#ffc680', seaLit: '#fff0d6', seaShade: '#d9c7c9', seaGap: '#a9b4d6', haze: '#f3dcc0', el: 30, az: 30, power: 2.35 },
  { t: 0.9, zenith: '#7478bd', horizon: '#ffa382', sun: '#ff9a66', seaLit: '#ffd2b4', seaShade: '#c7a2b8', seaGap: '#9a93c6', haze: '#eeb5a6', el: 21, az: 45, power: 2.25 },
  { t: 1.0, zenith: '#40457c', horizon: '#e8877c', sun: '#ff7c5c', seaLit: '#f0ab98', seaShade: '#8f7d9f', seaGap: '#5d5e92', haze: '#b98a95', el: 12, az: 58, power: 1.7 },
]

export const STORM = {
  zenith: new THREE.Color('#5a6472'),
  horizon: new THREE.Color('#a3abb4'),
  seaLit: new THREE.Color('#c4cad1'),
  seaShade: new THREE.Color('#7f8894'),
  seaGap: new THREE.Color('#5d6673'),
  haze: new THREE.Color('#9aa2ab'),
  sun: new THREE.Color('#dfe3e8'),
}

type ColorKey = 'zenith' | 'horizon' | 'sun' | 'seaLit' | 'seaShade' | 'seaGap' | 'haze'
const parsed = SKY_KEYS.map(k => ({
  ...k,
  c: {
    zenith: new THREE.Color(k.zenith),
    horizon: new THREE.Color(k.horizon),
    sun: new THREE.Color(k.sun),
    seaLit: new THREE.Color(k.seaLit),
    seaShade: new THREE.Color(k.seaShade),
    seaGap: new THREE.Color(k.seaGap),
    haze: new THREE.Color(k.haze),
  } as Record<ColorKey, THREE.Color>,
}))

/** Find the two keys around t and the smooth blend between them. */
function around(t: number) {
  const x = Math.min(1, Math.max(0, t))
  let i = 0
  while (i < parsed.length - 2 && x > parsed[i + 1].t) i++
  const a = parsed[i], b = parsed[i + 1]
  let k = (x - a.t) / (b.t - a.t)
  k = Math.min(1, Math.max(0, k))
  k = k * k * (3 - 2 * k)
  return { a, b, k }
}

export function skyColor(key: ColorKey, t: number, out: THREE.Color) {
  const { a, b, k } = around(t)
  return out.copy(a.c[key]).lerp(b.c[key], k)
}

export function skyScalar(key: 'el' | 'az' | 'power', t: number) {
  const { a, b, k } = around(t)
  return a[key] + (b[key] - a[key]) * k
}

export function makeSkyMaterial(mobile: boolean) {
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color() },
    uSeaLit: { value: new THREE.Color() },
    uSeaShade: { value: new THREE.Color() },
    uSeaGap: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uStorm: { value: 0 },
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uSeaY: { value: -90 },
    uSea: { value: 1 },
  }
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms,
    defines: { OCTAVES: mobile ? 3 : 4 },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunDir, uSunCol, uSeaLit, uSeaShade, uSeaGap, uHaze, uCam;
      uniform float uStorm, uTime, uSeaY, uSea;
      varying vec3 vDir;
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        for (int i = 0; i < OCTAVES; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3; a *= 0.5; }
        return s / (1.0 - pow(0.5, float(OCTAVES)));
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float s = max(dot(d, normalize(uSunDir)), 0.0);
        float calm = 1.0 - uStorm * 0.85;

        // ---- above the horizon: soft gradient + sun glow
        float up = smoothstep(0.0, 0.62, max(h, 0.0));
        vec3 sky = mix(uHorizon, uZenith, sqrt(up));
        float s2 = s * s, s4 = s2 * s2, s8 = s4 * s4;
        sky += uSunCol * (s8 * s8 * s8 * 0.9 + s8 * 0.18 + s2 * 0.06) * calm;
        // warm horizon glow on the sun's side
        sky += uSunCol * 0.12 * s2 * (1.0 - up) * calm;

        vec3 col = sky;
        if (h < 0.0) {
          // ---- below: haze band at the horizon, then the cloud sea
          vec3 below = mix(uHorizon, uHaze, smoothstep(0.0, 0.05, -h));
          if (uCam.y > uSeaY + 1.0 && uSea > 0.001) {
            float tHit = (uCam.y - uSeaY) / max(-h, 0.004);
            vec2 p = uCam.xz + d.xz * tHit;
            vec2 q = p * 0.021 + vec2(uTime * 0.012, uTime * 0.005);
            float n = fbm(q);
            float nl = fbm(q + normalize(uSunDir.xz + vec2(0.0001)) * 0.22);
            float cover = smoothstep(0.42, 0.6, n);
            float lit = clamp(0.55 + (n - nl) * 4.5, 0.0, 1.0);
            lit = smoothstep(0.25, 0.75, lit);
            vec3 cloud = mix(uSeaShade, uSeaLit, lit);
            // soft sunlit rims on the tops
            cloud += uSunCol * 0.1 * smoothstep(0.6, 0.75, n) * calm;
            vec3 sea = mix(uSeaGap, cloud, cover);
            float fog = 1.0 - exp(-tHit * 0.0022);
            sea = mix(sea, uHaze, clamp(fog, 0.0, 1.0));
            below = mix(below, sea, smoothstep(0.0, 0.08, -h) * uSea);
          }
          col = mix(uHorizon, below, smoothstep(0.0, 0.012, -h));
          col += uSunCol * s4 * 0.05 * calm;
        }
        col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  return { material, uniforms }
}
