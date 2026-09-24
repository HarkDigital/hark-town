import * as THREE from 'three'
import type { Frame } from '../core/types'
import { KIT, tickKit } from '../kit/anim'
import { STORM, makeSkyMaterial, skyColor, skyScalar } from './sky'
import { FarField, HAZE, type NdcRect } from './far'

export type { NdcRect } from './far'

/*
 * The shared sky for Hark Town — a miniature world floating in daylight.
 *
 *  - sky dome (camera-centred): zenith → horizon gradient with a sun glow
 *    above the horizon and, below it, a soft stylised CLOUD SEA far beneath
 *    the islands fading into warm haze — which is what the telephoto,
 *    looking-down chapter cameras mostly see behind their island.
 *  - far field: big soft clouds drifting below the islands and a few tiny
 *    distant floating islands on slow rings around params.focus. The islands
 *    keep off the copy column (left of a landscape screen), off the chapter's
 *    island (~shadowSize around focus) and out of params.keepOut, an extra
 *    screen rect a chapter can publish for its headline / dock.
 *  - sun: one DirectionalLight with soft PCF shadows whose frustum follows
 *    params.focus (keep params.shadowSize tight). Its arc through the day is
 *    art-directed for a camera on the +z side looking toward -z: morning
 *    light from the front-left, noon high, golden hour from the front-right.
 *    Rotate it with params.sunAzimuth, or lock it to the camera with
 *    params.sunFollow.
 *  - hemi: sky/ground fill (cool sky, warm ground bounce).
 *  - drives the kit: KIT.uTime (flags, water, birds, spinners), KIT.uGlow
 *    (windows + lamps glow from golden hour on, and in storms), rim tint.
 *
 * Chapters set `world.params` every frame they care (the engine resets them
 * to defaults first); values are damped so cuts never pop. The story runs
 * from morning (hero) to sunset (contact). `world.tone` exposes the current
 * sky colours (linear) for chapters that want to match them.
 */

export interface WorldParams {
  /** 0 dawn · 0.3 morning · 0.5 noon · 0.75 golden hour · 0.9 sunset · 1 dusk */
  time: number
  /** 0..1 overcast/storm: darker, cooler, flatter light */
  storm: number
  /** world-space point the shadow camera centres on (your island centre) */
  focus: THREE.Vector3
  /** half-size of the shadow frustum (world units) */
  shadowSize: number
  /** multiplier on the sun */
  sun: number
  /** extra sun azimuth in radians (rotates the light around +y) */
  sunAzimuth: number
  /** 0 = sun fixed in world space · 1 = sun azimuth follows the camera's orbit around focus */
  sunFollow: number
  /** 0..1 amount of background cloud field + far islands */
  clouds: number
  /** 0..1 cloud sea below */
  sea: number
  /** override for the evening lights (-1 = automatic from time/storm) */
  glow: number
  /**
   * Extra screen rect the distant far-field islands must stay out of, in NDC
   * (x right, y UP, -1..1; x0 < x1, y0 < y1), e.g. your headline or card.
   * Cleared every frame (resetParams points it at an empty, zero-area rect),
   * so set it each frame you want it: assign your own reused object
   * (`wp.keepOut = rect`) or write into the one provided
   * (`Object.assign(wp.keepOut, rect)`). null or a zero-area rect = none.
   * The copy column is always kept clear without it. See ndcRect().
   */
  keepOut: NdcRect | null
}

export const WORLD_DEFAULTS = { time: 0.35, storm: 0, shadowSize: 14, sun: 1, sunAzimuth: 0, sunFollow: 0, clouds: 1, sea: 1, glow: -1 }

const WHITE = new THREE.Color('#ffffff')
const GROUND = new THREE.Color('#d9c6a6')
const GROUND_STORM = new THREE.Color('#6d6a66')

