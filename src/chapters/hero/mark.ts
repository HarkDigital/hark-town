import * as THREE from 'three'
import { logoParts } from '../../logo/logo'
import { C, MAT, clayVC } from '../../kit/palette'
import { Builder } from '../../kit/geo'

/*
 * The HQ landmark: the Hark mark as a big glossy signal-green clay sculpture
 * standing on a round stone plinth ringed with little green LEDs. The centre
 * diamond is a softly glowing lamp — the "listen" rings pulse out from it.
 *
 *   sculpture.root       sits on the plaza (y = 0)
 *   sculpture.pivot      scale (pop spring) + yaw (faces the camera)
 *   sculpture.diamondMat emissive; pulse it
 */

export const MARK_H = 3.4
export const PLINTH_TOP = 0.62

/** A tiny sky-gradient environment so the glossy clay has something to reflect. */
function skyEnv(renderer: THREE.WebGLRenderer) {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 32
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 32)
  grad.addColorStop(0, '#9ccbf2')
  grad.addColorStop(0.42, '#e8f3fb')
  grad.addColorStop(0.5, '#fff6e6')
  grad.addColorStop(0.56, '#cfe6c0')
  grad.addColorStop(1, '#7fb86a')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 32)
  // a soft sun blob
  const sun = g.createRadialGradient(40, 9, 0, 40, 9, 8)
  sun.addColorStop(0, 'rgba(255,255,255,1)')
  sun.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = sun
  g.fillRect(28, 0, 24, 20)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.mapping = THREE.EquirectangularReflectionMapping
  const pm = new THREE.PMREMGenerator(renderer)
  const env = pm.fromEquirectangular(tex).texture
  pm.dispose()
  tex.dispose()
  return env
}

export class Sculpture {
  root = new THREE.Group()
  pivot = new THREE.Group()
  mark!: THREE.Mesh
  diamond!: THREE.Mesh
  leds!: THREE.Mesh
  diamondMat!: THREE.MeshStandardMaterial
  markMat!: THREE.MeshStandardMaterial
  sideMat!: THREE.MeshStandardMaterial
  /** diamond centre in root space (for the rings + callout) */
  diamondY = 0
  topY = 0

  /** Build in two slices (geometry, then the environment + materials). */
  static async create(renderer: THREE.WebGLRenderer, yieldFrame: () => Promise<void>) {
    const s = new Sculpture(renderer, yieldFrame)
    await s.ready
    return s
  }
  private ready: Promise<void>

  private constructor(renderer: THREE.WebGLRenderer, yieldFrame: () => Promise<void>) {
    this.ready = this.build(renderer, yieldFrame)
  }

  private async build(renderer: THREE.WebGLRenderer, yieldFrame: () => Promise<void>) {
    // --- plinth: stone drum, cream step, stone cap; a ring of LED studs
    const b = new Builder()
    b.cyl(1.02, 1.1, 0.18, 40, C.stone, { y: 0.09 })
    b.cyl(0.86, 0.9, 0.34, 40, C.cream, { y: 0.35 })
    b.cyl(0.9, 0.9, 0.05, 40, C.kerb, { y: 0.2 })
    b.cyl(0.74, 0.82, 0.1, 40, C.stone, { y: PLINTH_TOP - 0.05 })
    const plinth = new THREE.Mesh(b.build(), clayVC())
    plinth.castShadow = plinth.receiveShadow = true
    this.root.add(plinth)

    const studs: THREE.BufferGeometry[] = []
    const stud = new THREE.SphereGeometry(0.045, 8, 6)
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2
      const s = stud.clone()
      s.translate(Math.cos(a) * 0.885, 0.39, Math.sin(a) * 0.885)
      studs.push(s)
    }
    const b2 = new Builder()
    for (const s of studs) b2.add(s, C.signal)
    this.leds = new THREE.Mesh(b2.build(), MAT.led)
    this.root.add(this.leds)

