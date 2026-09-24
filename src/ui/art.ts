/*
 * Hand-drawn SVG art for the DOM layer of Hark Town (loader, minimap,
 * rotate card, menu, fallback). Flat toy-diorama shapes in the kit palette:
 * cream walls, clay roofs, round trees, a floating island with a soil
 * underside, and signal green only for Hark things (the flag, the LED lamp,
 * the HQ tower, the current stop).
 *
 * Everything is decorative (aria-hidden) and animated from ui.css.
 */

/** kit palette (src/kit/palette.ts), duplicated as plain strings for the DOM */
export const P = {
  grass: '#93cf74',
  grassSide: '#6fae57',
  meadow: '#7fbf64',
  soil: '#9c7457',
  soilDark: '#7c5a42',
  rock: '#b39a80',
  sand: '#ead7b1',
  water: '#63c1e3',
  wall: '#fbfaf6',
  wallShade: '#e6dac4',
  roof: '#e2694a',
  roofShade: '#c8603a',
  roofBlue: '#4d8fd6',
  roofYellow: '#f2b63d',
  leaf: '#46b36b',
  leafLight: '#6cc585',
  leafDark: '#2f8f55',
  trunk: '#8a5a3c',
  mustard: '#f0b43c',
  clay: '#d9774b',
  sky: '#6fb5e6',
  ink: '#1d2321',
  slate: '#4b5563',
  signal: '#00e27a',
  glass: '#ffd98a',
}

/**
 * The loader's island, built up in stages. Each group carries a data-stage
 * index; the loader flips `.is-on` on them as progress rises and ui.css pops
 * them up with a squash-and-stretch spring.
 *
 *   0 island · 1 path + pond + waterfall · 2 house · 3 tree + bushes
 *   4 lamp + walker · 5 bunting + Hark flag
 */
export function buildIslandSvg(cls = 'ld-isle') {
  return `<svg class="${cls}" viewBox="0 0 240 214" aria-hidden="true" focusable="false">
  <g class="isl-base" data-stage="0">
    <path class="isl-soil" fill="${P.soil}" d="M38 128c4 22 34 32 82 32s79-10 82-32c-3 26-20 40-40 48-10 16-24 28-40 34-15-5-29-17-38-30-24-8-42-28-46-52z"/>
    <path fill="${P.soilDark}" opacity=".55" d="M150 158c22-4 40-12 52-30-3 26-20 40-40 48-10 16-24 28-40 34 12-12 22-30 28-52z"/>
    <ellipse cx="86" cy="170" rx="9" ry="5" fill="${P.rock}"/>
    <ellipse cx="136" cy="186" rx="7" ry="4" fill="${P.rock}"/>
    <ellipse cx="112" cy="196" rx="5" ry="3" fill="${P.rock}" opacity=".9"/>
    <path fill="${P.grassSide}" d="M36 120c0 17 34 28 84 28s84-10 84-29v10c0 19-34 30-84 30s-84-11-84-29z"/>
    <path fill="${P.grass}" d="M36 120c0-16 34-26 84-26s84 9 84 25c0 17-32 27-84 27s-84-10-84-26z"/>
    <path fill="#a6da8a" opacity=".7" d="M52 112c10-9 38-14 68-14 20 0 38 2 52 6-24-1-58 0-84 5-14 3-26 6-36 3z"/>
  </g>
  <g class="isl-part isl-ground" data-stage="1">
    <path d="M52 132c26-10 52 2 74-8s40-12 66-14" fill="none" stroke="${P.sand}" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="62" cy="114" rx="13" ry="4.6" fill="${P.water}"/>
    <ellipse cx="59" cy="113" rx="5" ry="1.4" fill="#bfe6f4"/>
    <path class="isl-fall" d="M191 139v34" stroke="${P.water}" stroke-width="5" stroke-linecap="round"/>
  </g>
  <g class="isl-part isl-house" data-stage="2">
    <path fill="${P.wall}" d="M72 96h26v26H72z"/>
    <path fill="${P.wallShade}" d="M98 96l18-7v26l-18 7z"/>
    <path fill="${P.roof}" d="M68 98l17-24 17 24z"/>
    <path fill="${P.roofShade}" d="M85 74l17 24 18-7-17-24z"/>
    <path fill="${P.roofShade}" d="M106 64h5v11h-5z"/>
    <rect x="80" y="108" width="8" height="14" rx="1.5" fill="${P.trunk}"/>
    <path fill="${P.glass}" d="M104 99l6-2.3v7l-6 2.3z"/>
    <rect x="89.5" y="100" width="5" height="5" rx="1" fill="${P.glass}"/>
  </g>
  <g class="isl-part isl-tree" data-stage="3">
    <rect x="147" y="90" width="6" height="18" rx="2" fill="${P.trunk}"/>
    <circle cx="150" cy="80" r="15" fill="${P.leaf}"/>
    <circle cx="160" cy="88" r="9" fill="${P.leafDark}"/>
    <circle cx="145" cy="74" r="6.5" fill="${P.leafLight}"/>
  </g>
  <g class="isl-part isl-bush" data-stage="3">
    <circle cx="52" cy="126" r="7" fill="${P.leaf}"/>
    <circle cx="60" cy="128" r="5.5" fill="${P.leafDark}"/>
    <circle cx="128" cy="130" r="5.5" fill="${P.leaf}"/>
    <circle cx="170" cy="118" r="4.5" fill="${P.leafDark}"/>
  </g>
  <g class="isl-part isl-lamp" data-stage="4">
    <path d="M131 132v-20" stroke="${P.slate}" stroke-width="2.2" stroke-linecap="round"/>
    <circle class="isl-led" cx="131" cy="110" r="3.4" fill="${P.signal}"/>
  </g>
  <g class="isl-part isl-walker" data-stage="4">
    <g class="isl-walk">
      <rect x="-2.2" y="-9" width="4.4" height="7" rx="2" fill="${P.roofBlue}"/>
      <circle cx="0" cy="-11" r="2.3" fill="#f1c9a5"/>
      <path d="M-1 -2v3M1 -2v3" stroke="${P.ink}" stroke-width="1.2" stroke-linecap="round"/>
    </g>
  </g>
  <g class="isl-part isl-bunting" data-stage="5">
    <path d="M114 88Q150 108 186 82" fill="none" stroke="${P.slate}" stroke-width="1.1"/>
    <path fill="${P.mustard}" d="M122 92.6l5 2.3-3.6 5.4z"/>
    <path fill="${P.signal}" d="M132 96.8l5 1.2-2.8 5.8z"/>
    <path fill="${P.roof}" d="M142 99.2l5.2.2-2.2 6z"/>
    <path fill="${P.sky}" d="M152 99.4l5-.8-1.4 6.1z"/>
    <path fill="${P.mustard}" d="M162 97.4l4.8-1.8-.8 6.2z"/>
    <path fill="${P.signal}" d="M171.6 93.4l4.4-2.6v6.2z"/>
  </g>
  <g class="isl-part isl-flag" data-stage="5">
    <path d="M188 124V62" stroke="${P.slate}" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="188" cy="60" r="2.6" fill="${P.mustard}"/>
    <g class="isl-cloth">
      <path fill="${P.signal}" d="M189.5 64h28l-4 9 4 9h-28z"/>
      <path fill="${P.ink}" d="M199.5 73l3.5-3.5 3.5 3.5-3.5 3.5z"/>
    </g>
  </g>
</svg>`
}

