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
import { makeTitleCard } from "./titlecard";
import { makeMode } from "./mode";

interface Item {
  slug: string;
  name: string;
  jobtitle: string;
  hls: string;
  start: number;
  end: number;
  cards: { time: number; title: string; id: string }[];
}

interface Data {
  items: Item[];
  topic: { label: string; colour: string };
  base: string;
  cards: Record<string, {
    slug: string;
    body: string;
    subtitle?: string | null;
    image?: string | null;
    external?: string | null;
    location?: string | null;
    also: { slug: string; name: string; time: number; topicId: string | null; topicLabel: string | null }[];
  }>;
  music: { tracks: string[]; seed: number };
  field: { slug: string; label: string; voices: number }[];
  speakerTopics: Record<string, string[]>;
  people: { slug: string; name: string; jobtitle: string }[];
  here: string;
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
  let seeking = false;
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

  function loading(on: boolean): void {
    projection.classList.toggle("is-loading", on);
  }

  function dim(on: boolean): void {
    projection.classList.toggle("is-dimmed", on);
    // The bed follows the picture: gone means music, arrived means speech.
    if (on) score?.swell();
    else score?.under();
  }

  // The topic (left title) is the constant of the page; the speaker (right
  // title) changes with every cut — the "change of slide".
  const titleCard = makeTitleCard(root);
  const barName = root.querySelector<HTMLElement>(".titlebar__name");
  const barJob = root.querySelector<HTMLElement>(".titlebar__job");

  function setTitles(item: Item): void {
    // write into the door, not over it
    const label = titleR?.querySelector<HTMLElement>(".peopledoor") ?? titleR;
    if (label) label.textContent = item.name;
    if (barName) {
      const link = barName.querySelector<HTMLAnchorElement>(".titlebar__link");
      if (link) {
        link.textContent = item.name;
        link.href = `${data.base}/interview/${item.slug}/`;
      } else {
        barName.textContent = item.name;
      }
    }
    if (barJob) barJob.textContent = item.jobtitle;
    titleCard.show();   // a cut changes the answer, so say it again
    axis.update();

  }

