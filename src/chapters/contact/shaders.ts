import * as THREE from 'three'

/*
 * Materials for the Lighthouse: the dusk sky (a camera-centred backdrop with
 * a Belt-of-Venus horizon, stars and a rising full moon, tuned for a long
 * lens) and the lamp's two sweeping beams. The cloud deck's material lives
 * with it in ./clouds.ts (its haze reuses this sky's below-horizon colour).
 * GLSL notes: no pow() on signed values, no fwidth, no dynamic loops.
 */

const HASH = /* glsl */ `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * .1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`

export interface SkyUniforms {
  [k: string]: THREE.IUniform
  uSea: { value: THREE.Color }
  uGlow: { value: THREE.Color }
  uBelt: { value: THREE.Color }
  uLow: { value: THREE.Color }
  uHigh: { value: THREE.Color }
  uSunDir: { value: THREE.Vector3 }
  uStars: { value: number }
  uTime: { value: number }
  /** radians per device pixel (fov / drawing height) */
  uPx: { value: number }
  uMoonDir: { value: THREE.Vector3 }
  uMoonU: { value: THREE.Vector3 }
  uMoonV: { value: THREE.Vector3 }
  /** angular radius, radians */
  uMoonR: { value: number }
  uMoon: { value: number }
  uMoonCol: { value: THREE.Color }
}

export function skyUniforms(): SkyUniforms {
  return {
    uSea: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uBelt: { value: new THREE.Color() },
    uLow: { value: new THREE.Color() },
    uHigh: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0.7, 0.4, 0.6) },
    uStars: { value: 0 },
    uTime: { value: 0 },
    uPx: { value: 0.0003 },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonU: { value: new THREE.Vector3(1, 0, 0) },
    uMoonV: { value: new THREE.Vector3(0, 0, 1) },
    uMoonR: { value: 0.02 },
    uMoon: { value: 0 },
    uMoonCol: { value: new THREE.Color('#fff1d6') },
  }
}

/**
 * The chapter's own sky, drawn over the shared dome. Its gradient is
 * compressed toward the horizon because a 16° lens only ever sees the first
 * few degrees of sky: the far sea of clouds below, a warm haze at the
 * horizon, the pink Belt of Venus, then indigo with stars.
 */
export function skyMaterial(u: SkyUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSea, uGlow, uBelt, uLow, uHigh, uSunDir, uMoonDir, uMoonU, uMoonV, uMoonCol;
      uniform float uStars, uTime, uPx, uMoonR, uMoon;
      varying vec3 vDir;
      ${HASH}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        float az = atan(d.z, d.x);

        // above: haze -> belt of Venus -> lavender -> indigo (compressed for a long lens)
        vec3 sky = mix(uGlow, uBelt, smoothstep(0.0, 0.022, h));
        sky = mix(sky, uLow, smoothstep(0.02, 0.055, h));
        sky = mix(sky, uHigh, smoothstep(0.045, 0.16, h));
        // warmer toward the sun's side of the horizon
        vec2 sh = normalize(vec2(uSunDir.x, uSunDir.z) + 1e-5);
        vec2 dh = normalize(vec2(d.x, d.z) + 1e-5);
        float toSun = max(dot(sh, dh), 0.0);
        sky += uGlow * toSun * toSun * toSun * 0.35 * (1.0 - smoothstep(0.0, 0.2, h));

        // below: the far sea of clouds melting into the horizon haze, with faint stratus streaks
        float streak = vnoise(vec2(az * 26.0, h * 380.0)) * 0.6 + vnoise(vec2(az * 70.0, h * 900.0)) * 0.4;
        vec3 sea = mix(uGlow, mix(uSea, uGlow, 0.3), smoothstep(0.0, -0.012, h));
        sea = mix(sea, uSea, smoothstep(-0.01, -0.06, h));
        // straight down (through gaps in the clouds): the deep sky beneath the islands
        sea = mix(sea, mix(uLow, uHigh, 0.35), smoothstep(-0.12, -0.55, h) * 0.75);
        sea *= 0.95 + 0.1 * streak * smoothstep(0.0, -0.01, h);

        vec3 col = mix(sea, sky, step(0.0, h));

        // stars: one candidate per ~0.3 degree cell, sized in pixels
        float el = asin(clamp(h, -1.0, 1.0));
        vec2 sp = vec2(az, el);
        float cs = 0.0055;
        vec2 cell = floor(sp / cs);
        float r = hash12(cell);
        vec2 jit = vec2(hash12(cell + 17.31), hash12(cell + 41.17)) - 0.5;
        vec2 sc = (cell + 0.5 + jit * 0.7) * cs;
        float dpx = length(vec2((sp.x - sc.x) * cos(el), sp.y - sc.y)) / max(uPx, 1e-6);
        float size = mix(0.8, 2.1, hash12(cell + 7.7));
        float star = step(0.885, r) * (1.0 - smoothstep(size * 0.35, size, dpx));
        float tw = 0.72 + 0.28 * sin(uTime * (1.1 + 2.3 * hash12(cell + 3.1)) + r * 60.0);
        star *= tw * uStars * smoothstep(0.018, 0.075, h);
        col += vec3(1.0, 0.96, 0.88) * star * 1.25;

        // the full moon, rising out of the far clouds
        float md = dot(d, uMoonDir);
        float ang = length(cross(d, uMoonDir));
        float front = step(0.0, md);
        float disc = (1.0 - smoothstep(uMoonR - uPx * 1.6, uMoonR, ang)) * front;
        vec2 mq = vec2(dot(d, uMoonU), dot(d, uMoonV)) / max(uMoonR, 1e-4);
        float maria = vnoise(mq * 2.3 + 3.7) * 0.6 + vnoise(mq * 5.1 + 1.3) * 0.4;
        float limb = clamp(1.0 - dot(mq, mq), 0.0, 1.0);
        vec3 moon = uMoonCol * (0.86 + 0.14 * smoothstep(0.35, 0.75, maria)) * (0.9 + 0.1 * limb);
        float above = smoothstep(-0.001, 0.004, h);
        float halo = exp(-max(ang - uMoonR, 0.0) / max(uMoonR * 0.9, 1e-4)) * front * (1.0 - disc);
        col = mix(col, moon, disc * uMoon * above);
        col += uMoonCol * halo * 0.22 * uMoon * above;

        col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
}

/**
 * Two opposed beams in one mesh (aSide: 0 = Hark green, 1 = warm). Additive,
 * brightest at the lamp and along the core, fading along the length.
 */
export function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uI: { value: 0 },
      uWarm: { value: new THREE.Color(1.0, 0.78, 0.46) },
      uGreen: { value: new THREE.Color(0.25, 1.0, 0.55) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSide;
      varying float vT;
      varying float vSide;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vT = 1.0 - uv.y;
        vSide = aSide;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uI;
      uniform vec3 uWarm, uGreen;
      varying float vT;
      varying float vSide;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float edge = abs(dot(normalize(vN), normalize(vV)));
        edge = edge * edge * edge;
        float along = 1.0 - clamp(vT, 0.0, 1.0);
        along = along * along;
        float start = smoothstep(0.0, 0.05, vT);
        vec3 c = mix(uGreen, uWarm, vSide) * edge * along * start * uI * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
}

/** Soft radial falloff for the lamp's glow sprite. */
export function glowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)')
  grd.addColorStop(0.45, 'rgba(255,255,255,0.14)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
