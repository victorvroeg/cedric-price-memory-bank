// Which way are you moving through the archive?
//
// There are two, and they are the whole idea: along a theme, where the
// speakers change under you, or along a speaker, where the themes do. Until
// now that was something a visitor had to infer from which edge was lit.
//
// Three things say it here. A caption on the timeline, naming what the
// timeline is a picture of. A switch carrying both axes, so the other one is
// visible and reachable rather than hypothetical. And, the first couple of
// times, a line announcing the change, because the concept is easier to catch
// once than to deduce twice.

export interface Mode {
  /** "theme": speakers change under a fixed theme. "speaker": the reverse. */
  kind: "theme" | "speaker";
  base: string;
  theme: { slug: string; label: string; colour: string };
  speaker: { slug: string; name: string };
  /** where to pick the film up from, when crossing to the other axis */
  at(): number;
  /** what the timeline is showing, e.g. "8 speakers" or "10 themes" */
  count: { n: number; noun: string };
}

const SEEN = "cpmb-mode-explained";
const ANNOUNCE_TIMES = 2;

export function makeMode(root: HTMLElement, m: Mode): { update(): void } {
  caption(root, m);
  const refresh = switcher(root, m);
  announce(root, m);
  return { update: refresh };
}

function caption(root: HTMLElement, m: Mode): void {
  const slot = root.querySelector<HTMLElement>(".scrubcaption");
  if (!slot) return;
  const { n, noun } = m.count;
  slot.textContent =
    m.kind === "theme"
      ? `${n} ${noun}${n === 1 ? "" : "s"} on ${m.theme.label}`
      : `${n} ${noun}${n === 1 ? "" : "s"} in this interview`;
}

function switcher(root: HTMLElement, m: Mode): () => void {
  const el = root.querySelector<HTMLElement>(".modeswitch");
  if (!el) return () => {};
  el.textContent = "";

  let v_colour_holder: HTMLElement | null = null;
  const side = (
    kind: "theme" | "speaker",
    label: string,
    value: string,
    href: () => string,
  ): HTMLElement => {
    const live = kind === m.kind;
    const node = document.createElement(live ? "span" : "a");
    node.className = live ? "modeswitch__side is-live" : "modeswitch__side";
    if (!live) {
      const a = node as HTMLAnchorElement;
      a.href = href();
      // the film has moved on since this was built; ask again on the way out
      a.addEventListener("pointerdown", () => (a.href = href()));
      a.addEventListener("focus", () => (a.href = href()));
    }
    if (kind === "theme") node.style.setProperty("--c", m.theme.colour);
    if (kind === "theme") v_colour_holder = node;

    const k = document.createElement("span");
    k.className = "modeswitch__axis";
    k.textContent = label;
    const v = document.createElement("span");
    v.className = "modeswitch__value";
    v.textContent = value;
    node.append(k, v);
    return node;
  };

  // Crossing over keeps your place: into the speaker's own film at the second
  // you were on, or into the theme's cross-cut starting with the speaker you
  // were already listening to.
  const toSpeaker = () =>
    `${m.base}/interview/${m.speaker.slug}/?mode=1#t=${m.at().toFixed(1)}`;
  const toTheme = () => `${m.base}/topic/${m.theme.slug}/?mode=1&from=${m.speaker.slug}`;

  el.append(
    side("theme", "Theme", m.theme.label, toTheme),
    Object.assign(document.createElement("span"), {
      className: "modeswitch__sep",
      textContent: "·",
    }),
    side("speaker", "Speaker", m.speaker.name, toSpeaker),
  );

  // Whichever axis is not fixed keeps moving, and the switch has to say so.
  const values = el.querySelectorAll<HTMLElement>(".modeswitch__value");
  return () => {
    const [t, sp] = values;
    if (t && t.textContent !== m.theme.label) t.textContent = m.theme.label;
    v_colour_holder?.style.setProperty("--c", m.theme.colour);
    if (sp && sp.textContent !== m.speaker.name) sp.textContent = m.speaker.name;
  };
}

function announce(root: HTMLElement, m: Mode): void {
  const el = root.querySelector<HTMLElement>(".modesay");
  if (!el) return;

  const arrivedBySwitch = new URLSearchParams(location.search).has("mode");
  let seen = 0;
  try {
    seen = Number(sessionStorage.getItem(SEEN) ?? 0);
  } catch { /* private browsing */ }
  if (!arrivedBySwitch && seen >= ANNOUNCE_TIMES) return;
  try {
    sessionStorage.setItem(SEEN, String(seen + 1));
  } catch { /* ignore */ }

  el.innerHTML = "";
  const lead = document.createElement("span");
  lead.className = "modesay__lead";
  lead.textContent = "now following";
  const what = document.createElement("span");
  what.className = "modesay__what";
  if (m.kind === "theme") {
    what.textContent = m.theme.label;
    what.style.color = m.theme.colour;
  } else {
    what.textContent = m.speaker.name;
  }
  el.append(lead, what);
  el.hidden = false;
  el.classList.add("is-on");
  setTimeout(() => el.classList.remove("is-on"), 2600);
  setTimeout(() => (el.hidden = true), 3400);
}