export class World {
  object = new THREE.Group()
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  /** the rect params.keepOut is reset to each frame (zero area = none) */
  private keepNone: NdcRect = { x0: 0, y0: 0, x1: 0, y1: 0 }
  params: WorldParams = { ...WORLD_DEFAULTS, focus: new THREE.Vector3(), keepOut: this.keepNone }
  /** current sky colours (linear), updated every frame */
  tone = {
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sun: new THREE.Color(),
    haze: new THREE.Color(),
  }
  /** current sun direction (unit, toward the sun) */
  sunDir = new THREE.Vector3(0, 1, 0)
  private cur = { ...WORLD_DEFAULTS, focus: new THREE.Vector3() }
  private dome: THREE.Mesh
  private sky: ReturnType<typeof makeSkyMaterial>
  private far: FarField
  private shadowSize = -1
  private first = true
  private mapSize: number

  constructor(scene: THREE.Scene, mobile: boolean) {
    this.sky = makeSkyMaterial(mobile)
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 40, 20), this.sky.material)
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    this.object.add(this.dome)

    this.far = new FarField(mobile)
    this.object.add(this.far.object)

    this.sun = new THREE.DirectionalLight(0xffffff, 2.6)
    this.sun.castShadow = true
    const size = mobile ? 1024 : 2048
    this.sun.shadow.mapSize.set(size, size)
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.03
    this.sun.shadow.radius = 4
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 220
    this.mapSize = size
    scene.add(this.sun)
    scene.add(this.sun.target)

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0xd9c6a6, 1.15)
    scene.add(this.hemi)
  }

  resetParams() {
    const p = this.params
    p.time = WORLD_DEFAULTS.time
    p.storm = WORLD_DEFAULTS.storm
    p.shadowSize = WORLD_DEFAULTS.shadowSize
    p.sun = WORLD_DEFAULTS.sun
    p.sunAzimuth = WORLD_DEFAULTS.sunAzimuth
    p.sunFollow = WORLD_DEFAULTS.sunFollow
    p.clouds = WORLD_DEFAULTS.clouds
    p.sea = WORLD_DEFAULTS.sea
    p.glow = WORLD_DEFAULTS.glow
    p.focus.set(0, 0, 0)
    const k = this.keepNone
    k.x0 = k.y0 = k.x1 = k.y1 = 0
    p.keepOut = k
  }

  /** current (damped) time of day, 0..1 */
  get time() {
    return this.cur.time
  }

  /** current (damped) storm amount */
  get storm() {
    return this.cur.storm
  }

  update(frame: Frame, camera: THREE.Camera) {
    const c = this.cur
    const p = this.params
    if (this.first) {
      // no fade-in from defaults on the very first frame
      Object.assign(c, {
        time: p.time,
        storm: p.storm,
        shadowSize: p.shadowSize,
        sun: p.sun,
        sunAzimuth: p.sunAzimuth,
        sunFollow: p.sunFollow,
        clouds: p.clouds,
        sea: p.sea,
        glow: p.glow,
        focus: c.focus.copy(p.focus),
      })
      this.first = false
    }
    const k = 1 - Math.exp(-3.5 * frame.dt)
    c.time += (p.time - c.time) * k
    c.storm += (p.storm - c.storm) * k
    c.shadowSize += (p.shadowSize - c.shadowSize) * k
    c.sun += (p.sun - c.sun) * k
    c.sunAzimuth += (p.sunAzimuth - c.sunAzimuth) * k
    c.sunFollow += (p.sunFollow - c.sunFollow) * k
    c.clouds += (p.clouds - c.clouds) * k
    c.sea += (p.sea - c.sea) * k
    c.glow = p.glow < 0 ? -1 : c.glow < 0 ? p.glow : c.glow + (p.glow - c.glow) * k
    c.focus.lerp(p.focus, 1 - Math.exp(-8 * frame.dt))

    tickKit(frame.time, frame.reducedMotion)

    // ---- palette
    const t = c.time, st = c.storm
    const u = this.sky.uniforms
    skyColor('zenith', t, u.uZenith.value).lerp(STORM.zenith, st)
    skyColor('horizon', t, u.uHorizon.value).lerp(STORM.horizon, st)
    skyColor('sun', t, u.uSunCol.value).lerp(STORM.sun, st * 0.7)
    skyColor('seaLit', t, u.uSeaLit.value).lerp(STORM.seaLit, st)
    skyColor('seaShade', t, u.uSeaShade.value).lerp(STORM.seaShade, st)
    skyColor('seaGap', t, u.uSeaGap.value).lerp(STORM.seaGap, st)
    skyColor('haze', t, u.uHaze.value).lerp(STORM.haze, st)
    u.uStorm.value = st
    u.uTime.value = KIT.uTime.value
    u.uCam.value.copy(camera.position)
    u.uSea.value = c.sea
    this.tone.zenith.copy(u.uZenith.value)
    this.tone.horizon.copy(u.uHorizon.value)
    this.tone.sun.copy(u.uSunCol.value)
    this.tone.haze.copy(u.uHaze.value)
    HAZE.uHaze.value.copy(u.uHaze.value)

    // ---- sun: art-directed arc (+ optional azimuth offset / camera follow)
    const el = THREE.MathUtils.degToRad(skyScalar('el', t))
    let az = THREE.MathUtils.degToRad(skyScalar('az', t)) + c.sunAzimuth
    if (c.sunFollow > 0.001) {
      const camAz = Math.atan2(camera.position.x - c.focus.x, camera.position.z - c.focus.z)
      az += camAz * c.sunFollow
    }
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize()
    u.uSunDir.value.copy(this.sunDir)

    const power = skyScalar('power', t)
    // surfaces take a softer version of the sky's sun colour (keeps sunset grass from going olive)
    this.sun.color.copy(u.uSunCol.value).lerp(WHITE, 0.3)
    this.sun.intensity = power * c.sun * (1 - st * 0.72)
    this.sun.position.copy(c.focus).addScaledVector(this.sunDir, 80)
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
      // keep the penumbra ~constant in world units (soft toy shadows)
      const texel = (2 * c.shadowSize) / this.mapSize
      this.sun.shadow.radius = THREE.MathUtils.clamp(0.07 / texel, 2, 9)
    }
    // cool sky fill, warm ground bounce; lavender shadows toward sunset
    this.hemi.color.copy(u.uZenith.value).lerp(u.uHorizon.value, 0.35).lerp(WHITE, 0.45)
    this.hemi.groundColor.copy(GROUND).lerp(u.uHorizon.value, 0.25).lerp(GROUND_STORM, st)
    this.hemi.intensity = (1.05 + (1 - Math.min(1, power / 2.6)) * 0.35) * (1 - st * 0.3)

    // ---- kit tints
    KIT.uRim.value.copy(u.uHorizon.value).lerp(u.uZenith.value, 0.25)
    KIT.uRimStrength.value = 0.14 * (1 - st * 0.5)
    KIT.uWind.value = 1 + st * 1.6
    KIT.uCloudLift.value.copy(u.uHorizon.value).lerp(WHITE, 0.45).multiplyScalar(0.3 * (1 - st * 0.55))
    const autoGlow = Math.min(1, THREE.MathUtils.smoothstep(t, 0.74, 0.93) + st * 0.65)
    KIT.uGlow.value = c.glow < 0 ? autoGlow : c.glow

    // ---- dome + far field
    this.dome.position.copy(camera.position)
    this.far.update(KIT.uTime.value, camera, c.focus, c.clouds, Math.max(3, c.shadowSize), p.keepOut, frame.dt)
  }
}

/**
 * A DOM rect (client px) → NDC rect relative to the canvas rect `host`
 * (y flipped to point up), grown by `pad` px on every side.
 *   world.params.keepOut = ndcRect(head.getBoundingClientRect(), canvas.getBoundingClientRect(), this.keep)
 * Measure on resize / when the copy moves, not every frame.
 */
export function ndcRect(r: { left: number; top: number; right: number; bottom: number }, host: { left: number; top: number; width: number; height: number }, out: NdcRect = { x0: 0, y0: 0, x1: 0, y1: 0 }, pad = 12): NdcRect {
  const w = host.width || 1, h = host.height || 1
  out.x0 = ((r.left - pad - host.left) / w) * 2 - 1
  out.x1 = ((r.right + pad - host.left) / w) * 2 - 1
  out.y0 = 1 - ((r.bottom + pad - host.top) / h) * 2
  out.y1 = 1 - ((r.top - pad - host.top) / h) * 2
  return out
}