    // --- the mark
    const parts = logoParts()
    // the SVG contours carry thousands of points; ~260 evenly spaced ones are
    // plenty at this size (and keep the extrusion to a few thousand verts)
    const simplify = (shapes: THREE.Shape[]) =>
      shapes.map(sh => {
        const out = new THREE.Shape(sh.getSpacedPoints(260))
        for (const h of sh.holes) out.holes.push(new THREE.Path(h.getSpacedPoints(120)))
        return out
      })
    // a chunky cut-out: about as deep as the stroke is wide, softly bevelled
    const extrude = (shapes: THREE.Shape[], depth: number, bevel: number) => {
      const g = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel * 1.8, bevelSegments: 2, curveSegments: 1, steps: 1 })
      g.translate(0, 0, -depth / 2)
      g.computeVertexNormals()
      return g
    }
    const loops = extrude(simplify([...parts.loopA, ...parts.loopB]), 0.1, 0.012)
    const dia = extrude(parts.diamond, 0.15, 0.01)
    // stand the mark on its lowest point, centred over the plinth
    const pos = loops.attributes.position
    let minY = Infinity
    for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i))
    let sx = 0, n = 0
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < minY + 0.012) {
        sx += pos.getX(i)
        n++
      }
    }
    const footX = n ? sx / n : 0
    loops.computeBoundingBox()
    const cx = (loops.boundingBox!.min.x + loops.boundingBox!.max.x) / 2
    // centre the mark over the plinth when its foot still lands on the cap,
    // otherwise stand it on its foot
    const ox = Math.abs(footX - cx) * MARK_H < 0.55 ? cx : footX
    loops.translate(-ox, -minY, 0)
    dia.translate(-ox, -minY, 0)
    const pinX = (footX - ox) * MARK_H
    loops.computeBoundingSphere()
    dia.computeBoundingBox()
    dia.computeBoundingSphere()

    await yieldFrame()
    const env = skyEnv(renderer)
    // a deeper Hark green so the clay reads solid in full sun (and never blooms)
    this.markMat = new THREE.MeshStandardMaterial({
      color: '#0cae62',
      roughness: 0.36,
      metalness: 0,
      envMap: env,
      envMapIntensity: 0.55,
    })
    // painted-block look: green faces, pale wood sides that outline the form
    this.sideMat = new THREE.MeshStandardMaterial({ color: '#f1e2c4', roughness: 0.7, envMap: env, envMapIntensity: 0.35 })
    this.mark = new THREE.Mesh(loops, [this.markMat, this.sideMat])
    this.mark.scale.setScalar(MARK_H)
    this.mark.castShadow = true
    this.mark.receiveShadow = true
    // the lamp: a pale mint glass that glows signal green
    this.diamondMat = new THREE.MeshStandardMaterial({
      color: '#d9ffe9',
      emissive: new THREE.Color(C.signalBright),
      emissiveIntensity: 1,
      roughness: 0.3,
      envMap: env,
      envMapIntensity: 0.4,
    })
    this.diamond = new THREE.Mesh(dia, this.diamondMat)
    this.diamond.scale.setScalar(MARK_H)
    this.diamond.castShadow = true
    // a short steel pin where the loop meets the plinth
    const pin = new THREE.Mesh(new Builder().cyl(0.07, 0.1, 0.16, 12, C.slate, { x: pinX, y: 0.02 }).build(), clayVC())
    this.pivot.add(pin, this.mark, this.diamond)
    this.pivot.position.y = PLINTH_TOP
    this.root.add(this.pivot)

    const bb = dia.boundingBox!
    this.diamondY = PLINTH_TOP + ((bb.min.y + bb.max.y) / 2) * MARK_H
    this.topY = PLINTH_TOP + MARK_H
    this.diamondX = ((bb.min.x + bb.max.x) / 2) * MARK_H
  }

  /** diamond centre offset along the mark's own x (it isn't over the foot) */
  diamondX = 0
}
