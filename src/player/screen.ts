import { makeBloom } from "./bloom";
import { makeTitleCard } from "./titlecard";
import { makeMode } from "./mode";
// The projection screen: one film in the void.
// Reads its data from the #cpmb-data JSON island rendered by Screen.astro.

interface ScreenData {
  source: { url: string; placeholder: boolean } | null;
  segments: { start: number; end: number; topicId: string }[];
  cards: { time: number; cardId: string }[];
  topics: Record<string, { label: string; colour: string }>;
  cardTitles: Record<string, string>;
  cardData: Record<string, {
    slug: string;
    body: string;
    subtitle: string | null;
    image: string | null;
    external: string | null;
    location: string | null;
    also: { slug: string; name: string; time: number; topicId: string | null; topicLabel: string | null }[];
  }>;
  basis: number; // seconds represented by the scrub track at build time
  base: string;
  here: string;
  speakerName: string;
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
  const titleCard = makeTitleCard(root);
  const edgeTopic = root.querySelector<HTMLElement>(".title--left");
  const barTopic = root.querySelector<HTMLElement>(".titlebar__topic");
  const nowCard = root.querySelector<HTMLElement>(".nowline__card");
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
    // Every reference this film raises, standing where it is raised, and
    // clickable: ahead of the playhead something coming, behind it something
    // already said.
    for (const el of scrub.querySelectorAll<HTMLElement>(".scrub__card")) el.remove();
    for (const c of data.cards) {
      const title = data.cardTitles[c.cardId] ?? c.cardId;
      const at = (c.time / data.basis) * basis;
      const tick = document.createElement("button");
      tick.className = "scrub__card";
      tick.style.left = `${(at / basis) * 100}%`;
      tick.title = title;
      tick.setAttribute("aria-label", title);
      tick.dataset.at = String(at);
      tick.addEventListener("click", (e) => {
        e.stopPropagation();
        seekTo(Math.max(at - 4, 0));
      });
      wireCard(tick, title);
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
  video.addEventListener("timeupdate", () => {
    const t = video.currentTime;
    const tArchive = (t / basis) * data.basis; // back into archive time
    if (playhead) playhead.style.left = `${(t / basis) * 100}%`;

    const seg = data.segments.find((s) => tArchive >= s.start && tArchive < s.end);
    const topic = seg ? data.topics[seg.topicId] : null;
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
    for (const el of root.querySelectorAll<HTMLElement>(".scrub__card"))
      el.classList.toggle("is-past", Number(el.dataset.at ?? 0) < t - 0.2);
    for (const el of root.querySelectorAll<HTMLElement>(".scrub__segment[data-topic]"))
      el.classList.toggle("is-active", !!seg && el.dataset.start === String((seg.start / data.basis) * basis));
    for (const chip of root.querySelectorAll<HTMLButtonElement>(".topic"))
      chip.classList.toggle("is-active", !!seg && chip.dataset.topic === seg.topicId);

    const card = [...data.cards].reverse().find((c) => c.time <= tArchive);
    const title = card ? data.cardTitles[card.cardId] ?? "" : "";
    if (nowCard && nowCard.dataset.title !== title) {
      if (pinned) return;
      nowCard.dataset.title = title;
      nowCard.textContent = "";
      if (title) {
        const b = document.createElement("button");
        b.className = "nowline__cardlink";
        b.textContent = title;
        wireCard(b, title);
        nowCard.appendChild(b);
      }
    }
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

  // On this page the speaker is fixed and the themes change under them. The
  // theme reported is whatever the playhead is inside right now.
  let liveTopic = data.segments[0]?.topicId ?? "";
  video.addEventListener("timeupdate", () => {
    const tArchive = (video.currentTime / basis) * data.basis;
    const seg = data.segments.find((x) => tArchive >= x.start && tArchive < x.end);
    if (seg && seg.topicId !== liveTopic) {
      liveTopic = seg.topicId;
      mode.update();
    }
  });

  const mode = makeMode(root, {
    kind: "speaker",
    base: data.base,
    get theme() {
      const t = data.topics[liveTopic];
      return { slug: liveTopic, label: t?.label ?? "", colour: t?.colour ?? "#fff" };
    },
    speaker: { slug: data.here, name: data.speakerName },
    at: () => video!.currentTime,
  });

  // A theme chip moves the playhead, it does not change what you are
  // following. Crossing to the theme's cross-cut is what the switch is for.
  // Clicked again it finds that theme's next passage, so a speaker who
  // returns to something three times can be followed through all three.
  for (const chip of root.querySelectorAll<HTMLButtonElement>(".topic[data-topic]")) {
    chip.addEventListener("click", () => {
      const id = chip.dataset.topic;
      const runs = data.segments
        .filter((x) => x.topicId === id)
        .sort((a, b) => a.start - b.start);
      if (!runs.length) return;
      const now = (video!.currentTime / basis) * data.basis;
      const next = runs.find((r) => r.start > now + 0.5) ?? runs[0];
      seekTo((next.start / data.basis) * basis);
    });
  }

  // --- references ----------------------------------------------------------
  // Same behaviour as the cross-cut: hovering a name shows enough to decide,
  // asking for the whole thing holds the film until you close it.
  const panel = document.querySelector<HTMLElement>(".cardpanel");
  const sheet = document.querySelector<HTMLElement>(".reference");
  let pinned = false;
  let held = false;
  let panelTimer: number | undefined;
  const clock = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  function openCard(title: string, pin = false): void {
    const card = data.cardData?.[title];
    if (!panel || !card) return;
    clearTimeout(panelTimer);
    if (pin) pinned = true;
    panel.dataset.card = title;
    panel.querySelector<HTMLElement>(".cardpanel__title")!.textContent = title;
    panel.querySelector<HTMLElement>(".cardpanel__body")!.innerHTML = card.body;

    const also = panel.querySelector<HTMLElement>(".cardpanel__also")!;
    also.textContent = "";
    const others = card.also.filter(
      (a) => !(a.slug === data.here && Math.abs(a.time - (video!.currentTime / basis) * data.basis) < 30),
    );
    if (others.length) {
      const lead = document.createElement("p");
      lead.className = "cardpanel__alsolead";
      lead.textContent = others.length === 1 ? "also raised by" : `also raised by ${others.length} others`;
      also.appendChild(lead);
      for (const a of others.slice(0, 6)) {
        const mine = a.slug === data.here;
        const node = document.createElement(mine ? "button" : "a");
        node.className = mine ? "cardpanel__jump" : "cardpanel__jump cardpanel__jump--away";
        const mk = (cls: string, text: string) => {
          const n = document.createElement("span");
          n.className = cls;
          n.textContent = text;
          return n;
        };
        node.append(mk("cardpanel__who", a.name));
        if (a.topicLabel) node.append(mk("cardpanel__topic", a.topicLabel));
        node.append(mk("cardpanel__at", clock(a.time)));
        if (mine) {
          node.addEventListener("click", () => {
            closeCard(true);
            seekTo(((a.time - 4) / data.basis) * basis);
          });
        } else {
          (node as HTMLAnchorElement).href =
            `${data.base}/interview/${a.slug}/#t=${a.time.toFixed(1)}`;
        }
        also.appendChild(node);
      }
      if (others.length > 6) {
        const rest = document.createElement("a");
        rest.className = "cardpanel__jump cardpanel__rest";
        rest.textContent = `and ${others.length - 6} more`;
        rest.href = `${data.base}/card/${card.slug}/`;
        also.appendChild(rest);
      }
    }
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
  const closeCardSoon = () => {
    clearTimeout(panelTimer);
    panelTimer = window.setTimeout(() => closeCard(), 320);
  };

  function openReference(title: string): void {
    const card = data.cardData?.[title];
    if (!sheet || !card) return;
    sheet.querySelector<HTMLElement>(".reference__title")!.textContent = title;
    sheet.querySelector<HTMLElement>(".reference__body")!.innerHTML = card.body;
    const sub = sheet.querySelector<HTMLElement>(".reference__sub")!;
    sub.textContent = card.subtitle ?? "";
    sub.hidden = !card.subtitle;
    const fig = sheet.querySelector<HTMLElement>(".reference__figure")!;
    const img = sheet.querySelector<HTMLImageElement>(".reference__img")!;
    if (card.image) {
      img.src = card.image;
      img.alt = title;
      fig.hidden = false;
    } else fig.hidden = true;

    const links = sheet.querySelector<HTMLElement>(".reference__links")!;
    links.textContent = "";
    for (const [href, label] of [[card.external, "more about this"], [card.location, "where it is"]] as const) {
      if (!href) continue;
      const a = document.createElement("a");
      a.className = "reference__link";
      a.href = href.replace(/^http:\/\//, "https://");
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = label;
      links.appendChild(a);
    }
    links.hidden = !links.childElementCount;

    sheet.hidden = false;
    closeCard(true);
    if (!video!.paused) {
      held = true;
      video!.pause();
    }
  }
  function closeReference(): void {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (held) {
      held = false;
      void video!.play();
    }
  }
  panel?.addEventListener("pointerenter", () => clearTimeout(panelTimer));
  panel?.addEventListener("pointerleave", closeCardSoon);
  panel?.querySelector(".cardpanel__close")?.addEventListener("click", () => closeCard(true));
  panel?.querySelector(".cardpanel__more")
    ?.addEventListener("click", () => openReference(panel.dataset.card ?? ""));
  sheet?.querySelector(".reference__close")?.addEventListener("click", closeReference);
  sheet?.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".reference__sheet")) closeReference();
  });
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeReference();
    closeCard(true);
  });

  // the name in the now-line, and every mark on the timeline
  function wireCard(el: HTMLElement, title: string): void {
    el.addEventListener("pointerenter", () => openCard(title));
    el.addEventListener("pointerleave", closeCardSoon);
    el.addEventListener("focus", () => openCard(title));
    el.addEventListener("click", () => openCard(title, true));
  }

  layoutScrub();
}
