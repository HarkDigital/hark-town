import * as THREE from 'three'
import type { Frame } from '../core/types'

/*
 * The shared sky for Hark Town — a miniature world floating in daylight.
 *
 *  - object: a camera-centred sky dome (soft zenith → warm horizon) with a
 *    sun glow; colours follow the time of day and a storm amount.
 *  - sun: one DirectionalLight that casts soft shadows. Its shadow frustum
 *    follows `params.focus` so whichever island is on screen gets crisp
 *    contact shadows without a huge shadow map.
 *  - hemi: sky/ground fill light.
 *
 * Chapters set `world.params` every frame they care (the engine resets them
 * to defaults first); values are damped so cuts never pop. The story runs
 * from morning (hero) to sunset (contact).
 */

export interface WorldParams {
  /** 0 dawn · 0.3 morning · 0.5 noon · 0.75 golden hour · 1 dusk */
  time: number
  /** 0..1 overcast/storm: darker, cooler, flatter light */
  storm: number
  /** world-space point the shadow camera centres on */
  focus: THREE.Vector3
  /** half-size of the shadow frustum (world units) */
  shadowSize: number
  /** multiplier on the sun */
  sun: number
}

export const WORLD_DEFAULTS = { time: 0.35, storm: 0, shadowSize: 14, sun: 1 }

const Z = {
  dawn: new THREE.Color('#9fb7e0'),
  day: new THREE.Color('#7fb8ea'),
  gold: new THREE.Color('#8fa9d8'),
  dusk: new THREE.Color('#42426e'),
  storm: new THREE.Color('#5d6673'),
}
const H = {
  dawn: new THREE.Color('#fbd9c4'),
  day: new THREE.Color('#e9f2f4'),
  gold: new THREE.Color('#ffd7a3'),
  dusk: new THREE.Color('#f59a7a'),
  storm: new THREE.Color('#9aa3ad'),
}
const SUNCOL = {
  dawn: new THREE.Color('#ffd2b0'),
  day: new THREE.Color('#fff6e8'),
  gold: new THREE.Color('#ffc890'),
  dusk: new THREE.Color('#ff9a6e'),
}

/** piecewise colour through the day */
function dayColor(set: { dawn: THREE.Color; day: THREE.Color; gold: THREE.Color; dusk: THREE.Color }, t: number, out: THREE.Color) {
  if (t < 0.3) return out.copy(set.dawn).lerp(set.day, t / 0.3)
  if (t < 0.6) return out.copy(set.day)
  if (t < 0.82) return out.copy(set.day).lerp(set.gold, (t - 0.6) / 0.22)
  return out.copy(set.gold).lerp(set.dusk, (t - 0.82) / 0.18)
}

export class World {
  object = new THREE.Group()
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  params: WorldParams = { ...WORLD_DEFAULTS, focus: new THREE.Vector3() }
  private cur = { ...WORLD_DEFAULTS, focus: new THREE.Vector3() }
  private uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color() },
    uStorm: { value: 0 },
  }
  private sunDir = new THREE.Vector3()
  private shadowSize = -1

  constructor(scene: THREE.Scene, mobile: boolean) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(900, 48, 24),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith, uHorizon, uSunDir, uSunCol;
          uniform float uStorm;
          varying vec3 vDir;
          float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -1.0, 1.0);
            // warm horizon band, soft zenith; below the horizon fades to a hazy floor
            vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, h));
            c = mix(c, uHorizon * 0.92, smoothstep(0.0, -0.35, h));
            float s = max(dot(d, normalize(uSunDir)), 0.0);
            float glow = s * s * s * s * s * s * 0.35 + s * s * 0.08;
            c += uSunCol * glow * (1.0 - uStorm * 0.8);
            c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    )
    dome.frustumCulled = false
    dome.renderOrder = -10
    this.object.add(dome)

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6)
    this.sun.castShadow = true
    const size = mobile ? 1024 : 2048
    this.sun.shadow.mapSize.set(size, size)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.025
    this.sun.shadow.radius = 4
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 160
    scene.add(this.sun)
    scene.add(this.sun.target)

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0xc9b79c, 1.15)
    scene.add(this.hemi)
  }

  resetParams() {
    this.params.time = WORLD_DEFAULTS.time
    this.params.storm = WORLD_DEFAULTS.storm
    this.params.shadowSize = WORLD_DEFAULTS.shadowSize
    this.params.sun = WORLD_DEFAULTS.sun
    this.params.focus.set(0, 0, 0)
  }

  /** current (damped) time of day, 0..1 */
  get time() {
    return this.cur.time
  }

  update(frame: Frame, camera: THREE.Camera) {
    const k = 1 - Math.exp(-3.5 * frame.dt)
    const c = this.cur
    const p = this.params
    c.time += (p.time - c.time) * k
    c.storm += (p.storm - c.storm) * k
    c.shadowSize += (p.shadowSize - c.shadowSize) * k
    c.sun += (p.sun - c.sun) * k
    c.focus.lerp(p.focus, 1 - Math.exp(-8 * frame.dt))

    const u = this.uniforms
    dayColor(Z, c.time, u.uZenith.value).lerp(Z.storm, c.storm)
    dayColor(H, c.time, u.uHorizon.value).lerp(H.storm, c.storm)
    dayColor(SUNCOL, c.time, u.uSunCol.value)
    u.uStorm.value = c.storm

    // sun arcs across the sky through the day
    const el = Math.sin(Math.PI * (0.12 + 0.76 * c.time)) * 0.95 + 0.08
    const az = -0.9 + c.time * 1.7
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize()
    u.uSunDir.value.copy(this.sunDir)

    this.sun.color.copy(u.uSunCol.value)
    this.sun.intensity = 2.6 * c.sun * (1 - c.storm * 0.7) * THREE.MathUtils.smoothstep(this.sunDir.y, -0.05, 0.25)
    this.sun.position.copy(c.focus).addScaledVector(this.sunDir, 60)
    this.sun.target.position.copy(c.focus)
    this.sun.target.updateMatrixWorld()
    if (Math.abs(c.shadowSize - this.shadowSize) > 0.05) {
      this.shadowSize = c.shadowSize
      const cam = this.sun.shadow.camera
      cam.left = -c.shadowSize
      cam.right = c.shadowSize
      cam.top = c.shadowSize
      cam.bottom = -c.shadowSize
      cam.updateProjectionMatrix()
    }
    this.hemi.color.copy(u.uZenith.value).lerp(new THREE.Color('#ffffff'), 0.55)
    this.hemi.groundColor.set('#c9b79c').lerp(new THREE.Color('#6d6a66'), c.storm)
    this.hemi.intensity = 1.15 * (1 - c.storm * 0.3)

    this.object.position.copy(camera.position)
  }
}
