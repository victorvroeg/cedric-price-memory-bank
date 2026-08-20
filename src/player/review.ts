// The review tool: correct a drafted topic map and approve it.
// Local only — see src/pages/review/[slug].astro.

interface Seg { start: number; end: number; topicId: string }
interface Data {
  slug: string; duration: number; hls: string | null;
  segments: Seg[]; cards: { time: number; cardId: string }[];
  cues: { start: number; end: number; text: string }[];
  topics: { id: string; label: string; colour: string }[];
  cardTitles: Record<string, string>;
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
  let dirty = false;

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
            if (side === "start" && t < s.end - 1) s.start = Math.round(t * 10) / 10;
            if (side === "end" && t > s.start + 1) s.end = Math.round(t * 10) / 10;
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
      li.innerHTML = `
        <button class="seg__play" title="play">▸</button>
        <select class="seg__topic">${d.topics.map((t) =>
          `<option value="${t.id}"${t.id === s.topicId ? " selected" : ""}>${t.label}</option>`).join("")}</select>
        <input class="seg__t" type="number" step="0.1" value="${s.start.toFixed(1)}" title="start">
        <input class="seg__t" type="number" step="0.1" value="${s.end.toFixed(1)}" title="end">
        <span class="seg__len dim">${Math.round(s.end - s.start)}s</span>
        <button class="seg__del" title="delete">×</button>`;
      li.style.borderLeftColor = colour(s.topicId);
      const [play] = li.getElementsByClassName("seg__play") as HTMLCollectionOf<HTMLButtonElement>;
      play.onclick = () => { video.currentTime = s.start; void video.play(); };
      const sel = li.querySelector<HTMLSelectElement>(".seg__topic")!;
      sel.onchange = () => { s.topicId = sel.value; dirty = true; render(); };
      const [a, b] = li.querySelectorAll<HTMLInputElement>(".seg__t");
      a.onchange = () => { s.start = parseFloat(a.value); dirty = true; sort(); render(); };
      b.onchange = () => { s.end = parseFloat(b.value); dirty = true; sort(); render(); };
      li.querySelector<HTMLButtonElement>(".seg__del")!.onclick = () => {
        segs.splice(i, 1); dirty = true; render();
      };
      list.appendChild(li);
    }
  }

  function drawCues() {
    cueBox.innerHTML = "";
    for (const c of d.cues) {
      const p = document.createElement("p");
      p.className = "cue";
      p.dataset.start = String(c.start);
      p.innerHTML = `<span class="cue__t dim">${fmt(c.start)}</span> ${c.text}`;
      p.onclick = () => { video.currentTime = c.start; void video.play(); };
      cueBox.appendChild(p);
    }
  }

  function render() { sort(); drawTimeline(); drawList(); status.textContent = dirty ? "unsaved changes" : ""; }

  video.addEventListener("timeupdate", () => {
    const t = video.currentTime;
    clock.textContent = fmt(t);
    const head = document.getElementById("tl-head");
    if (head) head.style.left = `${(t / d.duration) * 100}%`;
    let current: HTMLElement | null = null;
    for (const p of cueBox.children as HTMLCollectionOf<HTMLElement>) {
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
    const t = Math.round(video.currentTime * 10) / 10;
    segs.push({ start: t, end: Math.min(t + 60, d.duration), topicId: d.topics[0].id });
    dirty = true; render();
  };

  function payload() {
    return JSON.stringify(segs.map((s) => ({
      start: Math.round(s.start * 100) / 100,
      end: Math.round(s.end * 100) / 100,
      topicId: s.topicId,
    })), null, 1);
  }

  // Approval travels back through GitHub's own editor: the corrected map is
  // pre-filled into a new file, the reviewer signs in as themselves and clicks
  // "Propose changes". No token of ours, no server, nothing to expire.
  const REPO = "victorvroeg/cedric-price-memory-bank";
  document.getElementById("propose")!.onclick = () => {
    const body = payload();
    if (body.length > 7000) {
      status.textContent = "too large to send this way — use Download file instead";
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

  drawCues();
  render();
}
