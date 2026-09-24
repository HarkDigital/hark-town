import type { Frame } from '../core/types'
import type { EngineState } from '../core/Engine'

/*
 * Hark Town soundscape. WebAudio only, no files: a small town on a sunny
 * day, heard from a balloon.
 *
 *   wind     a light breeze (filtered noise that breathes), gustier with
 *            scroll speed and in the storm
 *   birds    occasional synthesized birdsong (tweets, trills, a two-note
 *            whistle) panned around the island; they thin out in the storm
 *            and hand over to crickets as the sun goes down
 *   music    a soft marimba / music-box motif on a pentatonic scale. Each
 *            island has its own key (the storm turns minor and hushed);
 *            phrases change bar to bar, with rests to breathe
 *   weather  rain hiss and the odd distant thunder roll while it storms,
 *            gentle surf at the lighthouse
 *   cut()    a cloud whooshing past the lens
 *   blip()   a little "pop" in the current key (hover, nav)
 *   tone()   a pure sine a chapter may ask for (or via 'hark:tone' events)
 *
 * Off by default. Sound only ever starts from a user gesture: the toggle's
 * own click / tap / Enter / Space. A remembered "on" (localStorage) waits for
 * the first real activation (a pointer press or tap, or Enter / Space on a
 * control; never Tab, Shift or scrolling keys). Faded out and suspended while
 * the tab is hidden. On iOS the session is switched to "playback" so the
 * silent switch does not swallow it.
 *
 * Chapters can trigger a pop or whoosh without touching the chrome:
 *   window.dispatchEvent(new CustomEvent('hark:sfx', { detail: { kind: 'pop', level: 0.8 } }))
 */

export const STORE_KEY = 'hark-town:audio'

/** The remembered choice: true (on), false (off), or null when never set. */
export function storedAudio(): boolean | null {
  try {
    const v = localStorage.getItem(STORE_KEY)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

/** keys that activate a focused control; everything else (Tab, Shift, arrows, PageDown…) is navigation */
const ACTIVATE_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const CONTROL = 'a[href], button, [role="button"], [role="switch"], summary, input, select, textarea'
const MASTER_LEVEL = 1.1
const TONE_MAX = 0.08
const LOOKAHEAD = 0.3
/** one eighth note of the motif (s) */
const STEP = 0.36

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

/** per island: root (MIDI) and mode. The storm turns minor. */
const KEYS: Record<string, { root: number; minor?: boolean; level?: number }> = {
  hero: { root: 72 },
  work: { root: 74 },
  services: { root: 76 },
  voices: { root: 77 },
  shield: { root: 69, minor: true, level: 0.55 },
  process: { root: 79 },
  contact: { root: 75 },
}
const MAJOR_PENT = [0, 2, 4, 7, 9, 12, 14, 16]
const MINOR_PENT = [0, 3, 5, 7, 10, 12, 15, 17]
/** phrases as scale degrees; -1 is a rest */
const PHRASES = [
  [0, 2, 4, 2, 5, 4, 2, -1],
  [4, -1, 3, 2, 1, -1, 2, 0],
  [2, 4, 5, 7, 5, -1, 4, -1],
  [0, -1, 2, -1, 4, 3, 2, -1],
  [5, 4, 2, 4, 1, -1, 0, -1],
]

type SfxKind = 'pop' | 'whoosh'

function noiseBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  }
  return buf
}

/** Brownian (red) noise, loop-safe: wind body, surf, thunder. */
function brownBuffer(ctx: AudioContext, seconds: number) {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let last = 0
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = last * 3.5
    }
    // crossfade the tail into the head so the loop never clicks
    const fade = Math.min(4096, len >> 3)
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      d[i] = d[i] * t + d[len - fade + i] * (1 - t)
    }
  }
  return buf
}

/**
 * iOS routes Web Audio through the "ambient" session, which the ring/silent
 * switch mutes. Safari 16.4+ lets a page opt into "playback"; hand it back to
 * "auto" when muted. Feature-detected; a no-op elsewhere.
 */
function setAudioSession(type: 'playback' | 'auto') {
  try {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
    if (session && session.type !== type) session.type = type
  } catch {
    /* unsupported */
  }
}

interface Bed {
  gain: GainNode
  sent: number
}

export class Sound {
  enabled = false
  onChange: ((enabled: boolean) => void)[] = []

