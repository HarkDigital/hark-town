import { BRAND, CONTACT, PROCESS, SECTIONS, SECURITY, SERVICES, STATS, TESTIMONIALS, WORK, workImage } from '../content'
import { CONCEPT_TAG, WORDMARK, markSvg } from './mark'
import { unmountRotateGate } from './rotate'
import { releaseInert } from './inert'
import { balloonSvg, buildIslandSvg, miniIslandSvg } from './art'

/**
 * Plain HTML version of the story for browsers without WebGL2 (and the
 * last-resort view if boot fails), laid out as a friendly guidebook to Hark
 * Town: a cover with the little island, a fold-out route map of the seven
 * stops, then one guidebook entry per stop. Same copy, same HUD vocabulary,
 * no scene. Styled by the .fb-* rules in ui.css.
 *
 * Landmarks: the brand + primary nav are a real banner <header> just before
 * <main id="track"> and the credits a <footer> just after it, so "Skip to
 * content" (#track) lands on the guidebook itself, past the navigation.
 */
export function renderFallback(root: HTMLElement) {
  document.documentElement.classList.add('no-webgl')
  unmountRotateGate()
  // boot can fail while the loader still holds the page inert: let go of it
  releaseInert('loader')
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  /** the last word of a headline in the italic Hark green */
  const accent = (s: string) => {
    const t = esc(s)
    const i = t.lastIndexOf(' ')
    return i < 0 ? `<em>${t}</em>` : `${t.slice(0, i)} <em>${t.slice(i + 1)}</em>`
  }
  const newTab = '<span class="sr-only"> (opens in a new tab)</span>'
  const isPreview = (url: string) => /harktest\.com/.test(url)

  const STOPS = [
    { id: 'hero', href: '#fb-top', town: 'HQ', plain: 'Home' },
    { id: 'work', href: '#fb-work', town: 'Main Street', plain: 'Work' },
    { id: 'services', href: '#fb-services', town: 'The Works', plain: 'Services' },
    { id: 'voices', href: '#fb-voices', town: 'Town Square', plain: 'Clients' },
    { id: 'shield', href: '#fb-security', town: 'The Storm', plain: 'Security' },
    { id: 'process', href: '#fb-process', town: 'Building Site', plain: 'Process' },
    { id: 'contact', href: '#fb-contact', town: 'Lighthouse', plain: 'Contact' },
  ]
  const stopLabel = (i: number) => `Stop ${String(i + 1).padStart(2, '0')} · ${STOPS[i].town}`

  // banner and footer sit around <main> (a second call replaces them)
  document.getElementById('fb-head')?.remove()
  document.getElementById('fb-foot')?.remove()
  const head = document.createElement('header')
  head.className = 'fb fb-head'
  head.id = 'fb-head'
  head.innerHTML = `
    <div class="fb-top">
      <a class="fb-brand" href="#fb-top" aria-label="${esc(BRAND.name)}, top of page">
        <span class="fb-mark">${markSvg('fb-mark-svg')}</span>
        <span class="fb-brand-text" aria-hidden="true"><span class="fb-word">${WORDMARK}</span><span class="fb-sub">${CONCEPT_TAG}</span></span>
      </a>
      <nav class="fb-nav" aria-label="Primary">
        <a class="fb-link" href="#fb-work">Work</a>
        <a class="fb-link" href="#fb-services">Services</a>
        <a class="fb-link" href="#fb-contact">Contact</a>
        <a class="fb-cta" href="${CONTACT.href}">Start a project</a>
      </nav>
    </div>`
  const foot = document.createElement('footer')
  foot.className = 'fb fb-end'
  foot.id = 'fb-foot'
  foot.innerHTML = `
    <div class="fb-foot">
      <p>© ${new Date().getFullYear()} ${esc(BRAND.name)} · ${esc(BRAND.locale)}</p>
      <p class="fb-foot-links"><a href="${BRAND.classicSite}">Classic site</a><span aria-hidden="true"> · </span><a href="${BRAND.orbitSite}">Orbit</a><span aria-hidden="true"> · </span><a href="${BRAND.resonanceSite}">Resonance</a><span aria-hidden="true"> · </span><a href="${BRAND.pressSite}">Press</a></p>
    </div>`
  root.before(head)
  root.after(foot)

  root.style.pointerEvents = 'auto'
  root.innerHTML = `
  <div class="fb fb-body">
    <section class="fb-hero" id="fb-top" aria-labelledby="fb-h1">
      <div class="fb-hero-copy">
        <p class="hud-eyebrow">A guidebook to Hark Town</p>
        <h1 class="hud-title" id="fb-h1">${accent(BRAND.tagline)}</h1>
        <p class="hud-body fb-lede">${esc(BRAND.manifesto)}</p>
        <p class="hud-label fb-locale">${esc(BRAND.locale)}</p>
      </div>
      <div class="fb-hero-art" aria-hidden="true">${buildIslandSvg('fb-isle')}</div>
    </section>

    <nav class="fb-route" aria-label="Stops in this guide">
      <p class="hud-label fb-route-k" aria-hidden="true">The route · ${STOPS.length} stops</p>
      <ol class="fb-route-list">
        ${STOPS.map(
          (s, i) => `<li><a class="fb-stop" href="${s.href}">
            <span class="fb-stop-isle" aria-hidden="true">${miniIslandSvg(s.id)}${i === 0 ? `<span class="fb-stop-balloon">${balloonSvg()}</span>` : ''}</span>
            <span class="fb-stop-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
            <span class="fb-stop-name">${esc(s.plain)}</span>
            <span class="fb-stop-town">${esc(s.town)}</span>
          </a></li>`,
        ).join('')}
      </ol>
    </nav>

    <section class="fb-sec" id="fb-work" aria-labelledby="fb-work-h">
      <p class="hud-eyebrow">${esc(stopLabel(1))} · ${esc(SECTIONS.work.eyebrow)}</p>
      <h2 class="hud-h2" id="fb-work-h">${accent(SECTIONS.work.title)}</h2>
      <ul class="fb-work">
        ${WORK.map(
          w => `<li><a class="fb-card" href="${w.url}" target="_blank" rel="noopener">
            <span class="fb-card-img"><img src="${workImage(w.id)}" alt="" loading="lazy" width="1280" height="800">${
              isPreview(w.url) ? '<span class="fb-chip">Preview</span>' : ''
            }</span>
            <span class="fb-card-name">${esc(w.name)}${isPreview(w.url) ? '<span class="sr-only"> (pre-launch preview)</span>' : ''}${newTab}</span>
            <span class="hud-label">${esc(w.industry)}</span>
          </a></li>`,
        ).join('')}
      </ul>
    </section>

    <section class="fb-sec" id="fb-services" aria-labelledby="fb-services-h">
      <p class="hud-eyebrow">${esc(stopLabel(2))} · ${esc(SECTIONS.services.eyebrow)}</p>
      <h2 class="hud-h2" id="fb-services-h">${accent(SECTIONS.services.title)}</h2>
      <ul class="fb-grid">
        ${SERVICES.map(
          s => `<li class="fb-cell"><p class="fb-num" aria-hidden="true">${s.num}</p><h3 class="fb-h3">${esc(s.title)}</h3><p class="hud-body">${esc(s.blurb)}</p><ul class="hud-tags">${s.tags
            .map(t => `<li class="hud-tag">${esc(t)}</li>`)
            .join('')}</ul></li>`,
        ).join('')}
      </ul>
    </section>

    <section class="fb-sec" id="fb-voices" aria-labelledby="fb-voices-h">
      <p class="hud-eyebrow">${esc(stopLabel(3))} · ${esc(SECTIONS.voices.eyebrow)}</p>
      <h2 class="hud-h2" id="fb-voices-h">${accent(SECTIONS.voices.title)}</h2>
      <ul class="fb-quotes">
        ${TESTIMONIALS.map(
          t => `<li><figure class="fb-quote"><blockquote><p>“${esc(t.quote)}”</p></blockquote><figcaption class="hud-label">${esc(t.name)} · ${esc(t.company)}</figcaption></figure></li>`,
        ).join('')}
      </ul>
    </section>

    <section class="fb-sec fb-sec--storm" id="fb-security" aria-labelledby="fb-security-h">
      <p class="hud-eyebrow">${esc(stopLabel(4))} · ${esc(SECURITY.eyebrow)}</p>
      <h2 class="hud-h2" id="fb-security-h">${accent(SECURITY.title)}</h2>
      <p class="hud-body fb-lede">${esc(SECURITY.body)}</p>
      <p class="fb-actions"><a class="hud-btn hud-btn--ghost" href="${SECURITY.href}">${esc(SECURITY.cta)}</a></p>
    </section>

    <section class="fb-sec" id="fb-process" aria-labelledby="fb-process-h">
      <p class="hud-eyebrow">${esc(stopLabel(5))} · Process</p>
      <h2 class="hud-h2" id="fb-process-h">How we <em>work</em></h2>
      <ol class="fb-grid fb-grid--4">
        ${PROCESS.map(
          (p, i) => `<li class="fb-cell"><p class="fb-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</p><h3 class="fb-h3">${esc(p.title)}</h3><p class="hud-body">${esc(p.text)}</p></li>`,
        ).join('')}
      </ol>
      <ul class="fb-stats">
        ${STATS.map(st => `<li><span class="fb-stat">${esc(st.value)}</span><span class="fb-stat-l">${esc(st.label)}</span></li>`).join('')}
      </ul>
    </section>

    <section class="fb-sec fb-contact" id="fb-contact" aria-labelledby="fb-contact-h">
      <p class="hud-eyebrow">${esc(stopLabel(6))} · ${esc(CONTACT.eyebrow)}</p>
      <h2 class="hud-title" id="fb-contact-h">${accent(CONTACT.title)}</h2>
      <p class="hud-body fb-lede">${esc(CONTACT.body)}</p>
      <p class="fb-actions"><a class="hud-btn" href="${CONTACT.href}">${esc(BRAND.email)} <span aria-hidden="true">→</span></a></p>
    </section>
  </div>`
}
