# Hark Town — concept site

*A tiny floating town, built by Hark.* A scroll-driven WebGL concept for Hark
Digital Design: a sunny miniature world of floating islands seen through a
tilt-shift lens — soft clay buildings, little trams and townsfolk, and one
day passing from morning to sunset as you scroll.

**Live:** https://harkdigital.github.io/hark-town/

Sister concepts for comparison:
[Orbit (space)](https://harkdigital.github.io/hark-igloo/) ·
[Resonance (acoustic lab)](https://harkdigital.github.io/hark-resonance/) ·
[Press (print shop)](https://harkdigital.github.io/hark-press/) ·
[the 2026 site build](https://harkdigital.github.io/hark-digital-2026/).
Copy, services, portfolio and testimonials come from the 2026 site
(`Clients/Hark Digital 2026 Website/site-v2/src/data`) via `src/content.ts`.

## The tour

| # | Island | What happens |
|---|--------|--------------|
| 01 | **HQ** (`hero`) | The Hark mark stands as the town's landmark; "listen" rings pulse out and the town pops up around it → *Make the internet listen.* |
| 02 | **Main Street** (`work`) | *Built to be heard.* A tram stops at each project's shop, its website on the rooftop billboard; then a market of nine more |
| 03 | **The Works** (`services`) | *Eleven ways to be heard.* Eleven workshop islets, one per service |
| 04 | **Town Square** (`voices`) | *We listen. They talk.* Townsfolk share the testimonials in speech bubbles |
| 05 | **The Storm** (`shield`) | Red "hack" lightning, a green shield dome → *Hacked? Breathe.* → a rainbow, 24/7 |
| 06 | **Building Site** (`process`) | *We listen first. Then we build.* One building goes up in four stages: Listen · Prototype · Build · Support |
| 07 | **Lighthouse** (`contact`) | At sunset, a lighthouse whose lamp is the Hark mark — *Say hello.* |

Chapter cuts are a cloud wipe; the island minimap in the corner tracks the
flight and the time of day. Screen readers and keyboards get the whole story
as linear semantic HTML (`src/core/srContent.ts`), and the visuals follow
keyboard focus.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production build → dist/
```

URL params: `?nointro`, `?c=work&l=0.5`, `?p=0.4`, `?only=hero`, `?debug`.

```bash
npx vite --config vite.shots.config.ts --port 5490 --strictPort   # no-HMR server
node scripts/shot.mjs --port=5490 --frames=hero:0.3,work:0.2 --out=shots [--mobile]
```

## How it's built

Same engine as the other concepts (Vite + TypeScript + Three.js r186 + Lenis).

- `src/world/World.ts` — sky dome with time of day and storm, one soft-shadow
  sun whose shadow frustum follows the island on screen, hemisphere fill.
- `src/kit/` — the toy kit: clay materials and procedural islands, houses,
  trees, cars, people, clouds and street furniture.
- `src/core/post.ts` — tilt-shift depth of field, miniature saturation, cloud
  wipe at chapter cuts, soft vignette and grain.

## Deploy

Pushes to `main` deploy to GitHub Pages (`--base=/hark-town/`, `noindex`).
