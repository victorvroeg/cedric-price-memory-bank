import { makeBloom } from "./bloom";
import { makeTitleCard } from "./titlecard";
// The projection screen: one film in the void.
// Reads its data from the #cpmb-data JSON island rendered by Screen.astro.

interface ScreenData {
  source: { url: string; placeholder: boolean } | null;
  segments: { start: number; end: number; topicId: string }[];
  cards: { time: number; cardId: string }[];
  topics: Record<string, { label: string; colour: string }>;
  cardTitles: Record<string, string>;
  basis: number; // seconds represented by the scrub track at build time
  base: string;
  here: string;
  topicList: { slug: string; label: string; mine: boolean }[];
  people: { slug: string; name: string }[];
}

const dataEl = document.getElementById("cpmb-data");
const root = document.querySelector<HTMLElement>(".stage");
if (dataEl && root) init(JSON.parse(dataEl.textContent!) as ScreenData, root);

function init(data: ScreenData, root: HTMLElement) {
  const projection = root.querySelector<HTMLElement>(".projection")!;
  const video = root.querySelector<HTMLVideoElement>(".projection__video");
  const bloom = root.querySelector<HTMLCanvasElement>(".projection__bloom");
  const scrub = root.querySelector<HTMLElement>(".scrub");
  const playhead = root.querySelector<HTMLElement>(".scrub__playhead");
  const nowTopic = root.querySelector<HTMLElement>(".nowline__topic");
  const titleCard = makeTitleCard(root);
  const edgeTopic = root.querySelector<HTMLElement>(".title--left");
  const barTopic = root.querySelector<HTMLElement>(".titlebar__topic");
  const nowCard = root.querySelector<HTMLElement>(".nowline__card");
  const nowTime = root.querySelector<HTMLElement>(".nowline__time");
  if (!video || !data.source) return; // wounded state: static page stands

  let basis = data.basis;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- source -------------------------------------------------------------
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = data.source.url; // Safari: native HLS
  } else {
    import("hls.js").then(({ default: Hls }) => {
      if (!Hls.isSupported()) return;
      const hls = new Hls({ maxBufferLength: 20 });
      hls.loadSource(data.source!.url);
      hls.attachMedia(video);
    });
  }

  // Placeholder footage has arbitrary length; stretch the map to fit it so
  // the demo stays coherent. Real footage keeps the archive's own basis.
  // A reference in a cross-cut can send you here, to the moment somebody says
  // it. Honour #t=seconds on arrival.
  const wanted = parseFloat((location.hash.match(/t=([\d.]+)/) ?? [])[1] ?? "");

  video.addEventListener("loadedmetadata", () => {
    if (data.source!.placeholder && isFinite(video.duration) && video.duration > 0) {
      basis = video.duration;
      layoutScrub();
    }
    if (isFinite(wanted) && wanted > 0) {
      video.currentTime = Math.min(wanted, (video.duration || basis) - 0.1);
      void video.play().catch(() => {});
    }
    paintBloom();
  });

  // --- scrub layout -------------------------------------------------------
  function layoutScrub() {
    if (!scrub) return;
    const track = scrub.querySelector<HTMLElement>(".scrub__track")!;
    track.innerHTML = "";
    let cursor = 0;
    for (const s of data.segments) {
      const scaled = { start: (s.start / data.basis) * basis, end: (s.end / data.basis) * basis };
      if (scaled.start > cursor) {
        const gap = document.createElement("span");
        gap.className = "scrub__segment scrub__segment--gap";
        gap.style.width = `${((scaled.start - cursor) / basis) * 100}%`;
        gap.style.background = "transparent";
        track.appendChild(gap);
      }
      const el = document.createElement("span");
      el.className = "scrub__segment";
      el.dataset.topic = s.topicId;
      el.dataset.start = String(scaled.start);
      el.style.width = `${((scaled.end - scaled.start) / basis) * 100}%`;
      el.style.background = data.topics[s.topicId]?.colour ?? "#666";
      el.title = data.topics[s.topicId]?.label ?? s.topicId;
      track.appendChild(el);
      cursor = scaled.end;
    }
    for (const el of scrub.querySelectorAll<HTMLElement>(".scrub__card")) el.remove();
    for (const c of data.cards) {
      const tick = document.createElement("span");
      tick.className = "scrub__card";
      tick.style.left = `${(((c.time / data.basis) * basis) / basis) * 100}%`;
      scrub.appendChild(tick);
    }
  }

  // --- ambient bloom ------------------------------------------------------
  const bloomer = makeBloom(bloom);
  const paintBloom = () => bloomer.paint(video);
  let bloomTimer: number | undefined;
  function startBloom() {
    if (reducedMotion || bloomTimer) return;
    bloomTimer = window.setInterval(paintBloom, 130);
  }
  function stopBloom() {
    clearInterval(bloomTimer);
    bloomTimer = undefined;
  }

  // --- transport ----------------------------------------------------------
  function togglePlay() {
    if (video!.paused) void video!.play();
    else video!.pause();
  }
  video.addEventListener("play", () => {
    projection.classList.add("is-playing");
    startBloom();
  });
  video.addEventListener("pause", () => {
    projection.classList.remove("is-playing");
    stopBloom();
  });
  projection.querySelector(".projection__frame")?.addEventListener("click", () => {
    // While it is silent the frame means one thing: turn the sound on.
    if (projection.classList.contains("is-muted")) { unmute(); return; }
    togglePlay();
  });

  function unmute(): void {
    if (!projection.classList.contains("is-muted")) return;
    video!.muted = false;
    projection.classList.remove("is-muted");
  }
  for (const ev of ["pointerdown", "keydown"] as const) {
    addEventListener(ev, (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest(".projection__frame")) return;
      unmute();
    }, { capture: true });
  }

  // Nobody should have to ask an archive to start. Try with sound; if the
  // browser refuses, play silent rather than not at all and say so.
  async function autostart(): Promise<void> {
    try {
      await video!.play();
      return;
    } catch { /* fall through */ }
    video!.muted = true;
    projection.classList.add("is-muted");
    try { await video!.play(); } catch { /* leave it to the visitor */ }
  }
  video.addEventListener("canplay", function once() {
    video!.removeEventListener("canplay", once);
    void autostart();
  }, { once: true });

  // Every cut passes through darkness: dim, move, undim.
  function seekTo(t: number) {
    projection.classList.add("is-dimmed");
    const done = () => {
      projection.classList.remove("is-dimmed");
      video!.removeEventListener("seeked", done);
      paintBloom();
    };
    video!.addEventListener("seeked", done);
    video!.currentTime = Math.min(Math.max(t, 0), basis - 0.1);
    if (video!.paused) void video!.play();
  }

  scrub?.addEventListener("click", (e) => {
    const r = scrub.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * basis);
  });

  // topic chips are links into the cross-cut; the scrub handles in-film seeks

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest("button, a, input")) return;
    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.code === "ArrowRight") {
      video.currentTime = Math.min(video.currentTime + 5, basis);
    } else if (e.code === "ArrowLeft") {
      video.currentTime = Math.max(video.currentTime - 5, 0);
    }
  });

  // --- now playing --------------------------------------------------------
  const fmt = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  video.addEventListener("timeupdate", () => {
    const t = video.currentTime;
    const tArchive = (t / basis) * data.basis; // back into archive time
    if (playhead) playhead.style.left = `${(t / basis) * 100}%`;
    if (nowTime) nowTime.textContent = fmt(t);

    const seg = data.segments.find((s) => tArchive >= s.start && tArchive < s.end);
    const topic = seg ? data.topics[seg.topicId] : null;
    if (nowTopic) {
      nowTopic.textContent = topic?.label ?? "";
      nowTopic.style.color = topic?.colour ?? "";
    }
    // The left edge and the title card both name whatever is being said now.
    for (const el of [edgeTopic, barTopic]) {
      if (!el) continue;
      // crossing into a new topic is a change of answer: say it again
      if (el.textContent !== (topic?.label ?? "")) {
        el.textContent = topic?.label ?? "";
        titleCard.show();
      }
      el.style.color = topic?.colour ?? "";
    }
    for (const el of root.querySelectorAll<HTMLElement>(".scrub__segment[data-topic]"))
      el.classList.toggle("is-active", !!seg && el.dataset.start === String((seg.start / data.basis) * basis));
    for (const chip of root.querySelectorAll<HTMLButtonElement>(".topic"))
      chip.classList.toggle("is-active", !!seg && chip.dataset.topic === seg.topicId);

    const card = [...data.cards].reverse().find((c) => c.time <= tArchive);
    if (nowCard) nowCard.textContent = card ? data.cardTitles[card.cardId] ?? "" : "";
  });

  // --- the same two doors the cross-cut has --------------------------------
  // Left edge opens the topics, right edge opens the people. Here you are
  // following the person, so their own topics come first and the whole
  // interviews are the way across to somebody else.
  const field = document.querySelector<HTMLElement>(".topicfield");
  const fieldRow = field?.querySelector<HTMLElement>(".topicfield__row");
  const doorT = root.querySelector<HTMLElement>(".title--left");
  const doorP = root.querySelector<HTMLButtonElement>(".peopledoor");
  let leaving: number | undefined;
  let closeTimer: number | undefined;

  function head(t: string): HTMLElement {
    const h = document.createElement("h3");
    h.className = "topicfield__head";
    h.textContent = t;
    return h;
  }
  function rows(entries: { label: string; href: string; current: boolean }[], from: number): HTMLUListElement {
    const ul = document.createElement("ul");
    ul.className = "topicfield__list";
    entries.forEach((e, n) => {
      const li = document.createElement("li");
      li.style.setProperty("--i", String(from + n));
      const a = document.createElement("a");
      a.className = e.current ? "topicfield__item is-current" : "topicfield__item";
      a.href = e.href;
      a.textContent = e.label;
      li.appendChild(a);
      ul.appendChild(li);
    });
    return ul;
  }

  function build(mode: "topics" | "people"): void {
    if (!fieldRow) return;
    fieldRow.textContent = "";
    const name = root.querySelector<HTMLElement>(".titlebar__name")?.textContent ?? "";
    if (mode === "topics") {
      const mine = data.topicList.filter((t) => t.mine);
      const rest = data.topicList.filter((t) => !t.mine);
      fieldRow.appendChild(head(`${name} on`));
      fieldRow.appendChild(rows(mine.map((t) => ({ label: t.label, href: `${data.base}/topic/${t.slug}/`, current: false })), 0));
      fieldRow.appendChild(head("others on"));
      fieldRow.appendChild(rows(rest.map((t) => ({ label: t.label, href: `${data.base}/topic/${t.slug}/`, current: false })), mine.length));
    } else {
      fieldRow.appendChild(head("whole interviews"));
      fieldRow.appendChild(rows(data.people.map((p) => ({
        label: p.name, href: `${data.base}/interview/${p.slug}/`, current: p.slug === data.here,
      })), 0));
    }
  }

  function open(mode: "topics" | "people"): void {
    if (!field) return;
    build(mode);
    clearTimeout(leaving);
    clearTimeout(closeTimer);
    field.classList.remove("is-leaving");
    field.hidden = false;
    projection.classList.add("is-recessed");
    root.classList.add("is-fielded");
  }
  function close(): void {
    if (!field || field.hidden) return;
    projection.classList.remove("is-recessed");
    root.classList.remove("is-fielded");
    field.classList.add("is-leaving");
    clearTimeout(leaving);
    leaving = window.setTimeout(() => {
      field.hidden = true;
      field.classList.remove("is-leaving");
    }, 300);
  }
  const closeSoon = () => {
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, 360);
  };

  for (const [el, mode] of [[doorT, "topics"], [doorP, "people"]] as const) {
    el?.addEventListener("pointerenter", () => open(mode));
    el?.addEventListener("pointerleave", closeSoon);
    el?.addEventListener("click", () => open(mode));
  }
  field?.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  field?.addEventListener("pointerleave", closeSoon);
  field?.querySelector(".topicfield__close")?.addEventListener("click", close);
  field?.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".topicfield__item")) close();
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  layoutScrub();
}