/**
 * A cartoon cloud: flat bottom, lumpy top, with a soft blue-grey underside.
 * viewBox 0 0 120 60.
 */
export function cloudSvg(cls = '') {
  return `<svg class="${cls}" viewBox="0 0 120 60" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
  <path fill="#dfe9ef" d="M18 58c-9 0-15-6-15-13s6-12 13-12c1-10 10-17 20-16 4-9 13-14 23-13 11 1 19 9 21 19 3-2 7-3 11-2 8 1 14 9 13 17 6 1 10 6 10 11 0 6-5 9-10 9z"/>
  <path fill="#fbfaf6" d="M18 52c-8 0-13-5-13-11s5-11 12-11c1-10 10-17 20-16 4-9 13-14 23-13 11 1 19 9 21 19 3-2 7-3 11-2 8 1 14 9 13 17 6 1 9 5 9 9 0 5-4 8-9 8z"/>
</svg>`
}

/** a tiny hot-air balloon in Hark green (the minimap marker). viewBox 0 0 20 28 */
export function balloonSvg(cls = '') {
  return `<svg class="${cls}" viewBox="0 0 20 28" aria-hidden="true" focusable="false">
  <path fill="${P.signal}" d="M10 1C5 1 1.5 4.6 1.5 9.3c0 4.6 4.3 8.4 6.6 10.7h3.8c2.3-2.3 6.6-6.1 6.6-10.7C18.5 4.6 15 1 10 1z"/>
  <path fill="#07a85d" d="M10 1c-2 0-3.6 3.8-3.6 8.3 0 4.4 1.4 8.3 1.7 10.7h3.8c.3-2.4 1.7-6.3 1.7-10.7C13.6 4.8 12 1 10 1z" opacity=".55"/>
  <path fill="#fbfaf6" opacity=".7" d="M5 6.2c.9-1.8 2.4-2.9 3.9-3.3-1.6 1.6-2.4 3.6-2.6 5.6z"/>
  <path d="M8.1 20l.6 3.6M11.9 20l-.6 3.6" stroke="${P.ink}" stroke-width=".9"/>
  <rect x="7.8" y="23.2" width="4.4" height="3.8" rx=".9" fill="${P.trunk}"/>
</svg>`
}

/**
 * The seven stops as tiny floating islands for the minimap, each with a
 * silhouette of what's on it. viewBox 0 0 32 30 (island top at y≈19).
 */
