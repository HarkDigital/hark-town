import * as THREE from 'three'

/*
 * Toy "pop" springs for instanced props. Every instance has a base transform
 * (position, yaw, scale) and a spring value that chases a target of 0
 * (tucked into the ground) or 1 (standing). Targets are derived from scroll
 * (or the intro clock), so any jump converges to the right town within a
 * second; the spring only adds the squash-and-stretch on the way.
 *
 * Squash & stretch: while shooting up an instance stretches tall and thin,
 * at the overshoot it swells, and on the rebound it squashes wide and short.
 */

export interface SpringCfg {
  /** stiffness */
  k: number
  /** damping */
  c: number
  /** squash/stretch per unit of spring velocity */
  squash: number
}

export const SPRING = {
  house: { k: 170, c: 10.5, squash: 0.055 },
  tree: { k: 230, c: 9, squash: 0.07 },
  small: { k: 260, c: 12, squash: 0.05 },
  road: { k: 320, c: 17, squash: 0.03 },
  mark: { k: 120, c: 6.8, squash: 0.06 },
} satisfies Record<string, SpringCfg>

const MAX_H = 1 / 120

/** A bank of scalar springs (one per instance). */
export class Springs {
  v: Float32Array
  u: Float32Array
  tgt: Float32Array
  moving = true
  /** set when values jump (snap/kick) so views rewrite even if nothing is moving */
  dirty = true
  constructor(
    public n: number,
    public cfg: SpringCfg,
  ) {
    this.v = new Float32Array(n)
    this.u = new Float32Array(n)
    this.tgt = new Float32Array(n)
  }

  snap() {
    this.v.set(this.tgt)
    this.u.fill(0)
    this.dirty = true
  }

  /** Nudge an instance (pointer poke): a quick squash that springs back. */
  kick(i: number, amount: number) {
    this.u[i] += amount
    this.dirty = true
  }

  /** Integrate. Returns true when anything is still moving. */
  step(dt: number, reduced: boolean) {
    const { v, u, tgt, n } = this
    const k = this.cfg.k
    const c = this.cfg.c
    // reduced motion: critically damped, no overshoot
    const crit = 2 * Math.sqrt(k)
    let moving = false
    const steps = Math.max(1, Math.ceil(dt / MAX_H))
    const h = dt / steps
    for (let i = 0; i < n; i++) {
      let x = v[i], vel = u[i]
      const t = tgt[i]
      if (Math.abs(t - x) < 1e-4 && Math.abs(vel) < 1e-3) {
        v[i] = t
        u[i] = 0
        continue
      }
      moving = true
      // tucking away is always calm (no ghostly re-bounce below ground)
      const damp = reduced || t < x - 0.02 ? crit * 1.05 : c
      for (let s = 0; s < steps; s++) {
        vel += (k * (t - x) - damp * vel) * h
        x += vel * h
      }
      v[i] = x
      u[i] = vel
    }
    this.moving = moving
    return moving
  }
}

/** Grow + squash/stretch factors for spring i: [xz, y]. */
export function squashOf(s: Springs, i: number, out: { g: number; xz: number; y: number }) {
  const g = Math.max(0, s.v[i])
  const st = Math.max(-0.32, Math.min(0.42, s.u[i] * s.cfg.squash))
  out.g = g
  out.y = g * (1 + st)
  out.xz = g * (1 - st * 0.5)
  return out
}

const _sq = { g: 0, xz: 0, y: 0 }

/**
 * InstancedMesh + base transforms + springs. Geometry sits on y = 0 so it
 * grows out of the ground.
 */
export class PopField {
  mesh: THREE.InstancedMesh
  springs: Springs
  x: Float32Array
  y: Float32Array
  z: Float32Array
  ry: Float32Array
  s: Float32Array
  /** extra vertical scale per instance (variety) */
  sy: Float32Array
  private dirty = true

  constructor(geo: THREE.BufferGeometry, mat: THREE.Material, public n: number, cfg: SpringCfg, shadows: { cast?: boolean; receive?: boolean } = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    // instances start at zero scale; a cached bounding sphere would cull them forever
    this.mesh.frustumCulled = false
    this.mesh.castShadow = shadows.cast ?? true
    this.mesh.receiveShadow = shadows.receive ?? true
    this.springs = new Springs(n, cfg)
    this.x = new Float32Array(n)
    this.y = new Float32Array(n)
    this.z = new Float32Array(n)
    this.ry = new Float32Array(n)
    this.s = new Float32Array(n).fill(1)
    this.sy = new Float32Array(n).fill(1)
  }

  set(i: number, x: number, y: number, z: number, ry = 0, s = 1, sy = 1) {
    this.x[i] = x
    this.y[i] = y
    this.z[i] = z
    this.ry[i] = ry
    this.s[i] = s
    this.sy[i] = sy
    this.dirty = true
  }

  color(i: number, c: THREE.Color) {
    this.mesh.setColorAt(i, c)
  }

  /** step springs and rewrite matrices when something moved */
  update(dt: number, reduced: boolean) {
    const moving = this.springs.step(dt, reduced)
    if (!moving && !this.dirty && !this.springs.dirty) return
    this.dirty = false
    this.springs.dirty = false
    const e = this.mesh.instanceMatrix.array as Float32Array
    for (let i = 0; i < this.n; i++) {
      squashOf(this.springs, i, _sq)
      const s = this.s[i]
      const a = s * _sq.xz
      const b = s * _sq.y * this.sy[i]
      const cs = Math.cos(this.ry[i]), sn = Math.sin(this.ry[i])
      const o = i * 16
      e[o] = cs * a
      e[o + 1] = 0
      e[o + 2] = -sn * a
      e[o + 3] = 0
      e[o + 4] = 0
      e[o + 5] = b
      e[o + 6] = 0
      e[o + 7] = 0
      e[o + 8] = sn * a
      e[o + 9] = 0
      e[o + 10] = cs * a
      e[o + 11] = 0
      e[o + 12] = this.x[i]
      e[o + 13] = this.y[i]
      e[o + 14] = this.z[i]
      e[o + 15] = 1
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }
}
