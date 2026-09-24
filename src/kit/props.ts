/*
 * The Hark Town toy kit — soft "clay miniature" pieces. Import everything
 * from here. Unless noted, each maker returns a Group sitting on y = 0 with
 * its footprint centred on the origin, facing +z (vehicles face +x), sized
 * for a town where a house is ~1.2 units and a person ~0.5.
 *
 * HOW IT'S BUILT (why it's cheap)
 *   Kit meshes are vertex-coloured and share ONE material, clayVC(). So:
 *   - any number of static props can be merged into one draw call:
 *       const town = new THREE.Group(); ...add houses, trees, fences...
 *       island.add(mergeStatic(town))          // 1–3 draw calls total
 *   - many copies of one piece instance into one draw call:
 *       scatter(treeGeometry(4), clayVC(), points, { castShadow: true })
 *   - windows, lamp bulbs and headlights carry a `glow` attribute and light
 *     up warm at dusk automatically (the World drives KIT.uGlow from the
 *     time of day / storm). Hark LEDs use MAT.led (always on, blooms).
 *   - flags, water, waterfalls and birds animate in shaders from KIT.uTime;
 *     windmill sails use spin(). No per-frame work in chapters.
 *   Shadows: houses, trees, towers, windmills, cars, trams, boats, balloons
 *   cast; islands, people, bushes, rocks, flowers, tufts, fences, benches,
 *   lamps, signs, flags, clouds and birds don't (people get a blob).
 *
 * ISLANDS
 *   makeIsland({ radius, thickness, depth, seed, wobble, top, beach,
 *                aspect, square, lip, strata, rock, hanging, drips, roots,
 *                detail, castShadow })
 *       grass top at y = 0 (colour-varied, rolled overhanging lip, mossy
 *       drips), 2–3 soil strata, soft terraced rock underside with dangling
 *       rocks (roots optional). One draw call; ~2–3 ms at 4x CPU throttle
 *       (detail 0.6 on mobile halves it). userData: radius, radiusAt(a),
 *       edge(a), contains(x, z, margin), randomPoint(rand, margin).
 *   islandPoints(island, n, { seed, margin, spacing, avoid, minR })
 *       spaced random points on an island top (for scatter()).
 *
 * NATURE
 *   makeTree(seed, scale, kind?)  round / cluster / pine / poplar / blossom,
 *                                 two-tone canopies. treeGeometry(seed, kind?)
 *   makeBush(seed, scale) · bushGeometry(seed)
 *   makeRock(seed, scale) · rockGeometry(seed)
 *   flowerGeometry()  white head: use scatter(..., { colors: [...] })
 *   tuftGeometry()    grass tuft
 *   makeCloud(seed, scale) · cloudGeometry(seed) · cloudMaterial()
 *   makePond({ radius, aspect, seed, rim, lilies })  shimmering pond + rim
 *   makeWater({ radius, aspect, seed })              bare water surface
 *   waterMaterial()   shared shimmering water (vertex colours, world space)
 *   makeWaterfall({ height, width })  pours toward local +z and dissolves:
 *       wf.position.copy(island.userData.edge(a)); wf.rotation.y = Math.PI / 2 - a
 *   makeBirds({ count, radius, height, seed, color, size })  GPU-animated
 *       gulls circling the mesh's origin (one draw call)
 *
 * BUILDINGS
 *   makeHouse({ w, d, h, wall, roof, style: gable|hip|flat|shed, seed,
 *               chimney, awning, shop, accent, flowers, shutters })
 *   makeShop(opts)   flat roof, display window, fascia, striped awning
 *   makeTower({ h, r, color, band, top: cap|dome|none })
 *   makeWindmill({ color, roof, sail, speed, h })  sails spin by themselves
 *
 * STREET
 *   makeRoad(points, { width, color, line, kerb, closed, y })  tarmac ribbon
 *       with kerbs + dashes; points = [x, z] pairs or Vector3s (smoothed).
 *       userData.curve (CatmullRomCurve3) + userData.length for traffic.
 *   makePath(points, { width, color, closed, seed, stones })  footpath
 *   makeRails(points, { gauge, closed, bed })  tram tracks (+ curve)
 *   makeFence(points, { color, height, spacing, closed })  picket fence
 *   makeBench(color) · makeLamp() · makeStreetLamp({ hark, color })
 *   makeSign(text, { w, h, color, ink, hark, font, post, arrow, sub })
 *       signpost with real canvas text (redrawn when fonts load)
 *   makeFlag({ color, w, h, pole, mark })  flutters by itself; mark = Hark mark
 *   makeBlob(w, d, opacity) · blobMaterial(opacity)  soft contact shadow
 *
 * VEHICLES & PEOPLE
 *   makeCar(color, { seed, kind: hatch|van|taxi }) · carColor(seed)
 *   makeTram(color, { length, stripe })
 *   makeBoat({ color, sail })          rowing boat, or sailboat with `sail`
 *   makeBalloon({ color, stripe, seed, hark })
 *   makePerson(color, seed) · personGeometry(seed, shirt?)
 *   makeCrowd(count, { seed, variants }) → { group, set(i, x, y, z, heading,
 *       bob, scale), hide(i), commit() }  instanced walkers + blobs
 *
 * PERFORMANCE
 *   scatter(geometry, material, points, { seed, scale, rotate, colors,
 *           castShadow, receiveShadow })  → InstancedMesh
 *   mergeStatic(root, { keep })  → merged Group (one mesh per material)
 *
 * Also: palette.ts (C, WALLS, ROOFS, SHIRTS, CARS, clay, clayVC, MAT,
 * shadowed), anim.ts (KIT uniforms, spin), geo.ts (Builder for your own
 * vertex-coloured pieces: b.box / b.rbox / b.cyl / b.sphere / b.cone /
 * b.add(geo, colour|paint, xf, glow) / b.addPainted(kitGeo, xf) → b.build();
 * paint helpers vgrad, twoTone; noise vnoise2 / fbm2). A house builds in
 * ~0.4 ms (~1.5 ms at 4x throttle).
 *
 * WORLD (src/world/World.ts) — set every frame you care:
 *   world.params.time (0 dawn · .28 morning · .5 noon · .76 golden · .9 sunset
 *   · 1 dusk), storm, focus (island centre: shadows + far field follow it),
 *   shadowSize (tight!), sun, sunAzimuth (rad), sunFollow (0..1: lock the
 *   sun to the camera's orbit), clouds (0..1 far clouds/islands), sea (0..1
 *   cloud sea), glow (-1 auto, else 0..1 evening lights).
 *   world.tone.{zenith, horizon, sun, haze} and world.sunDir are readable.
 */
export { makeIsland, islandPoints } from './island'
export type { IslandOptions, IslandData } from './island'
export {
  makeTree,
  treeGeometry,
  makeBush,
  bushGeometry,
  makeRock,
  rockGeometry,
  flowerGeometry,
  tuftGeometry,
  makeCloud,
  cloudGeometry,
  cloudMaterial,
  makePond,
  makeWater,
  waterMaterial,
  makeWaterfall,
  makeBirds,
} from './nature'
export type { TreeKind } from './nature'
export { makeHouse, makeShop, makeTower, makeWindmill } from './buildings'
export type { HouseOptions } from './buildings'
export { makeRoad, makePath, makeRails, makeFence, makeBench, makeLamp, makeStreetLamp, makeSign, makeFlag, makeBlob, blobMaterial } from './street'
export type { PathPoint, RoadOptions, SignOptions } from './street'
export { makeCar, carColor, makeTram, makeBoat, makeBalloon } from './vehicles'
export { makePerson, personGeometry, makeCrowd } from './people'
export type { Crowd } from './people'
export { scatter, mergeStatic } from './util'
export type { ScatterPoint, ScatterOptions } from './util'
export { spin, KIT } from './anim'
export { Builder } from './geo'