const ICONS: Record<string, string> = {
  // HQ: the Hark tower with a green LED crown
  hero: `<path class="mi-ink" d="M13.5 18V7.5h5V18z"/><path class="mi-led" d="M13.5 7.5l2.5-3 2.5 3z"/><rect class="mi-glass" x="15" y="10" width="2" height="2"/><rect class="mi-glass" x="15" y="13.5" width="2" height="2"/>`,
  // Main Street: two little houses
  work: `<path class="mi-wall" d="M8 18v-5h6v5z"/><path class="mi-roof" d="M7 13.4l4-4.4 4 4.4z"/><path class="mi-wall" d="M17 18v-6.5h7V18z"/><path class="mi-roof2" d="M16 11.9l4.5-4.9 4.5 4.9z"/>`,
  // The Works: a windmill
  services: `<path class="mi-wall" d="M14.4 18l.8-8h1.6l.8 8z"/><g class="mi-blades"><path class="mi-ink" d="M16 9.6 16 3.4M16 9.6l6 1.2M16 9.6 10 8.4M16 9.6l-1.4 5.6" stroke-width="1.6" stroke-linecap="round"/></g><circle class="mi-led" cx="16" cy="9.6" r="1.2"/>`,
  // Town Square: a big round tree and a bench
  voices: `<rect class="mi-trunk" x="15.1" y="12" width="1.8" height="6"/><circle class="mi-leaf" cx="16" cy="9.5" r="5"/><circle class="mi-leaf2" cx="14.2" cy="8" r="2"/><path class="mi-ink" d="M21 16.2h5M21.6 16.2v1.8M25.4 16.2v1.8" stroke-width="1.1"/>`,
  // The Storm: a rain cloud with a bolt
  shield: `<path class="mi-cloud" d="M9.5 10.5a3 3 0 0 1 3.4-3 4 4 0 0 1 7.3.6 2.6 2.6 0 0 1 2.3 2.6 2.4 2.4 0 0 1-2.4 2.3h-8.3a2.3 2.3 0 0 1-2.3-2.5z"/><path class="mi-bolt" d="M16.4 13l-2 3.2h2l-1.2 2.8 3.4-4h-2l1.2-2z"/>`,
  // Building Site: a crane
  process: `<path class="mi-crane" d="M11 18V5.5M9 5.5h14M11 8.5l3-3M20.5 5.5v5" stroke-width="1.5" stroke-linecap="round"/><rect class="mi-roof2" x="19" y="10.5" width="3" height="2.4"/><path class="mi-wall" d="M17 18v-3h6v3z"/>`,
  // Lighthouse: striped tower, lit lamp
  contact: `<path class="mi-wall" d="M14 18l1-10h2l1 10z"/><path class="mi-roof" d="M14.5 13h3l.3 2.4h-3.6zM15.2 9.6h1.6l.2 1.6h-2z"/><rect class="mi-led" x="14.8" y="5.8" width="2.4" height="2.2" rx=".6"/><path class="mi-ink" d="M14.6 5.9l1.4-2 1.4 2z"/>`,
}

export function miniIslandSvg(id: string) {
  const icon = ICONS[id] ?? ''
  return `<svg class="mi" viewBox="0 0 32 30" aria-hidden="true" focusable="false">
  <path class="mi-soil" d="M4.5 19.5c2 3 6 4.5 11.5 4.5s9.5-1.5 11.5-4.5c-1 3.2-3.8 5.2-6.4 6.2-1.3 1.8-3 3-5.1 3.5-2.1-.5-3.8-1.7-5.1-3.5-2.6-1-5.4-3-6.4-6.2z"/>
  <path class="mi-side" d="M4 18.2c0 2.7 5.4 4.6 12 4.6s12-1.9 12-4.6v1.8c0 2.7-5.4 4.6-12 4.6S4 22.7 4 20z"/>
  <ellipse class="mi-top" cx="16" cy="18.2" rx="12" ry="4.2"/>
  ${icon}
</svg>`
}

/** a phone outline for the rotate card: it turns upright on a loop. viewBox 0 0 64 64 */
export function phoneSvg(cls = '') {
  return `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <path class="rot-arc" d="M12 22a24 24 0 0 1 34-10" fill="none" stroke="${P.slate}" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 4.5"/>
  <path d="M42 7.5l5 4.6-6.2 2.6" fill="none" stroke="${P.slate}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <g class="rot-phone">
    <rect x="21" y="16" width="22" height="38" rx="4.5" fill="${P.ink}"/>
    <rect x="23.6" y="20.5" width="16.8" height="28" rx="1.6" fill="#bfe0f3"/>
    <ellipse cx="32" cy="38" rx="6" ry="2" fill="${P.grass}"/>
    <path d="M26 38c1 2 3 4 6 5 3-1 5-3 6-5z" fill="${P.soil}"/>
    <path d="M30.5 36.8v-4h3v4z" fill="${P.ink}"/><path d="M30.5 32.8l1.5-1.8 1.5 1.8z" fill="${P.signal}"/>
    <circle cx="32" cy="51.3" r="1.1" fill="#4b5563"/>
  </g>
</svg>`
}
