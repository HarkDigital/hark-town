/*
 * Main Street, in "street space": the street runs along +x, shop fronts face
 * +z (toward the camera side), the tram line runs down the middle at z = 0.
 * STREET_YAW turns the whole chapter in the world (0: the camera sits on the
 * world's +z side, as the shared sky is art-directed for); SUN_AZIMUTH
 * swings the late-morning sun round so it rakes across the shop fronts from
 * the camera's right shoulder (fronts lit, the sides we see in soft shade).
 */

/** Rotation of the street in the world (radians about +y). */
export const STREET_YAW = 0
/** Extra sun azimuth (world.params.sunAzimuth) for Main Street. */
export const SUN_AZIMUTH = 1.45

/** Camera heading in street space (radians; negative = camera to the west). */
export const VIEW_YAW = -0.34
/** Billboards turn to face the camera heading and lean back a touch. */
export const BOARD_YAW = VIEW_YAW * 0.9
export const BOARD_TILT = -0.16

export const TERMINUS_X = -7.2
export const BUFFER_X = -10.4
/** The six featured shops (x of each footprint centre). */
export const SHOP_X = [0, 7.5, 15, 22.5, 30, 37.5]
/** Where the tram halts for each shop (tram centre). */
export const STOP_X = SHOP_X.map(x => x - 0.25)
/** Tram-stop pole beside each halt. */
export const POLE_DX = 1.95

/** Shop footprint: fronts on the far sidewalk. */
export const SHOP_W = 3.2
export const SHOP_D = 2.6
export const FRONT_Z = -2.4
export const SHOP_Z = FRONT_Z - SHOP_D / 2

/** The market row of nine stalls. */
export const STALL_X = Array.from({ length: 9 }, (_, j) => 45.2 + j * 2.05)
export const STALL_Z = -3.05
export const ARCH_X = 43.2

/** Street cross-section (z ranges). */
export const ROAD = { z0: -1.25, z1: 1.25 }
export const WALK_FAR = { z0: -2.4, z1: -1.25 }
export const WALK_NEAR = { z0: 1.25, z1: 2.3 }
export const CANAL = { z0: 3.05, z1: 3.95 }
/** where the canal spills off the island's west end */
export const FALL_X = -11.5
export const RAIL_Y = 0.075
export const WIRE_Y = 1.72

/** Island extent. */
export const ISLAND = { x0: -12.8, x1: 67.2, z0: -9.2, z1: 5.3 }
export const STREET_X0 = -10.8
export const STREET_X1 = 67.4
/** The sky bridge the tram leaves on. */
export const BRIDGE_END = 104

/** The tram rolls ahead of the camera through the market. */
export const MARKET_LEAD = 3.4
