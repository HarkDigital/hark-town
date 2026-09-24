import * as THREE from 'three'

/*
 * "Listen" rings: soft green sonar pulses that roll out across the ground
 * from the HQ mark. A single transparent disc just above the grass:
 *
 *  - ambient pulses (time): a sharp leading edge with a soft trail, one
 *    every ~1.8 s, fading with distance
 *  - the build front (scroll): a bright ring at uFront — the town pops up
 *    as it passes
 *  - a burst (intro): one strong ring when the mark lands
 */

const vert = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vXZ = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const frag = /* glsl */ `
  uniform float uTime, uSpeed, uGap, uAmt, uFront, uFrontAmt, uBurst, uBurstAmt, uOuter, uInner;
  uniform vec3 uColor;
  varying vec2 vXZ;
  void main() {
    float r = length(vXZ);
    float edge = 1.0 - smoothstep(uOuter * 0.8, uOuter, r);
    float inner = smoothstep(uInner, uInner + 0.45, r);

    // ambient pulses: q = 0 right at the expanding edge, growing behind it
    float q = 1.0 - fract((r - uTime * uSpeed) / uGap);
    float amb = smoothstep(0.0, 0.012, q) * exp(-q * 26.0);
    amb *= 1.0 - smoothstep(0.0, uOuter, r) * 0.75;

    // the build front
    float d = r - uFront;
    float front = exp(-d * d * 60.0) + 0.1 * exp(min(d, 0.0) * 2.0) * step(d, 0.0) * smoothstep(-2.0, 0.0, d);

    // intro burst
    float b = r - uBurst;
    float burst = exp(-b * b * 40.0);

    float a = (amb * uAmt + front * uFrontAmt + burst * uBurstAmt) * edge * inner;
    a = clamp(a, 0.0, 1.0);
    if (a < 0.002) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

export class ListenRings {
  mesh: THREE.Mesh
  u = {
    uTime: { value: 0 },
    uSpeed: { value: 1.3 },
    uGap: { value: 2.4 },
    uAmt: { value: 0.3 },
    uFront: { value: 0 },
    uFrontAmt: { value: 0 },
    uBurst: { value: 0 },
    uBurstAmt: { value: 0 },
    uOuter: { value: 7 },
    uInner: { value: 1.05 },
    // HDR mint-green so the rings catch a little bloom
    uColor: { value: new THREE.Color('#7dffc0') },
  }

  constructor(outer: number) {
    this.u.uOuter.value = outer
    const geo = new THREE.CircleGeometry(outer, 96)
    geo.rotateX(-Math.PI / 2)
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.u,
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    )
    this.mesh.renderOrder = 2
    this.mesh.frustumCulled = false
  }

  /** 0..1 brightness of the diamond pulse (peaks as each ring leaves it) */
  pulse(time: number) {
    const q = 1 - (((-time * this.u.uSpeed.value) / this.u.uGap.value) % 1 + 1) % 1
    return Math.exp(-q * 6)
  }
}
