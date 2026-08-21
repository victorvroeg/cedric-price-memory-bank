import { makeBloom } from "./bloom";
// The projection screen: one film in the void.
// Reads its data from the #cpmb-data JSON island rendered by Screen.astro.

interface ScreenData {
  source: { url: string; placeholder: boolean } | null;
  segments: { start: number; end: number; topicId: string }[];
  cards: { time: number; cardId: string }[];
  topics: Record<string, { label: string; colour: string }>;
  cardTitles: Record<string, string>;
  basis: number; // seconds represented by the scrub track at build time
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
  projection.querySelector(".projection__frame")?.addEventListener("click", togglePlay);

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
      if (el.textContent !== (topic?.label ?? "")) el.textContent = topic?.label ?? "";
      el.style.color = topic?.colour ?? "";
    }
    for (const el of root.querySelectorAll<HTMLElement>(".scrub__segment[data-topic]"))
      el.classList.toggle("is-active", !!seg && el.dataset.start === String((seg.start / data.basis) * basis));
    for (const chip of root.querySelectorAll<HTMLButtonElement>(".topic"))
      chip.classList.toggle("is-active", !!seg && chip.dataset.topic === seg.topicId);

    const card = [...data.cards].reverse().find((c) => c.time <= tArchive);
    if (nowCard) nowCard.textContent = card ? data.cardTitles[card.cardId] ?? "" : "";
  });

  layoutScrub();
}
