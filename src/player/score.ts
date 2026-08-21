// The bed: music the tool steers, not music baked into the film.
//
// Documentary grammar. The bed comes up in the gaps — arrival, buffering, the
// dark between two cuts — and gets out of the way the moment somebody speaks.
//
// Two things make this harder than it sounds, and both have bitten us:
//
//   1. A browser may refuse play() on an audio element it did not see a person
//      ask for. The refusal is a rejected promise, which is easy to swallow and
//      then report success against a gain value that means nothing. So every
//      play() is checked, and a refusal arms a retry on the next real gesture.
//   2. iOS ignores volume set on a media element. There, and only there, we
//      route through a GainNode instead — feature-tested, not sniffed, because
//      the Web Audio path has its own failure (a context that never leaves
//      'suspended' plays nothing at all while looking perfectly healthy).

// TUNED AGAINST THE LIVE FILMS, WHICH ARE STILL THE OLD, VERY QUIET MASTERS
// (-30 to -48 LUFS). Once the fold-down is wired every film sits at -18 LUFS
// and the same bed will read about 12 dB quieter than it does now; UNDER
// should go back up to ~0.12 in the same commit that re-wires the videos.
const SWELL = 0.34;   // nobody is speaking
const UNDER = 0.045;  // somebody is — and the sentence wins, always
const RISE = 2.4;     // seconds to come up: slow, like a room filling
const DUCK = 1.0;     // seconds to get out of the way: faster, speech wins
const OUT = 5.5;      // the long fade at the end of a cross-cut

export interface Score {
  swell(): void;
  under(): void;
  out(): void;
  allow(): void;
  /** what is actually true, for ?debug — not what we hoped */
  readonly state: {
    gain: number;
    playing: boolean;
    time: number;
    route: "volume" | "webaudio";
    ctx: string;
    blocked: boolean;
  };
}

export function makeScore(tracks: string[], seed = 0): Score | null {
  if (!tracks.length) return null;

  // One piece per topic, chosen deterministically: a topic keeps its theme
  // across visits, but the archive as a whole is not monotonous.
  const el = new Audio(tracks[Math.abs(seed) % tracks.length]);
  el.loop = true;
  el.preload = "auto";

  // Does this platform honour volume on a media element? iOS does not.
  el.volume = 0.5;
  const volumeWorks = Math.abs(el.volume - 0.5) < 0.01;
  el.volume = 0;

  let allowed = false;
  let blocked = false;
  let level = SWELL;
  let ctx: AudioContext | null = null;
  let gain: GainNode | null = null;
  let easing: number | undefined;

  function buildGraph(): void {
    if (ctx || volumeWorks) return;
    try {
      const AC: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    } catch {
      ctx = null;
      gain = null;
    }
  }

  function ramp(to: number, seconds: number): void {
    if (gain && ctx) {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(to, t + seconds);
      return;
    }
    clearInterval(easing);
    const from = el.volume;
    const t0 = performance.now();
    easing = window.setInterval(() => {
      const k = Math.min((performance.now() - t0) / (seconds * 1000), 1);
      try { el.volume = from + (to - from) * k; } catch { /* ignore */ }
      if (k === 1) { clearInterval(easing); easing = undefined; }
    }, 40);
  }

  function start(): void {
    void ctx?.resume();
    if (!el.paused) return;
    el.play().then(
      () => { blocked = false; },
      // Refused. Say so, and take the next gesture as permission.
      () => { blocked = true; armGesture(); },
    );
  }

  let armed = false;
  function armGesture(): void {
    if (armed) return;
    armed = true;
    const go = (): void => {
      armed = false;
      removeEventListener("pointerdown", go, true);
      removeEventListener("keydown", go, true);
      buildGraph();
      start();
      apply(RISE);
    };
    addEventListener("pointerdown", go, true);
    addEventListener("keydown", go, true);
  }

  function apply(seconds: number): void {
    const to = allowed ? level : 0;
    ramp(to, seconds);
    if (to > 0) start();
  }

  return {
    swell() { level = SWELL; apply(RISE); },
    under() { level = UNDER; apply(DUCK); },
    out() { level = 0; apply(OUT); },
    allow() {
      if (allowed) return;
      allowed = true;
      buildGraph();
      apply(RISE);
    },
    get state() {
      return {
        gain: gain ? gain.gain.value : el.volume,
        playing: !el.paused,
        time: el.currentTime,
        route: (volumeWorks ? "volume" : "webaudio") as "volume" | "webaudio",
        ctx: ctx ? ctx.state : "none",
        blocked,
      };
    },
  };
}