  async function playItem(i: number, viaGesture = false, at?: number): Promise<void> {
    const t0 = performance.now();
    current = i;
    const item = items[i];
    const from = at ?? item.start;
    const standby = els[1 - active];
    const el = singleMode ? els[0] : standby;

    if (!singleMode && !viaGesture) {
      // standby should already be parked on item.start
    } else {
      await attach(el, item.hls, from);
      if (el.readyState >= 1) el.currentTime = from;
      else el.addEventListener("loadedmetadata", () => (el.currentTime = from), { once: true });
    }
    // a parked element sits on the in-point; a reference asks for a later one
    if (at !== undefined && !viaGesture) {
      if (el.readyState >= 1) el.currentTime = at;
      else el.addEventListener("loadedmetadata", () => (el.currentTime = at), { once: true });
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
      seeking = true;
      old.pause();
      seeking = false;
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
    if (el.readyState >= 3) { loading(false); undim(); }
    else el.addEventListener("playing", () => { loading(false); undim(); }, { once: true });

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
    markTicks(pos / total);
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
  const fmt = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
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
    panel.dataset.card = title;

    // Who else raises this, and can we get there from here? An appearance
    // inside this cross-cut is a jump; one outside it is a link into that
    // person's own interview, at the moment they say it.
    const also = panel.querySelector<HTMLElement>(".cardpanel__also")!;
    also.textContent = "";
    const others = (card.also ?? []).filter(
      (a) => !(current >= 0 && a.slug === items[current].slug &&
               Math.abs(a.time - els[active].currentTime) < 30),
    );
    if (others.length) {
      // What you can reach without leaving comes first; a long tail belongs on
      // the reference's own page, not crammed into a panel over the film.
      const ranked = others
        .map((a) => ({
          a,
          here: items.findIndex(
            (it) => it.slug === a.slug && a.time >= it.start && a.time < it.end,
          ),
        }))
        .sort((x, y) => (y.here >= 0 ? 1 : 0) - (x.here >= 0 ? 1 : 0));
      const SHOWN = 6;

      const lead = document.createElement("p");
      lead.className = "cardpanel__alsolead";
      lead.textContent = others.length === 1 ? "also raised by" : `also raised by ${others.length} others`;
      also.appendChild(lead);

      for (const { a, here } of ranked.slice(0, SHOWN)) {
        const mk = (cls: string, text: string) => {
          const n = document.createElement("span");
          n.className = cls;
          n.textContent = text;
          return n;
        };
        const fill = (node: HTMLElement) => {
          node.appendChild(mk("cardpanel__who", a.name));
          if (a.topicLabel) node.appendChild(mk("cardpanel__topic", a.topicLabel));
          node.appendChild(mk("cardpanel__at", fmt(a.time)));
        };
        if (here >= 0) {
          const b = document.createElement("button");
          b.className = "cardpanel__jump";
          fill(b);
          x
          b.addEventListener("click", () => {
            closeCard(true);
            dim(true);
            void playItem(here, true, Math.max(a.time - 4, items[here].start));
          });
          also.appendChild(b);
        } else {
          const link = document.createElement("a");
          link.className = "cardpanel__jump cardpanel__jump--away";
          fill(link);
          link.title = `${a.name}'s interview, at this moment`;
          link.href = `${data.base}/interview/${a.slug}/#t=${a.time.toFixed(1)}`;
          also.appendChild(link);
        }
      }

      if (others.length > SHOWN) {
        const rest = document.createElement("a");
        rest.className = "cardpanel__jump cardpanel__rest";
        rest.textContent = `and ${others.length - SHOWN} more`;
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

  // a moment's grace, so the pointer can travel from the name into the panel
  function closeSoon(): void {
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => closeCard(), 320);
  }

  // Hovering shows you enough to decide. Asking for the whole thing is a
  // different act: the film waits, because you have chosen to read rather
  // than to watch, and it is still there when you close it.
  const sheet = document.querySelector<HTMLElement>(".reference");
  let heldByReference = false;

  function openReference(title: string): void {
    const card = data.cards[title];
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
    } else {
      fig.hidden = true;
    }
    // where it is, and where to read more: the two links the 2014 blocks had
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
    if (!els[active].paused) {
      heldByReference = true;
      els[active].pause();
      projection.classList.remove("is-playing");
    }
    sheet.querySelector<HTMLButtonElement>(".reference__close")!.focus();
  }

  function closeReference(): void {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    if (heldByReference) {
      heldByReference = false;
      void els[active].play().then(() => projection.classList.add("is-playing"));
    }
  }

  panel?.querySelector<HTMLButtonElement>(".cardpanel__more")
    ?.addEventListener("click", () => openReference(panel.dataset.card ?? ""));
  sheet?.querySelector<HTMLButtonElement>(".reference__close")
    ?.addEventListener("click", closeReference);
  sheet?.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".reference__sheet")) closeReference();
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeReference(); });

  panel?.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  panel?.addEventListener("pointerleave", closeSoon);
  panel?.querySelector<HTMLButtonElement>(".cardpanel__close")
    ?.addEventListener("click", () => closeCard(true));
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(true); });

  // --- the bed -------------------------------------------------------------
  // Music the tool steers: up while a film is being fetched, under while
  // somebody talks. Nothing is baked into the video.
  const score = makeScore(data.music?.tracks ?? [], data.music?.seed ?? 0);
  if (debug) {
    (window as unknown as { cpmbScore: unknown }).cpmbScore = score;
    setInterval(() => score && report(`bed ${JSON.stringify(score.state)}`), 2000);
  }

  // --- references on the timeline ------------------------------------------
  // Every name this cross-cut raises, standing on the scrub where it is
  // raised. Ahead of the playhead they are things coming; behind, things
  // already said. Either way they are clickable, so a reference is somewhere
  // you can go rather than something you had to be present for.
  function posOf(i: number, t: number): number {
    const item = items[i];
    const within = Math.min(Math.max(t - item.start, 0), item.end - item.start);
    return (offsets[i] + within) / total;
  }

  const ticks: { el: HTMLButtonElement; at: number }[] = [];
  function layoutCards(): void {
    if (!scrub) return;
    for (const el of scrub.querySelectorAll(".scrub__card")) el.remove();
    ticks.length = 0;
    items.forEach((item, i) => {
      for (const c of item.cards) {
        const at = posOf(i, c.time);
        const b = document.createElement("button");
        b.className = "scrub__card";
        b.style.left = `${at * 100}%`;
        b.title = `${c.title} — ${item.name}`;
        b.setAttribute("aria-label", `${c.title}, raised by ${item.name}`);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          dim(true);
          void playItem(i, true, Math.max(c.time - 4, item.start));
        });
        b.addEventListener("pointerenter", () => openCard(c.title));
        b.addEventListener("pointerleave", closeSoon);
        scrub.appendChild(b);
        ticks.push({ el: b, at });
      }
    });
  }
  function markTicks(pos: number): void {
    for (const t of ticks) t.el.classList.toggle("is-past", t.at < pos - 0.001);
  }

  // --- the topic field -----------------------------------------------------
  // One word on the left is the only sign of where you are. Lean on it and the
  // rest of the archive stands up behind it — same hover grammar as a
  // reference, same rule: the film keeps talking.
  const door = root.querySelector<HTMLButtonElement>(".topicdoor");
  const peopleDoor = root.querySelector<HTMLButtonElement>(".peopledoor");
  const fieldEl = document.querySelector<HTMLElement>(".topicfield");
  const fieldRow = fieldEl?.querySelector<HTMLElement>(".topicfield__row");
  let fieldPinned = false;
  let fieldTimer: number | undefined;
  let fieldOpenedAt = 0;
  let mode: "topics" | "people" = "topics";

  const topicLabel = new Map(data.field.map((t) => [t.slug, t.label]));

  function heading(text: string): HTMLElement {
    const h = document.createElement("h3");
    h.className = "topicfield__head";
    h.textContent = text;
    return h;
  }

  function list(): HTMLUListElement {
    const ul = document.createElement("ul");
    ul.className = "topicfield__list";
    return ul;
  }

  function entry(label: string, href: string, active: boolean, i: number): HTMLLIElement {
    const li = document.createElement("li");
    li.style.setProperty("--i", String(i));
    const a = document.createElement("a");
    a.className = active ? "topicfield__item is-current" : "topicfield__item";
    a.href = href;
    a.textContent = label;
    li.appendChild(a);
    return li;
  }

  // The 2014 menu, which was a list and not a cloud: what the person on screen
  // covers, then everyone else's. Same for the people door: who is in this
  // cross-cut, then the whole archive.
  function buildField(): void {
    if (!fieldRow) return;
    fieldRow.textContent = "";
    let i = 0;

    if (mode === "topics") {
      const who = current >= 0 ? items[current] : items[0];
      const theirs = (data.speakerTopics[who.slug] ?? []).filter((t) => topicLabel.has(t));
      const rest = data.field.map((t) => t.slug).filter((t) => !theirs.includes(t));

      fieldRow.appendChild(heading(`${who.name} on`));
      const a = list();
      for (const t of theirs)
        a.appendChild(entry(topicLabel.get(t)!, `${data.base}/topic/${t}/`, t === data.here, i++));
      fieldRow.appendChild(a);

      fieldRow.appendChild(heading("others on"));
      const b = list();
      for (const t of rest)
        b.appendChild(entry(topicLabel.get(t)!, `${data.base}/topic/${t}/`, t === data.here, i++));
      fieldRow.appendChild(b);
    } else {
      const inCut: string[] = [];
      for (const it of items) if (!inCut.includes(it.slug)) inCut.push(it.slug);
      const here = current >= 0 ? items[current].slug : null;

      fieldRow.appendChild(heading(`on ${data.topic.label.toLowerCase()}`));
      const a = list();
      inCut.forEach((slug) => {
        const p = data.people.find((x) => x.slug === slug);
        if (!p) return;
        const li = entry(p.name, `${data.base}/interview/${slug}/`, slug === here, i++);
        // inside this cross-cut, their turn is a jump rather than a page
        li.querySelector("a")!.addEventListener("click", (e) => {
          e.preventDefault();
          const n = items.findIndex((it) => it.slug === slug);
          if (n < 0) return;
          closeField(true);
          dim(true);
          void playItem(n, true);
        });
        a.appendChild(li);
      });
      fieldRow.appendChild(a);

      fieldRow.appendChild(heading("whole interviews"));
      const b = list();
      for (const p of data.people)
        b.appendChild(entry(p.name, `${data.base}/interview/${p.slug}/`, false, i++));
      fieldRow.appendChild(b);
    }
  }

  function openField(which: "topics" | "people", pin = false): void {
    if (!fieldEl) return;
    clearTimeout(fieldTimer);
    if (pin) fieldPinned = true;
    mode = which;
    buildField();
    if (fieldEl.hidden) fieldOpenedAt = performance.now();
    clearTimeout(leaving);
    fieldEl.classList.remove("is-leaving");
    fieldEl.hidden = false;
    door?.setAttribute("aria-expanded", String(which === "topics"));
    peopleDoor?.setAttribute("aria-expanded", String(which === "people"));
    projection.classList.add("is-recessed");
    root.classList.add("is-fielded");
  }

  let leaving: number | undefined;
  function closeField(force = false): void {
    if (!fieldEl || fieldEl.hidden) return;
    if (fieldPinned && !force) return;
    fieldPinned = false;
    door?.setAttribute("aria-expanded", "false");
    peopleDoor?.setAttribute("aria-expanded", "false");
    projection.classList.remove("is-recessed");
    root.classList.remove("is-fielded");
    fieldEl.classList.add("is-leaving");
    clearTimeout(leaving);
    leaving = window.setTimeout(() => {
      fieldEl.hidden = true;
      fieldEl.classList.remove("is-leaving");
    }, 300);
  }
  function closeFieldSoon(): void {
    clearTimeout(fieldTimer);
    fieldTimer = window.setTimeout(() => closeField(), 360);
  }

  for (const [btn, which] of [[door, "topics"], [peopleDoor, "people"]] as const) {
    btn?.addEventListener("pointerenter", () => openField(which));
    btn?.addEventListener("pointerleave", closeFieldSoon);
    btn?.addEventListener("focus", () => openField(which));
    btn?.addEventListener("click", () => {
      if (fieldEl?.hidden || mode !== which || performance.now() - fieldOpenedAt < 500) openField(which, true);
      else closeField(true);
    });
  }
  fieldEl?.addEventListener("pointerenter", () => clearTimeout(fieldTimer));
  fieldEl?.addEventListener("pointerleave", closeFieldSoon);
  fieldEl?.querySelector(".topicfield__close")?.addEventListener("click", () => closeField(true));
  fieldEl?.addEventListener("click", (e) => {
    if (!(e.target as Element).closest(".topicfield__item")) closeField(true);
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeField(true); });

  // --- bloom ---------------------------------------------------------------
  const bloomer = makeBloom(bloom);
  function paintBloom(): void {
    if (reducedMotion && !els[active].paused) return;
    bloomer.paint(els[active]);
  }

  // A stall is a gap like any other: the bed covers it, the way a cut is
  // covered, so waiting sounds like part of the film rather than a fault.
  for (const el of els) {
    el.addEventListener("waiting", () => {
      if (el !== els[active]) return;
      score?.swell();
      loading(true);
    });
    el.addEventListener("playing", () => {
      if (el !== els[active]) return;
      score?.under();
      loading(false);
    });
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
      score?.under();
    } else {
      els[active].pause();
      projection.classList.remove("is-playing");
      score?.out();
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
  async function autostart(first = 0): Promise<void> {
    try {
      await playItem(first, true);
      if (!els[active].paused) { score?.allow(); return; }
    } catch { /* fall through to muted */ }
    for (const el of els) el.muted = true;
    projection.classList.add("is-muted");
    try {
      await playItem(first, true);
      report("started muted — click for sound");
    } catch {
      pendingStart = first;
      current = -1;
      report("tap to start");
    }
  }

  function unmute(): void {
    if (!projection.classList.contains("is-muted")) return;
    for (const el of els) el.muted = false;
    projection.classList.remove("is-muted");
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

  // On this page the theme is fixed and the speakers change under it.
  const axis = makeMode(root, {
    kind: "theme",
    base: data.base,
    theme: { slug: data.here, label: data.topic.label, colour: data.topic.colour },
    get speaker() {
      const it = items[current < 0 ? 0 : current];
      return { slug: it.slug, name: it.name };
    },
    at: () => els[active].currentTime,
    count: { n: new Set(items.map((i) => i.slug)).size, noun: "speaker" },
  });

  // Arriving from the switch: start on the speaker you were already hearing.
  const from = new URLSearchParams(location.search).get("from");
  if (from) {
    const n = items.findIndex((i) => i.slug === from);
    if (n > 0) pendingStart = n;
  }

  layoutCards();
  loading(true);          // Cedric holds the frame until a picture arrives
  score?.swell();
  void autostart(pendingStart);
}
