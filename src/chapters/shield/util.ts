/**
 * Yield between heavy build steps so the loader keeps painting. rAF never
 * fires in a hidden tab, so a timeout backs it up.
 */
export const nextFrame = () =>
  new Promise<void>(resolve => {
    let done = false
    const r = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    if (typeof document !== 'undefined' && document.hidden) {
      setTimeout(r, 0)
      return
    }
    requestAnimationFrame(r)
    setTimeout(r, 120)
  })

export const fract = (x: number) => x - Math.floor(x)

/** cheap deterministic 0..1 hash of a number */
export const hash1 = (n: number) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453)

/**
 * Springy pop, derived purely from progress u (0..1): 0 → overshoots to
 * ~1.15 → settles at 1 by u = 1. Toy "boing" for things that appear.
 */
export function pop(u: number) {
  if (u <= 0) return 0
  if (u >= 1) return 1
  return 1 - Math.exp(-6 * u) * Math.cos(10 * u)
}
