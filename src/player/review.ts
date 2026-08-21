// The review tool: correct a drafted topic map and approve it.
// Local only — see src/pages/review/[slug].astro.

interface Seg { start: number; end: number; topicId: string }
interface Data {
  slug: string; duration: number; hls: string | null;
  jobtitle: string; recorded: string;
  segments: Seg[]; cards: { time: number; cardId: string }[];
  cues: { start: number; end: number; text: string }[];
  topics: { id: string; label: string; colour: string }[];
  cardTitles: Record<string, string>;
}

// The archive is 25 fps throughout — the 2014 masters were cut in PAL and the
// recovered topic map is SMPTE 25. Segment boundaries are stored in seconds but
// edited as timecode, and always land on a frame.
const FPS = 25;
const snap = (t: number) => Math.round(t * FPS) / FPS;

function toTC(t: number): string {
  const f = Math.round(Math.max(0, t) * FPS);
  const h = Math.floor(f / (3600 * FPS));
  const m = Math.floor((f % (3600 * FPS)) / (60 * FPS));
  const sec = Math.floor((f % (60 * FPS)) / FPS);
  const fr = f % FPS;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}:${pad(fr)}`;
}

/** Accepts HH:MM:SS:FF, MM:SS:FF, SS:FF, or plain seconds. */
function fromTC(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return snap(parseFloat(t));
  const parts = t.split(":").map((x) => parseInt(x, 10));
  if (parts.some(isNaN)) return null;
  const fr = parts.pop()!;
  const sec = parts.pop() ?? 0;
  const min = parts.pop() ?? 0;
  const hr = parts.pop() ?? 0;
  if (fr >= FPS) return null;
  return snap(hr * 3600 + min * 60 + sec + fr / FPS);
}

const el = document.getElementById("review-data");
if (el) start(JSON.parse(el.textContent!) as Data);

function start(d: Data) {
  const video = document.querySelector<HTMLVideoElement>(".review__video")!;
  const timeline = document.getElementById("timeline")!;
  const list = document.getElementById("segments")!;
  const cueBox = document.getElementById("cues")!;
  const clock = document.getElementById("clock")!;
  const status = document.getElementById("status")!;
  const colour = (id: string) => d.topics.find((t) => t.id === id)?.colour ?? "#666";
  const label = (id: string) => d.topics.find((t) => t.id === id)?.label ?? id;
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  let segs: Seg[] = d.segments.map((s) => ({ ...s }));
  const cues = d.cues.map((c) => ({ ...c }));
  let dirty = false;
  let transcriptCorrected = d.corrected;
  const jobtitleEl = document.getElementById("jobtitle") as HTMLInputElement;
  const recordedEl = document.getElementById("recorded") as HTMLInputElement;
  const savedEl = document.getElementById("saved")!;

  // Work in progress is kept in this browser, so closing the tab loses
  // nothing. It is not the archive: that is what Approve does.
  const KEY = `cpmb-review:${d.slug}`;
  let saveTimer: number | undefined;

  function saveLocal() {
    localStorage.setItem(KEY, JSON.stringify({
      at: new Date().toISOString(),
      segments: segs,
      cues,
      jobtitle: jobtitleEl?.value ?? "",
      recorded: recordedEl?.value ?? "",
    }));
    savedEl.textContent = `saved in this browser · ${new Date().toLocaleTimeString()}`;
  }

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveLocal, 600);
  }

  const markDirty = () => {
    status.textContent = dirty ? "unsaved changes" : "";
    if (dirty) queueSave();
  };

  if (d.hls) {
    if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = d.hls;
    else import("hls.js").then(({ default: Hls }) => {
      if (!Hls.isSupported()) return;
      const h = new Hls(); h.loadSource(d.hls!); h.attachMedia(video);
    });
  }

  function sort() { segs.sort((a, b) => a.start - b.start); }

  function drawTimeline() {
    timeline.innerHTML = "";
    for (const [i, s] of segs.entries()) {
      const bar = document.createElement("div");
      bar.className = "tl__seg";
      bar.style.left = `${(s.start / d.duration) * 100}%`;
      bar.style.width = `${((s.end - s.start) / d.duration) * 100}%`;
      bar.style.background = colour(s.topicId);
      bar.title = `${label(s.topicId)} — ${fmt(s.start)}–${fmt(s.end)}`;
      bar.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("tl__grip")) return;
        video.currentTime = s.start; void video.play();
      });
      for (const side of ["start", "end"] as const) {
        const grip = document.createElement("span");
        grip.className = `tl__grip tl__grip--${side}`;
        grip.addEventListener("pointerdown", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const move = (m: PointerEvent) => {
            const r = timeline.getBoundingClientRect();
            const t = Math.max(0, Math.min(((m.clientX - r.left) / r.width) * d.duration, d.duration));
            if (side === "start" && t < s.end - 1 / FPS) s.start = snap(t);
            if (side === "end" && t > s.start + 1 / FPS) s.end = snap(t);
            dirty = true; render();
          };
          const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
          addEventListener("pointermove", move); addEventListener("pointerup", up);
        });
        bar.appendChild(grip);
      }
      timeline.appendChild(bar);
      void i;
    }
    const head = document.createElement("div");
    head.className = "tl__head"; head.id = "tl-head";
    timeline.appendChild(head);
  }

  function drawList() {
    list.innerHTML = "";
    for (const [i, s] of segs.entries()) {
      const li = document.createElement("li");
      li.className = "seg";
      const tcHelp = "timecode hh:mm:ss:ff — ↑↓ steps one frame, shift ↑↓ one second";
      li.innerHTML = `
        <button class="seg__play" title="play">▸</button>
        <select class="seg__topic">${d.topics.map((t) =>
          `<option value="${t.id}"${t.id === s.topicId ? " selected" : ""}>${t.label}</option>`).join("")}</select>
        <input class="seg__tc" value="${toTC(s.start)}" title="in — ${tcHelp}" spellcheck="false">
        <button class="seg__grab" data-side="start" title="set in from playhead">⌾</button>
        <input class="seg__tc" value="${toTC(s.end)}" title="out — ${tcHelp}" spellcheck="false">
        <button class="seg__grab" data-side="end" title="set out from playhead">⌾</button>
        <span class="seg__len dim">${toTC(s.end - s.start).slice(3)}</span>
        <button class="seg__del" title="delete">×</button>`;
      li.style.borderLeftColor = colour(s.topicId);
      const [play] = li.getElementsByClassName("seg__play") as HTMLCollectionOf<HTMLButtonElement>;
      play.onclick = () => { video.currentTime = s.start; void video.play(); };
      const sel = li.querySelector<HTMLSelectElement>(".seg__topic")!;
      sel.onchange = () => { s.topicId = sel.value; dirty = true; render(); };
      const [a, b] = li.querySelectorAll<HTMLInputElement>(".seg__tc");
      const bind = (input: HTMLInputElement, side: "start" | "end") => {
        const commit = (t: number) => {
          if (side === "start" && t < s.end - 1 / FPS) s.start = t;
          else if (side === "end" && t > s.start + 1 / FPS) s.end = t;
          dirty = true; sort(); render();
        };
        input.onchange = () => {
          const t = fromTC(input.value);
          if (t === null) { input.value = toTC(s[side]); return; }
          commit(t);
        };
        input.onkeydown = (ev) => {
          if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
          ev.preventDefault();
          const step = (ev.shiftKey ? 1 : 1 / FPS) * (ev.key === "ArrowUp" ? 1 : -1);
          const t = snap(Math.max(0, (fromTC(input.value) ?? s[side]) + step));
          input.value = toTC(t);
          commit(t);
          // keep the eye on the frame you are trimming to
          video.currentTime = t;
        };
      };
      bind(a, "start"); bind(b, "end");
      for (const g of li.querySelectorAll<HTMLButtonElement>(".seg__grab")) {
        g.onclick = () => {
          const t = snap(video.currentTime);
          const side = g.dataset.side as "start" | "end";
          if (side === "start" && t < s.end - 1 / FPS) s.start = t;
          if (side === "end" && t > s.start + 1 / FPS) s.end = t;
          dirty = true; sort(); render();
        };
      }
      li.querySelector<HTMLButtonElement>(".seg__del")!.onclick = () => {
        segs.splice(i, 1); dirty = true; render();
      };
      list.appendChild(li);
    }
  }

  function drawCues() {
    cueBox.innerHTML = "";
    for (const c of cues) {
      const p = document.createElement("p");
      p.className = "cue";
      p.dataset.start = String(c.start);

      const t = document.createElement("button");
      t.className = "cue__t";
      t.textContent = fmt(c.start);
      t.title = "play from here";
      t.onclick = () => { video.currentTime = c.start; void video.play(); };

      const text = document.createElement("span");
      text.className = "cue__text";
      text.contentEditable = "true";
      text.spellcheck = true;
      text.textContent = c.text;
      // Whisper mangles exactly the proper nouns this archive is about, so the
      // transcript is meant to be corrected here, by ear, against the film.
      text.addEventListener("input", () => {
        c.text = text.textContent ?? "";
        dirty = true;
        markDirty();
      });
      text.addEventListener("focus", () => { video.currentTime = c.start; });

      p.append(t, text);
      cueBox.appendChild(p);
    }
  }

  // find and replace across the whole transcript — one pass fixes a name that
  // Whisper got wrong every time it occurs.
  function replaceAll(from: string, to: string): number {
    if (!from) return 0;
    // Whole words only: replacing "Duckland" with "Ducklands" must not turn an
    // already-correct "Ducklands" into "Ducklandss".
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bounded = /^[\w\s'-]+$/.test(from) ? `\\b${esc}\\b` : esc;
    const rx = new RegExp(bounded, "gi");
    let n = 0;
    for (const c of cues) {
      const before = c.text;
      c.text = c.text.replace(rx, to);
      if (c.text !== before) n += (before.match(rx) || []).length;
    }
    if (n) { dirty = true; drawCues(); markDirty(); }
    return n;
  }

  function render() { sort(); drawTimeline(); drawList(); status.textContent = dirty ? "unsaved changes" : ""; }

  video.addEventListener("timeupdate", () => {
    const t = video.currentTime;
    clock.textContent = toTC(t);
    const head = document.getElementById("tl-head");
    if (head) head.style.left = `${(t / d.duration) * 100}%`;
    let current: HTMLElement | null = null;
    for (const p of cueBox.children as HTMLCollectionOf<HTMLElement>) {
      if (p.querySelector(".cue__text")=== document.activeElement) continue;
      const on = parseFloat(p.dataset.start!) <= t;
      p.classList.toggle("is-past", on);
      if (on) current = p;
    }
    if (current && !current.classList.contains("is-current")) {
      for (const p of cueBox.querySelectorAll(".is-current")) p.classList.remove("is-current");
      current.classList.add("is-current");
      current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  });

  document.getElementById("add")!.onclick = () => {
    const t = snap(video.currentTime);
    segs.push({ start: t, end: snap(Math.min(t + 60, d.duration)), topicId: d.topics[0].id });
    dirty = true; render();
  };

  function segmentsOnly() {
    return segs.map((s) => ({
      start: Math.round(snap(s.start) * 1000) / 1000,
      end: Math.round(snap(s.end) * 1000) / 1000,
      topicId: s.topicId,
    }));
  }

  function payload() {
    const out: Record<string, unknown> = {
      slug: d.slug,
      interviewee: { jobtitle: jobtitleEl?.value.trim() ?? d.jobtitle },
      recorded: recordedEl?.value.trim() ?? d.recorded,
      segments: segmentsOnly(),
    };
    if (cues.length) {
      out.transcript = {
        corrected: transcriptCorrected,
        cues: cues.map((c) => ({ start: c.start, end: c.end, text: c.text.trim() })),
      };
    }
    return JSON.stringify(out, null, 1);
  }

  // Approval travels back through GitHub's own editor: the corrected map is
  // pre-filled into a new file, the reviewer signs in as themselves and clicks
  // "Propose changes". No token of ours, no server, nothing to expire.
  const REPO = "victorvroeg/cedric-price-memory-bank";
  document.getElementById("propose")!.onclick = () => {
    const body = payload();
    transcriptCorrected = cues.length > 0;
    // A corrected transcript is far too long for a URL, so hand the reviewer
    // the file and GitHub's own drag-and-drop upload page instead. Still no
    // code, still no service of ours.
    if (body.length > 6000) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([body], { type: "application/json" }));
      a.download = `${d.slug}.json`;
      a.click();
      window.open(`https://github.com/${REPO}/upload/main/ingest/approved`, "_blank", "noopener");
      dirty = false;
      saveLocal();
      status.textContent = `downloaded ${d.slug}.json — drop it on the GitHub page that just opened, then “Propose changes”`;
      return;
    }
    const url = `https://github.com/${REPO}/new/main` +
      `?filename=ingest/approved/${d.slug}.json` +
      `&value=${encodeURIComponent(body)}` +
      `&message=${encodeURIComponent(`Approve topic map: ${d.slug}`)}` +
      `&description=${encodeURIComponent(
        `${segs.length} segments approved in the review tool.\n\n` +
        `Apply with: python3 tools/draft_segments.py --apply ${d.slug} ingest/approved/${d.slug}.json`)}`;
    window.open(url, "_blank", "noopener");
    dirty = false;
    status.textContent = "opened GitHub — sign in and click “Propose changes”";
  };

  document.getElementById("export")!.onclick = async () => {
    await navigator.clipboard.writeText(payload());
    dirty = false;
    status.textContent = `copied ${segs.length} segments — apply with: python3 tools/draft_segments.py --apply ${d.slug} <file>`;
  };

  document.getElementById("download")!.onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([payload()], { type: "application/json" }));
    a.download = `${d.slug}-segments.json`;
    a.click();
    dirty = false;
    status.textContent = "downloaded";
  };

  addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

  // restore anything left from a previous sitting
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const prev = JSON.parse(raw);
      if (Array.isArray(prev.segments) && prev.segments.length) {
        segs = prev.segments;
        if (Array.isArray(prev.cues) && prev.cues.length === cues.length) {
          prev.cues.forEach((c: { text: string }, i: number) => (cues[i].text = c.text));
        }
        if (prev.jobtitle && jobtitleEl) jobtitleEl.value = prev.jobtitle;
        if (prev.recorded && recordedEl) recordedEl.value = prev.recorded;
        dirty = true;
        savedEl.textContent = `restored your unsent changes from ${new Date(prev.at).toLocaleString()}`;
      }
    }
  } catch { /* a corrupt save must never block the tool */ }

  for (const input of [jobtitleEl, recordedEl]) {
    input?.addEventListener("input", () => { dirty = true; markDirty(); });
  }

  document.getElementById("revert")!.onclick = () => {
    if (!confirm("Discard your changes and go back to what the memory bank holds?")) return;
    localStorage.removeItem(KEY);
    location.reload();
  };

  document.getElementById("doreplace")!.onclick = () => {
    const from = (document.getElementById("find") as HTMLInputElement).value.trim();
    const to = (document.getElementById("repl") as HTMLInputElement).value;
    const n = replaceAll(from, to);
    document.getElementById("findstatus")!.textContent =
      n ? `replaced ${n}` : from ? "no matches" : "";
  };

  drawCues();
  render();
}
