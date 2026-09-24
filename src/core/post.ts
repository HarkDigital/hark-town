import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

/**
 * Final display-space pass for Hark Town — a miniature world under a
 * tilt-shift lens:
 *  - TILT-SHIFT: sharp in a horizontal band (uFocusY ± uBand), blurring
 *    smoothly above and below, plus the classic miniature saturation lift.
 *  - CLOUD WIPE at chapter cuts: soft puffy clouds roll across and cover the
 *    frame at the boundary, then part to reveal the next island.
 *  - gentle vignette, fine grain, soft wash (flash) and fade.
 */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    /** 0..1, peaks at a chapter cut (engine-driven) */
    uTransition: { value: 0 },
    /** 0..1 heat-shimmer wobble a chapter can add */
    uGlitch: { value: 0 },
    uAberration: { value: 0.0006 },
    uGrain: { value: 0.03 },
    uVignette: { value: 0.28 },
    /** 0..1 wash to warm white */
    uFlash: { value: 0 },
    /** 0..1 fade to cloud-white (reduced-motion cuts) */
    uFade: { value: 0 },
    /** tilt-shift: screen-space y (0 bottom .. 1 top) of the sharp band */
    uFocusY: { value: 0.5 },
    /** half-height of the sharp band */
    uBand: { value: 0.16 },
    /** max blur radius in CSS px */
    uBlur: { value: 7 },
    /** miniature saturation lift */
    uSat: { value: 1.12 },
    uCloud: { value: new THREE.Color('#fbfaf6') },
    uFadeColor: { value: new THREE.Color('#fbfaf6') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uTransition, uGlitch, uAberration, uGrain, uVignette, uFlash, uFade, uFocusY, uBand, uBlur, uSat;
    uniform vec2 uResolution;
    uniform vec3 uCloud, uFadeColor;
    varying vec2 vUv;

    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float a = 0.5, s = 0.0;
      for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
      return s;
    }

    void main() {
      vec2 uv = vUv;
      float g = clamp(uGlitch, 0.0, 1.0);
      uv.x += g * 0.003 * sin(uv.y * 40.0 + uTime * 6.0);

      // ---- tilt-shift blur (12-tap golden-angle disc)
      float dist = abs(uv.y - uFocusY);
      float amt = smoothstep(uBand, uBand + 0.32, dist);
      vec2 px = 1.0 / uResolution;
      float rad = amt * uBlur * (uResolution.y / 900.0);
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (rad > 0.35) {
        vec3 acc = col;
        float wsum = 1.0;
        for (int i = 0; i < 12; i++) {
          float fi = float(i);
          float r = sqrt((fi + 0.5) / 12.0) * rad;
          float a = fi * 2.39996;
          acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r * px).rgb;
          wsum += 1.0;
        }
        col = acc / wsum;
      }
      // faint lateral colour at the frame edges
      vec2 c = uv - 0.5;
      col.r = mix(col.r, texture2D(tDiffuse, uv + c * uAberration).r, 0.6);
      col.b = mix(col.b, texture2D(tDiffuse, uv - c * uAberration).b, 0.6);

      // miniature look: a touch more saturation and contrast
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * 1.04 + 0.5;

      // ---- cloud wipe at chapter cuts
      float t = clamp(uTransition, 0.0, 1.0);
      if (t > 0.001) {
        float aspect = uResolution.x / max(uResolution.y, 1.0);
        vec2 q = vec2(uv.x * aspect, uv.y) * 2.2 + vec2(uTime * 0.05, 0.0);
        float n = fbm(q) + 0.25 * fbm(q * 2.7 - uTime * 0.08);
        // clouds roll in from the sides toward the middle as t rises
        float edge = abs(uv.x - 0.5) * 1.1;
        float cover = t * 1.55 - 0.35 + edge * (1.0 - t) * 0.9;
        float cl = smoothstep(0.62 - cover, 0.8 - cover, n);
        float shade = 0.9 + 0.1 * smoothstep(0.3, 0.9, fbm(q + vec2(0.0, 0.35)));
        vec3 cloud = uCloud * shade;
        col = mix(col, cloud, cl);
      }

      col = mix(col, vec3(1.0, 0.985, 0.95), clamp(uFlash, 0.0, 1.0));
      float v = 1.0 - smoothstep(0.35, 1.05, length(c * vec2(1.0, 0.9)) * 1.4);
      col *= mix(1.0, 0.55 + 0.45 * v, uVignette);
      col += (hash(vUv * uResolution + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
      col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export type PostParams = {
  bloomStrength: number
  bloomRadius: number
  bloomThreshold: number
  aberration: number
  grain: number
  vignette: number
  /** heat-shimmer wobble 0..1 */
  glitch: number
  /** wash to warm white 0..1 */
  flash: number
  exposure: number
  /** tilt-shift: screen-space y (0 bottom .. 1 top) of the sharp band */
  focusY: number
  /** tilt-shift: half-height of the sharp band (0..0.5) */
  band: number
  /** tilt-shift: max blur radius (px at 900px tall) */
  blur: number
  /** miniature saturation lift (1 = none) */
  sat: number
}

/** Sunny miniature defaults: bloom only on true HDR (lamps, LEDs, sun glints). */
export const POST_DEFAULTS: PostParams = {
  bloomStrength: 0.35,
  bloomRadius: 0.4,
  bloomThreshold: 1.0,
  aberration: 0.0006,
  grain: 0.03,
  vignette: 0.28,
  glitch: 0,
  flash: 0,
  exposure: 1,
  focusY: 0.5,
  band: 0.16,
  blur: 7,
  sat: 1.12,
}

/**
 * Scrubs NaN/Inf and clamps runaway HDR right after the scene render. A single
 * bad fragment would otherwise smear across the whole frame through the bloom
 * mip chain and black it out.
 */
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
    }
  `,
}

export class Post {
  composer: EffectComposer
  bloom: UnrealBloomPass
  final: ShaderPass
  /**
   * Chapters write targets here every frame (engine resets them to defaults
   * first); values are damped toward so nothing pops at a cut.
   */
  params: PostParams = { ...POST_DEFAULTS }
  private current: PostParams = { ...POST_DEFAULTS }
  transition = 0
  fade = 0

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** skip MSAA (retina / mobile: already supersampled, and MSAA half-float targets are huge) */
    noMsaa: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: noMsaa ? 0 : 4,
    })
    this.composer = new EffectComposer(renderer, rt)
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new ShaderPass(SanitizeShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.4, 1.0)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.final = new ShaderPass(FinalShader)
    this.composer.addPass(this.final)
  }

  /** kept for engine compatibility: cuts and fades are always cloud-white here */
  setFadeTone(_tone: number) {}

  resetParams() {
    Object.assign(this.params, POST_DEFAULTS)
  }

  setSize(w: number, h: number, dpr: number) {
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    this.bloom.resolution.set((w * dpr) / 2, (h * dpr) / 2)
    this.final.uniforms.uResolution.value.set(w * dpr, h * dpr)
  }

  render(dt: number, time: number) {
    const k = 1 - Math.exp(-6 * dt)
    const c = this.current
    const p = this.params
    for (const key of Object.keys(p) as (keyof PostParams)[]) {
      // flash & glitch respond instantly so chapters can punch them
      c[key] = key === 'flash' || key === 'glitch' ? p[key] : c[key] + (p[key] - c[key]) * k
    }
    this.bloom.strength = c.bloomStrength
    this.bloom.radius = c.bloomRadius
    this.bloom.threshold = c.bloomThreshold
    this.renderer.toneMappingExposure = c.exposure
    const u = this.final.uniforms
    u.uTime.value = time
    u.uTransition.value = this.transition
    u.uGlitch.value = c.glitch
    u.uAberration.value = c.aberration
    u.uGrain.value = c.grain
    u.uVignette.value = c.vignette
    u.uFlash.value = c.flash
    u.uFade.value = this.fade
    u.uFocusY.value = c.focusY
    u.uBand.value = c.band
    u.uBlur.value = c.blur
    u.uSat.value = c.sat
    this.composer.render(dt)
  }
}
