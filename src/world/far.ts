import * as THREE from 'three'
import { rng } from '../core/math'
import { clayVC, C } from '../kit/palette'
import { cloudGeometry, cloudMaterial, treeGeometry } from '../kit/nature'
import { makeIsland } from '../kit/island'
import { Builder } from '../kit/geo'

/*
 * Depth dressing that follows the camera: a field of big soft clouds drifting
 * below (and a few far above) the islands, and a handful of tiny distant
 * floating islands. Positions wrap around the camera (toroidal field) so the
 * field never runs out and parallaxes correctly, and they are pushed clear of
 * the chapter's island (world.params.focus). Everything fades into the haze
 * with distance. ~5 draw calls, no shadows.
 */

export const HAZE = {
  uHaze: { value: new THREE.Color('#dcecf6') },
  uHazeNear: { value: 50 },
  uHazeFar: { value: 360 },
}

/** Clone a kit material and fade it into the haze with view distance. */
function hazed(base: THREE.MeshStandardMaterial, key: string, lift = 0) {
  const m = base.clone()
  const inner = base.onBeforeCompile
  if (lift) {
    m.emissive = new THREE.Color('#ffffff')
    m.emissiveIntensity = lift
  }
  m.onBeforeCompile = (shader, r) => {
    inner.call(m, shader, r)
    shader.uniforms.uHaze = HAZE.uHaze
    shader.uniforms.uHazeNear = HAZE.uHazeNear
    shader.uniforms.uHazeFar = HAZE.uHazeFar
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nuniform float uHazeNear, uHazeFar;')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, smoothstep(uHazeNear, uHazeFar, length(vViewPosition)) * 0.92);`,
      )
  }
  m.customProgramCacheKey = () => key
  return m
}

interface Item {
  /** ring angle (rad) at time 0 */
  a0: number
  /** angular drift (rad/s) */
  w: number
  r: number
  y: number
  scale: number
  ry: number
}

export class FarField {
  object = new THREE.Group()
  private clouds: { mesh: THREE.InstancedMesh; items: Item[] }[] = []
  private islands: { mesh: THREE.Mesh; item: Item }[] = []
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private s = new THREE.Vector3()
  private e = new THREE.Euler()

  /*
   * Everything sits on slowly drifting rings around the (damped) focus, below
   * the chapter's island, so whichever way a telephoto chapter camera looks
   * there is depth behind the subject — and nothing ever crosses the island.
   */
  constructor(mobile: boolean) {
    const rand = rng(77)
    const cloudMat = hazed(cloudMaterial(), 'far-cloud')
    const perShape = mobile ? 4 : 5
    for (let v = 0; v < 3; v++) {
      const items: Item[] = []
      for (let i = 0; i < perShape; i++) {
        const k = v * perShape + i
        const high = i === perShape - 1
        items.push({
          a0: (k / (perShape * 3)) * Math.PI * 2 + rand() * 0.3,
          w: (0.004 + rand() * 0.004) * (rand() < 0.5 ? 1 : -1),
          r: high ? 150 + rand() * 80 : 46 + rand() * 70,
          y: high ? 16 + rand() * 24 : -26 - rand() * 34,
          scale: high ? 7 + rand() * 5 : 3.6 + rand() * 3.6,
          ry: rand() * Math.PI,
        })
      }
      const mesh = new THREE.InstancedMesh(cloudGeometry(v + 1), cloudMat, items.length)
      mesh.frustumCulled = false
      mesh.castShadow = false
      mesh.receiveShadow = false
      this.object.add(mesh)
      this.clouds.push({ mesh, items })
    }
    // distant islands: tiny merged dioramas
    const islandMat = hazed(clayVC(), 'far-island')
    const count = mobile ? 5 : 7
    for (let i = 0; i < count; i++) {
      const R = 2 + rand() * 2.4
      const isl = makeIsland({ radius: R, seed: 40 + i, detail: 0.45, hanging: 2, depth: R * 1.1, drips: false })
      const b = new Builder()
      b.addPainted((isl.children[0] as THREE.Mesh).geometry)
      const trees = 3 + Math.floor(rand() * 4)
      for (let k = 0; k < trees; k++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * R * 0.7
        b.addPainted(treeGeometry(k + i * 5), { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.9 + rand() * 0.5, ry: rand() * 6 })
      }
      if (rand() < 0.75) {
        const hx = (rand() - 0.5) * R * 0.6, hz = (rand() - 0.5) * R * 0.6
        b.rbox(0.9, 0.7, 0.8, 0.05, [C.white, C.butter, C.blush][i % 3], { x: hx, y: 0.37, z: hz }, 1)
        b.add(new THREE.ConeGeometry(0.72, 0.5, 4).rotateY(Math.PI / 4), [C.roofRed, C.roofBlue, C.roofTeal][i % 3], { x: hx, y: 0.97, z: hz, sx: 0.95, sz: 0.85 })
      }
      const mesh = new THREE.Mesh(b.build(), islandMat)
      ;(isl.children[0] as THREE.Mesh).geometry.dispose()
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      this.object.add(mesh)
      this.islands.push({
        mesh,
        item: {
          a0: ((i + 0.3 + rand() * 0.4) / count) * Math.PI * 2,
          w: 0.002 + rand() * 0.002,
          r: 52 + rand() * 34,
          y: -17 - rand() * 18,
          scale: 1,
          ry: rand() * Math.PI * 2,
        },
      })
    }
  }

  private place(it: Item, time: number, focus: THREE.Vector3, out: THREE.Vector3) {
    const a = it.a0 + time * it.w
    return out.set(focus.x + Math.cos(a) * it.r, focus.y + it.y, focus.z + Math.sin(a) * it.r)
  }

  update(time: number, _cam: THREE.Vector3, focus: THREE.Vector3, amount: number) {
    for (const c of this.clouds) {
      for (let i = 0; i < c.items.length; i++) {
        const it = c.items[i]
        this.place(it, time, focus, this.p)
        const sc = it.scale * amount
        this.s.set(sc, sc * 0.8, sc)
        this.q.setFromEuler(this.e.set(0, it.ry + time * it.w, 0))
        c.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s))
      }
      c.mesh.instanceMatrix.needsUpdate = true
      c.mesh.visible = amount > 0.01
    }
    for (const { mesh, item } of this.islands) {
      this.place(item, time, focus, mesh.position)
      mesh.scale.setScalar(Math.max(0.001, amount))
      mesh.rotation.y = item.ry + time * 0.01
      mesh.visible = amount > 0.01
    }
  }
}
