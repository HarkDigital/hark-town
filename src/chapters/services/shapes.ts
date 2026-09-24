import * as THREE from 'three'

/* Small geometry helpers for the workshop dioramas (all raw, unpainted). */

/** Right-triangle prism: base w along x at y = 0, vertical side (height h) at +x, length d along z (centered). */
export function wedgeGeo(w: number, h: number, d: number, rightHigh = true) {
  const s = new THREE.Shape()
  if (rightHigh) {
    s.moveTo(-w / 2, 0)
    s.lineTo(w / 2, h)
    s.lineTo(w / 2, 0)
  } else {
    s.moveTo(-w / 2, 0)
    s.lineTo(-w / 2, h)
    s.lineTo(w / 2, 0)
  }
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false })
  g.translate(0, 0, -d / 2)
  return g
}

/** Top half of a cylinder lying along z (a quonset hut / mailbox lid), base at y = 0. */
export function halfCylGeo(r: number, len: number, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false, -Math.PI / 2, Math.PI)
  g.rotateX(-Math.PI / 2)
  return g
}

/** A flat strip along a polyline of [x, z] points at height y. */
export function stripGeo(pts: [number, number][], width: number, y = 0.02, closed = false) {
  const n = pts.length
  const pos: number[] = []
  const idx: number[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    let tx = b[0] - a[0], tz = b[1] - a[1]
    const l = Math.hypot(tx, tz) || 1
    tx /= l
    tz /= l
    const nx = -tz, nz = tx
    pos.push(p[0] + nx * width * 0.5, y, p[1] + nz * width * 0.5)
    pos.push(p[0] - nx * width * 0.5, y, p[1] - nz * width * 0.5)
  }
  const segs = closed ? n : n - 1
  for (let i = 0; i < segs; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  // strips are flat: force up normals (winding-independent)
  const nor = g.attributes.normal as THREE.BufferAttribute
  for (let i = 0; i < nor.count; i++) nor.setXYZ(i, 0, 1, 0)
  return g
}

/** A flat pennant triangle in the x/y plane pointing +x (thin extrude). */
export function pennantGeo(len: number, h: number, thick = 0.012) {
  const s = new THREE.Shape()
  s.moveTo(0, -h / 2)
  s.lineTo(len, 0)
  s.lineTo(0, h / 2)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false })
  g.translate(0, 0, -thick / 2)
  return g
}

/** Downward bunting flag (triangle pointing -y) in the x/y plane. */
export function flagDownGeo(w: number, h: number, thick = 0.01) {
  const s = new THREE.Shape()
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(0, -h)
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false })
  g.translate(0, 0, -thick / 2)
  return g
}

/** Stadium (race track) center-line sampler: straights along x (half length ls), turn radius rt, offset o outward. */
export function stadium(ls: number, rt: number, s: number, o: number, out: { x: number; z: number; yaw: number }) {
  const straight = 2 * ls
  const turn = Math.PI * rt
  const P = 2 * straight + 2 * turn
  let d = (((s % 1) + 1) % 1) * P
  const r = rt + o
  if (d < straight) {
    out.x = -ls + d
    out.z = r
    out.yaw = 0
    return out
  }
  d -= straight
  if (d < turn) {
    const th = Math.PI / 2 - d / rt
    out.x = ls + r * Math.cos(th)
    out.z = r * Math.sin(th)
    // traveling clockwise seen from above: tangent = (sin th, -cos th)... d(th) < 0
    const tx = Math.sin(th), tz = -Math.cos(th)
    out.yaw = Math.atan2(-tz, tx)
    return out
  }
  d -= turn
  if (d < straight) {
    out.x = ls - d
    out.z = -r
    out.yaw = Math.PI
    return out
  }
  d -= straight
  const th = -Math.PI / 2 - d / rt
  out.x = -ls + r * Math.cos(th)
  out.z = r * Math.sin(th)
  const tx = Math.sin(th), tz = -Math.cos(th)
  out.yaw = Math.atan2(-tz, tx)
  return out
}
