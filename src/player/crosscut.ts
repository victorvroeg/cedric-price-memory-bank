// The cross-cut engine (M2): play a topic across films.
//
// Two <video> elements rotate: while A plays its segment, B is already
// attached to the next film and parked on its in-point; at the boundary the
// screen dims, B starts, the screen undims. If the platform refuses to run
// two media elements (iOS gesture policy), the engine degrades to a single
// element that dim-seeks-undims — the fallback the plan names.
//
// Transition gaps are measured (performance.now between boundary and the
// next film's 'playing') and logged; add ?debug to the URL for an overlay.

import type Hls from "hls.js";
import { makeBloom } from "./bloom";
import { makeScore } from "./score";

interface Item {
  slug: string;
  name: string;
  jobtitle: string;
  hls: string;
  start: number;
  end: number;
  cards: { time: number; title: string }[];
}

interface Data {
  items: Item[];
  topic: { label: string; colour: string };
  base: string;
  cards: Record<string, { slug: string; body: string }>;
  music: { tracks: string[]; seed: number };
}

const dataEl = document.getElementById("cpmb-crosscut");
const root = document.querySelector<HTMLElement>(".stage--crosscut");
if (dataEl && root) init(JSON.parse(dataEl.textContent!) as Data, root);

function init(data: Data, root: HTMLElement) {
  const items = data.items;
  if (!items.length) return;

  const projection = root.querySelector<HTMLElement>(".projection")!;
  const els = [...root.querySelectorAll<HTMLVideoElement>(".projection__video")];
  const bloom = root.querySelector<HTMLCanvasElement>(".projection__bloom");
  const scrub = root.querySelector<HTMLElement>(".scrub");
  const playhead = root.querySelector<HTMLElement>(".scrub__playhead");
  const titleL = root.querySelector<HTMLElement>(".title--left");
  const titleR = root.querySelector<HTMLElement>(".title--right");
  const nowSpeaker = root.querySelector<HTMLElement>(".nowline__topic");
  const nowCard = root.querySelector<HTMLElement>(".nowline__card");
  const nowIndex = root.querySelector<HTMLElement>(".nowline__time");
  const debug = new URLSearchParams(location.search).has("debug")
    ? Object.assign(document.body.appendChild(document.createElement("div")), { className: "debug" })
    : null;

  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const native = els[0].canPlayType("application/vnd.apple.mpegurl") !== "";
  const hlsBySrc = new Map<HTMLVideoElement, { url: string; hls: Hls | null }>();
  let HlsCtor: typeof Hls | null = null;

  const total = items.reduce((a, i) => a + (i.end - i.start), 0);
  const offsets: number[] = [];
  items.reduce((a, i) => (offsets.push(a), a + (i.end - i.start)), 0);

  let active = 0;        // index into els
  let current = -1;      // index into items (what the active element shows)
  let singleMode = false;
  let started = false;
  let advancing = false;
  let skipped = 0;
  let pendingStart = 0;
  const gaps: number[] = [];

  async function attach(el: HTMLVideoElement, url: string, at = 0): Promise<void> {
    const prev = hlsBySrc.get(el);
    if (prev?.url === url && !el.error) return; // re-attach after a media error
    prev?.hls?.destroy();
    if (native) {
      // Safari: #t= puts the first byte request at the in-point rather than
      // fetching the head of the film and seeking afterwards.
      el.src = at > 0 ? `${url}#t=${at.toFixed(2)}` : url;
      el.load();
      hlsBySrc.set(el, { url, hls: null });
    } else {
      if (!HlsCtor) HlsCtor = (await import("hls.js")).default;
      const hls = new HlsCtor({
        // Start on the lowest rendition so the first frame arrives almost
        // immediately; ABR climbs to full quality within a second or two.
        startLevel: 0,
        // Begin loading AT the in-point instead of at zero — a cross-cut
        // almost never starts at the top of a film.
        startPosition: at,
        startFragPrefetch: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 90,
        backBufferLength: 30,
        abrEwmaDefaultEstimate: 2_500_000,
      });
      hls.attachMedia(el);
      hls.loadSource(url);
      hlsBySrc.set(el, { url, hls });
    }
  }

  function park(el: HTMLVideoElement, item: Item): void {
    // attach + place on the in-point, paused, so starting it is instant
    void attach(el, item.hls, item.start).then(() => {
      const seek = () => { el.currentTime = item.start; };
      if (el.readyState >= 1) seek();
      else el.addEventListener("loadedmetadata", seek, { once: true });
    });
  }

  function dim(on: boolean): void {
    projection.classList.toggle("is-dimmed", on);
    // The bed follows the picture: gone means music, arrived means speech.
    if (on) score?.swell();
    else score?.under();
  }

  // The topic (left title) is the constant of the page; the speaker (right
  // title) changes with every cut — the "change of slide".
  function setTitles(item: Item): void {
    if (titleR) titleR.textContent = item.name;
    if (nowSpeaker) nowSpeaker.textContent = `${item.name} — ${item.jobtitle}`;
  }

  async function playItem(i: number, viaGesture = false): Promise<void> {
    const t0 = performance.now();
    current = i;
    const item = items[i];
    const standby = els[1 - active];
    const el = singleMode ? els[0] : standby;

    if (!singleMode && !viaGesture) {
      // standby should already be parked on item.start
    } else {
      await attach(el, item.hls, item.start);
      if (el.readyState >= 1) el.currentTime = item.start;
      else el.addEventListener("loadedmetadata", () => (el.currentTime = item.start), { once: true });
    }

    try {
      await el.play();
    } catch (e) {
      // A broken stream must not silence the whole topic: skip the turn.
      const dead = el.error || (e instanceof DOMException && e.name === "NotSupportedError");
      if (dead) {
        skipped++;
        report(`stream unreachable, skipping ${item.slug} (${skipped}/${items.length})`);
        if (skipped < items.length && i + 1 < items.length) return playItem(i + 1, viaGesture);
        dim(false);
        return;
      }
      if (!singleMode && !viaGesture) {
        singleMode = true;   // iOS refused the second element: degrade
        active = 0;
        els[0].classList.add("is-front");
        els[1].classList.remove("is-front");
        report("fallback: single-element mode");
        return playItem(i, true);
      }
      // Gesture allowance ran out (e.g. after skipping dead streams):
      // re-arm so the next tap starts right here.
      pendingStart = i;
      current = -1;
      projection.classList.remove("is-playing");
      dim(false);
      report("tap to start");
      return;
    }

    if (!singleMode) {
      const old = els[active];
      old.pause();
      active = 1 - active;
      els[active].classList.add("is-front");
      old.classList.remove("is-front");
    }
    setTitles(item);
    const undim = () => {
      dim(false);
      const gap = performance.now() - t0;
      if (started) { gaps.push(gap); report(`cut #${gaps.length} → ${item.slug}: ${gap.toFixed(0)}ms`); }
    };
    if (el.readyState >= 3) undim();
    else el.addEventListener("playing", undim, { once: true });

    started = true;
    projection.classList.add("is-playing");
    // park the *other* element on the next item
    if (!singleMode && items[i + 1]) park(els[1 - active], items[i + 1]);
  }

  function advance(): void {
    if (advancing) return;
    advancing = true;
    dim(true);
    const next = current + 1;
    if (next >= items.length) {
      els[active].pause();
      projection.classList.remove("is-playing");
      dim(false);
      score?.out();
      report(`end of cross-cut. mean gap ${gaps.length ? (gaps.reduce((a, b) => a + b) / gaps.length).toFixed(0) : "—"}ms over ${gaps.length} cuts`);
      current = -1;
      advancing = false;
      return;
    }
    void playItem(next).finally(() => (advancing = false));
  }

  // --- boundary watch + playhead ------------------------------------------
  setInterval(() => {
    if (current < 0) return;
    const el = els[active];
    const item = items[current];
    if (!el.paused && el.currentTime >= item.end - 0.12) advance();
    const pos = offsets[current] + Math.min(Math.max(el.currentTime - item.start, 0), item.end - item.start);
    if (playhead) playhead.style.left = `${(pos / total) * 100}%`;
    if (nowIndex) nowIndex.textContent = `${current + 1} / ${items.length}`;
    markSpeaker();
    if (nowCard) {
      const card = [...item.cards].reverse().find((c) => c.time <= el.currentTime);
      const title = card?.title ?? "";
      if (nowCard.dataset.title !== title) {
        if (pinned) return;   // leave a pinned reference alone
        nowCard.dataset.title = title;
        nowCard.textContent = "";
        if (title) {
          // A name raised in passing is a door: open it without losing the film.
          const b = document.createElement("button");
          b.className = "nowline__cardlink";
          b.textContent = title;
          b.addEventListener("pointerenter", () => openCard(title));
          b.addEventListener("pointerleave", closeSoon);
          b.addEventListener("click", () => openCard(title, true));
          b.addEventListener("focus", () => openCard(title));
          nowCard.appendChild(b);
        }
      }
    }
    paintBloom();
  }, 120);

  // --- reference cards -------------------------------------------------------
  // A reference opens on hover and the film keeps running — reading about
  // Price's Candles should not cost you the sentence that mentioned them.
  // Clicking pins it, for touch and for anyone who wants to follow a link.
  const panel = root.querySelector<HTMLElement>(".cardpanel");
  let pinned = false;
  let closeTimer: number | undefined;

  function openCard(title: string, pin = false): void {
    const card = data.cards[title];
    if (!panel || !card) return;
    clearTimeout(closeTimer);
    if (pin) pinned = true;
    panel.querySelector<HTMLElement>(".cardpanel__title")!.textContent = title;
    panel.querySelector<HTMLElement>(".cardpanel__body")!.innerHTML = card.body;
    panel.querySelector<HTMLAnchorElement>(".cardpanel__more")!.href =
      `${data.base}/card/${card.slug}/`;
    panel.hidden = false;
    panel.classList.toggle("is-pinned", pinned);
  }

  function closeCard(force = false): void {
    if (!panel || panel.hidden) return;
    if (pinned && !force) return;
    panel.hidden = true;
    pinned = false;
    panel.classList.remove("is-pinned");
  }

  // a moment's grace, so the pointer can travel from the name into the panel
  function closeSoon(): void {
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => closeCard(), 320);
  }

  panel?.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  panel?.addEventListener("pointerleave", closeSoon);
  panel?.querySelector<HTMLButtonElement>(".cardpanel__close")
    ?.addEventListener("click", () => closeCard(true));
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(true); });

  // --- the bed -------------------------------------------------------------
  // Music the tool steers: up while a film is being fetched, under while
  // somebody talks. Nothing is baked into the video.
  const score = makeScore(data.music?.tracks ?? [], data.music?.seed ?? 0);
  const scoreBtn = root.querySelector<HTMLButtonElement>(".controls__score");
  if (debug) (window as unknown as { cpmbScore: unknown }).cpmbScore = score;
  if (score && scoreBtn) {
    scoreBtn.hidden = false;
    const paint = (on: boolean) => {
      scoreBtn.setAttribute("aria-pressed", String(on));
      scoreBtn.classList.toggle("is-off", !on);
      scoreBtn.title = on ? "music bed on — click to silence it" : "music bed off — click to bring it back";
    };
    paint(score.wanted);
    scoreBtn.addEventListener("click", () => paint(score.toggle()));
  }

  // --- bloom ---------------------------------------------------------------
  const bloomer = makeBloom(bloom);
  function paintBloom(): void {
    if (reducedMotion && !els[active].paused) return;
    bloomer.paint(els[active]);
  }

  // A stall is a gap like any other: the bed covers it, the way a cut is
  // covered, so waiting sounds like part of the film rather than a fault.
  for (const el of els) {
    el.addEventListener("waiting", () => { if (el === els[active]) score?.swell(); });
    el.addEventListener("playing", () => { if (el === els[active]) score?.under(); });
    el.addEventListener("pause", () => { if (el === els[active] && !advancing) score?.swell(); });
  }

  // --- input ---------------------------------------------------------------
  projection.querySelector(".projection__frame")?.addEventListener("click", () => {
    // While the film is silent, the frame means one thing only: turn the sound
    // on. It must not also pause — clicking for sound and getting a stopped
    // picture reads as a broken page.
    if (projection.classList.contains("is-muted")) { unmute(); return; }
    if (current < 0) {
      // first gesture: unlock the element that will stay standby; the other
      // one gets its play() directly from this gesture inside playItem.
      const idle = els[active];
      const p = idle.play();
      void p?.then(() => idle.pause()).catch(() => {});
      void playItem(pendingStart, true);
    } else if (els[active].paused) {
      void els[active].play();
      projection.classList.add("is-playing");
    } else {
      els[active].pause();
      projection.classList.remove("is-playing");
    }
  });

  scrub?.addEventListener("click", (e) => {
    const r = scrub.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * total;
    const i = Math.max(0, offsets.findLastIndex((o) => o <= t));
    dim(true);
    const el = () => els[singleMode ? 0 : active];
    if (i === current) {
      el().currentTime = items[i].start + (t - offsets[i]);
      dim(false);
    } else {
      void playItem(i, true);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest("button, a, input")) return;
    if (e.code === "Space") {
      e.preventDefault();
      projection.querySelector<HTMLElement>(".projection__frame")?.click();
    }
  });

  function report(msg: string): void {
    console.log(`[crosscut] ${msg}`);
    if (debug) debug.textContent = msg;
  }

  // Park the first two films so the opening tap is instant. playItem starts
  // on the *standby* element (els[1] while active=0), so the first item is
  // parked there and the second on els[0].
  park(els[1], items[0]);
  if (items[1]) park(els[0], items[1]);
  setTitles(items[0]);

  // Start on arrival. Browsers only allow unprompted sound when they judge the
  // visitor to be engaged, so: try with sound, fall back to silent rather than
  // to nothing, and let any click or key bring the sound up.
  async function autostart(): Promise<void> {
    try {
      await playItem(0, true);
      if (!els[active].paused) { score?.allow(); return; }
    } catch { /* fall through to muted */ }
    for (const el of els) el.muted = true;
    projection.classList.add("is-muted");
    try {
      await playItem(0, true);
      report("started muted — click for sound");
    } catch {
      pendingStart = 0;
      current = -1;
      report("tap to start");
    }
  }

  const soundBtn = root.querySelector<HTMLButtonElement>(".controls__sound");
  function paintSound(): void {
    if (!soundBtn) return;
    const off = projection.classList.contains("is-muted");
    soundBtn.setAttribute("aria-pressed", String(!off));
    soundBtn.classList.toggle("is-off", off);
    soundBtn.title = off ? "sound is off — click to turn it on" : "sound is on — click to mute";
    soundBtn.querySelector("span[aria-hidden]")!.textContent = off ? "🔇" : "🔊";
  }
  soundBtn?.addEventListener("click", () => {
    if (projection.classList.contains("is-muted")) unmute();
    else {
      for (const el of els) el.muted = true;
      projection.classList.add("is-muted");
      paintSound();
    }
  });

  function unmute(): void {
    if (!projection.classList.contains("is-muted")) return;
    for (const el of els) el.muted = false;
    projection.classList.remove("is-muted");
    paintSound();
    score?.allow();
    // Whatever was said while the page was silent was not heard. If we are
    // still near the top of this turn, take it from the top; deeper in, leave
    // the visitor where they are rather than throwing away minutes.
    const el = els[active];
    if (current >= 0 && el.currentTime - items[current].start < 25) {
      el.currentTime = items[current].start;
    }
  }
  for (const ev of ["pointerdown", "keydown"] as const) {
    addEventListener(ev, (e) => {
      // the frame has its own handler above; let it speak for itself
      const t = e.target;
      if (t instanceof Element && t.closest(".projection__frame")) return;
      unmute();
    }, { capture: true });
  }

  // Clicking a name jumps to that person's turn on this topic.
  for (const chip of root.querySelectorAll<HTMLButtonElement>(".topic[data-speaker]")) {
    chip.addEventListener("click", () => {
      const from = current < 0 ? 0 : current;
      // the next turn of theirs after where we are, or their first
      const next = items.findIndex((it, n) => it.slug === chip.dataset.speaker && n > from);
      const i = next >= 0 ? next : items.findIndex((it) => it.slug === chip.dataset.speaker);
      if (i < 0) return;
      dim(true);
      void playItem(i, true);
    });
  }

  function markSpeaker(): void {
    const slug = current >= 0 ? items[current].slug : null;
    for (const chip of root.querySelectorAll<HTMLElement>(".topic[data-speaker]"))
      chip.classList.toggle("is-active", chip.dataset.speaker === slug);
  }

  // Warm the rest of the cross-cut. Only the playlists — a few kB each — not
  // the video: a cut starts at an in-point deep inside a film, so pulling
  // anyone's opening seconds would buy nothing and cost real bandwidth. The
  // picture itself is prepared one film ahead, by parking the standby element.
  function warmPlaylists(): void {
    const seen = new Set<string>([items[0]?.hls]);
    for (const item of items.slice(1)) {
      if (seen.has(item.hls)) continue;
      seen.add(item.hls);
      // @ts-expect-error - priority is not in every lib.dom yet
      void fetch(item.hls, { priority: "low", mode: "cors" }).catch(() => {});
    }
    report(`warmed ${seen.size - 1} further playlists`);
  }
  setTimeout(warmPlaylists, 1200);   // after the first frame is on screen

  score?.swell();
  void autostart().then(paintSound);
}
