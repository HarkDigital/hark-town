import * as THREE from 'three'
import type { Chapter } from '../../core/types'
import { el, rise, setRise } from '../../core/dom'
import { makeIsland, makeHouse, makeTree } from '../../kit/props'

// PLACEHOLDER — replaced by the services chapter build.
export default function create(): Chapter {
  const group = new THREE.Group()
  const island = makeIsland({ radius: 5, seed: 8 })
  group.add(island)
  for (let i = 0; i < 6; i++) {
    const h = makeHouse({ seed: i + 1, h: 0.8 + (i % 3) * 0.4 })
    h.position.set(Math.cos(i) * 2.6, 0, Math.sin(i) * 2.6)
    h.rotation.y = -i
    group.add(h)
    const t = makeTree(i + 7)
    t.position.set(Math.cos(i + 0.5) * 3.8, 0, Math.sin(i + 0.5) * 3.8)
    group.add(t)
  }
  let title: HTMLElement
  return {
    id: 'services',
    group,
    init(ctx) {
      el('p', 'hud-eyebrow', 'The Works', ctx.stage).style.cssText = 'position:absolute;left:var(--gutter);top:var(--safe-top)'
      title = rise(el('h2', 'hud-h2', undefined, ctx.stage), 'Eleven ways to be <em>heard.</em>')
      title.style.cssText = 'position:absolute;left:var(--gutter);top:calc(var(--safe-top) + 34px);max-width:60vw'
    },
    update(local, frame, ctx) {
      ctx.world.params.time = 0.5
      ctx.world.params.shadowSize = 9
      group.rotation.y = local * 1.2 + frame.time * 0.03
      setRise(title, local > 0.05 && local < 0.95)
    },
    camera(_local, _frame, out) {
      out.position.set(0, 28, 44)
      out.target.set(0, -0.5, 0)
      out.fov = 14
      out.parallax = 0.6
    },
  }
}