  private ctx: AudioContext | null = null
  private master!: GainNode
  private fx!: GainNode
  private music!: GainNode
  private birdsBus!: GainNode
  private white!: AudioBuffer
  private brown!: AudioBuffer
  private wind!: Bed
  private windHi!: Bed
  private rain!: Bed
  private surf!: Bed
  private toneOsc!: OscillatorNode
  private toneGain!: GainNode

  // scene state (from update)
  private chapter = 'hero'
  private storm = 0
  private dayT = 0.3
  private speed = 0

  // schedulers (audio clock)
  private schedTimer = 0
  private nextStep = 0
  private step = 0
  private phrase = 0
  private bar = 0
  private nextBird = 0
  private nextCricket = 0
  private nextThunder = 0

  private lastCut = 0
  private lastBlip = 0
  private suspendTimer = 0
  private hidden = typeof document !== 'undefined' && document.hidden
  /** a remembered "on" preference waiting for the first user gesture */
  private armed = false
  private gestureBound = false

  // requested pure tone (kept even while muted so it applies the moment sound starts)
  private toneHz = 432
  private toneLevel = 0
  private toneSent = { hz: 0, level: -1 }

  constructor() {
    this.armed = storedAudio() === true
    if (this.armed) this.waitForGesture()
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden
      this.applyRunning()
    })
    // an explicit on/off from elsewhere (must itself come from a gesture)
    window.addEventListener('hark:audio', e => {
      const d = (e as CustomEvent<{ on?: boolean }>).detail
      if (d && typeof d.on === 'boolean') this.set(d.on)
    })
    window.addEventListener('hark:tone', e => {
      const d = (e as CustomEvent<{ hz?: number; level?: number }>).detail
      if (d && typeof d.hz === 'number') this.tone(d.hz, d.level ?? 0)
    })
    window.addEventListener('hark:sfx', e => {
      const d = (e as CustomEvent<{ kind?: SfxKind; level?: number }>).detail
      if (d?.kind === 'pop') this.blip(0, d.level ?? 1)
      else if (d?.kind === 'whoosh') this.whoosh(d.level ?? 1, 1)
    })
  }

  /** Flip sound on/off. Call from a user gesture (click / key). */
  toggle() {
    this.armed = false
    this.setEnabled(!this.enabled)
    this.persist(this.enabled)
  }

  /** Set sound on/off and remember the choice (even when it is unchanged). */
  set(on: boolean) {
    this.armed = false
    this.setEnabled(on)
    this.persist(on)
  }

  /** Release any requested tone at once (e.g. while the scene is covered and chapters stop updating). */
  hush() {
    this.speed = 0
    if (this.toneLevel === 0) return
    this.toneLevel = 0
    this.applyTone()
  }

  /** Follow the story: which island, how stormy, what time of day, how fast. */
  update(frame: Frame, state: EngineState) {
    const slot = state.slots[state.index]
    if (!slot) return
    this.chapter = slot.def.id
    const w = slot.ctx.world
    this.storm = clamp01(w.params.storm)
    this.dayT = Number.isFinite(w.time) ? w.time : 0.3
    this.speed += (clamp01(Math.abs(frame.velocity) * 0.8) - this.speed) * Math.min(1, frame.dt * 4)
    const ctx = this.live()
    if (!ctx) return
    const storm = this.storm
    const sea = this.chapter === 'contact' ? 1 : this.chapter === 'hero' ? 0.35 : 0
    this.bed(ctx, this.wind, 0.05 + storm * 0.1 + this.speed * 0.05)
    this.bed(ctx, this.windHi, 0.004 + storm * 0.02 + this.speed * 0.006)
    this.bed(ctx, this.rain, storm > 0.2 ? (storm - 0.2) * 0.06 : 0)
    this.bed(ctx, this.surf, sea * 0.07)
    const key = KEYS[this.chapter] ?? KEYS.hero
    const musicLv = 0.9 * (key.level ?? 1) * (1 - storm * 0.35)
    if (Math.abs(this.music.gain.value - musicLv) > 0.01) this.music.gain.setTargetAtTime(musicLv, ctx.currentTime, 0.6)
  }

  /** A cloud rolls past the lens (chapter cuts). */
  cut(from: number, to: number) {
    this.whoosh(1, to >= from ? 1 : -1)
  }

  /** A little toy "pop" in the current key (hover, nav). No-op while sound is off. */
  blip(pitch = 0, level = 1) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastBlip < 0.045) return
    this.lastBlip = now
    const key = KEYS[this.chapter] ?? KEYS.hero
    const scale = key.minor ? MINOR_PENT : MAJOR_PENT
    const deg = Math.abs(Math.round(pitch)) % scale.length
    const f = mtof(key.root + scale[deg])
    const a = clamp01(level)
    // the pop: a bubble snapping up in pitch, then gone
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(f * 0.55, now)
    o.frequency.exponentialRampToValueAtTime(f * 1.12, now + 0.028)
    o.frequency.exponentialRampToValueAtTime(f, now + 0.09)
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.085 * a, now + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    o.connect(g)
    g.connect(this.fx)
    o.start(now)
    o.stop(now + 0.18)
    this.noiseHit(ctx, now, { type: 'bandpass', f: 2600, q: 1.2, level: 0.035 * a, attack: 0.001, decay: 0.012 })
  }

  /** A pure sine a chapter may ask for: level 0..1 (0 releases it). */
  tone(hz: number, level: number) {
    if (Number.isFinite(hz) && hz > 20 && hz < 12000) this.toneHz = hz
    this.toneLevel = clamp01(Number.isFinite(level) ? level : 0)
    this.applyTone()
  }

  // ------------------------------------------------------------------ internals

  /** The running context, or null when sound is off / suspended / hidden. */
  private live() {
    const ctx = this.ctx
    if (!ctx || !this.enabled || this.hidden || ctx.state !== 'running') return null
    return ctx
  }

  private bed(ctx: AudioContext, b: Bed, level: number) {
    if (Math.abs(b.sent - level) < 0.0015) return
    b.sent = level
    b.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.5)
  }

  private noiseSource(ctx: AudioContext, buf = this.white) {
    const src = ctx.createBufferSource()
    src.buffer = buf
    return src
  }

  /** a short filtered noise burst */
  private noiseHit(
    ctx: AudioContext,
    t: number,
    o: { type: BiquadFilterType; f: number; q: number; level: number; attack: number; decay: number; pan?: number },
  ) {
    const src = this.noiseSource(ctx)
    const f = ctx.createBiquadFilter()
    f.type = o.type
    f.frequency.value = o.f
    f.Q.value = o.q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(o.level, t + o.attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.attack + o.decay)
    src.connect(f)
    f.connect(g)
    if (o.pan) {
      const p = ctx.createStereoPanner()
      p.pan.value = o.pan
      g.connect(p)
      p.connect(this.fx)
    } else g.connect(this.fx)
    src.start(t, Math.random() * 2)
    src.stop(t + o.attack + o.decay + 0.02)
  }

  /** a cloud passing: a filtered-noise swell that sweeps across the stereo field */
  private whoosh(level: number, dir: number) {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (now - this.lastCut < 0.25) return
    this.lastCut = now
    const a = clamp01(level)
    const src = this.noiseSource(ctx, this.brown)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.8
    bp.frequency.setValueAtTime(260, now)
    bp.frequency.exponentialRampToValueAtTime(1500, now + 0.42)
    bp.frequency.exponentialRampToValueAtTime(420, now + 1.05)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.3 * a, now + 0.38)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.15)
    const p = ctx.createStereoPanner()
    p.pan.setValueAtTime(-0.65 * dir, now)
    p.pan.linearRampToValueAtTime(0.65 * dir, now + 1.05)
    src.connect(bp)
    bp.connect(g)
    g.connect(p)
    p.connect(this.fx)
    src.start(now, Math.random() * 3)
    src.stop(now + 1.2)
    // the airy top of the cloud
    const air = this.noiseSource(ctx)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2400
    const ag = ctx.createGain()
    ag.gain.setValueAtTime(0, now)
    ag.gain.linearRampToValueAtTime(0.025 * a, now + 0.35)
    ag.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
    air.connect(hp)
    hp.connect(ag)
    ag.connect(p)
    air.start(now, Math.random() * 2)
    air.stop(now + 1)
  }

  /** one marimba / music-box note */
  private note(ctx: AudioContext, t: number, midi: number, vel: number, pan: number) {
    const f = mtof(midi)
    const out = ctx.createGain()
    out.gain.value = 1
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    out.connect(p)
    p.connect(this.music)
    // body
    const o1 = ctx.createOscillator()
    const g1 = ctx.createGain()
    o1.type = 'sine'
    o1.frequency.value = f
    g1.gain.setValueAtTime(0, t)
    g1.gain.linearRampToValueAtTime(0.075 * vel, t + 0.005)
    g1.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    o1.connect(g1)
    g1.connect(out)
    o1.start(t)
    o1.stop(t + 1.55)
    // the bright struck partial (a marimba bar's 4th), gone almost at once
    const o2 = ctx.createOscillator()
    const g2 = ctx.createGain()
    o2.type = 'sine'
    o2.frequency.value = f * 3.93
    g2.gain.setValueAtTime(0, t)
    g2.gain.linearRampToValueAtTime(0.022 * vel, t + 0.002)
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
    o2.connect(g2)
    g2.connect(out)
    o2.start(t)
    o2.stop(t + 0.16)
  }

  /** a songbird call at audio time t */
  private bird(ctx: AudioContext, t: number) {
    const pan = (Math.random() * 2 - 1) * 0.75
    const p = ctx.createStereoPanner()
    p.pan.value = pan
    p.connect(this.birdsBus)
    const chirp = (at: number, f0: number, f1: number, dur: number, lv: number) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(f0, at)
      o.frequency.exponentialRampToValueAtTime(f1, at + dur)
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(lv, at + Math.min(0.012, dur * 0.3))
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.02)
      o.connect(g)
      g.connect(p)
      o.start(at)
      o.stop(at + dur + 0.04)
    }
    const kind = Math.random()
    const lv = 0.028 + Math.random() * 0.018
    const base = 2600 + Math.random() * 1400
    if (kind < 0.42) {
      // tweet-tweet
      const n = 2 + Math.floor(Math.random() * 3)
      for (let i = 0; i < n; i++) chirp(t + i * 0.13, base, base * 1.45, 0.055, lv)
    } else if (kind < 0.72) {
      // a quick trill
      const n = 6 + Math.floor(Math.random() * 6)
      for (let i = 0; i < n; i++) chirp(t + i * 0.045, base * 1.5 + (i % 2 ? 260 : -180), base * 1.35, 0.03, lv * 0.7)
    } else {
      // a two-note whistle, "fee-bee"
      chirp(t, base * 1.1, base * 1.08, 0.22, lv * 0.8)
      chirp(t + 0.3, base * 0.86, base * 0.82, 0.26, lv * 0.75)
    }
  }

  /** three quick cricket pulses */
  private cricket(ctx: AudioContext, t: number) {
    const p = ctx.createStereoPanner()
    p.pan.value = (Math.random() * 2 - 1) * 0.8
    p.connect(this.birdsBus)
    const f = 4300 + Math.random() * 500
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      const at = t + i * 0.045
      o.frequency.value = f
      g.gain.setValueAtTime(0, at)
      g.gain.linearRampToValueAtTime(0.007, at + 0.006)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03)
      o.connect(g)
      g.connect(p)
      o.start(at)
      o.stop(at + 0.04)
    }
  }

  /** a distant thunder roll */
  private thunder(ctx: AudioContext, t: number, a: number) {
    const src = this.noiseSource(ctx, this.brown)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(420, t)
    lp.frequency.exponentialRampToValueAtTime(110, t + 2.4)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.32 * a, t + 0.12)
    g.gain.setTargetAtTime(0.18 * a, t + 0.3, 0.3)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2)
    src.connect(lp)
    lp.connect(g)
    g.connect(this.fx)
    src.start(t, Math.random() * 3)
    src.stop(t + 3.3)
  }

  /** keep the music and the wildlife scheduled a little ahead on the audio clock */
  private schedule = () => {
    const ctx = this.live()
    if (!ctx) return
    const now = ctx.currentTime
    if (this.nextStep < now) this.nextStep = now + 0.08
    const key = KEYS[this.chapter] ?? KEYS.hero
    const scale = key.minor ? MINOR_PENT : MAJOR_PENT
    const step = key.minor ? STEP * 1.25 : STEP
    while (this.nextStep < now + LOOKAHEAD) {
      const s = this.step % 8
      if (s === 0) {
        this.bar++
        // a new phrase each bar; every fourth bar rests (the storm rests more)
        this.phrase = Math.floor(Math.random() * PHRASES.length)
      }
      const resting = this.bar % 4 === 0 || (key.minor && this.bar % 2 === 0)
      const deg = PHRASES[this.phrase][s]
      if (!resting && deg >= 0) {
        const swing = s % 2 ? 0.018 : 0
        const vel = (s === 0 ? 1 : 0.72) * (0.85 + Math.random() * 0.3)
        this.note(ctx, this.nextStep + swing, key.root + scale[deg], vel, (deg / 7 - 0.5) * 0.5)
      }
      // a soft low bar on the downbeat
      if (s === 0 && !resting) this.note(ctx, this.nextStep, key.root - 12, 0.55, 0)
      this.step++
      this.nextStep += step
    }

    // birds by day, fewer in the storm, crickets as the sun goes down
    const day = clamp01(1 - (this.dayT - 0.8) / 0.12) * (1 - this.storm * 0.85)
    const dusk = clamp01((this.dayT - 0.8) / 0.12) * (1 - this.storm)
    if (this.nextBird < now) this.nextBird = now + 1 + Math.random() * 2
    if (this.nextBird < now + LOOKAHEAD) {
      if (day > 0.05 && Math.random() < day) this.bird(ctx, this.nextBird)
      this.nextBird += 1.6 + Math.random() * 4.5
    }
    if (this.nextCricket < now) this.nextCricket = now + 0.5
    if (this.nextCricket < now + LOOKAHEAD) {
      if (dusk > 0.05 && Math.random() < dusk) this.cricket(ctx, this.nextCricket)
      this.nextCricket += 0.7 + Math.random() * 0.6
    }
    if (this.storm > 0.55) {
      if (this.nextThunder < now) this.nextThunder = now + 1.5 + Math.random() * 3
      if (this.nextThunder < now + LOOKAHEAD) {
        this.thunder(ctx, this.nextThunder, this.storm)
        this.nextThunder += 7 + Math.random() * 7
      }
    } else this.nextThunder = 0
  }

  private applyTone() {
    const ctx = this.live()
    if (!ctx) return
    const lv = this.toneLevel * TONE_MAX
    const s = this.toneSent
    if (Math.abs(s.hz - this.toneHz) < 0.05 && Math.abs(s.level - lv) < 0.0005) return
    const now = ctx.currentTime
    this.toneOsc.frequency.setTargetAtTime(this.toneHz, now, 0.035)
    this.toneGain.gain.setTargetAtTime(lv, now, lv > s.level ? 0.07 : 0.16)
    s.hz = this.toneHz
    s.level = lv
  }

  private setEnabled(on: boolean) {
    if (on === this.enabled) return
    this.enabled = on
    setAudioSession(on ? 'playback' : 'auto')
    if (on) {
      try {
        this.ensureGraph()
      } catch (err) {
        console.warn('[hark] audio unavailable', err)
      }
    }
    this.applyRunning()
    for (const fn of this.onChange) fn(on)
  }

  private persist(on: boolean) {
    try {
      localStorage.setItem(STORE_KEY, on ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  /** Resume + fade in, or fade out + suspend, based on enabled/hidden. */
  private applyRunning() {
    const ctx = this.ctx
    if (!ctx) return
    clearTimeout(this.suspendTimer)
    window.clearInterval(this.schedTimer)
    const now = ctx.currentTime
    if (this.enabled && !this.hidden) {
      ctx
        .resume()
        .then(() => {
          if (!this.enabled || this.hidden) return
          if (ctx.state !== 'running') return this.waitForGesture()
          const t = ctx.currentTime
          this.master.gain.cancelScheduledValues(t)
          this.master.gain.setValueAtTime(this.master.gain.value, t)
          this.master.gain.setTargetAtTime(MASTER_LEVEL, t, 0.4)
          this.toneSent.level = -1
          for (const b of [this.wind, this.windHi, this.rain, this.surf]) b.sent = -1
          this.applyTone()
          this.nextStep = t + 0.35
          this.nextBird = t + 0.8 + Math.random()
          window.clearInterval(this.schedTimer)
          this.schedTimer = window.setInterval(this.schedule, 50)
          this.schedule()
        })
        .catch(() => this.waitForGesture())
    } else {
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.setTargetAtTime(0, now, this.hidden ? 0.05 : 0.2)
      this.suspendTimer = window.setTimeout(
        () => {
          if (!this.enabled || this.hidden) ctx.suspend().catch(() => {})
        },
        this.hidden ? 300 : 1200,
      )
    }
  }

  /** Start audio on the first real gesture (remembered preference / blocked resume). */
  private waitForGesture() {
    if (this.gestureBound) return
    this.gestureBound = true
    const events = ['pointerdown', 'click', 'touchend', 'keydown'] as const
    const handler = (e: Event) => {
      // keyboard: only Enter / Space aimed at a control counts as "play"; Tab,
      // Shift+Tab, arrows, PageDown and Space-to-scroll are just moving around
      if (e instanceof KeyboardEvent) {
        if (!ACTIVATE_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
        if (!(e.target as Element | null)?.closest?.(CONTROL)) return
      }
      for (const ev of events) window.removeEventListener(ev, handler, true)
      this.gestureBound = false
      const onToggle = (e.target as Element | null)?.closest?.('[data-sound-toggle]')
      if (this.armed) {
        this.armed = false
        // the toggle's own click decides for itself
        if (!onToggle) this.setEnabled(true)
      } else if (this.enabled) this.applyRunning()
    }
    for (const ev of events) window.addEventListener(ev, handler, true)
  }

  private ensureGraph() {
    if (this.ctx) return
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC({ latencyHint: 'interactive' })
    this.ctx = ctx
    const now = ctx.currentTime
    this.white = noiseBuffer(ctx, 3)
    this.brown = brownBuffer(ctx, 6)

    // master → high-pass → gentle glue compression → out
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 30
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 16
    comp.ratio.value = 3
    comp.attack.value = 0.008
    comp.release.value = 0.3
    this.master.connect(hp)
    hp.connect(comp)
    comp.connect(ctx.destination)

    // an open-air echo shared by the music and the birds (a darkened feedback delay)
    const echo = ctx.createDelay(1)
    echo.delayTime.value = STEP * 1.5
    const fb = ctx.createGain()
    fb.gain.value = 0.3
    const dark = ctx.createBiquadFilter()
    dark.type = 'lowpass'
    dark.frequency.value = 2400
    const wet = ctx.createGain()
    wet.gain.value = 0.32
    echo.connect(dark)
    dark.connect(fb)
    fb.connect(echo)
    dark.connect(wet)
    wet.connect(this.master)

    this.fx = ctx.createGain()
    this.fx.connect(this.master)
    this.music = ctx.createGain()
    this.music.gain.value = 0.9
    this.music.connect(this.master)
    this.music.connect(echo)
    this.birdsBus = ctx.createGain()
    this.birdsBus.gain.value = 1
    this.birdsBus.connect(this.master)
    this.birdsBus.connect(echo)

    const loopBed = (
      buf: AudioBuffer,
      filter: { type: BiquadFilterType; f: number; q: number },
      lfo?: { rate: number; depth: number; target: 'freq' | 'gain' },
    ): Bed => {
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.loop = true
      const flt = ctx.createBiquadFilter()
      flt.type = filter.type
      flt.frequency.value = filter.f
      flt.Q.value = filter.q
      const breathe = ctx.createGain()
      breathe.gain.value = 1
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(flt)
      flt.connect(breathe)
      breathe.connect(gain)
      gain.connect(this.master)
      if (lfo) {
        const o = ctx.createOscillator()
        o.frequency.value = lfo.rate
        const d = ctx.createGain()
        d.gain.value = lfo.depth
        o.connect(d)
        d.connect(lfo.target === 'freq' ? flt.frequency : breathe.gain)
        o.start(now)
      }
      src.start(now, Math.random() * 2)
      return { gain, sent: -1 }
    }
    // the breeze: a slow-breathing band of noise, plus a faint high whistle
    this.wind = loopBed(this.brown, { type: 'bandpass', f: 520, q: 0.55 }, { rate: 0.07, depth: 260, target: 'freq' })
    this.windHi = loopBed(this.white, { type: 'bandpass', f: 1700, q: 5 }, { rate: 0.11, depth: 600, target: 'freq' })
    this.rain = loopBed(this.white, { type: 'highpass', f: 3200, q: 0.4 })
    this.surf = loopBed(this.brown, { type: 'lowpass', f: 700, q: 0.3 }, { rate: 0.12, depth: 0.7, target: 'gain' })

    // requested pure tone
    this.toneOsc = ctx.createOscillator()
    this.toneOsc.type = 'sine'
    this.toneOsc.frequency.value = this.toneHz
    this.toneGain = ctx.createGain()
    this.toneGain.gain.value = 0
    this.toneOsc.connect(this.toneGain)
    this.toneGain.connect(this.master)
    this.toneOsc.start(now)
  }
}
