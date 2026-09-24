/**
 * The Storm — one scroll of weather over a cosy little town.
 *
 *   0.00–0.07  in-beat: the camera drops out of the cloud wipe; the storm is
 *              already rolling in and the townsfolk run for their doors
 *   0.07–0.35  HACK STORM: red 'hack' lightning crackles into the town, cracks
 *              glow where it lands, windows flicker red, 'Intrusion detected'
 *   0.28–0.36  the Hark beacon charges (LEDs ramp, the emblem spins up)
 *   0.35–0.43  a green hex SHIELD DOME blows up out of the beacon like a bubble
 *   0.40–0.52  the cracks heal green and vanish; windows go warm and cosy
 *   0.44–0.68  bolts splash harmlessly off the dome with hex ripples
 *   0.67–0.79  the storm clears; the dome sinks back into the beacon, which
 *              keeps pinging a soft green 24/7 watch ring across the town
 *   0.72–0.85  a toy rainbow sweeps over the island, puddles glint
 *   0.74–0.86  people pop back out of their doors and stroll the plaza
 *   0.93–1.00  out-beat: the camera cranes up into the sky
 *
 * Every state is derived from `local`; frame.time only drives idle life
 * (rain, crackle, walkers, the car, flags, ripples).
 */
export const T = {
  stormIn: [0.0, 0.2],
  rainIn: [0.02, 0.13],
  bolts: [
    [0.07, 0.17],
    [0.12, 0.23],
    [0.18, 0.29],
    [0.235, 0.35],
  ],
  hackTitle: 0.1,
  alert: [0.085, 0.345],
  charge: [0.28, 0.36],
  inflate: [0.35, 0.43],
  heal: [0.4, 0.52],
  breathe: 0.365,
  body: [0.39, 0.705],
  shieldTag: [0.43, 0.67],
  domeBolts: [
    [0.44, 0.54],
    [0.5, 0.61],
    [0.56, 0.68],
  ],
  rainOut: [0.66, 0.73],
  /** the dome sinks back into the beacon; watch pings take over */
  deflate: [0.7, 0.775],
  clear: [0.67, 0.79],
  rainbow: [0.72, 0.85],
  peopleOut: 0.74,
  /** the sky is bright enough for ink text again */
  lightsUp: 0.712,
  watch: 0.735,
  out: [0.93, 1],
  /** where the CTA is settled (chapter.anchors) */
  cta: 0.83,
} as const
