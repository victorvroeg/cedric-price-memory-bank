// The bed: music the tool steers, not music baked into the film.
//
// Documentary grammar. The bed comes up in the gaps — arrival, buffering, the
// dark between two cuts — and gets out of the way the moment somebody speaks.
// It never stops; it stands under the talking, quietly, and rises again when
// the talking does.
//
// Levels ride a GainNode rather than el.volume, because iOS ignores volume set
// on a media element. Where there is no Web Audio at all we fall back to
// volume and accept that iOS will play the bed flat.

// Set by ear against these interviews, not by taste in the abstract: the films
// sit around -20 dBFS of speech and the bed's own level is about -17 dBFS, so
// UNDER puts the music roughly 15 dB under the talking — present in the room,
// never competing for the sentence. 0.055 was 27 dB down, which is silence.
const SWELL = 0.5;    // nobody is speaking
const UNDER = 0.13;   // somebody is
const RISE = 2.4;     // seconds to come up: slow, like a room filling
const DUCK = 1.0;     // seconds to get out of the way: faster — speech wins
const OUT = 5.5;      // the long fade at the end of a cross-cut
const KEY = "cpmb-score";

export interface Score {
  swell(): void;
  under(): void;
  out(): void;
  allow(): void;          // sound is permitted now (autoplay cleared, or a gesture)
  toggle(): boolean;      // returns the new state
  readonly wanted: boolean;
  readonly gain: number;  // where the bed actually sits, for ?debug
}

export function makeScore(tracks: string[], seed = 0): Score | null {
  if (!tracks.length) return null;

  // One piece per topic, chosen deterministically: a topic keeps its theme
  // across visits, but the archive as a whole is not monotonous.
  const el = new Audio(tracks[Math.abs(seed) % tracks.length]);
  el.loop = true;
  el.preload = "auto";

  let on = localStorage.getItem(KEY) !== "off";
  let allowed = false;
  let built = false;
  let level = SWELL;                       // what the film state asks for
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;

  function build(): void {
    if (built) return;
    built = true;
    try {
      const AC: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    } catch {
      ctx = null;
      gain = null;
      el.volume = 0;
    }
  }

  function apply(seconds: number): void {
    const v = allowed && on ? level : 0;
    if (gain && ctx) {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(v, t + seconds);
    } else {
      ease(v, seconds);
    }
    if (v > 0 && el.paused) void el.play().catch(() => {});
  }

  // fallback ramp for browsers without Web Audio
  let easing: number | undefined;
  function ease(to: number, seconds: number): void {
    clearInterval(easing);
    const from = el.volume;
    const t0 = performance.now();
    easing = window.setInterval(() => {
      const k = Math.min((performance.now() - t0) / (seconds * 1000), 1);
      try { el.volume = from + (to - from) * k; } catch { /* iOS */ }
      if (k === 1) { clearInterval(easing); easing = undefined; }
    }, 40);
  }

  return {
    swell() { level = SWELL; apply(RISE); },
    under() { level = UNDER; apply(DUCK); },
    out() { level = 0; apply(OUT); },
    allow() {
      if (allowed) return;
      allowed = true;
      build();
      void ctx?.resume();
      apply(RISE);
    },
    toggle() {
      on = !on;
      localStorage.setItem(KEY, on ? "on" : "off");
      apply(on ? RISE : 0.7);
      if (!on) setTimeout(() => el.pause(), 900);
      return on;
    },
    get wanted() { return on; },
    get gain() { return gain ? gain.gain.value : el.volume; },
  };
}
